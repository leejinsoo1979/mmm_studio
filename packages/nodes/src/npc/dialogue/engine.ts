import { pointInPolygon } from '@pascal-app/core'
import { withJosa } from '../josa'
import type { DialogueAction, DialogueChoice, DialogueGraph, DialogueLine } from '../schema'
import type { RoomFact, SceneFacts } from '../types'
import { formatArea, renderTemplate, type TemplateVars } from './templates'

/**
 * The scripted conversation, pure: entering a line and picking a choice give
 * the text to show and the effects on the world. The dialogue store plays
 * them; the inspector's preview runs the same steps.
 */

/** What a step asks of the world. `say` is an extra NPC line (a room described, a guide's word). */
export type DialogueEffect =
  | { kind: 'follow' | 'stopFollow' | 'end' | 'askAi' }
  | { kind: 'guideTo'; roomId: string }
  | { kind: 'emote'; id: string }
  | { kind: 'say'; text: string }

/** `askAi`: picking it opens AI chat, so it is hidden while the AI can't answer. */
export type RenderedChoice = { id: string; label: string; askAi: boolean }

export type RenderedLine = {
  id: string
  text: string
  emote: string | null
  /** Shown choices: the line's own that its flags allow, and its room menu. */
  choices: RenderedChoice[]
  /** Where the line continues when it shows no choice; null ends the conversation. */
  next: string | null
}

export type DialogueContext = {
  flags: ReadonlySet<string>
  vars: TemplateVars
  facts: SceneFacts | null
  /** The NPC's level: its rooms make the room menu and the tour. */
  levelId: string | null
  /** The room the player stands in. */
  roomId: string | null
  /** Where the tour begins (the spawn's room); null starts at the largest room. */
  tourStart: string | null
  /** Rooms the tour has shown; `@next` never goes back to one. */
  visited: readonly string[]
}

export type EnterResult = { line: RenderedLine; effects: DialogueEffect[]; flags: Set<string> }

export type ChooseResult = {
  next: string | null
  /** The choice as the player said it (for the transcript). */
  label: string
  effects: DialogueEffect[]
  flags: Set<string>
}

/** Choice keys run 1–9, so a room menu fills the list up to this many. */
export const MAX_CHOICES = 9

const ROOM_CHOICE = 'room:'

const TOUR_DONE = '이제 모든 방을 다 둘러보셨어요.'
const ROOM_UNREACHABLE = '그 방은 지금 안내해 드리기 어려워요.'
const NOTHING_TO_DESCRIBE = '이곳은 따로 소개해 드릴 정보가 없어요.'

const findLine = (graph: DialogueGraph, id: string) => graph.lines.find((line) => line.id === id)

const shown = (choice: DialogueChoice, flags: ReadonlySet<string>) =>
  choice.requires.every((flag) => flags.has(flag)) && !choice.hideIf.some((flag) => flags.has(flag))

const largerFirst = (a: RoomFact, b: RoomFact) =>
  b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function roomsOn(facts: SceneFacts | null, levelId: string | null): RoomFact[] {
  if (!facts) return []
  return levelId === null ? facts.rooms : facts.rooms.filter((room) => room.levelId === levelId)
}

/**
 * The rooms of a level in tour order: breadth-first through the doors from
 * `startId` (larger rooms first among neighbours), then the rooms no door
 * reaches, largest first.
 */
export function tourOrder(
  facts: SceneFacts | null,
  levelId: string | null,
  startId: string | null,
): RoomFact[] {
  const rooms = roomsOn(facts, levelId)
  const byId = new Map(rooms.map((room) => [room.id, room]))
  const ranked = [...rooms].sort(largerFirst)
  const start = (startId ? byId.get(startId) : undefined) ?? ranked[0]
  if (!start) return []

  const order: RoomFact[] = []
  const seen = new Set([start.id])
  const queue = [start]
  for (let room = queue.shift(); room; room = queue.shift()) {
    order.push(room)
    const neighbours = room.doorsTo
      .map((id) => byId.get(id))
      .filter((next): next is RoomFact => next !== undefined && !seen.has(next.id))
      .sort(largerFirst)
    for (const next of neighbours) {
      seen.add(next.id)
      queue.push(next)
    }
  }
  for (const room of ranked) if (!seen.has(room.id)) order.push(room)
  return order
}

/** The room of `levelId` holding the level-local point `p` (the smallest, where rooms overlap). */
export function roomAt(
  facts: SceneFacts | null,
  levelId: string | null,
  p: [number, number] | null,
): RoomFact | null {
  if (!p) return null
  let found: RoomFact | null = null
  for (const room of roomsOn(facts, levelId)) {
    if (!pointInPolygon(p[0], p[1], room.polygon)) continue
    if (!found || room.area < found.area) found = room
  }
  return found
}

/** A room described aloud from its facts; `here` when the player stands in it. */
export function describeRoomKo(room: RoomFact, here: boolean): string {
  const area = `약 ${formatArea(room.area)}㎡`
  let text = here
    ? `여기는 ${withJosa(room.name, '이에요', '예요')}. 면적은 ${area}`
    : `${withJosa(room.name, '은', '는')} 면적이 ${area}`
  text += room.floorMaterial
    ? `이고, 바닥은 ${withJosa(room.floorMaterial, '이에요', '예요')}.`
    : '예요.'
  const furniture = [...room.furniture]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(({ name, count }) => (count > 1 ? `${name} ${count}개` : name))
  if (furniture.length > 0) text += ` ${withJosa(furniture.join(', '), '이', '가')} 놓여 있어요.`
  if (room.windows > 0) text += ` 창이 ${room.windows}개 있어서 밝아요.`
  return text
}

/** The rooms a `roomMenu` line offers: the tour's, bar the player's own, as many as fit. */
function menuRooms(line: DialogueLine, ctx: DialogueContext): RoomFact[] {
  if (!line.roomMenu) return []
  const authored = line.choices.filter((choice) => shown(choice, ctx.flags)).length
  return tourOrder(ctx.facts, ctx.levelId, ctx.tourStart)
    .filter((candidate) => candidate.id !== ctx.roomId)
    .slice(0, Math.max(0, MAX_CHOICES - authored))
}

const roomLabel = (room: RoomFact) => `${withJosa(room.name, '으로', '로')} 가요`

function renderChoices(line: DialogueLine, ctx: DialogueContext): RenderedChoice[] {
  const rooms = menuRooms(line, ctx).map((room) => ({
    id: ROOM_CHOICE + room.id,
    label: roomLabel(room),
    askAi: false,
  }))
  const own = line.choices
    .filter((choice) => shown(choice, ctx.flags))
    .map((choice) => ({
      id: choice.id,
      label: renderTemplate(choice.label, ctx.vars),
      askAi: choice.actions.some((action) => action.kind === 'askAi'),
    }))
  return [...rooms, ...own]
}

/** Runs `actions` in order: flags change in `flags`, the rest become effects. */
function runActions(
  actions: readonly DialogueAction[],
  flags: Set<string>,
  ctx: DialogueContext,
): DialogueEffect[] {
  const effects: DialogueEffect[] = []
  const visited = [...ctx.visited]
  for (const action of actions) {
    switch (action.kind) {
      case 'setFlag':
        if (action.value) flags.add(action.flag)
        else flags.delete(action.flag)
        break
      case 'guideTo': {
        const room =
          action.room === '@next'
            ? tourOrder(ctx.facts, ctx.levelId, ctx.tourStart).find(
                (candidate) => candidate.id !== ctx.roomId && !visited.includes(candidate.id),
              )
            : roomsOn(ctx.facts, ctx.levelId).find((candidate) => candidate.id === action.room)
        if (room) {
          visited.push(room.id)
          effects.push({ kind: 'guideTo', roomId: room.id })
        } else {
          effects.push({
            kind: 'say',
            text: action.room === '@next' ? TOUR_DONE : ROOM_UNREACHABLE,
          })
        }
        break
      }
      case 'describeRoom': {
        const id = action.room ?? ctx.roomId
        const room = id ? ctx.facts?.rooms.find((candidate) => candidate.id === id) : undefined
        effects.push({
          kind: 'say',
          text: room ? describeRoomKo(room, room.id === ctx.roomId) : NOTHING_TO_DESCRIBE,
        })
        break
      }
      case 'emote':
        effects.push({ kind: 'emote', id: action.emote })
        break
      default:
        effects.push({ kind: action.kind })
    }
  }
  return effects
}

/** Enters line `lineId`: its `onEnter` actions run, then its text and choices render. Null for an
 *  unknown line (the conversation ends). */
export function enter(
  graph: DialogueGraph,
  lineId: string,
  ctx: DialogueContext,
): EnterResult | null {
  const line = findLine(graph, lineId)
  if (!line) return null
  const flags = new Set(ctx.flags)
  const effects = runActions(line.onEnter, flags, ctx)
  return {
    line: {
      id: line.id,
      text: renderTemplate(line.text, ctx.vars),
      emote: line.emote ?? null,
      choices: renderChoices(line, { ...ctx, flags }),
      next: line.next,
    },
    effects,
    flags,
  }
}

/**
 * Picks choice `choiceId` of line `lineId`: its actions run and the
 * conversation goes to `next`. A room-menu choice guides the player there and
 * goes on to the line's `next`, or back to the menu. Null when the line
 * doesn't offer that choice.
 */
export function choose(
  graph: DialogueGraph,
  lineId: string,
  choiceId: string,
  ctx: DialogueContext,
): ChooseResult | null {
  const line = findLine(graph, lineId)
  if (!line) return null
  const flags = new Set(ctx.flags)

  if (choiceId.startsWith(ROOM_CHOICE)) {
    const room = menuRooms(line, ctx).find((candidate) => ROOM_CHOICE + candidate.id === choiceId)
    if (!room) return null
    return {
      next: line.next ?? line.id,
      label: roomLabel(room),
      effects: [
        { kind: 'guideTo', roomId: room.id },
        {
          kind: 'say',
          text: `좋아요, ${withJosa(room.name, '으로', '로')} 안내할게요. 따라오세요!`,
        },
      ],
      flags,
    }
  }

  const choice = line.choices.find((candidate) => candidate.id === choiceId)
  if (!choice || !shown(choice, ctx.flags)) return null
  const effects = runActions(choice.actions, flags, ctx)
  return { next: choice.next, label: renderTemplate(choice.label, ctx.vars), effects, flags }
}
