import {
  DEFAULT_CUT_PARAMS,
  type GrowCut,
  HAIR_CUT_STYLES,
  type HairCut,
  type HairCutStyle,
} from './hair-cut'
import type { Tier } from './hair-grow'
import { BASE_HAIRLINE, baseHairline, HAIRLINE_STEPS } from './hair-scalp'
import { smoothstep } from './head-skull'

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

const STRAIGHT = { kind: 'none' as CurlKind, amplitude: 0, period: 6, start: 0.2 }
const NO_HAIRLINE = { front: 0, temple: 0, sideburn: 0, nape: 0 }
const LAY = { inner: 0.7, mid: 0.5, outer: 0.35 }
const WIDTH = { inner: 0.8, mid: 0.55, outer: 0.45 }
const SHORT_CAPS: Record<Tier, number> = { studio: 40000, game: 12000, far: 5000 }
const BOB_CAPS: Record<Tier, number> = { studio: 60000, game: 18000, far: 7000 }
const LONG_CAPS: Record<Tier, number> = { studio: 80000, game: 25000, far: 10000 }
const FULL_CAPS: Record<Tier, number> = { studio: 85000, game: 28000, far: 11000 }
const SHORT_ENDS = { earArch: true, napeTaper: true }
const LONG_ENDS = { earArch: false, napeTaper: false }

/** The styles (design §6.11): the starting point WP-S tunes 단발 and 투블럭 from, and WP-C the rest. */
export const STYLES: Record<HairCutStyle, StyleDef> = {
  short: {
    length: { front: 6, crown: 4, top: 5, sides: 2.2, back: 2.8, nape: 1.4 },
    cut: null,
    ends: { mode: 'point', jitter: 0.5 },
    tipTaper: 0.5,
    undercut: null,
    hairline: NO_HAIRLINE,
    short: SHORT_ENDS,
    flow: { back: 0.5, down: 0.4, part: 0.8, swirl: 0.6 },
    fringe: { depth: 0.35, cut: 0 },
    volume: { crown: 1.6, top: 2.0, sides: 0.7, back: 1.2, nape: 0.4 },
    lift: 0.45,
    spread: 0,
    stiffness: 0.85,
    layPull: LAY,
    curl: STRAIGHT,
    atlasCurl: 0,
    endCurl: 0,
    clump: { amount: 0.55, size: 0.8 },
    gather: null,
    strips: 2400,
    width: WIDTH,
    caps: SHORT_CAPS,
  },
  dandy: {
    length: { front: 9, crown: 5, top: 7, sides: 3, back: 3.5, nape: 1.8 },
    cut: null,
    ends: { mode: 'point', jitter: 0.4 },
    tipTaper: 0.3,
    undercut: null,
    hairline: NO_HAIRLINE,
    short: SHORT_ENDS,
    flow: { back: 0.2, down: 0.8, part: 0.5, swirl: 0.4 },
    fringe: { depth: 0.25, cut: 0 },
    volume: { crown: 1.8, top: 2.3, sides: 0.8, back: 1.3, nape: 0.5 },
    lift: 0.2,
    spread: 0,
    stiffness: 0.75,
    layPull: LAY,
    curl: STRAIGHT,
    atlasCurl: 0,
    endCurl: 0,
    clump: { amount: 0.5, size: 0.9 },
    gather: null,
    strips: 2400,
    width: WIDTH,
    caps: SHORT_CAPS,
  },
  twoBlock: {
    length: { front: 10, crown: 7.5, top: 8.5, sides: 8, back: 7, nape: 5 },
    cut: null,
    ends: { mode: 'point', jitter: 0.4 },
    tipTaper: 0.3,
    undercut: { line: 0.35, shells: [0.85, 0.55, 0.3] },
    hairline: NO_HAIRLINE,
    short: SHORT_ENDS,
    flow: { back: 0.1, down: 0.7, part: 0.5, swirl: 0.5 },
    fringe: { depth: 0.5, cut: 0 },
    volume: { crown: 1.8, top: 2.2, sides: 1.7, back: 1.4, nape: 0.5 },
    lift: 0.4,
    spread: 0,
    stiffness: 0.7,
    layPull: LAY,
    curl: STRAIGHT,
    atlasCurl: 0,
    endCurl: 0,
    clump: { amount: 0.6, size: 0.9 },
    gather: null,
    strips: 2400,
    width: WIDTH,
    caps: SHORT_CAPS,
  },
  bob: {
    length: { front: 30, crown: 30, top: 30, sides: 30, back: 30, nape: 30 },
    cut: { front: 9, side: 9.5, back: 8 },
    ends: { mode: 'blunt', jitter: 0.3 },
    tipTaper: 0.15,
    undercut: null,
    hairline: NO_HAIRLINE,
    short: LONG_ENDS,
    flow: { back: 0.15, down: 1, part: 1, swirl: 0.2 },
    fringe: { depth: 0.45, cut: 0 },
    volume: { crown: 1.5, top: 1.8, sides: 2.5, back: 2.2, nape: 1.5 },
    lift: 0.25,
    spread: 0.6,
    stiffness: 0.5,
    layPull: LAY,
    curl: STRAIGHT,
    atlasCurl: 0,
    endCurl: 0.9,
    clump: { amount: 0.35, size: 1.1 },
    gather: null,
    strips: 2400,
    width: { inner: 0.8, mid: 0.6, outer: 0.5 },
    caps: BOB_CAPS,
  },
  long: {
    length: { front: 45, crown: 45, top: 45, sides: 45, back: 45, nape: 45 },
    cut: { front: 32, side: 34, back: 38 },
    ends: { mode: 'v', jitter: 0.6 },
    tipTaper: 0.6,
    undercut: null,
    hairline: NO_HAIRLINE,
    short: LONG_ENDS,
    flow: { back: 0.25, down: 1, part: 1, swirl: 0.2 },
    fringe: { depth: 0.45, cut: 0 },
    volume: { crown: 1.2, top: 1.5, sides: 1.8, back: 2.0, nape: 1.5 },
    lift: 0.2,
    spread: 0.8,
    stiffness: 0.35,
    layPull: LAY,
    curl: STRAIGHT,
    atlasCurl: 0,
    endCurl: 0.2,
    clump: { amount: 0.5, size: 1.2 },
    gather: null,
    strips: 2400,
    width: { inner: 0.8, mid: 0.6, outer: 0.5 },
    caps: LONG_CAPS,
  },
  layered: {
    length: { front: 45, crown: 45, top: 45, sides: 45, back: 45, nape: 45 },
    cut: { front: 26, side: 30, back: 36 },
    ends: { mode: 'layered', jitter: 0.6 },
    tipTaper: 0.75,
    undercut: null,
    hairline: NO_HAIRLINE,
    short: LONG_ENDS,
    flow: { back: 0.25, down: 1, part: 1, swirl: 0.2 },
    fringe: { depth: 0.45, cut: 0 },
    volume: { crown: 1.5, top: 1.8, sides: 2.2, back: 2.4, nape: 1.6 },
    lift: 0.25,
    spread: 0.8,
    stiffness: 0.35,
    layPull: LAY,
    curl: { kind: 'wave', amplitude: 0.4, period: 6, start: 0.3 },
    atlasCurl: 0,
    endCurl: 0.4,
    clump: { amount: 0.5, size: 1.2 },
    gather: null,
    strips: 2400,
    width: { inner: 0.8, mid: 0.6, outer: 0.5 },
    caps: LONG_CAPS,
  },
  ponytail: {
    length: { front: 40, crown: 40, top: 40, sides: 40, back: 40, nape: 40 },
    cut: null,
    ends: { mode: 'point', jitter: 0.6 },
    tipTaper: 0.55,
    undercut: null,
    hairline: { ...NO_HAIRLINE, nape: 0.1 },
    short: LONG_ENDS,
    flow: { back: 1, down: 0.2, part: 0.6, swirl: 0 },
    fringe: { depth: 0.3, cut: 0 },
    volume: { crown: 0.4, top: 0.5, sides: 0.4, back: 0.5, nape: 0.3 },
    lift: 0.05,
    spread: 0,
    stiffness: 0.5,
    layPull: LAY,
    curl: STRAIGHT,
    atlasCurl: 0,
    endCurl: 0,
    clump: { amount: 0.55, size: 1 },
    gather: {
      kind: 'ponytail',
      a: Math.PI,
      e: 0.45,
      standoff: 0.9,
      tail: 26,
      radius: 1.1,
      turns: [0, 0],
    },
    strips: 2400,
    width: WIDTH,
    caps: FULL_CAPS,
  },
  bun: {
    length: { front: 40, crown: 40, top: 40, sides: 40, back: 40, nape: 40 },
    cut: null,
    ends: { mode: 'point', jitter: 0.3 },
    tipTaper: 0.3,
    undercut: null,
    hairline: { ...NO_HAIRLINE, nape: 0.1 },
    short: LONG_ENDS,
    flow: { back: 1, down: 0.1, part: 0.4, swirl: 0 },
    fringe: { depth: 0.3, cut: 0 },
    volume: { crown: 0.4, top: 0.5, sides: 0.4, back: 0.5, nape: 0.3 },
    lift: 0.05,
    spread: 0,
    stiffness: 0.5,
    layPull: LAY,
    curl: STRAIGHT,
    atlasCurl: 0,
    endCurl: 0,
    clump: { amount: 0.45, size: 1 },
    gather: {
      kind: 'bun',
      a: Math.PI,
      e: 0.85,
      standoff: 0.8,
      tail: 30,
      radius: 3.6,
      turns: [1, 1.4],
    },
    strips: 2400,
    width: WIDTH,
    caps: FULL_CAPS,
  },
  curly: {
    length: { front: 26, crown: 26, top: 26, sides: 26, back: 26, nape: 26 },
    cut: { front: 6, side: 8, back: 9 },
    ends: { mode: 'point', jitter: 0.6 },
    tipTaper: 0.5,
    undercut: null,
    hairline: NO_HAIRLINE,
    short: LONG_ENDS,
    flow: { back: 0.1, down: 1, part: 0.7, swirl: 0.3 },
    fringe: { depth: 0.4, cut: 0 },
    volume: { crown: 3.5, top: 4.0, sides: 3.5, back: 4.0, nape: 3.0 },
    lift: 0.5,
    spread: 1.6,
    stiffness: 0.45,
    layPull: { inner: 0.3, mid: 0.25, outer: 0.2 },
    curl: { kind: 'wave', amplitude: 1.0, period: 5.5, start: 0.08 },
    atlasCurl: 1,
    endCurl: 0,
    clump: { amount: 0.75, size: 0.7 },
    gather: null,
    strips: 1200,
    width: { inner: 1.0, mid: 1.0, outer: 1.0 },
    caps: FULL_CAPS,
  },
}

/** The most a 단발's sides stand off at the cheeks (cm), whatever the 볼륨. */
const BOB_SIDES_MOST = 4

/** 길이 over 0.5 lets 곱슬 reach the shoulders. */
const CURLY_REACHES_BODY = 0.5

/**
 * The groom for a cut on a character: 길이 scales every length and cut
 * depth by 2^(0.9·v) (a tail too, a bun's ball by 2^(0.5·v)); 볼륨 scales
 * the regional volume, spread and lift by 2^v (lift at most 1, a 단발's
 * sides at most BOB_SIDES_MOST). The other sliders are read as they are.
 */
export function groomOf(cut: HairCut, who: Who): Groom {
  const def = STYLES[cut.style]
  const long = 2 ** (0.9 * cut.length)
  const full = 2 ** cut.volume
  const scaleRegion = <T extends Record<string, number>>(region: T, by: number) =>
    Object.fromEntries(Object.entries(region).map(([k, v]) => [k, v * by])) as T
  const volume = scaleRegion(def.volume, full)
  if (cut.style === 'bob') volume.sides = Math.min(volume.sides, BOB_SIDES_MOST)
  return {
    ...def,
    length: scaleRegion(def.length, long),
    cut: def.cut && scaleRegion(def.cut, long),
    volume,
    spread: def.spread * full,
    lift: Math.min(1, def.lift * full),
    gather: def.gather && {
      ...def.gather,
      tail: def.gather.tail * long,
      radius: def.gather.radius * (def.gather.kind === 'bun' ? 2 ** (0.5 * cut.length) : 1),
    },
    sliders: {
      style: cut.style,
      length: cut.length,
      volume: cut.volume,
      curl: cut.curl,
      part: cut.part,
      fringe: cut.fringe,
    },
    who,
    touchesBody:
      cut.style === 'long' ||
      cut.style === 'layered' ||
      (cut.style === 'curly' && cut.length > CURLY_REACHES_BODY),
  }
}

/** How much higher (rad) a man's hairline sits at the temples. */
const TEMPLE_RECESS = 0.1

/** A groom's hairline: its elevation at 33 even steps of |a| over [0, π]. */
export function hairlineTable(groom: Groom): Float32Array {
  const { front, temple, sideburn, nape } = groom.hairline
  const recess = groom.who.sex === 'male' && !groom.who.child ? TEMPLE_RECESS : 0
  return Float32Array.from({ length: HAIRLINE_STEPS }, (_, k) => {
    const a = (k / (HAIRLINE_STEPS - 1)) * Math.PI
    const bump = (at: number, width: number) => Math.exp(-(((a - at) / width) ** 2))
    return (
      baseHairline(a) +
      front * (1 - smoothstep(0.3, 0.75, a)) +
      (temple + recess) * bump(BASE_HAIRLINE[2]![0], 0.2) +
      sideburn * bump(BASE_HAIRLINE[5]![0], 0.12) +
      nape * smoothstep(2.4, 2.9, a)
    )
  })
}

let union: Float32Array | null = null

/**
 * The lowest hairline of every style on anyone, entry by entry: what a
 * head's base is laid out for, whatever cut it later wears.
 */
export function unionHairline(): Float32Array {
  if (!union) {
    const all = new Float32Array(HAIRLINE_STEPS).fill(Number.POSITIVE_INFINITY)
    for (const style of HAIR_CUT_STYLES) {
      for (const sex of ['male', 'female'] as const) {
        const table = hairlineTable(
          groomOf(
            { style, ...DEFAULT_CUT_PARAMS[style], tip: null, shine: 0.5 },
            {
              sex,
              child: false,
            },
          ),
        )
        for (let k = 0; k < HAIRLINE_STEPS; k++) all[k] = Math.min(all[k]!, table[k]!)
      }
    }
    union = all
  }
  return union
}

/**
 * Each region's share at (a, e) — crown, top, sides, back, nape — summing
 * to 1, eased between them.
 */
export function regionShares(a: number, e: number, out: Region) {
  const x = Math.abs(a)
  const sideways = smoothstep(0.7, 1.3, x)
  const behind = smoothstep(2.0, 2.6, x)
  const front = 1 - sideways
  const side = sideways * (1 - behind)
  const high = smoothstep(0.35, 0.85, e)
  const low = 1 - smoothstep(-0.6, -0.2, e)
  out.top = high * (front + side)
  out.crown = high * behind
  out.sides = (1 - high) * (front + side)
  out.back = (1 - high) * behind * (1 - low)
  out.nape = (1 - high) * behind * low
  return out
}

/** A regional value at (a, e). */
export function regional(region: Region, a: number, e: number, shares: Region) {
  regionShares(a, e, shares)
  return (
    region.crown * shares.crown +
    region.top * shares.top +
    region.sides * shares.sides +
    region.back * shares.back +
    region.nape * shares.nape
  )
}
