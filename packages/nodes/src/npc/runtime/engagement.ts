import type { NpcChasePhase, NpcEngagement, NpcSocialAct } from '../types'

/**
 * Engagements on the wire: the world doc entries `npc:<id>` and `npcEpoch`.
 * Every engagement is kept in canonical form (rounded position and facing,
 * whole ms, capped line) both here and on the wire, so the player who wrote
 * it and everyone who reads it compute the same schedule from it.
 */

export const NPC_EPOCH_KEY = 'npcEpoch'
const ENGAGEMENT_PREFIX = 'npc:'

/** A held engagement not refreshed for this long is free, for every player alike. */
export const NPC_ENGAGEMENT_EXPIRY_MS = 120_000
/** How often the holder re-writes `at` while it holds the NPC. */
export const NPC_ENGAGEMENT_REFRESH_MS = 30_000
/** A shared line (over the NPC's head for the other players) is cut to this. */
export const NPC_SHARED_LINE_MAX = 140
const BY_MAX = 128

const SOCIAL_ACTS: readonly NpcSocialAct[] = [
  'highFive',
  'handshake',
  'fistBump',
  'shoulderPat',
  'hug',
  'dance',
  'photo',
]
const CHASE_PHASES: readonly NpcChasePhase[] = ['startle', 'npc', 'player', 'end']
const CHASE_WINNERS = ['npc', 'player', 'none'] as const

export const npcEngagementKey = (npcId: string) => `${ENGAGEMENT_PREFIX}${npcId}`

/** The NPC id of an engagement entry key, or null for any other key. */
export function npcIdOfKey(key: string): string | null {
  return key.startsWith(ENGAGEMENT_PREFIX) && key.length > ENGAGEMENT_PREFIX.length
    ? key.slice(ENGAGEMENT_PREFIX.length)
    : null
}

const roundTo = (value: number, places: number) => {
  const scale = 10 ** places
  // `+ 0` turns -0 into 0, so a rounded position reads the same as JSON.
  return Math.round(value * scale) / scale + 0
}
const point = (p: readonly [number, number]): [number, number] => [
  roundTo(p[0], 2),
  roundTo(p[1], 2),
]
const yawOf = (yaw: number) => roundTo(yaw, 4)

/** The engagement in canonical form: positions to the centimetre, facing to 4 decimals. */
export function canonicalEngagement(e: NpcEngagement): NpcEngagement {
  const at = Math.round(e.at)
  const p = point(e.p)
  switch (e.m) {
    case 'free':
      return { m: 'free', at, p }
    case 'follow':
      return { m: 'follow', by: e.by, at, p }
    case 'talk': {
      const talk: NpcEngagement = { m: 'talk', by: e.by, at, p, yaw: yawOf(e.yaw) }
      if (e.line) talk.line = sharedLine(e.line)
      return talk
    }
    case 'guide': {
      const guide: NpcEngagement = { m: 'guide', by: e.by, at, p, room: e.room }
      if (e.line) guide.line = sharedLine(e.line)
      return guide
    }
    case 'social':
      return { m: 'social', by: e.by, at, p, yaw: yawOf(e.yaw), act: e.act }
    case 'chase': {
      const chase: NpcEngagement = { m: 'chase', by: e.by, at, p, ph: e.ph, pt: Math.round(e.pt) }
      if (e.won) chase.won = e.won
      return chase
    }
  }
}

const sharedLine = (line: string) => line.slice(0, NPC_SHARED_LINE_MAX)

/** The world-doc value of an engagement (plain JSON, no undefined fields). */
export function encodeEngagement(e: NpcEngagement): Record<string, unknown> {
  return { ...canonicalEngagement(e) }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isPoint = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1])
const isPlayer = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= BY_MAX
const optionalText = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string'

/** Another player's engagement entry, or null when it isn't a valid one. */
export function decodeEngagement(value: unknown): NpcEngagement | null {
  if (!(isRecord(value) && finite(value.at) && isPoint(value.p))) return null
  const { at, p } = value
  if (value.m === 'free') return canonicalEngagement({ m: 'free', at, p })
  const by = value.by
  if (!isPlayer(by)) return null
  switch (value.m) {
    case 'follow':
      return canonicalEngagement({ m: 'follow', by, at, p })
    case 'talk':
      if (!(finite(value.yaw) && optionalText(value.line))) return null
      return canonicalEngagement({ m: 'talk', by, at, p, yaw: value.yaw, line: value.line })
    case 'guide':
      if (!(typeof value.room === 'string' && value.room && optionalText(value.line))) return null
      return canonicalEngagement({ m: 'guide', by, at, p, room: value.room, line: value.line })
    case 'social': {
      const act = SOCIAL_ACTS.find((candidate) => candidate === value.act)
      if (!(act && finite(value.yaw))) return null
      return canonicalEngagement({ m: 'social', by, at, p, yaw: value.yaw, act })
    }
    case 'chase': {
      const ph = CHASE_PHASES.find((candidate) => candidate === value.ph)
      const won = CHASE_WINNERS.find((candidate) => candidate === value.won)
      if (!(ph && finite(value.pt)) || (value.won !== undefined && !won)) return null
      return canonicalEngagement({ m: 'chase', by, at, p, ph, pt: value.pt, won })
    }
    default:
      return null
  }
}

/**
 * The engagement as it stands at `now`: a held one nobody refreshed for
 * NPC_ENGAGEMENT_EXPIRY_MS reads as released where it was held, at the moment
 * it expired — the same for every player, whoever held it.
 */
export function effectiveEngagement(
  e: NpcEngagement | undefined,
  now: number,
): NpcEngagement | null {
  if (!e) return null
  if (e.m === 'free' || now - e.at <= NPC_ENGAGEMENT_EXPIRY_MS) return e
  return { m: 'free', at: e.at + NPC_ENGAGEMENT_EXPIRY_MS, p: e.p }
}

/** Someone other than `me` holds the NPC at `now`. */
export function heldByOther(e: NpcEngagement | undefined, me: string, now: number): boolean {
  const current = effectiveEngagement(e, now)
  return current !== null && current.m !== 'free' && current.by !== me
}
