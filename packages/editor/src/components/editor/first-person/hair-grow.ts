import type { BaseInput, BaseResult } from './hair-base'
import type { GrowCut } from './hair-cut'
import type { Groom } from './hair-groom'
import type { HairLibrary } from './hair-styles'

/**
 * Hair grown on a character's own scalp: guide strands walked over the
 * head as currently shaped, interpolated into clumped ribbon strips in
 * layers, cut, and laid out as the same vertex arrays for every style,
 * tier and layer. Runs in the hair workers, in stages that give way to a
 * newer request for the same character. Pure.
 */

/**
 * How much hair a build has: the studio's, the game's (the first half of
 * the studio's roots), or the game's far prefix (frozen NPCs).
 */
export type Tier = 'studio' | 'game' | 'far'

/** The body in its bind pose as currently shaped, arms trimmed: what long hair rests on. */
export type BodyInput = { points: Float32Array; index: Uint32Array }

/**
 * The shape hair is grown against: the flattened head's bind positions as
 * currently shaped (face, ears, head), and the body when the groom touches
 * it. `version` rises with every shape applied (see avatar-shape.ts's
 * `onShaped`), so a newer shape supersedes a grow under way.
 */
export type ShapeInput = { version: number; head: Float32Array; body: BodyInput | null }

/** What the worker keeps of a head between grows (its frames, radius maps and fitted template). */
export type HeadData = { readonly avatar: string }

export function headData(input: BaseInput, base: BaseResult, library: HairLibrary): HeadData {
  throw new Error('headData: generated hair is not built yet')
}

/**
 * One geometry's ribbons. Every array starts plain (Float32 or Uint16); see
 * the hair material for what `hairData` and `hairShape` carry.
 */
export type RibbonArrays = {
  position: Float32Array
  normal: Float32Array
  tangent: Float32Array
  uv: Float32Array
  hairData: Float32Array
  hairShape: Float32Array
  skinIndex: Uint16Array
  skinWeight: Float32Array
  index: Uint32Array
}

export type HairBuild = {
  key: string
  tier: Tier
  geometries: {
    inner: RibbonArrays
    outer: RibbonArrays
    strays?: RibbonArrays
    soft?: RibbonArrays
  }
  /** How many strips each geometry has, in root order, for drawing a prefix of them. */
  strips: { inner: number; outer: number; strays: number }
  /** Per strand: the flattened head's triangle and barycentrics its root stands on, and where it was grown. */
  roots: { tri: Uint32Array; bary: Float32Array; grown: Float32Array }
  touchesBody: boolean
  /** The groom's hairline table (see hair-groom.ts's `hairlineTable`), for the root layer. */
  hairline: Float32Array
  /**
   * Where the strands part, in template units round the scalp's middle: at
   * x = `x`·(1 − smoothstep(fade[0], fade[1], −z)) for z ≥ `crown`; behind
   * that the crown's whorl has no part. The root layer opens its roots there.
   */
  part: { x: number; fade: [number, number]; crown: number }
  undercut: { line: number; shells: [number, number, number] } | null
  /** Where an ombré tip colour starts and is full (bind height). */
  ombre: { earY: number; cutY: number }
  /** The guides, kept for a later sway. */
  guides?: { points: Float32Array; perStrip: Uint16Array; weights: Float32Array }
  stats: { ms: Record<string, number>; triangles: number }
}

/**
 * Grows a groom on a head against its current shape. `yieldTo` is awaited
 * between stages and answers whether a newer request superseded this one:
 * then the grow stops with null.
 */
export async function growHair(
  head: HeadData,
  groom: Groom,
  tier: Tier,
  shape: ShapeInput,
  seed: number,
  yieldTo?: () => Promise<boolean>,
): Promise<HairBuild | null> {
  throw new Error('growHair: generated hair is not built yet')
}

/**
 * What the page asks a hair worker: a head's base (sent once; again when
 * the worker answers `missing`), hair grown for a character (`slot`, its
 * model's uuid: a newer grow for a slot replaces one still waiting), or to
 * drop a slot's grow.
 */
export type HairRequest =
  | { kind: 'base'; avatar: string; input: BaseInput }
  | {
      kind: 'grow'
      slot: string
      avatar: string
      cut: GrowCut
      tier: Tier
      shape: ShapeInput
      priority: number
    }
  | { kind: 'cancel'; slot: string }

/** A hair worker's answer, its arrays transferred: a base, a build, a base it no longer has, or a failure. */
export type HairReply =
  | { kind: 'base'; avatar: string; base: BaseResult }
  | { kind: 'grow'; slot: string; key: string; build: HairBuild }
  | { kind: 'missing'; avatar: string }
  | { kind: 'error'; slot?: string; avatar?: string; message: string }
