import { withJosa } from '../josa'

/**
 * What E finds: the NPC whose standing capsule the aim ray meets first,
 * within that NPC's talking range. Tested analytically against a capsule from
 * the feet up: a skinned mesh is slow to raycast, and in its bind pose.
 * Pure, so it is testable without three.js.
 */

export type Vec3 = readonly [number, number, number]

/** The capsule E aims at: this thick (radius, m)… */
export const NPC_TALK_RADIUS = 0.3
/** …from the feet to the top of the head (m). */
export const NPC_TALK_HEIGHT = 1.8

/** The E prompt while someone else holds the NPC. */
export const NPC_BUSY_LABEL = '다른 방문자와 대화 중'
const DEFAULT_PROMPT = '대화하기'

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/** Distance along the ray (`dir` unit) to a sphere, or null (behind the origin counts as a miss). */
function raySphere(origin: Vec3, dir: Vec3, center: Vec3, r: number): number | null {
  const oc = sub(origin, center)
  const b = dot(dir, oc)
  const c = dot(oc, oc) - r * r
  if (c <= 0) return 0
  const h = b * b - c
  if (h < 0) return null
  const t = -b - Math.sqrt(h)
  return t >= 0 ? t : null
}

/**
 * Distance along the ray (`dir` unit) to the capsule around segment `a → b`
 * with radius `r`; 0 when the ray starts inside it; null on a miss.
 */
export function rayCapsuleDistance(
  origin: Vec3,
  dir: Vec3,
  a: Vec3,
  b: Vec3,
  r: number,
): number | null {
  const ba = sub(b, a)
  const oa = sub(origin, a)
  const baba = dot(ba, ba)
  const bard = dot(ba, dir)
  const baoa = dot(ba, oa)
  const rdoa = dot(dir, oa)
  const oaoa = dot(oa, oa)

  // Inside: the origin is within `r` of the segment.
  const along = baba > 0 ? Math.min(1, Math.max(0, baoa / baba)) : 0
  const near = sub(oa, [ba[0] * along, ba[1] * along, ba[2] * along])
  if (dot(near, near) <= r * r) return 0

  const k2 = baba - bard * bard
  if (k2 > 1e-12) {
    const k1 = baba * rdoa - baoa * bard
    const k0 = baba * oaoa - baoa * baoa - r * r * baba
    const h = k1 * k1 - k2 * k0
    // Missing the infinite cylinder misses the capsule inside it.
    if (h < 0) return null
    const t = (-k1 - Math.sqrt(h)) / k2
    const y = baoa + t * bard
    if (y > 0 && y < baba) return t >= 0 ? t : null
    // Beyond the body: one of the end caps.
    return raySphere(origin, dir, y <= 0 ? a : b, r)
  }
  // Along the axis: whichever cap comes first.
  const ta = raySphere(origin, dir, a, r)
  const tb = raySphere(origin, dir, b, r)
  if (ta === null) return tb
  if (tb === null) return ta
  return Math.min(ta, tb)
}

export type NpcTalkCandidate = {
  id: string
  /** World position of the feet. */
  feet: Vec3
  /** How far (m) E reaches this NPC. */
  range: number
}

/** The nearest NPC the ray meets within its range: its standing capsule from the feet up. */
export function nearestNpcHit(
  origin: Vec3,
  dir: Vec3,
  candidates: Iterable<NpcTalkCandidate>,
): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null
  for (const { id, feet, range } of candidates) {
    const bottom: Vec3 = [feet[0], feet[1] + NPC_TALK_RADIUS, feet[2]]
    const top: Vec3 = [feet[0], feet[1] + NPC_TALK_HEIGHT - NPC_TALK_RADIUS, feet[2]]
    const distance = rayCapsuleDistance(origin, dir, bottom, top, NPC_TALK_RADIUS)
    if (distance === null || distance > range) continue
    if (!best || distance < best.distance) best = { id, distance }
  }
  return best
}

/** What E offers an NPC that doesn't talk: its menu of friendly gestures. */
const HANG_OUT_PROMPT = '어울리기'

/**
 * The E prompt for an NPC: "지아와 대화하기", "민준과 대화하기", "지아와
 * 어울리기" when it doesn't talk (E opens its menu either way), or busy.
 */
export function npcTalkLabel(name: string, prompt: string, busy: boolean, talkable = true): string {
  if (busy) return NPC_BUSY_LABEL
  const offer = talkable ? prompt.trim() || DEFAULT_PROMPT : HANG_OUT_PROMPT
  return `${withJosa(name, '와', '과')} ${offer}`
}
