/**
 * How far a speaking NPC's mouth opens (0..1), for the body's jaw. The browser
 * voice only reports word boundaries, so its mouth pops open on each word over
 * a murmur; the server voice's audio is measured directly.
 */

/** A word opens the mouth this far, and it closes again at this rate (1/s). */
const WORD_OPEN = 0.9
const WORD_CLOSE = 9
/** The murmur while a line is said: it also moves the mouth of voices without word events. */
const MURMUR = 0.3
const MURMUR_HZ = 7

/** Below this RMS the audio is silence; at `RMS_FULL` the mouth is wide open. */
const RMS_GATE = 0.01
const RMS_FULL = 0.16

/** The mouth opens quickly and closes a little slower (1/s). */
const OPEN_RATE = 30
const CLOSE_RATE = 12

/** Mouth level `t` s into a browser-voiced line, `sinceWord` s after the last word boundary
 *  (Infinity before the first). */
export function speechMouthLevel(t: number, sinceWord: number): number {
  const word = WORD_OPEN * Math.exp(-WORD_CLOSE * Math.max(0, sinceWord))
  const murmur = MURMUR * (0.5 + 0.5 * Math.sin(2 * Math.PI * MURMUR_HZ * t))
  return Math.max(word, murmur)
}

/** Mouth level from the RMS of the server voice's current audio frame. */
export function rmsMouthLevel(rms: number): number {
  return Math.min(1, Math.max(0, (rms - RMS_GATE) / (RMS_FULL - RMS_GATE)))
}

/** `level` eased toward `target` over `dt` s, so the jaw doesn't snap. */
export function followMouth(level: number, target: number, dt: number): number {
  const rate = target > level ? OPEN_RATE : CLOSE_RATE
  return level + (target - level) * (1 - Math.exp(-rate * dt))
}
