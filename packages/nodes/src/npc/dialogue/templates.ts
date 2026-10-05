import { josa } from '../josa'
import type { SceneFacts } from '../types'

/** What a dialogue line can say about the moment: `{player}`, `{room}`, `{time}` … */
export type TemplateVars = {
  /** The player's display name. */
  player?: string
  npc?: string
  /** The room the player stands in. */
  room?: string
  /** Its floor area (m², as said aloud). */
  area?: string
  level?: string
  houseArea?: string
  roomCount?: string
  /** 아침, 오후 or 저녁 on the in-game clock. */
  time?: string
}

/** `{name}`, or `{name:a/b}` with the particle pair that follows it. */
const VARIABLE = /\{([A-Za-z]+)(?::([^{}/]+)\/([^{}/]+))?\}/g

/**
 * `text` with its variables filled in: `{npc:이/가}` adds the particle that
 * fits the name (지아가, 민준이). Unknown or empty variables render as nothing,
 * particle included.
 */
export function renderTemplate(text: string, vars: TemplateVars): string {
  const values = vars as Record<string, string | undefined>
  return text.replace(VARIABLE, (_match, name: string, a?: string, b?: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined
    if (!value) return ''
    return a && b ? value + josa(value, a, b) : value
  })
}

/** 아침, 오후 or 저녁 for a clock time in hours. */
export function dayPartKo(hour: number): string {
  if (hour >= 4 && hour < 11) return '아침'
  if (hour >= 11 && hour < 17) return '오후'
  return '저녁'
}

/** A floor area as said aloud: one decimal, none when whole ("12.5", "32"). */
export function formatArea(squareMetres: number): string {
  return String(Math.round(squareMetres * 10) / 10)
}

/** The scene's variables for a player standing in `roomId` (or nowhere) on `levelId`. */
export function sceneVars(
  facts: SceneFacts | null,
  levelId: string | null,
  roomId: string | null,
): TemplateVars {
  if (!facts) return {}
  const room = roomId ? facts.rooms.find((candidate) => candidate.id === roomId) : undefined
  const levelOf = room?.levelId ?? levelId
  const level = facts.levels.find((candidate) => candidate.id === levelOf)
  const hasRooms = facts.rooms.length > 0
  return {
    room: room?.name,
    area: room ? formatArea(room.area) : undefined,
    level: level?.name,
    houseArea: hasRooms ? formatArea(facts.totalArea) : undefined,
    roomCount: hasRooms ? String(facts.rooms.length) : undefined,
  }
}
