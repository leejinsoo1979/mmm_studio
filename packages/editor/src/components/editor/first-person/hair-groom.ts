import type { GrowCut, HairCut } from './hair-cut'
import type { Tier } from './hair-grow'

/**
 * How each generated style is grown (see hair-grow.ts): its lengths and
 * cut, its volume over each region of the head, how it is combed, clumped,
 * curled and gathered, and how many strips it takes. Lengths and volumes
 * are centimetres on the adult template, scaled by each head's size;
 * angles are radians round the scalp's middle (azimuth a, elevation e). Pure.
 */

export type CurlKind = 'none' | 'wave' | 'curl' | 'coil'

/** A tied tail or bun: where on the scalp it is tied (a, e), how it hangs or winds. */
export type Gather = {
  kind: 'ponytail' | 'bun'
  a: number
  e: number
  standoff: number
  tail: number
  radius: number
  turns: [number, number]
}

/** A value for each region of the head (cm). */
export type Region = { crown: number; top: number; sides: number; back: number; nape: number }

/** How the ends are cut, by lock: `jitter` (cm) is how far a lock's ends stray from the cut. */
export type CutEnds = { mode: 'blunt' | 'point' | 'v' | 'layered'; jitter: number }

export type StyleDef = {
  /** cm from the root, by region. */
  length: Region & { front: number }
  /** cm below eye level, or null for no cut. */
  cut: { front: number; side: number; back: number } | null
  ends: CutEnds
  tipTaper: number
  /** The buzzed sides below `line` (elevation), with the coverage of each of the three shells. */
  undercut: { line: number; shells: [number, number, number] } | null
  /** Offsets (rad) to the base hairline. */
  hairline: { front: number; temple: number; sideburn: number; nape: number }
  short: { earArch: boolean; napeTaper: boolean }
  flow: { back: number; down: number; part: number; swirl: number }
  fringe: { depth: number; cut: number }
  /** Clearance off the skull (cm), by region. */
  volume: Region
  lift: number
  spread: number
  stiffness: number
  layPull: { inner: number; mid: number; outer: number }
  /** The geometric wave or curl, bounded (tighter curl lives in the atlas). */
  curl: { kind: CurlKind; amplitude: number; period: number; start: number }
  /** 0 = straight atlas layers. */
  atlasCurl: number
  endCurl: number
  clump: { amount: number; size: number }
  gather: Gather | null
  strips: number
  width: { inner: number; mid: number; outer: number }
  /** Triangle caps by tier. */
  caps: Record<Tier, number>
}

/** Whose head a style is grown on, for its hairline. */
export type Who = { sex: 'male' | 'female'; child: boolean }

/** A style as grown for one cut on one character: its definition with the sliders applied. */
export type Groom = StyleDef & {
  sliders: GrowCut
  who: Who
  touchesBody: boolean
}

/** The groom for a cut on a character (see StyleDef and the sliders' mappings). */
export function groomOf(cut: HairCut, who: Who): Groom {
  throw new Error('groomOf: generated hair is not built yet')
}

/** A groom's hairline: its elevation at 33 even steps of |a| over [0, π]. */
export function hairlineTable(groom: Groom): Float32Array {
  throw new Error('hairlineTable: generated hair is not built yet')
}
