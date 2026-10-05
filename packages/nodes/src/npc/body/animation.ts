import type { NpcEmoteCue } from '../types'

/** Past this distance (m) from the camera a body holds its pose… */
export const NPC_FREEZE_DISTANCE = 30
/** …and past this it isn't drawn. */
export const NPC_HIDE_DISTANCE = 50
/** Bodies animated every frame, nearest first; the others step every NPC_THROTTLED_STEP s. */
export const NPC_MAX_ANIMATED = 16
export const NPC_THROTTLED_STEP = 0.1
/** Moving faster than this (m/s) ends an emote: walking off ends it. */
export const NPC_EMOTE_BREAK_SPEED = 0.5

/** The name tag fades out between these distances (m) and hides closer than NAME_TOO_CLOSE. */
const NAME_FADE_FROM = 8
const NAME_FADE_TO = 14
const NAME_TOO_CLOSE = 1

export type NpcBodyDetail = 'animated' | 'frozen' | 'hidden'

export function npcBodyDetail(distance: number): NpcBodyDetail {
  if (distance > NPC_HIDE_DISTANCE) return 'hidden'
  return distance > NPC_FREEZE_DISTANCE ? 'frozen' : 'animated'
}

/** The ids of the `max` nearest bodies (ties by id, so the pick holds still). */
export function nearestBodies(
  distances: ReadonlyMap<string, number>,
  max = NPC_MAX_ANIMATED,
): Set<string> {
  if (distances.size <= max) return new Set(distances.keys())
  const sorted = [...distances].sort(([a, da], [b, db]) => da - db || (a < b ? -1 : 1))
  return new Set(sorted.slice(0, max).map(([id]) => id))
}

/** Opacity of the name tag and bubble over a body this far (m) from the camera. */
export function overheadOpacity(distance: number): number {
  if (distance < NAME_TOO_CLOSE) return 0
  const t = Math.min(1, Math.max(0, (distance - NAME_FADE_FROM) / (NAME_FADE_TO - NAME_FADE_FROM)))
  return 1 - t * t * (3 - 2 * t)
}

const sameCue = (a: NpcEmoteCue, b: NpcEmoteCue) => a.at === b.at && a.id === b.id

export type NpcEmoteInput = {
  /** The pose's own cue (schedule idle emotes, the brain's nods and waves), shared ms clock. */
  cue: NpcEmoteCue | null
  /** Since when (ms) the NPC has been saying something, or null. */
  speakingSince: number | null
  /** Speaks with `present` (a guide showing the house) rather than `talk`. */
  presenter: boolean
  now: number
}

/**
 * Which emote an NPC body plays: the pose's own cue once it is due, or a
 * talk loop while the NPC speaks, whichever started last. A cue that played
 * out, was walked off, or that a later one took over from is not taken up
 * again, though the pose may keep it for a while.
 */
export class NpcEmotePicker {
  private done: NpcEmoteCue | null = null

  pick({ cue, speakingSince, presenter, now }: NpcEmoteInput): NpcEmoteCue | null {
    const own = cue && cue.at <= now && !(this.done && sameCue(cue, this.done)) ? cue : null
    const talk =
      speakingSince === null ? null : { id: presenter ? 'present' : 'talk', at: speakingSince }
    if (own && talk && talk.at > own.at) {
      this.done = own
      return talk
    }
    return own ?? talk
  }

  /** The pose's cue has played out (or was walked off). */
  finish(cue: NpcEmoteCue) {
    this.done = cue
  }
}
