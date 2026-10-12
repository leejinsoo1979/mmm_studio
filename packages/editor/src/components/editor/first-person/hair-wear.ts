import { cutKey, type GrowCut, type HairCut } from './hair-cut'
import type { Tier } from './hair-grow'

/**
 * What generated-hair.ts decides while a character wears generated hair,
 * kept apart from three and the page so it can be tested: which grow to
 * ask the hair worker for and when, which answers to put on, how far each
 * strand has moved with the head since it was grown, and where the root
 * layer stands on the head as it is shaped now. Pure.
 */

/**
 * How much generated hair a character gets: the studio's tier (a drag
 * previews at the game's), the game's, or the far prefix alone for crowds.
 */
export type HairDetail = 'studio' | 'game' | 'crowd'

/** A grow to ask for: a cut at a tier, against the head's shape as of `version`. */
export type GrowAsk = { cut: GrowCut; tier: Tier; version: number; key: string }

/** How long (ms) hair waits for a drag to settle before it is grown at its final tier. */
export const SETTLE_MS = 160

const finalTier = (detail: HairDetail): Tier =>
  detail === 'studio' ? 'studio' : detail === 'crowd' ? 'far' : 'game'

/** Drags preview at the game tier in the studio; elsewhere the final tier is quick enough. */
const previewTier = (detail: HairDetail): Tier => (detail === 'studio' ? 'game' : finalTier(detail))

const askKey = (cut: GrowCut, tier: Tier, version: number) => `${cutKey(cut)}|${tier}|${version}`

/** A cut's part that hair is grown from (its colours are its material's alone). */
export const growCut = ({ style, length, volume, curl, part, fringe }: GrowCut): GrowCut => ({
  style,
  length,
  volume,
  curl,
  part,
  fringe,
})

/**
 * Which grows one character needs, as its cut and its head's shape change.
 * A new style (or the first) is grown at the final tier at once: the old
 * hair stays until it lands. A slider drag on the same style previews at
 * the game tier, and the final tier follows once the drag has settled for
 * SETTLE_MS. A new head shape (a face slider) only moves the strands
 * already grown (see strandOffsets) until it settles too; then the hair is
 * grown again against it. Answers come back in the order asked; one older
 * than the hair on, or for a style no longer worn, is never put on.
 */
export class GrowPlan {
  private cut: GrowCut | null = null
  private version: number
  /** The grow whose hair is on. */
  private shown: GrowAsk | null = null
  /** The grows asked for since, oldest first. */
  private asks: GrowAsk[] = []
  /** When the final tier is due (ms), after a drag. */
  private settleAt: number | null = null

  constructor(
    readonly detail: HairDetail,
    version: number,
    private readonly settleMs = SETTLE_MS,
  ) {
    this.version = version
  }

  /** The cut changed (null: the character's own hair). Returns the grow to ask for now, if any. */
  want(cut: GrowCut | null, now: number): GrowAsk | null {
    const before = this.cut
    this.cut = cut
    if (!cut) {
      this.shown = null
      this.asks = []
      this.settleAt = null
      return null
    }
    if (before && cutKey(before) === cutKey(cut)) return null
    const newest = this.newest
    if (!newest || newest.cut.style !== cut.style) {
      this.settleAt = null
      return this.ask(finalTier(this.detail))
    }
    this.settleAt = now + this.settleMs
    return this.ask(previewTier(this.detail))
  }

  /** The head took a new shape (see avatar-shape.ts's onShaped). */
  shaped(version: number, now: number) {
    if (version === this.version) return
    this.version = version
    if (this.cut) this.settleAt = now + this.settleMs
  }

  /** When (ms) `due` next has something to ask, or null. */
  get dueAt(): number | null {
    return this.settleAt
  }

  /** The final grow once a drag has settled, if the hair on (or asked for) is not it already. */
  due(now: number): GrowAsk | null {
    if (this.settleAt === null || now < this.settleAt || !this.cut) return null
    this.settleAt = null
    const tier = finalTier(this.detail)
    const key = askKey(this.cut, tier, this.version)
    if (this.newest?.key === key) return null
    return this.ask(tier)
  }

  /** The final grow asked for again (after a failed one). */
  retry(): GrowAsk | null {
    return this.cut ? this.ask(finalTier(this.detail)) : null
  }

  /**
   * A grow's hair came: whether to put it on. It is, if it was asked for
   * since the hair on and is the style wanted now; the grows asked before
   * it are let go either way.
   */
  built(key: string): boolean {
    let at = -1
    for (let i = this.asks.length - 1; i >= 0 && at < 0; i--) if (this.asks[i]!.key === key) at = i
    if (at < 0) return false
    const ask = this.asks[at]!
    this.asks.splice(0, at + 1)
    if (!this.cut || ask.cut.style !== this.cut.style) return false
    this.shown = ask
    return true
  }

  /** Whether a grow asked for is still the latest (one asked for since replaces it). */
  latest(ask: GrowAsk): boolean {
    return this.asks[this.asks.length - 1] === ask
  }

  /** A grow failed: nothing is waiting on it any more. */
  failed(key: string) {
    this.asks = this.asks.filter((ask) => ask.key !== key)
  }

  /** Whether a grow is asked for and not yet in, or one is due once a drag settles. */
  get pending(): boolean {
    return this.asks.length > 0 || this.settleAt !== null
  }

  /** Whether the hair on is the final tier of the cut wanted, against the head as it is, with nothing left to grow. */
  get settled(): boolean {
    if (!this.cut) return true
    if (this.pending) return false
    return this.shown?.key === askKey(this.cut, finalTier(this.detail), this.version)
  }

  /** The grow asked for last, or else the one on. */
  private get newest(): GrowAsk | null {
    return this.asks[this.asks.length - 1] ?? this.shown
  }

  private ask(tier: Tier): GrowAsk {
    const cut = this.cut!
    const ask = { cut, tier, version: this.version, key: askKey(cut, tier, this.version) }
    this.asks.push(ask)
    return ask
  }
}

/** A character's hair colours, as its material takes them (see hair-material.ts's HairLook). */
export type WornLook = { base: string; tip: string | null; shine: number; skin: string }

/**
 * The colours generated hair is drawn in: the look's dye and skin, or
 * where it has none the avatar's own (`own`); the cut's tip and shine.
 */
export const wornLook = (
  cut: Pick<HairCut, 'tip' | 'shine'>,
  colours: { hair: string | null; skin: string | null },
  own: { hair: string; skin: string },
): WornLook => ({
  base: colours.hair ?? own.hair,
  tip: cut.tip,
  shine: cut.shine,
  skin: colours.skin ?? own.skin,
})

/** Strands the offsets can hold (a 64 × 64 texture's texels). */
export const OFFSET_COLUMNS = 64
export const MOST_STRANDS = OFFSET_COLUMNS * OFFSET_COLUMNS

/**
 * How far each strand's root has moved (bind units) since its hair was
 * grown, as RGBA texels (one per strand, xyz used): the point on its head
 * triangle (`tri`, barycentrics `bary` as b, c) on the head now, less the
 * same point on the head it was grown against. Zero for hair just grown.
 */
export function strandOffsets(
  roots: { tri: Uint32Array; bary: Float32Array },
  index: Uint32Array,
  grownOn: Float32Array,
  now: Float32Array,
  out: Float32Array,
) {
  const count = Math.min(roots.tri.length, out.length / 4)
  for (let r = 0; r < count; r++) {
    const t = roots.tri[r]!
    const b = roots.bary[r * 2]!
    const c = roots.bary[r * 2 + 1]!
    const a = 1 - b - c
    const ia = index[t * 3]! * 3
    const ib = index[t * 3 + 1]! * 3
    const ic = index[t * 3 + 2]! * 3
    for (let axis = 0; axis < 3; axis++) {
      out[r * 4 + axis] =
        a * (now[ia + axis]! - grownOn[ia + axis]!) +
        b * (now[ib + axis]! - grownOn[ib + axis]!) +
        c * (now[ic + axis]! - grownOn[ic + axis]!)
    }
    out[r * 4 + 3] = 0
  }
}

/**
 * The root layer on the head as it is now: each of its points `height` off
 * its head point (`src`) along that point's normal.
 */
export function followRoots(
  src: Uint32Array,
  height: Float32Array,
  points: Float32Array,
  normals: Float32Array,
  position: Float32Array,
  normal: Float32Array,
) {
  for (let i = 0; i < src.length; i++) {
    const s = src[i]! * 3
    const h = height[i]!
    for (let axis = 0; axis < 3; axis++) {
      normal[i * 3 + axis] = normals[s + axis]!
      position[i * 3 + axis] = points[s + axis]! + normals[s + axis]! * h
    }
  }
}

/**
 * The flattened head (`flat`) as the head shows its shape now, before the
 * flattened head goes on: each point moved as far as the head's own point
 * moved from where it was loaded (`loaded` to `shown`, all bind points).
 * Exact where the head kept its own points; close enough where it laid
 * them flat, which the strands' offsets put right once it goes on.
 */
export function shapedFlat(
  flat: Float32Array,
  loaded: Float32Array,
  shown: Float32Array,
): Float32Array {
  if (loaded.length !== flat.length || shown.length !== flat.length) return Float32Array.from(flat)
  const out = new Float32Array(flat.length)
  for (let i = 0; i < flat.length; i++) out[i] = flat[i]! + shown[i]! - loaded[i]!
  return out
}

/** A shape's identity by its points (bit for bit), to tell a shape that changed from one put on again. */
export function pointsHash(points: Float32Array): number {
  const words = new Uint32Array(points.buffer, points.byteOffset, points.length)
  let h = 0x811c9dc5
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i]!, 0x01000193)
  return h >>> 0
}
