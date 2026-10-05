import type { NpcSpeechRequest } from '../types'

/** A greeting bark carries this far (m); farther NPCs greet silently. */
export const BARK_RANGE = 8

/** A line may run this long past its slowest plausible reading before it is given up. */
const SPEECH_GRACE_MS = 5000
/** Korean speech runs about 5 syllables a second; this is well under it. */
const SPEECH_MS_PER_CHAR = 350

/** Whose line is being said, and what kind. */
export type NpcSpeechSlot = Pick<NpcSpeechRequest, 'npcId' | 'kind'>

/**
 * Whether `next` is said aloud now, over the `current` line (which then stops).
 * NPCs speak one at a time, as the browser voice can only say one line at once:
 * a conversation line (`line`, `ai`) always speaks and cuts anything off; a
 * bark speaks only within `BARK_RANGE` of the player (`distance`, null when
 * unknown) and only over silence or the same NPC's earlier bark.
 */
export function speaksNow(
  current: NpcSpeechSlot | null,
  next: NpcSpeechSlot,
  distance: number | null,
): boolean {
  if (next.kind !== 'bark') return true
  if (distance === null || distance > BARK_RANGE) return false
  return current === null || (current.kind === 'bark' && current.npcId === next.npcId)
}

/** How long (ms) a line is given, request and playback included, before it is taken as stuck. */
export function speechTimeoutMs(text: string, rate: number): number {
  return SPEECH_GRACE_MS + (text.length * SPEECH_MS_PER_CHAR) / rate
}
