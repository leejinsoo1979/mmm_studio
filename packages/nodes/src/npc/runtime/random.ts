/**
 * Seeded randomness for the shared NPC schedule: every client draws the same
 * numbers for the same NPC, slot and purpose. Integer math only (`Math.imul`,
 * shifts), so every JS engine agrees.
 */

/** FNV-1a over the UTF-16 code units of `text`, as an unsigned 32-bit integer. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** A small seeded generator of numbers in `[0, 1)`. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The NPC's schedule seed: the one the placement tool wrote, else one derived from its id. */
export function npcSeed(seed: number, id: string): number {
  return seed > 0 ? seed : fnv1a32(id)
}

/** The generator for one NPC, slot and purpose (`salt`): the same on every client. */
export function rngFor(seed: number, id: string, slot: number, salt: string): () => number {
  return mulberry32(fnv1a32(`${seed}|${id}|${slot}|${salt}`))
}
