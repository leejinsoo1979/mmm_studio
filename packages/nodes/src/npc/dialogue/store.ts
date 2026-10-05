import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { EMOTES, isEmoteId } from '@pascal-app/editor'
import { characterStatus, useViewer } from '@pascal-app/viewer'
import { Vector3 } from 'three'
import { create } from 'zustand'
import { collectSceneFacts, getNpcNameResolvers } from '../knowledge'
import { npcPoses, useNpcRuntime } from '../runtime/store'
import { DialogueGraph, type NpcNode } from '../schema'
import type {
  NpcChatErrorCode,
  NpcChatResult,
  NpcChatStatus,
  NpcChatTransport,
  NpcChatTurn,
  NpcDialogueCloseReason,
  NpcDialogueSurface,
  NpcEmoteCue,
  NpcEngagement,
  NpcNameResolvers,
  SceneFacts,
} from '../types'
import { npcSpeaking, speakNpc, stopNpcSpeech } from '../voice/engine'
import { getNpcChatTransport } from './chat-transport'
import {
  choose as chooseIn,
  type DialogueContext,
  type DialogueEffect,
  describeRoomKo,
  enter as enterIn,
  type RenderedChoice,
  roomAt,
} from './engine'
import { dayPartKo, sceneVars } from './templates'

/**
 * The local player's conversation with an NPC: who is talked to, what is on
 * the panel, the scripted and AI modes, and what talking does to the NPC
 * (its engagement, gestures, voice). The panel renders it; E (or the NPC
 * menu) calls `open`, the runtime calls `close('walkedAway')` and
 * `guideArrived`.
 */

export type NpcTranscriptEntry = { from: 'npc' | 'player'; text: string }

export type NpcDialogueMode = 'script' | 'ai'

export type NpcDialogueState = NpcDialogueSurface & {
  mode: NpcDialogueMode
  /** What was said before the current line, oldest first; kept per NPC for the session. */
  transcript: NpcTranscriptEntry[]
  /** The NPC's current line on the panel (`line` holds it only while it is being said). */
  text: string | null
  /** When `text` began typing out (ms); 0 shows it whole. */
  textAt: number
  /** The numbered choices, once the NPC has said its lines. */
  choices: RenderedChoice[]
  /** More is coming after this line: a click, Enter or Space moves on. */
  more: boolean
  /** An AI reply is on its way. */
  aiBusy: boolean
  /** The chat route's last answer (null until asked, or without a transport). */
  aiStatus: NpcChatStatus | null
  /** AI chat can go back to the scripted choices. */
  canReturn: boolean
  /**
   * Gestures the conversation gives NPCs, on the shared clock: a nod hello, a
   * line's emote, thinking over a question, a wave goodbye. The NPC brain
   * plays each NPC's cue among its own.
   */
  emotes: Record<string, NpcEmoteCue>
  /** A short note under the panel ("다른 방문자와 대화 중이에요"). */
  notice: string | null
  /** The player's name for `{player}` and the AI; the app sets it. */
  playerName: string | null
  choose(choiceId: string): void
  /** Shows the whole line, or moves on to what comes after it. */
  advance(): void
  /** Asks the AI; false when the question can't go now (empty, too soon, a reply pending). */
  send(text: string): boolean
  backToChoices(): void
  /** A guide reached `roomId` (called on the guiding player's client): it describes the room. */
  guideArrived(npcId: string, roomId: string): void
  refreshAiStatus(): void
  setPlayerName(name: string | null): void
}

/** A held engagement nobody refreshed for this long is free (the runtime's rule too). */
const ENGAGEMENT_EXPIRY_MS = 120_000
/** How long the NPC says a line at least, and per character. */
const LINE_MIN_MS = 2500
const LINE_MS_PER_CHAR = 60
/** The voice may take longer: it is waited for, up to this much more per character. */
const VOICE_WAIT_MS_PER_CHAR = 200
const VOICE_POLL_MS = 200
/** The panel's typewriter pace. */
export const NPC_TYPE_MS_PER_CHAR = 30
export const NPC_MESSAGE_MAX = 500
const SEND_COOLDOWN_MS = 1500
const MAX_QUESTIONS = 20
/** AI turns sent with a question (the route reads no more). */
const HISTORY_TURNS = 12
/** The chat route's limits on a turn and on the player's name. */
const TURN_MAX = 600
const PLAYER_NAME_MAX = 24
/** A line other players see over the NPC; the world doc keeps entries small. */
const SHARED_LINE_MAX = 140
const TRANSCRIPT_MAX = 60
const NOTICE_MS = 3000
/** A gesture starts just after the talk loop the body plays while a line is said, as the body
 *  plays whichever began last. */
const GESTURE_DELAY_MS = 120

const SAY = {
  hello: '안녕하세요!',
  aiHello: '안녕하세요! 무엇이 궁금하세요?',
  aiIntro: '네, 궁금한 걸 편하게 물어보세요.',
  bye: '안녕히 계세요',
  unavailable: '지금은 자세한 상담이 어려워요. 다른 질문이 있으면 골라 주세요.',
  unavailableAlone: '지금은 자세한 상담이 어려워요. 다음에 다시 찾아 주세요.',
  tooManyQuestions: '오늘은 이야기를 많이 나눴네요. 다음에 또 물어봐 주세요.',
  busy: '다른 방문자와 대화 중이에요',
  preempted: '다른 방문자가 먼저 말을 걸었어요',
  // `{player}님` reads well with it.
  guest: '방문객',
}

const ERROR_LINES: Record<Exclude<NpcChatErrorCode, 'unavailable'>, string> = {
  rate_limited: '잠시 후 다시 물어봐 주세요.',
  refusal: '그 이야기는 도와드리기 어려워요.',
  upstream: '잠깐 말이 막혔어요. 다시 한 번 물어봐 주세요.',
  network: '연결이 잠깐 끊겼어요. 다시 한 번 물어봐 주세요.',
}

/** What a player and an NPC keep between conversations this session. */
type NpcMemory = {
  flags: Set<string>
  transcript: NpcTranscriptEntry[]
  /** Rooms a tour has shown. */
  visited: string[]
  /** The NPC follows the player once the conversation ends. */
  following: boolean
  conversationId: string
  aiTurns: NpcChatTurn[]
  questions: number
}

/** A line the NPC says; `kind` tells the voice whether a reply token vouches for it. */
type Beat = { text: string; emote: string | null; kind: 'line' | 'ai'; token?: string }

/** What follows the last line said. */
type Continuation =
  | { kind: 'choices' }
  | { kind: 'goto'; lineId: string }
  | { kind: 'ai'; returnTo: string | null }
  | { kind: 'close' }

type Conversation = {
  npcId: string
  node: NpcNode
  graph: DialogueGraph
  /** The NPC has a graph of its own, which AI chat can go back to. */
  scripted: boolean
  memory: NpcMemory
  lineId: string | null
  /** The current line's choices, AI ones included. */
  choices: RenderedChoice[]
  pending: Beat[]
  after: Continuation
  /** The line "선택지로 돌아가기" returns to. */
  returnTo: string | null
  request: AbortController | null
  lastSendAt: number
  timer: ReturnType<typeof setTimeout> | null
}

const memories = new Map<string, NpcMemory>()
let active: Conversation | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null

const said = (text: string): Beat => ({ text, emote: null, kind: 'line' })

/** A v4 UUID for the chat route. `crypto.randomUUID` needs a secure context, which a phone on the
 *  LAN dev server is not. */
function uuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function memoryFor(npcId: string): NpcMemory {
  let memory = memories.get(npcId)
  if (!memory) {
    memory = {
      flags: new Set(),
      transcript: [],
      visited: [],
      following: false,
      conversationId: uuid(),
      aiTurns: [],
      questions: 0,
    }
    memories.set(npcId, memory)
  }
  return memory
}

function readNpc(id: string): NpcNode | null {
  const node = useScene.getState().nodes[id as AnyNodeId] as unknown as NpcNode | undefined
  return node?.type === 'npc' ? node : null
}

const heldByOther = (engagement: NpcEngagement, me: string, now: number) =>
  engagement.m !== 'free' && engagement.by !== me && now - engagement.at < ENGAGEMENT_EXPIRY_MS

const npcLevel = (c: Conversation) => npcPoses.get(c.npcId)?.levelId ?? c.node.parentId ?? null

/** Where the NPC stands (level-local XZ), as a fresh pair. */
function npcSpot(c: Conversation): [number, number] {
  const p = npcPoses.get(c.npcId)?.p
  return p ? [p[0], p[1]] : [c.node.position[0], c.node.position[2]]
}

const playerWorld = new Vector3()

/** The player's level-local XZ on `levelId`. */
function playerOn(levelId: string | null): [number, number] | null {
  const level = levelId ? sceneRegistry.nodes.get(levelId) : undefined
  if (!level) return null
  const local = level.worldToLocal(playerWorld.copy(characterStatus.position))
  return [local.x, local.z]
}

const PLAIN_NAMES: NpcNameResolvers = { item: (asset) => asset.name, material: (ref) => ref }
let factsCache: { nodes: unknown; names: unknown; facts: SceneFacts } | null = null

function sceneFacts(): SceneFacts {
  const nodes = useScene.getState().nodes
  const names = getNpcNameResolvers()
  if (factsCache?.nodes !== nodes || factsCache.names !== names) {
    factsCache = { nodes, names, facts: collectSceneFacts(nodes, names ?? PLAIN_NAMES) }
  }
  return factsCache.facts
}

const playerRoom = (facts: SceneFacts, levelId: string | null) =>
  roomAt(facts, levelId, playerOn(levelId))?.id ?? null

/** The in-game hour: the app lights the night from the sun's opposite hour. */
function clockHour(): number {
  const { sunTime, sceneTheme } = useViewer.getState()
  return sceneTheme === 'night' ? (sunTime + 12) % 24 : sunTime
}

/** Tours start where visitors do: the spawn's room, else the NPC's own. */
function tourStart(c: Conversation, facts: SceneFacts, levelId: string | null): string | null {
  const spawn = Object.values(useScene.getState().nodes).find(
    (node) => node.type === 'spawn' && node.parentId === levelId,
  )
  const from: [number, number] =
    spawn?.type === 'spawn' ? [spawn.position[0], spawn.position[2]] : npcSpot(c)
  return roomAt(facts, levelId, from)?.id ?? null
}

function context(c: Conversation): DialogueContext {
  const facts = sceneFacts()
  const levelId = npcLevel(c)
  const roomId = playerRoom(facts, levelId)
  return {
    flags: c.memory.flags,
    facts,
    levelId,
    roomId,
    tourStart: tourStart(c, facts, levelId),
    visited: c.memory.visited,
    vars: {
      player: useNpcDialogue.getState().playerName || SAY.guest,
      npc: c.node.name,
      time: dayPartKo(clockHour()),
      ...sceneVars(facts, levelId, roomId),
    },
  }
}

const aiReady = (c: Conversation) =>
  c.node.ai.enabled &&
  getNpcChatTransport() !== null &&
  useNpcDialogue.getState().aiStatus?.available !== false

const visibleChoices = (c: Conversation) =>
  aiReady(c) ? c.choices : c.choices.filter((choice) => !choice.askAi)

/** The emotes with the NPC's cue set to `id`, or dropped. */
function cue(npcId: string, id: string | null, at: number): Record<string, NpcEmoteCue> {
  const emotes = { ...useNpcDialogue.getState().emotes }
  if (id && isEmoteId(id)) emotes[npcId] = { id, at }
  else delete emotes[npcId]
  return emotes
}

/** The emotes without the NPC's looping gesture (a think, a present): it ends with its line. */
function endLoopCue(npcId: string): Record<string, NpcEmoteCue> {
  const emotes = useNpcDialogue.getState().emotes
  const current = emotes[npcId]
  if (!(current && isEmoteId(current.id) && EMOTES[current.id].loop)) return emotes
  const { [npcId]: _ended, ...rest } = emotes
  return rest
}

function remember(c: Conversation, ...entries: NpcTranscriptEntry[]): NpcTranscriptEntry[] {
  c.memory.transcript = [...c.memory.transcript, ...entries].slice(-TRANSCRIPT_MAX)
  return c.memory.transcript
}

function notify(text: string) {
  if (noticeTimer) clearTimeout(noticeTimer)
  useNpcDialogue.setState({ notice: text })
  noticeTimer = setTimeout(() => {
    noticeTimer = null
    useNpcDialogue.setState({ notice: null })
  }, NOTICE_MS)
}

function clearTimer(c: Conversation) {
  if (c.timer) clearTimeout(c.timer)
  c.timer = null
}

/** Holds the NPC for talking, facing the player. */
function holdForTalk(c: Conversation, by: string, at: number) {
  const p = npcSpot(c)
  const player = playerOn(npcLevel(c))
  const yaw = player
    ? Math.atan2(player[0] - p[0], player[1] - p[1])
    : (npcPoses.get(c.npcId)?.yaw ?? c.node.rotation)
  useNpcRuntime.getState().setEngagement(c.npcId, { m: 'talk', by, at, p, yaw })
}

/** Lets the NPC go back to its day (or follow the player, if asked to) from where it stands. */
function release(c: Conversation) {
  const runtime = useNpcRuntime.getState()
  const held = runtime.engagements[c.npcId]
  if ((held?.m !== 'talk' && held?.m !== 'guide') || held.by !== runtime.localPlayerId) return
  const at = Date.now()
  const p = npcSpot(c)
  runtime.setEngagement(
    c.npcId,
    c.memory.following ? { m: 'follow', by: held.by, at, p } : { m: 'free', at, p },
  )
}

/** Shows a finished line to the other players, over the NPC. */
function shareLine(c: Conversation, text: string) {
  const runtime = useNpcRuntime.getState()
  const held = runtime.engagements[c.npcId]
  if ((held?.m === 'talk' || held?.m === 'guide') && held.by === runtime.localPlayerId) {
    runtime.setEngagement(c.npcId, { ...held, line: text.slice(0, SHARED_LINE_MAX) })
  }
}

function guide(c: Conversation, roomId: string) {
  const runtime = useNpcRuntime.getState()
  runtime.setEngagement(c.npcId, {
    m: 'guide',
    by: runtime.localPlayerId,
    at: Date.now(),
    p: npcSpot(c),
    room: roomId,
  })
  const here = playerRoom(sceneFacts(), npcLevel(c))
  for (const id of [here, roomId]) {
    if (id && !c.memory.visited.includes(id)) c.memory.visited.push(id)
  }
}

/**
 * Plays out a step's effects. Returns the extra lines to say, what follows
 * (an `end`, or AI chat coming back to `returnTo`) and a gesture.
 */
function applyEffects(c: Conversation, effects: DialogueEffect[], returnTo: string | null) {
  const says: Beat[] = []
  let after: Continuation | null = null
  let emote: string | null = null
  for (const effect of effects) {
    switch (effect.kind) {
      case 'say':
        says.push(said(effect.text))
        break
      case 'emote':
        emote = effect.id
        break
      case 'follow':
        c.memory.following = true
        break
      case 'stopFollow':
        c.memory.following = false
        break
      case 'guideTo':
        guide(c, effect.roomId)
        break
      case 'askAi':
        if (after?.kind !== 'close' && aiReady(c)) after = { kind: 'ai', returnTo }
        break
      case 'end':
        after = { kind: 'close' }
        break
    }
  }
  return { says, after, emote }
}

/** The NPC says `beat` now: on the panel (typing out, unless it streamed in), over its head,
 *  aloud, and to the other players. */
function show(c: Conversation, beat: Beat, streamed = false) {
  const state = useNpcDialogue.getState()
  const now = Date.now()
  const waiting = c.pending.length === 0 && c.after.kind === 'choices'
  useNpcDialogue.setState({
    transcript:
      state.text && !streamed ? remember(c, { from: 'npc', text: state.text }) : state.transcript,
    text: beat.text,
    textAt: streamed ? 0 : now,
    line: beat.text,
    more: !waiting,
    choices: waiting ? visibleChoices(c) : [],
    emotes: beat.emote ? cue(c.npcId, beat.emote, now + GESTURE_DELAY_MS) : endLoopCue(c.npcId),
  })
  shareLine(c, beat.text)
  speakNpc({ npcId: c.npcId, text: beat.text, kind: beat.kind, token: beat.token })
  waitForLine(c, beat.text, now)
}

/** Ends the line once it has been said: its reading time, then its voice (within reason). */
function waitForLine(c: Conversation, text: string, startedAt: number) {
  clearTimer(c)
  const readAt = startedAt + Math.max(LINE_MIN_MS, text.length * LINE_MS_PER_CHAR)
  const giveUpAt = readAt + text.length * VOICE_WAIT_MS_PER_CHAR
  const check = () => {
    c.timer = null
    if (active !== c) return
    const now = Date.now()
    if (now < giveUpAt && (now < readAt || npcSpeaking.has(c.npcId))) {
      c.timer = setTimeout(check, VOICE_POLL_MS)
      return
    }
    endLine(c)
  }
  c.timer = setTimeout(check, readAt - startedAt)
}

/** The line has been said: the next one, or what follows the last. */
function endLine(c: Conversation) {
  useNpcDialogue.setState({ line: null, emotes: endLoopCue(c.npcId) })
  const next = c.pending.shift()
  if (next) show(c, next)
  else proceed(c)
}

function proceed(c: Conversation) {
  const after = c.after
  switch (after.kind) {
    case 'goto':
      goTo(c, after.lineId)
      break
    case 'ai':
      startAi(c, SAY.aiIntro, after.returnTo)
      break
    case 'close':
      useNpcDialogue.getState().close('polite')
      break
    case 'choices':
      useNpcDialogue.setState({ more: false, choices: visibleChoices(c) })
  }
}

function play(c: Conversation, beats: Beat[], after: Continuation) {
  clearTimer(c)
  c.after = after
  c.pending = beats.slice(1)
  const first = beats[0]
  if (first) show(c, first)
  else proceed(c)
}

/** Enters line `lineId`, after `lead` (what the last choice had the NPC say) and with the
 *  choice's `gesture`. */
function goTo(c: Conversation, lineId: string, lead: Beat[] = [], gesture: string | null = null) {
  const result = enterIn(c.graph, lineId, context(c))
  if (!result) {
    play(c, lead, { kind: 'close' })
    return
  }
  const { line } = result
  c.memory.flags = result.flags
  c.lineId = line.id
  c.choices = line.choices
  const { says, after, emote } = applyEffects(c, result.effects, line.next)
  const beats: Beat[] = [...lead, { text: line.text, emote: line.emote ?? emote, kind: 'line' }]
  beats.push(...says)
  if (gesture && !beats[0]!.emote) beats[0]!.emote = gesture
  const next: Continuation =
    after ??
    (visibleChoices(c).length > 0
      ? { kind: 'choices' }
      : line.next
        ? { kind: 'goto', lineId: line.next }
        : { kind: 'close' })
  play(c, beats, next)
}

function startAi(c: Conversation, text: string, returnTo: string | null) {
  c.returnTo = returnTo
  c.lineId = null
  c.choices = []
  useNpcDialogue.setState({ mode: 'ai', canReturn: c.scripted, choices: [] })
  play(c, [said(text)], { kind: 'choices' })
}

/** A one-line conversation for an NPC without its own graph: a greeting, then goodbye. */
const greetingGraph = (text: string) =>
  DialogueGraph.parse({
    start: 'hello',
    lines: [{ id: 'hello', text, choices: [{ id: 'bye', label: SAY.bye }] }],
  })

/** The AI can't answer: back to the script, or a goodbye for an NPC without one. */
function unavailable(c: Conversation) {
  const voice = useNpcDialogue.getState().aiStatus?.voice ?? 'browser'
  useNpcDialogue.setState({
    mode: 'script',
    canReturn: false,
    aiStatus: { available: false, voice },
  })
  if (c.scripted) {
    play(c, [said(SAY.unavailable)], { kind: 'goto', lineId: c.returnTo ?? c.graph.start })
  } else {
    c.graph = greetingGraph(SAY.unavailableAlone)
    goTo(c, c.graph.start)
  }
}

/** Drops a question still waiting for its reply, as if never asked. */
function cancelQuestion(c: Conversation) {
  if (!useNpcDialogue.getState().aiBusy) return
  c.request?.abort()
  c.request = null
  c.memory.aiTurns.pop()
  c.memory.questions -= 1
  useNpcDialogue.setState({ aiBusy: false, text: null, line: null })
}

/** The recent AI turns, opening with a question as the route expects. */
function chatHistory(turns: NpcChatTurn[]): NpcChatTurn[] {
  const recent = turns.slice(-HISTORY_TURNS)
  while (recent[0]?.role === 'assistant') recent.shift()
  return recent
}

async function ask(c: Conversation, transport: NpcChatTransport) {
  const request = new AbortController()
  c.request = request
  const live = () => active === c && c.request === request
  const levelId = npcLevel(c)
  const roomId = playerRoom(sceneFacts(), levelId)
  let reply = ''
  let result: NpcChatResult
  try {
    result = await transport.send(
      {
        npcId: c.npcId,
        conversationId: c.memory.conversationId,
        messages: chatHistory(c.memory.aiTurns),
        context: { ...(roomId ? { roomId } : {}), ...(levelId ? { levelId } : {}) },
        playerName: useNpcDialogue.getState().playerName?.slice(0, PLAYER_NAME_MAX) || undefined,
        signal: request.signal,
      },
      (delta) => {
        if (!live()) return
        if (!reply) useNpcDialogue.setState({ emotes: endLoopCue(c.npcId) })
        reply += delta
        useNpcDialogue.setState({ text: reply, textAt: 0, line: reply })
      },
    )
  } catch {
    result = { ok: false, code: 'network' }
  }
  if (!live()) return
  c.request = null
  const answer = reply.trim()
  if (result.ok && answer) {
    c.memory.aiTurns.push({ role: 'assistant', text: answer.slice(0, TURN_MAX) })
    useNpcDialogue.setState({ aiBusy: false })
    show(c, { text: answer, emote: null, kind: 'ai', token: result.token }, true)
    return
  }
  // Unanswered: the question is taken back so the history stays question, answer, question …
  c.memory.aiTurns.pop()
  c.memory.questions -= 1
  useNpcDialogue.setState({ aiBusy: false, text: null, line: null, emotes: endLoopCue(c.npcId) })
  const code = result.ok ? 'upstream' : result.code
  if (code === 'unavailable') {
    unavailable(c)
    return
  }
  const beat = said(ERROR_LINES[code])
  if (code === 'refusal') beat.emote = 'headShake'
  play(c, [beat], { kind: 'choices' })
}

/** A line in the middle of things (a guide arriving): said next, then the conversation goes on. */
function interject(c: Conversation, beat: Beat) {
  const { more, aiBusy } = useNpcDialogue.getState()
  if (more || aiBusy) c.pending.unshift(beat)
  else show(c, beat)
}

export const useNpcDialogue = create<NpcDialogueState>()((set, get) => ({
  npcId: null,
  line: null,
  mode: 'script',
  transcript: [],
  text: null,
  textAt: 0,
  choices: [],
  more: false,
  aiBusy: false,
  aiStatus: null,
  canReturn: false,
  emotes: {},
  notice: null,
  playerName: null,

  open: (npcId) => {
    if (get().npcId === npcId) return
    const node = readNpc(npcId)
    if (!node?.interaction.talkable) return
    const runtime = useNpcRuntime.getState()
    const me = runtime.localPlayerId
    const now = Date.now()
    const held = runtime.engagements[npcId]
    if (held && heldByOther(held, me, now)) {
      notify(SAY.busy)
      return
    }
    get().close('polite')

    const memory = memoryFor(npcId)
    memory.following = held?.m === 'follow' && held.by === me
    // The small-talk `following` flag tracks the NPC: it may have given up following on its own.
    if (memory.following) memory.flags.add('following')
    else memory.flags.delete('following')

    const barks = node.behavior.greet.barks
    const c: Conversation = {
      npcId,
      node,
      graph:
        node.dialogue ??
        greetingGraph(
          node.ai.enabled
            ? node.ai.greeting || SAY.hello
            : (barks[Math.floor(Math.random() * barks.length)] ?? '…'),
        ),
      scripted: node.dialogue !== null,
      memory,
      lineId: null,
      choices: [],
      pending: [],
      after: { kind: 'choices' },
      returnTo: null,
      request: null,
      lastSendAt: 0,
      timer: null,
    }
    active = c
    holdForTalk(c, me, now)
    // Frees the mouse for the choices.
    if (document.pointerLockElement) document.exitPointerLock()
    set({
      npcId,
      line: null,
      mode: 'script',
      transcript: memory.transcript,
      text: null,
      textAt: 0,
      choices: [],
      more: false,
      aiBusy: false,
      canReturn: false,
      emotes: cue(npcId, 'nod', now + GESTURE_DELAY_MS),
    })
    get().refreshAiStatus()

    if (!c.scripted && aiReady(c)) {
      startAi(c, node.ai.greeting || SAY.aiHello, null)
    } else {
      goTo(c, c.graph.start)
    }
  },

  close: (reason: NpcDialogueCloseReason = 'polite') => {
    const c = active
    if (!c) return
    cancelQuestion(c)
    active = null
    clearTimer(c)
    stopNpcSpeech(c.npcId)
    const { text } = get()
    if (text) remember(c, { from: 'npc', text })
    if (reason !== 'preempted') release(c)
    set({
      npcId: null,
      line: null,
      mode: 'script',
      transcript: [],
      text: null,
      textAt: 0,
      choices: [],
      more: false,
      canReturn: false,
      emotes: cue(c.npcId, reason === 'polite' ? 'wave' : null, Date.now()),
    })
    if (reason === 'preempted') notify(SAY.preempted)
  },

  choose: (choiceId) => {
    const c = active
    const state = get()
    if (!c || state.mode !== 'script' || c.lineId === null) return
    if (!state.choices.some((choice) => choice.id === choiceId)) return
    const result = chooseIn(c.graph, c.lineId, choiceId, context(c))
    if (!result) return
    const heard: NpcTranscriptEntry[] = state.text ? [{ from: 'npc', text: state.text }] : []
    set({
      transcript: remember(c, ...heard, { from: 'player', text: result.label }),
      text: null,
      line: null,
      choices: [],
    })
    c.memory.flags = result.flags
    const { says, after, emote } = applyEffects(c, result.effects, result.next)
    if (emote && says[0] && !says[0].emote) says[0].emote = emote
    if (after) play(c, says, after)
    else if (result.next) goTo(c, result.next, says, emote)
    else play(c, says, { kind: 'close' })
  },

  advance: () => {
    const c = active
    const state = get()
    if (!c || state.aiBusy) return
    const typing =
      state.text !== null &&
      state.textAt > 0 &&
      Date.now() - state.textAt < state.text.length * NPC_TYPE_MS_PER_CHAR
    if (typing) set({ textAt: 0 })
    else if (state.more) {
      clearTimer(c)
      endLine(c)
    }
  },

  send: (question) => {
    const c = active
    const state = get()
    if (!c || state.mode !== 'ai' || state.aiBusy) return false
    const text = question.trim().slice(0, NPC_MESSAGE_MAX)
    const now = Date.now()
    if (!text || now - c.lastSendAt < SEND_COOLDOWN_MS) return false
    c.lastSendAt = now
    clearTimer(c)
    c.pending = []
    c.after = { kind: 'choices' }
    stopNpcSpeech(c.npcId)
    const heard: NpcTranscriptEntry[] = state.text ? [{ from: 'npc', text: state.text }] : []
    set({
      transcript: remember(c, ...heard, { from: 'player', text }),
      text: null,
      line: null,
      more: false,
    })

    const transport = getNpcChatTransport()
    if (c.memory.questions >= MAX_QUESTIONS) {
      play(c, [said(SAY.tooManyQuestions)], { kind: 'choices' })
    } else if (!transport) {
      unavailable(c)
    } else {
      c.memory.questions += 1
      c.memory.aiTurns.push({ role: 'user', text })
      set({ aiBusy: true, emotes: cue(c.npcId, 'think', now) })
      void ask(c, transport)
    }
    return true
  },

  backToChoices: () => {
    const c = active
    if (!c || get().mode !== 'ai' || !c.scripted) return
    cancelQuestion(c)
    set({ mode: 'script', canReturn: false })
    goTo(c, c.returnTo ?? c.graph.start)
  },

  guideArrived: (npcId, roomId) => {
    const runtime = useNpcRuntime.getState()
    const held = runtime.engagements[npcId]
    if (held?.m !== 'guide' || held.by !== runtime.localPlayerId) return
    const c = active
    const now = Date.now()
    if (c?.npcId !== npcId) {
      const p = npcPoses.get(npcId)?.p ?? held.p
      runtime.setEngagement(npcId, { m: 'free', at: now, p: [p[0], p[1]] })
      return
    }
    holdForTalk(c, held.by, now)
    const room = sceneFacts().rooms.find((candidate) => candidate.id === roomId)
    if (room) interject(c, said(describeRoomKo(room, true)))
  },

  refreshAiStatus: () => {
    getNpcChatTransport()
      ?.status()
      .then(
        (aiStatus) => {
          set({ aiStatus })
          const c = active
          if (!c) return
          const state = get()
          if (state.mode === 'ai' && !aiStatus.available && !state.aiBusy) unavailable(c)
          else if (state.mode === 'script' && !state.more) set({ choices: visibleChoices(c) })
        },
        () => {},
      )
  },

  setPlayerName: (playerName) => set({ playerName }),
}))
