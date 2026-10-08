import { vertexNormals } from './bald-head'
import { type BaseInput, type BaseResult, headFits, spotsOf } from './hair-base'
import { cutKey, type GrowCut } from './hair-cut'
import { type Groom, hairlineTable, type Region, regional, unionHairline } from './hair-groom'
import {
  ATLAS,
  ATLAS_VARIANTS,
  depthInHair,
  joinRibbons,
  LAYER,
  type Layer,
  type RibbonFrame,
  ribbons,
  type StripSet,
} from './hair-ribbons'
import {
  angles,
  type Candidates,
  type EyeKeepOut,
  eyeKeepOut,
  fbm3,
  fnv1a,
  hairlineAt,
  hairlineDensity,
  onHead,
  outOfEyes,
  type RadiusMap,
  radiusAt,
  radiusMap,
  rootCandidates,
  TEMPLATE_CM,
  templateFrame,
  unitHash,
  type V3,
} from './hair-scalp'
import type { HairLibrary } from './hair-styles'
import { fitBald, PointGrid, smoothstep } from './head-skull'

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
  part: { x: number; fade: number }
  undercut: { line: number; shells: [number, number, number] } | null
  /** Where an ombré tip colour starts and is full (bind height). */
  ombre: { earY: number; cutY: number }
  /** The guides, kept for a later sway. */
  guides?: { points: Float32Array; perStrip: Uint16Array; weights: Float32Array }
  stats: { ms: Record<string, number>; triangles: number }
}

// ---------------------------------------------------------------------------
// Constants (cm on the adult template are × the head's scale, hs; mm are not).

/** Steps along a guide's walk, and between a strip's points before it is resampled (cm). */
const WALK_STEP = 0.6
const STRIP_STEP = 1.2
/** How far a root sinks into the head (mm), so no gap shows under it. */
const ROOT_SINK = 0.6
/** The least clearance off the skull (cm), and the inner layer's (mm: 1.5 over the 0.8 mm root layer). */
const LEAST_CLEAR = 0.15
const INNER_CLEAR = 2.3
/** Clearance grows to the regional volume over the first part of a strand (cm), lift fades over this (cm). */
const CLEAR_RAMP = 3
const LIFT_RAMP = 1.2
/** The volume's noise: its cell (cm) and share. */
const VOLUME_CELL = 4
const VOLUME_NOISE = 0.3
/** Each lock's stand-off: between these (mm), either way. */
const STANDOFF: readonly [number, number] = [2, 4]
/** Settling passes for a guide (long hair takes more); the last few collide segments' middles too. */
const SETTLE = 20
const SETTLE_LONG = 30
const MIDDLE_PASSES = 4
const LAY_PASSES = 3
/** Guides are walked this far (cm) past the lowest their strips are cut at. */
const WALK_PAST = 2
/** A strand lies along the scalp at least this far (cm) before it may leave it. */
const LEAVE_AFTER = 1
/** Strips are laid and collided in this many passes; their volume read every so many points. */
const STRIP_PASSES = 2
const VOLUME_EVERY = 3
/** How far below the head's middle (bind units) the envelope turns from round O to round its vertical axis. */
const ENVELOPE_TURN = 0.08
/** Where each layer stands in the hair's volume, as a share of the regional clearance. */
const LAYER_DEPTH: Record<'inner' | 'mid' | 'outer', number> = { inner: 0.3, mid: 0.75, outer: 1 }
/** The share of strips in the inner and mid layers (the rest are the outer layer). */
const INNER_SHARE = 0.3
const MID_SHARE = 0.4
/** Strays (studio only): their share of strips, width (cm) and how far out they stray (cm). */
const STRAY_SHARE = 0.015
const STRAY_WIDTH: readonly [number, number] = [0.1, 0.15]
const STRAY_OUT = 1
/** Baby hair along the front hairline (studio only): how many, how long (cm), how wide (cm), how far off the comb. */
const BABY: readonly [number, number] = [40, 80]
const BABY_LENGTH: readonly [number, number] = [0.5, 2]
const BABY_WIDTH = 0.15
const BABY_TURN = (40 * Math.PI) / 180
/** Strips in the hairline band are narrower and lift more. */
const BAND_LIFT = 1.5
/** Roots below the cut, and fringe strips that never reach theirs, are this long at most (cm). */
const BELOW_CUT = 2.2
const FRINGE_MOST = 9
/** The fringe's cut: this far over the brows (cm) with 앞머리 at 0, and at 1. */
const FRINGE_CUT: readonly [number, number] = [2.5, 0.3]
/** 앞머리 under this uses the wispy layer and narrow strips: a see-through fringe. */
const SEE_THROUGH = 0.35
/** The fringe's width (cm) at 앞머리 0 and 1, and its density. */
const FRINGE_WIDTH: readonly [number, number] = [0.25, 0.55]
const FRINGE_DENSITY: readonly [number, number] = [0.4, 1]
/** Within a lock, ends stray by this (mm) round the lock's own. */
const IN_LOCK = 1
/** Blunt ends: the lock's pull lets go over this last share of the strip. */
const BLUNT_RELEASE = 0.15
/** 단발's ends turn under over this last share of the strip. */
const END_CURL_FROM = 0.75
/** Strands shorter than these (cm) turn under less, none under the first. */
const END_CURL_LENGTH: readonly [number, number] = [3, 8]
/** A short style's hair arches round the ear: this far over its top (mm). */
const OVER_EAR = 6
/** A short style's nape: strands rooted at the nape line are this long (cm), longer higher up. */
const NAPE_LENGTH = 1.25
/**
 * An undercut's top hair drapes this far (rad) below the block line: a
 * little over the temples, further down the back, so the hem tapers to
 * the nape instead of ringing the head like a bowl.
 */
const BLOCK_DRAPE: readonly [number, number] = [0.1, 0.3]
/** How far down (cm) from the head bone strands stop following the head's shape. */
const FOLLOW_FADE = 10
/** Bind units per atlas repeat along a strand (cm). */
const ATLAS_REPEAT = 8
/** How strips are resampled: a point where they turn this far (rad) since the last, and at least every so far (cm). */
const RESAMPLE: Record<Tier, { turn: number; spacing: number }> = {
  studio: { turn: (12 * Math.PI) / 180, spacing: 3 },
  game: { turn: (20 * Math.PI) / 180, spacing: 5 },
  far: { turn: (20 * Math.PI) / 180, spacing: 5 },
}
/** Each tier's share of the studio's roots, in root order. */
const TIER_SHARE: Record<Tier, number> = { studio: 1, game: 0.5, far: 0.2 }
/** The cranium is skinned to the head bone alone this far over its bind height (bind units). */
const CRANIUM_RIGID = 0.03
/** The whorl's place on the scalp (a, e), how far round it the swirl reaches (cos), and its turn. */
const WHORL: readonly [number, number] = [2.9, 0.95]
const WHORL_REACH: readonly [number, number] = [0.75, 0.97]
const WHORL_AXIS: V3 = [
  Math.cos(WHORL[1]) * Math.sin(WHORL[0]),
  Math.sin(WHORL[1]),
  Math.cos(WHORL[1]) * Math.cos(WHORL[0]),
]
/** The part's offset per unit of 가르마 (template units) at the front, gone by the crown. */
const PART_SHIFT = 0.045
const PART_FADE: readonly [number, number] = [-0.04, 0.08]
/** Groups guides blend within. */
const GROUP = { right: 0, left: 1, fringe: 2, crown: 3, tied: 4 } as const
/** Sub-seeds of a grow's stages. */
const SEED = { roots: 0xa, guides: 0xb, strips: 0xc, tails: 0xd, noise: 0xe } as const

const smooth = smoothstep

// ---------------------------------------------------------------------------
// The head as the worker keeps it.

type ShapeData = {
  version: number
  points: Float32Array
  normals: Float32Array
  map: RadiusMap
}

type StyleRoots = {
  /** Candidates kept, in root order. */
  cand: Int32Array
  group: Uint8Array
  density: Float32Array
}

class HeadState implements HeadData {
  readonly avatar: string
  readonly cm: number
  readonly mm: number
  hs = 1
  readonly origin: V3
  readonly templateOrigin: V3
  readonly scale: V3
  readonly shift: V3
  readonly eyeY: number
  readonly browY: number
  readonly keepOut: EyeKeepOut
  readonly ears: { side: number; top: number; y: number; z: number; depth: number; inner: number }[]
  readonly earGrid: PointGrid | null
  readonly candidates: Candidates
  readonly bald: { points: Float32Array; index: Uint32Array }
  readonly index: Uint32Array
  readonly spots: Int32Array
  readonly spotCount: number
  readonly skinIndex: Uint16Array
  readonly skinWeight: Float32Array
  readonly headBone: number
  readonly neck: number
  readonly faceBones: Set<number>
  readonly shapes: ShapeData[] = []
  readonly styleRoots = new Map<string, StyleRoots>()
  /** The last guides grown: a drag's game-tier preview and its release's studio grow share them. */
  lastGuides: { key: string; guides: Guides } | null = null

  constructor(input: BaseInput, base: Pick<BaseResult, 'head'>, library: HairLibrary) {
    this.avatar = input.avatar
    this.cm = 0.01 / input.metresPerUnit
    this.mm = 0.001 / input.metresPerUnit
    const { cranium } = headFits(input, library)
    const frame = templateFrame(library.skull)
    this.templateOrigin = frame.origin
    this.scale = cranium.scale
    this.shift = cranium.shift
    this.origin = [0, 1, 2].map(
      (axis) => frame.origin[axis]! * cranium.scale[axis]! + cranium.shift[axis]!,
    ) as V3
    const [left, right] = input.marks.eyes as [number[], number[]]
    this.eyeY = (left[1]! + right[1]!) / 2
    this.browY = input.faceBones.Bip01_MMiddleEyebrow?.[1] ?? this.eyeY + 2 * this.cm
    this.keepOut = eyeKeepOut(input.marks.eyes, input.lashes, this.cm)
    const bald = fitBald(library.skull, cranium)
    this.bald = { points: bald.points, index: library.skull.triangles }
    // Its own copy: the base itself is handed on to the page.
    this.index = Uint32Array.from(base.head.index)
    const { spots, count } = spotsOf(input.head.points)
    this.spots = spots
    this.spotCount = count
    this.skinIndex = input.head.skinIndex
    this.skinWeight = input.head.skinWeight
    this.headBone = input.boneIndex.head
    this.neck = input.marks.neck
    // The face's bones (any the head is skinned to but the head, neck and body's): hair never follows them.
    const body = new Set(Object.values(input.boneIndex))
    this.faceBones = new Set<number>()
    for (let i = 0; i < input.head.skinIndex.length; i++) {
      if (input.head.skinWeight[i]! > 0 && !body.has(input.head.skinIndex[i]!)) {
        this.faceBones.add(input.head.skinIndex[i]!)
      }
    }
    // The ears, each side: its top, middle and how far back and in it reaches.
    const points = input.head.points
    const sideEars = new Map<number, number[]>()
    const earPoints: number[] = []
    for (let i = 0; i < points.length / 3; i++) {
      if (!input.ears?.[i]) continue
      const side = points[i * 3]! > this.origin[0] ? 1 : -1
      const list = sideEars.get(side) ?? []
      list.push(i)
      sideEars.set(side, list)
      earPoints.push(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!)
    }
    this.earGrid = earPoints.length > 0 ? new PointGrid(earPoints, 0.02) : null
    this.ears = [...sideEars].map(([side, ids]) => {
      const ys = ids.map((i) => points[i * 3 + 1]!)
      const zs = ids.map((i) => points[i * 3 + 2]!)
      const xs = ids.map((i) => Math.abs(points[i * 3]! - this.origin[0]))
      const top = Math.max(...ys)
      const low = Math.min(...ys)
      return {
        side,
        top,
        y: (top + low) / 2,
        z: (Math.max(...zs) + Math.min(...zs)) / 2,
        depth: (Math.max(...zs) - Math.min(...zs)) / 2,
        inner: Math.min(...xs),
      }
    })
    this.candidates = rootCandidates(
      library.skull,
      'union',
      (a, e) => e > hairlineAt(unionHairline(), a) - 0.1,
    )
    // The head's scale: its arc from the front hairline over the top to the
    // nape, against the template's (an adult man's, where cm are cm).
    const shape = this.shape({ version: Number.NaN, head: base.head.points, body: null })
    this.hs = arcOver(shape.map) / this.cm / (templateArc(library) / TEMPLATE_CM)
    this.shapes.length = 0
  }

  /** The flattened head as shaped, its normals and radius map (the last few kept). */
  shape(input: ShapeInput): ShapeData {
    const known = this.shapes.find((s) => s.version === input.version && s.points === input.head)
    if (known) return known
    const raw = vertexNormals(input.head, this.index)
    // Alike at every spot, so a root on a texture seam isn't lit apart.
    const sum = new Float32Array(this.spotCount * 3)
    for (let i = 0; i < raw.length / 3; i++) {
      for (let axis = 0; axis < 3; axis++) sum[this.spots[i]! * 3 + axis]! += raw[i * 3 + axis]!
    }
    const normals = new Float32Array(raw.length)
    for (let i = 0; i < raw.length / 3; i++) {
      const s = this.spots[i]!
      const l = Math.sqrt(sum[s * 3]! ** 2 + sum[s * 3 + 1]! ** 2 + sum[s * 3 + 2]! ** 2) || 1
      for (let axis = 0; axis < 3; axis++) normals[i * 3 + axis] = sum[s * 3 + axis]! / l
    }
    const map = radiusMap(this.origin, [{ points: input.head, index: this.index }, this.bald])
    const data = { version: input.version, points: input.head, normals, map }
    this.shapes.unshift(data)
    if (this.shapes.length > SHAPES_KEPT) this.shapes.pop()
    return data
  }

  /** A point's place on the template (the fit undone) as (a, e). */
  templateAngles(x: number, y: number, z: number) {
    return angles(
      (x - this.shift[0]) / this.scale[0] - this.templateOrigin[0],
      (y - this.shift[1]) / this.scale[1] - this.templateOrigin[1],
      (z - this.shift[2]) / this.scale[2] - this.templateOrigin[2],
    )
  }
}

/** The arc (bind units) from the front hairline over the top to the nape, along the middle of a radius map. */
function arcOver(map: RadiusMap) {
  let length = 0
  let last: number[] | null = null
  const front = hairlineAt(unionHairline(), 0)
  const back = hairlineAt(unionHairline(), Math.PI)
  const steps = 96
  for (let k = 0; k <= steps; k++) {
    const t = front + (Math.PI - back - front) * (k / steps)
    const r = radiusAt(map, 0, Math.sin(t), Math.cos(t))
    if (r <= 0) continue
    const p = [Math.sin(t) * r, Math.cos(t) * r]
    if (last) length += Math.sqrt((p[0]! - last[0]!) ** 2 + (p[1]! - last[1]!) ** 2)
    last = p
  }
  return length
}

const templateArcs = new WeakMap<HairLibrary['skull'], number>()

/** The template's own arc (see `arcOver`), once per skull. */
function templateArc(library: HairLibrary) {
  let arc = templateArcs.get(library.skull)
  if (arc === undefined) {
    const { bald, triangles } = library.skull
    arc = arcOver(
      radiusMap(templateFrame(library.skull).origin, [{ points: bald, index: triangles }]),
    )
    templateArcs.set(library.skull, arc)
  }
  return arc
}

/** Shaped heads a worker keeps per avatar. */
const SHAPES_KEPT = 6

const stateOf = (head: HeadData) => head as HeadState

export function headData(
  input: BaseInput,
  base: Pick<BaseResult, 'head'>,
  library: HairLibrary,
): HeadData {
  return new HeadState(input, base, library)
}

/** A head's frame as grown on: its middle, centimetre, scale and eyes' keep-out (for tests and the runtime). */
export function headFrame(head: HeadData) {
  const state = stateOf(head)
  return {
    origin: state.origin,
    cm: state.cm,
    mm: state.mm,
    hs: state.hs,
    keepOut: state.keepOut,
    eyeY: state.eyeY,
    browY: state.browY,
    neck: state.neck,
    ears: state.ears,
    radiusMap: (shape: ShapeInput) => state.shape(shape).map,
  }
}

// ---------------------------------------------------------------------------
// Fields.

/** A root's length (bind units) at (a, e) on the template, its group's. */
export function rootLength(groom: Groom, a: number, e: number, group: number, cmHs: number) {
  const L = groom.length
  const x = Math.abs(a)
  const side = smooth(0.6, 1.5, x)
  const back = smooth(1.6, 2.6, x)
  const low = smooth(0.2, -0.6, e)
  const top = smooth(0.4, 1.2, e)
  let length =
    L.front * (1 - side) * (1 - top) +
    top * (L.top * (1 - back) + L.crown * back) +
    L.sides * side * (1 - back) * (1 - top) +
    L.back * back * (1 - top)
  length = length * (1 - low * back) + L.nape * low * back
  if (group === GROUP.fringe) length = Math.max(length, L.front)
  return length * cmHs
}

/** The cut's depth (cm under eye level) for a root at template azimuth a. */
function cutDepth(cut: NonNullable<Groom['cut']>, a: number) {
  const x = Math.abs(a)
  const side = smooth(0.4, 1.4, x)
  const back = smooth(1.8, 2.8, x)
  return cut.front * (1 - side) + cut.side * side * (1 - back) + cut.back * back
}

/** Where hair stops lying on the head and hangs: under its widest line. */
export const leaveElevation = (a: number) => -0.05 - 0.3 * smooth(1.6, 2.8, Math.abs(a))

/** The comb's direction (unit, along the head) at a head direction d (unit, from O) for a group. */
function comb(groom: Groom, d: V3, group: number, out: number[]) {
  out[0] = 0
  out[1] = 0
  out[2] = 0
  const add = (vx: number, vy: number, vz: number, w: number) => {
    const k = vx * d[0] + vy * d[1] + vz * d[2]
    out[0]! += (vx - k * d[0]) * w
    out[1]! += (vy - k * d[1]) * w
    out[2]! += (vz - k * d[2]) * w
  }
  const { flow } = groom
  const part = groom.sliders.part
  if (group === GROUP.fringe) {
    add(0, -0.4, 1, 1.2)
    add(0, -1, 0, 0.6)
    add(-Math.sign(part || 1e-4) * 0.4 * Math.abs(part), 0, 0, 1)
  } else {
    add(0, -1, 0, flow.down)
    add(0, 0, -1, flow.back)
    const side = group === GROUP.left ? 1 : group === GROUP.right ? -1 : 0
    add(side, 0, 0, flow.part * smooth(0.1, 0.9, d[1]))
    if (group === GROUP.crown) {
      const axis = WHORL_AXIS
      const near = smooth(
        WHORL_REACH[0],
        WHORL_REACH[1],
        d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2],
      )
      add(
        axis[1] * d[2] - axis[2] * d[1],
        axis[2] * d[0] - axis[0] * d[2],
        axis[0] * d[1] - axis[1] * d[0],
        flow.swirl * near,
      )
    }
  }
  let l = Math.sqrt(out[0]! ** 2 + out[1]! ** 2 + out[2]! ** 2)
  if (l < 1e-6) {
    add(0, -1, 0, 1)
    l = Math.sqrt(out[0]! ** 2 + out[1]! ** 2 + out[2]! ** 2) || 1
  }
  out[0]! /= l
  out[1]! /= l
  out[2]! /= l
}

// ---------------------------------------------------------------------------
// Roots.

type Roots = {
  count: number
  /** Candidate per root, template (a, e), group and density there. */
  cand: Int32Array
  a: Float32Array
  e: Float32Array
  group: Uint8Array
  density: Float32Array
  pass: Uint8Array
  /** On the shaped head: triangle, barycentrics (b, c), point and normal. */
  tri: Uint32Array
  bary: Float32Array
  pos: Float32Array
  nrm: Float32Array
}

/** Which candidates a style keeps, by its density and group (cached per style and fringe). */
function styleRoots(state: HeadState, groom: Groom): StyleRoots {
  const fringeOn = groom.sliders.fringe > 0.05
  const key = `${groom.sliders.style}|${groom.who.sex}|${fringeOn}`
  const known = state.styleRoots.get(key)
  if (known) return known
  const table = hairlineTable(groom)
  const c = state.candidates
  const cand: number[] = []
  const group: number[] = []
  const density: number[] = []
  const found: number[] = []
  const distances: number[] = []
  const [line] = groom.undercut ? [groom.undercut.line] : [Number.NEGATIVE_INFINITY]
  for (let i = 0; i < c.count; i++) {
    const a = c.a[i]!
    const e = c.e[i]!
    let d = hairlineDensity(table, a, e)
    if (groom.undercut && Math.abs(a) > 0.95 && e < line) d = 0
    if (d <= 0) continue
    // Clear of the ears: none within 4 mm, all from 10.
    if (state.earGrid) {
      const [x, y, z] = [0, 1, 2].map(
        (axis) => c.point[i * 3 + axis]! * state.scale[axis]! + state.shift[axis]!,
      )
      const near = state.earGrid.nearest(x!, y!, z!, 1, found, distances, 10 * state.mm)
      if (near > 0) d *= smooth(4 * state.mm, 10 * state.mm, Math.sqrt(distances[0]!))
    }
    const tz = c.point[i * 3 + 2]! - state.templateOrigin[2]
    const tx = c.point[i * 3]! - state.templateOrigin[0]
    const fringe =
      fringeOn && Math.abs(a) < 0.95 && e > 0.2 && e < hairlineAt(table, a) + groom.fringe.depth
    if (c.rand[i]! >= d) continue
    const partX = PART_SHIFT * groom.sliders.part * (1 - smooth(PART_FADE[0], PART_FADE[1], -tz))
    cand.push(i)
    density.push(d)
    group.push(
      groom.gather
        ? GROUP.tied
        : fringe
          ? GROUP.fringe
          : tz < -0.02
            ? GROUP.crown
            : tx > partX
              ? GROUP.left
              : GROUP.right,
    )
  }
  const roots = {
    cand: Int32Array.from(cand),
    group: Uint8Array.from(group),
    density: Float32Array.from(density),
  }
  state.styleRoots.set(key, roots)
  return roots
}

/** A style's roots on the head as shaped: each cast from the head's middle onto it, sunk a little. */
function placeRoots(state: HeadState, shape: ShapeData, picked: StyleRoots, count: number): Roots {
  const c = state.candidates
  const cand: number[] = []
  const tri: number[] = []
  const bary: number[] = []
  const pos: number[] = []
  const nrm: number[] = []
  const ga: number[] = []
  const ge: number[] = []
  const group: number[] = []
  const density: number[] = []
  const pass: number[] = []
  const hit = { tri: -1, u: 0, v: 0, t: 0 }
  const [ox, oy, oz] = state.origin
  const { points, normals } = shape
  const index = state.index
  for (let k = 0; k < count; k++) {
    const i = picked.cand[k]!
    const fx = c.point[i * 3]! * state.scale[0] + state.shift[0] - ox
    const fy = c.point[i * 3 + 1]! * state.scale[1] + state.shift[1] - oy
    const fz = c.point[i * 3 + 2]! * state.scale[2] + state.shift[2] - oz
    const l = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1
    if (onHead(shape.map, points, index, fx / l, fy / l, fz / l, hit) < 0) continue
    const [ia, ib, ic] = [index[hit.tri * 3]!, index[hit.tri * 3 + 1]!, index[hit.tri * 3 + 2]!]
    const w0 = 1 - hit.u - hit.v
    let nx = 0
    let ny = 0
    let nz = 0
    const p = [0, 0, 0]
    for (let axis = 0; axis < 3; axis++) {
      p[axis] =
        points[ia * 3 + axis]! * w0 +
        points[ib * 3 + axis]! * hit.u +
        points[ic * 3 + axis]! * hit.v
    }
    nx = normals[ia * 3]! * w0 + normals[ib * 3]! * hit.u + normals[ic * 3]! * hit.v
    ny = normals[ia * 3 + 1]! * w0 + normals[ib * 3 + 1]! * hit.u + normals[ic * 3 + 1]! * hit.v
    nz = normals[ia * 3 + 2]! * w0 + normals[ib * 3 + 2]! * hit.u + normals[ic * 3 + 2]! * hit.v
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
    const sink = ROOT_SINK * state.mm
    cand.push(i)
    tri.push(hit.tri)
    bary.push(hit.u, hit.v)
    pos.push(p[0]! - nx * sink, p[1]! - ny * sink, p[2]! - nz * sink)
    nrm.push(nx, ny, nz)
    ga.push(c.a[i]!)
    ge.push(c.e[i]!)
    group.push(picked.group[k]!)
    density.push(picked.density[k]!)
    pass.push(c.pass[i]!)
  }
  return {
    count: cand.length,
    cand: Int32Array.from(cand),
    a: Float32Array.from(ga),
    e: Float32Array.from(ge),
    group: Uint8Array.from(group),
    density: Float32Array.from(density),
    pass: Uint8Array.from(pass),
    tri: Uint32Array.from(tri),
    bary: Float32Array.from(bary),
    pos: Float32Array.from(pos),
    nrm: Float32Array.from(nrm),
  }
}

// ---------------------------------------------------------------------------
// Walking, colliding and laying.

/** A polyline with each point's arc length and whether it still lies on the head. */
type Path = {
  points: Float32Array
  s: Float32Array
  lying: Uint8Array
  count: number
  length: number
}

type Grower = {
  state: HeadState
  shape: ShapeData
  groom: Groom
  cmHs: number
  noiseSeed: number
  shares: Region
}

/** The regional volume (bind units) at a point, with its noise: what clearance grows to there. */
function volumeAt(g: Grower, x: number, y: number, z: number) {
  const { state, groom, cmHs } = g
  const [a, e] = angles(x - state.origin[0], y - state.origin[1], z - state.origin[2])
  const cell = VOLUME_CELL * state.cm
  const noise = 1 + VOLUME_NOISE * fbm3(x / cell, y / cell, z / cell, g.noiseSeed)
  return regional(groom.volume, a, e, g.shares) * cmHs * noise
}

/** The clearance (bind units) over the skull for a volume, at an arc along the strand, a lock's stand-off and a layer's depth. */
const clearance = (g: Grower, volume: number, s: number, standoff: number, depth: number) =>
  LEAST_CLEAR * g.state.cm + (volume * smooth(0, CLEAR_RAMP * g.cmHs, s) + standoff) * depth

const dir: V3 = [0, 0, 0]

/** Pushes a point (at `o`) out of the head to `clear` over it, and out of the eyes; true if it moved. */
function collide(g: Grower, p: Float32Array, o: number, clear: number) {
  const [ox, oy, oz] = g.state.origin
  const dx = p[o]! - ox
  const dy = p[o + 1]! - oy
  const dz = p[o + 2]! - oz
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz)
  let moved = false
  if (r > 1e-9) {
    const R = radiusAt(g.shape.map, dx / r, dy / r, dz / r)
    if (R > 0 && r < R + clear) {
      const k = (R + clear) / r
      p[o] = ox + dx * k
      p[o + 1] = oy + dy * k
      p[o + 2] = oz + dz * k
      moved = true
    }
  }
  return outOfEyes(g.state.keepOut, p, o) || moved
}

/** A segment's middle out of the head: both its ends pushed out by as far as it is in. */
function collideMiddle(g: Grower, p: Float32Array, a: number, b: number, clear: number) {
  const [ox, oy, oz] = g.state.origin
  const mx = (p[a]! + p[b]!) / 2 - ox
  const my = (p[a + 1]! + p[b + 1]!) / 2 - oy
  const mz = (p[a + 2]! + p[b + 2]!) / 2 - oz
  const r = Math.sqrt(mx * mx + my * my + mz * mz)
  if (r < 1e-9) return
  const R = radiusAt(g.shape.map, mx / r, my / r, mz / r)
  const inside = R + clear - r
  if (R <= 0 || inside <= 0) return
  const [ux, uy, uz] = [mx / r, my / r, mz / r]
  // Never the root (a strip's first point).
  for (const o of a === 0 ? [b] : [a, b]) {
    p[o]! += ux * inside
    p[o + 1]! += uy * inside
    p[o + 2]! += uz * inside
  }
}

/** Two-sided: hair lying on the head is drawn toward `clear` over it by `pull`, never under half of it. */
function layOn(g: Grower, p: Float32Array, o: number, clear: number, pull: number) {
  const [ox, oy, oz] = g.state.origin
  const dx = p[o]! - ox
  const dy = p[o + 1]! - oy
  const dz = p[o + 2]! - oz
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (r < 1e-9) return
  const R = radiusAt(g.shape.map, dx / r, dy / r, dz / r)
  if (R <= 0) return
  let target = r + (R + clear - r) * pull
  if (target < R + clear * 0.5) target = R + clear * 0.5
  const k = target / r
  p[o] = ox + dx * k
  p[o + 1] = oy + dy * k
  p[o + 2] = oz + dz * k
}

/** Arc lengths along a polyline (into `s`), and its whole length. */
function arcLengths(points: Float32Array, count: number, s: Float32Array) {
  s[0] = 0
  for (let k = 1; k < count; k++) {
    const dx = points[k * 3]! - points[k * 3 - 3]!
    const dy = points[k * 3 + 1]! - points[k * 3 - 2]!
    const dz = points[k * 3 + 2]! - points[k * 3 - 1]!
    s[k] = s[k - 1]! + Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
  return s[count - 1] ?? 0
}

/** A point at arc length `at` along a path (held at its last point past its end) into out. */
function pointAt(path: Path, at: number, out: number[], lying?: number[]) {
  const { points, s, count } = path
  if (at >= s[count - 1]!) {
    // Past the end: on along its last direction.
    const k = count - 1
    const over = at - s[k]!
    const prev = Math.max(0, k - 1)
    const seg = s[k]! - s[prev]! || 1
    for (let axis = 0; axis < 3; axis++) {
      out[axis] =
        points[k * 3 + axis]! + ((points[k * 3 + axis]! - points[prev * 3 + axis]!) / seg) * over
    }
    if (lying) lying[0] = path.lying[k]!
    return
  }
  let lo = 0
  let hi = count - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (s[mid]! <= at) lo = mid
    else hi = mid
  }
  const t = (at - s[lo]!) / (s[hi]! - s[lo]! || 1)
  for (let axis = 0; axis < 3; axis++) {
    out[axis] = points[lo * 3 + axis]! * (1 - t) + points[hi * 3 + axis]! * t
  }
  if (lying) lying[0] = t < 0.5 ? path.lying[lo]! : path.lying[hi]!
}

// ---------------------------------------------------------------------------
// Guides.

type Guides = { roots: Roots; paths: Path[]; index: Int32Array }

/** Walks and settles the guides: the roots of the first pass. */
function growGuides(g: Grower, roots: Roots, seed: number): Guides {
  const { state, groom, cmHs } = g
  const ids: number[] = []
  for (let i = 0; i < roots.count; i++) if (roots.pass[i] === 0) ids.push(i)
  const step = WALK_STEP * cmHs
  const lift0 = groom.lift
  const flow = [0, 0, 0]
  const paths: Path[] = []
  const passes = groom.touchesBody ? SETTLE_LONG : SETTLE
  const stiff = groom.stiffness
  const [ox, oy, oz] = state.origin
  for (const i of ids) {
    const group = roots.group[i]!
    const length =
      rootLength(groom, roots.a[i]!, roots.e[i]!, group, cmHs) *
      (1 + 0.08 * (unitHash(seed, i) - 0.5))
    const steps = Math.max(2, Math.ceil(length / step))
    const points = new Float32Array((steps + 1) * 3)
    const lying = new Uint8Array(steps + 1)
    const volume = new Float32Array(steps + 1)
    points.set(roots.pos.subarray(i * 3, i * 3 + 3))
    lying[0] = 1
    const lift = Math.min(1, lift0 * (roots.density[i]! < 1 ? BAND_LIFT : 1))
    // Hair the cut takes off is not walked: a little past the lowest its strips are cut at.
    const stopY =
      group === GROUP.fringe
        ? fringeLevel(g) - WALK_PAST * cmHs
        : groom.cut
          ? state.eyeY - (cutDepth(groom.cut, roots.a[i]!) + groom.ends.jitter + WALK_PAST) * cmHs
          : Number.NEGATIVE_INFINITY
    let count = steps + 1
    let onHeadNow = true
    let travelled = 0
    for (let k = 1; k <= steps; k++) {
      const px = points[k * 3 - 3]!
      const py = points[k * 3 - 2]!
      const pz = points[k * 3 - 1]!
      const dx = px - ox
      const dy = py - oy
      const dz = pz - oz
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      dir[0] = dx / r
      dir[1] = dy / r
      dir[2] = dz / r
      const [a, e] = angles(dx, dy, dz)
      // Even a root under the head's widest line combs along the scalp before it falls.
      if (onHeadNow && travelled >= LEAVE_AFTER * cmHs && e < leaveElevation(a)) onHeadNow = false
      let sx: number
      let sy: number
      let sz: number
      if (onHeadNow) {
        comb(groom, dir, group, flow)
        const up = lift * (1 - smooth(0, LIFT_RAMP * cmHs, travelled))
        sx = flow[0]! * (1 - up) + dir[0] * up
        sy = flow[1]! * (1 - up) + dir[1] * up
        sz = flow[2]! * (1 - up) + dir[2] * up
      } else {
        // Off the head it keeps its way, falling.
        const back = Math.max(0, k - 2)
        sx = px - points[back * 3]!
        sy = py - points[back * 3 + 1]! - step * (1 - stiff)
        sz = pz - points[back * 3 + 2]!
      }
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1
      points[k * 3] = px + (sx / sl) * step
      points[k * 3 + 1] = py + (sy / sl) * step
      points[k * 3 + 2] = pz + (sz / sl) * step
      travelled += step
      volume[k] = volumeAt(g, points[k * 3]!, points[k * 3 + 1]!, points[k * 3 + 2]!)
      const clear = clearance(g, volume[k]!, travelled, 0, LAYER_DEPTH.mid)
      if (onHeadNow) layOn(g, points, k * 3, clear, groom.layPull.mid)
      collide(g, points, k * 3, clear)
      lying[k] = onHeadNow ? 1 : 0
      if (k >= 2 && points[k * 3 + 1]! < stopY) {
        count = k + 1
        break
      }
    }
    const seg = step
    // Settled: gravity and stiffness on what hangs, the lay pull on what lies.
    for (let pass = 0; pass < passes; pass++) {
      for (let k = 2; k < count; k++) {
        // What lies on the head has settled after a few passes: only what hangs moves on.
        if (lying[k] && pass >= LAY_PASSES) continue
        const p = k * 3
        if (!lying[k]) {
          points[p + 1]! -= seg * 0.25 * (1 - 0.8 * stiff)
          const ax = points[p - 3]! - points[p - 6]!
          const ay = points[p - 2]! - points[p - 5]!
          const az = points[p - 1]! - points[p - 4]!
          const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1
          const w = stiff * (1 - (0.5 * k) / count)
          points[p] = points[p]! * (1 - w) + (points[p - 3]! + (ax / al) * seg) * w
          points[p + 1] = points[p + 1]! * (1 - w) + (points[p - 2]! + (ay / al) * seg) * w
          points[p + 2] = points[p + 2]! * (1 - w) + (points[p - 1]! + (az / al) * seg) * w
          if (groom.spread > 0) {
            const below = smooth(state.eyeY, state.eyeY - 0.12, points[p + 1]!)
            const hx = points[p]! - ox
            const hz = points[p + 2]! - oz
            const hl = Math.sqrt(hx * hx + hz * hz) || 1
            const push = groom.spread * cmHs * 0.02 * below
            points[p]! += (hx / hl) * push
            points[p + 2]! += (hz / hl) * push
          }
        }
        const dx = points[p]! - points[p - 3]!
        const dy = points[p + 1]! - points[p - 2]!
        const dz = points[p + 2]! - points[p - 1]!
        const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
        points[p] = points[p - 3]! + (dx / dl) * seg
        points[p + 1] = points[p - 2]! + (dy / dl) * seg
        points[p + 2] = points[p - 1]! + (dz / dl) * seg
        const clear = clearance(g, volume[k]!, k * seg, 0, LAYER_DEPTH.mid)
        if (lying[k]) {
          layOn(g, points, p, clear, groom.layPull.mid)
          outOfEyes(state.keepOut, points, p)
        } else {
          collide(g, points, p, clear)
          if (pass >= passes - MIDDLE_PASSES) collideMiddle(g, points, p - 3, p, clear)
        }
      }
    }
    const s = new Float32Array(count)
    const total = arcLengths(points, count, s)
    paths.push({ points: points.subarray(0, count * 3), s, lying, count, length: total })
  }
  return { roots, paths, index: Int32Array.from(ids) }
}

// ---------------------------------------------------------------------------
// Strips.

/** What the generator knows of each strip besides its points (for the build and the tests). */
export type StripInfo = {
  /** The strip's root among the build's roots (its strand id). */
  root: Uint32Array
  a: Float32Array
  e: Float32Array
  group: Uint8Array
  lock: Int32Array
  layer: Uint8Array
  /** Its length by the length field (bind units), and how it was cut: 0 not, 1 at the cut, 2 short below it, 3 by a short style's ear, nape or block. */
  field: Float32Array
  cut: Uint8Array
  /** The cut level it was cut at (bind height), where it was cut at a level. */
  level: Float32Array
  /** Its outer clearance factor and lock stand-off, for the clearance profile. */
  standoff: Float32Array
}

/** The rotation (row-major 3×3, into out) taking unit a to unit b (Rodrigues); none for opposite ones. */
function rotation(a: number[], b: number[], out: number[]) {
  const x = a[1]! * b[2]! - a[2]! * b[1]!
  const y = a[2]! * b[0]! - a[0]! * b[2]!
  const z = a[0]! * b[1]! - a[1]! * b[0]!
  const c = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  if (c < -0.999) {
    out.fill(0)
    out[0] = out[4] = out[8] = 1
    return
  }
  // R = I + [v]× + [v]×² / (1 + c), v = a × b
  const k = 1 / (1 + c)
  out[0] = 1 - (y * y + z * z) * k
  out[1] = -z + x * y * k
  out[2] = y + x * z * k
  out[3] = z + x * y * k
  out[4] = 1 - (x * x + z * z) * k
  out[5] = -x + y * z * k
  out[6] = -y + x * z * k
  out[7] = x + y * z * k
  out[8] = 1 - (x * x + y * y) * k
}

type Strip = Path & {
  root: number
  layer: Layer
  lock: number
  cut: number
  level: number
  field: number
}

/**
 * Strips from the guides: each blended from the four nearest guides of its
 * group (their offsets turned to its own root), pulled into locks, curled,
 * laid by layer, collided and cut lock by lock.
 */
function growStripPaths(g: Grower, guides: Guides, roots: Roots, count: number, seed: number) {
  const { state, groom, cmHs } = g
  const [ox, oy, oz] = state.origin
  const step = STRIP_STEP * cmHs
  // Guides by group.
  const byGroup = new Map<number, { grid: PointGrid; ids: number[] }>()
  guides.index.forEach((i, q) => {
    const group = roots.group[i]!
    let entry = byGroup.get(group)
    if (!entry) {
      entry = { grid: null as unknown as PointGrid, ids: [] }
      byGroup.set(group, entry)
    }
    entry.ids.push(q)
  })
  for (const entry of byGroup.values()) {
    const at = new Float32Array(entry.ids.length * 3)
    for (let k = 0; k < entry.ids.length; k++) {
      const i = guides.index[entry.ids[k]!]!
      at.set(roots.pos.subarray(i * 3, i * 3 + 3), k * 3)
    }
    entry.grid = new PointGrid(at, 0.02)
  }
  const anyGrid = new PointGrid(
    Float32Array.from(
      Array.from(guides.index).flatMap((i) => [...roots.pos.subarray(i * 3, i * 3 + 3)]),
    ),
    0.02,
  )
  // Locks: in root order each strip joins the nearest lock of its group within the lock's size, or starts one.
  const lockOf = new Int32Array(count)
  {
    const size = groom.clump.size * cmHs
    const cells = new Map<number, number[]>()
    const cellKey = (x: number, y: number, z: number) =>
      ((x + 512) * 1024 + (y + 512)) * 1024 + z + 512
    for (let c = 0; c < count; c++) {
      const [x, y, z] = [roots.pos[c * 3]!, roots.pos[c * 3 + 1]!, roots.pos[c * 3 + 2]!]
      const [ix, iy, iz] = [Math.floor(x / size), Math.floor(y / size), Math.floor(z / size)]
      let best = -1
      let bestD = size * size
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const q of cells.get(cellKey(ix + dx, iy + dy, iz + dz)) ?? []) {
              if (roots.group[q] !== roots.group[c]) continue
              const d =
                (roots.pos[q * 3]! - x) ** 2 +
                (roots.pos[q * 3 + 1]! - y) ** 2 +
                (roots.pos[q * 3 + 2]! - z) ** 2
              if (d < bestD) {
                bestD = d
                best = q
              }
            }
          }
        }
      }
      if (best >= 0) lockOf[c] = best
      else {
        lockOf[c] = c
        const key = cellKey(ix, iy, iz)
        const list = cells.get(key)
        if (list) list.push(c)
        else cells.set(key, [c])
      }
    }
  }
  const found: number[] = []
  const distances: number[] = []
  const strips: Strip[] = []
  const rootNormal = [0, 0, 0]
  const guideNormal = [0, 0, 0]
  const turn = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  for (let c = 0; c < count; c++) {
    const group = roots.group[c]!
    const field = rootLength(groom, roots.a[c]!, roots.e[c]!, group, cmHs)
    let length = field
    // A short style's nape: no longer than reaches the nape line.
    if (groom.short.napeTaper && Math.abs(roots.a[c]!) > 2.2) {
      const line = hairlineAt(hairlineTable(groom), roots.a[c]!)
      const over = Math.max(0, roots.e[c]! - line)
      const r = Math.sqrt(
        (roots.pos[c * 3]! - ox) ** 2 +
          (roots.pos[c * 3 + 1]! - oy) ** 2 +
          (roots.pos[c * 3 + 2]! - oz) ** 2,
      )
      length = Math.min(length, over * r + NAPE_LENGTH * cmHs)
    }
    // Blended from the nearest guides of its group.
    const entry = byGroup.get(group)
    let n = 0
    const ids: number[] = []
    if (entry) {
      n = entry.grid.nearest(
        roots.pos[c * 3]!,
        roots.pos[c * 3 + 1]!,
        roots.pos[c * 3 + 2]!,
        4,
        found,
        distances,
      )
      for (let j = 0; j < n; j++) ids.push(entry.ids[found[j]!]!)
    } else {
      n = anyGrid.nearest(
        roots.pos[c * 3]!,
        roots.pos[c * 3 + 1]!,
        roots.pos[c * 3 + 2]!,
        1,
        found,
        distances,
      )
      ids.push(found[0]!)
    }
    const weights = ids.map((_, j) => 1 / (distances[j]! + 1e-6))
    const total = weights.reduce((sum, w) => sum + w, 0)
    // No further than its guides were walked (past their cut).
    if (groom.cut || group === GROUP.fringe) {
      length = Math.min(length, Math.max(...ids.map((qi) => guides.paths[qi]!.length)) + step)
    }
    const points = Math.max(2, Math.ceil(length / step) + 1)
    const path = new Float32Array(points * 3)
    const lying = new Uint8Array(points)
    const lyingShare = new Float32Array(points)
    rootNormal[0] = roots.nrm[c * 3]!
    rootNormal[1] = roots.nrm[c * 3 + 1]!
    rootNormal[2] = roots.nrm[c * 3 + 2]!
    // Each guide's offsets from its root, turned from its root's normal to this one's, weighted.
    for (let j = 0; j < ids.length; j++) {
      const qi = ids[j]!
      const guide = guides.paths[qi]!
      const gi = guides.index[qi]!
      guideNormal[0] = roots.nrm[gi * 3]!
      guideNormal[1] = roots.nrm[gi * 3 + 1]!
      guideNormal[2] = roots.nrm[gi * 3 + 2]!
      rotation(guideNormal, rootNormal, turn)
      const w = weights[j]! / total
      // Along the guide at the strip's own arc lengths (rising, so a cursor walks it).
      const gs = guide.s
      const gp = guide.points
      const last = guide.count - 1
      const rx = gp[0]!
      const ry = gp[1]!
      const rz = gp[2]!
      const gl = guide.lying
      const t0 = turn[0]!
      const t1 = turn[1]!
      const t2 = turn[2]!
      const t3 = turn[3]!
      const t4 = turn[4]!
      const t5 = turn[5]!
      const t6 = turn[6]!
      const t7 = turn[7]!
      const t8 = turn[8]!
      const tail = gs[last]! - gs[last - 1]! || 1
      let lo = 0
      for (let k = 0; k < points; k++) {
        const at = (k / (points - 1)) * length
        let qx: number
        let qy: number
        let qz: number
        let lies: number
        if (at >= gs[last]!) {
          const over = (at - gs[last]!) / tail
          qx = gp[last * 3]! + (gp[last * 3]! - gp[last * 3 - 3]!) * over - rx
          qy = gp[last * 3 + 1]! + (gp[last * 3 + 1]! - gp[last * 3 - 2]!) * over - ry
          qz = gp[last * 3 + 2]! + (gp[last * 3 + 2]! - gp[last * 3 - 1]!) * over - rz
          lies = gl[last]!
        } else {
          while (lo < last - 1 && gs[lo + 1]! <= at) lo++
          const t = (at - gs[lo]!) / (gs[lo + 1]! - gs[lo]! || 1)
          qx = gp[lo * 3]! + (gp[lo * 3 + 3]! - gp[lo * 3]!) * t - rx
          qy = gp[lo * 3 + 1]! + (gp[lo * 3 + 4]! - gp[lo * 3 + 1]!) * t - ry
          qz = gp[lo * 3 + 2]! + (gp[lo * 3 + 5]! - gp[lo * 3 + 2]!) * t - rz
          lies = t < 0.5 ? gl[lo]! : gl[lo + 1]!
        }
        path[k * 3]! += (t0 * qx + t1 * qy + t2 * qz) * w
        path[k * 3 + 1]! += (t3 * qx + t4 * qy + t5 * qz) * w
        path[k * 3 + 2]! += (t6 * qx + t7 * qy + t8 * qz) * w
        lyingShare[k]! += lies * w
      }
    }
    for (let k = 0; k < points; k++) {
      path[k * 3]! += roots.pos[c * 3]!
      path[k * 3 + 1]! += roots.pos[c * 3 + 1]!
      path[k * 3 + 2]! += roots.pos[c * 3 + 2]!
      lying[k] = lyingShare[k]! >= 0.5 ? 1 : 0
    }
    lying[0] = 1
    const layerPick = unitHash(seed ^ 0x1a7e, c)
    const layer: Layer =
      layerPick < INNER_SHARE
        ? LAYER.inner
        : layerPick < INNER_SHARE + MID_SHARE
          ? LAYER.mid
          : LAYER.outer
    strips.push({
      points: path,
      s: new Float32Array(points),
      lying,
      count: points,
      length,
      root: c,
      layer,
      lock: lockOf[c]!,
      cut: length < field ? 3 : 0,
      level: Number.NaN,
      field,
    })
  }
  return strips
}

/** Where the fringe is cut (bind height): over the brows by the 앞머리 slider. */
const fringeLevel = ({ state, groom, cmHs }: Grower) =>
  state.browY +
  (FRINGE_CUT[0] + (FRINGE_CUT[1] - FRINGE_CUT[0]) * groom.sliders.fringe + groom.fringe.cut) * cmHs

/** The lock stand-off (bind units) of a lock: 2–4 mm, out or in. */
const standoffOf = (seed: number, lock: number, mm: number) => {
  const size = STANDOFF[0] + (STANDOFF[1] - STANDOFF[0]) * unitHash(seed ^ 0x57a0, lock)
  return (unitHash(seed ^ 0x57a1, lock) < 0.5 ? -1 : 1) * size * mm
}

/** The depth in the volume a strip's layer stands at. */
const layerDepth = (layer: Layer) =>
  layer === LAYER.inner
    ? LAYER_DEPTH.inner
    : layer === LAYER.mid
      ? LAYER_DEPTH.mid
      : LAYER_DEPTH.outer

/** Locks, curl, the layer's clearance and the cut, strip by strip. */
function shapeStrips(g: Grower, strips: Strip[], roots: Roots, seed: number) {
  const { state, groom, cmHs } = g
  const mm = state.mm
  const byRoot = new Map<number, Strip>()
  for (const strip of strips) byRoot.set(strip.root, strip)
  const lockRandom = (lock: number) => unitHash(seed ^ 0x10c4, lock)
  const fringeY = fringeLevel(g)
  const blunt = groom.ends.mode === 'blunt'
  // The level each strip is cut at, lock by lock (and where the lock's leader is cut, for blunt ends).
  for (const strip of strips) {
    const c = strip.root
    const lock = strip.lock
    const jitter =
      (lockRandom(lock) - 0.5) * 2 * groom.ends.jitter * cmHs +
      (unitHash(seed ^ 0x5717, c) - 0.5) * 2 * IN_LOCK * mm
    if (roots.group[c] === GROUP.fringe) strip.level = fringeY + jitter
    // The lock's leader's depth for all of it: its ends are cut together.
    else if (groom.cut)
      strip.level = state.eyeY - cutDepth(groom.cut, roots.a[lock]!) * cmHs + jitter
  }
  // Pulled toward the lock's leader, toward the tips.
  const amount = groom.clump.amount
  for (const strip of strips) {
    const leader = byRoot.get(strip.lock)
    if (!leader || leader === strip) continue
    const n = strip.count
    let release = 1
    let cutAt = Number.POSITIVE_INFINITY
    if (blunt && Number.isFinite(leader.level)) {
      for (let k = 1; k < leader.count; k++) {
        if (leader.points[k * 3 + 1]! < leader.level && leader.points[k * 3 - 2]! >= leader.level) {
          cutAt = (k / (leader.count - 1)) * leader.length
          break
        }
      }
    }
    for (let k = 1; k < n; k++) {
      const at = (k / (n - 1)) * strip.length
      const u = at / strip.length
      if (blunt) release = 1 - smooth(1 - BLUNT_RELEASE, 1, at / Math.min(cutAt, strip.length))
      const lk = Math.min(leader.count - 1, Math.round((at / leader.length) * (leader.count - 1)))
      const pull = amount * u ** 1.3 * release
      for (let axis = 0; axis < 3; axis++) {
        const own = strip.points[k * 3 + axis]!
        strip.points[k * 3 + axis] = own + (leader.points[lk * 3 + axis]! - own) * pull
      }
    }
  }
  // Curl: a smooth wave round each lock's way, its phase the lock's.
  const curlSlider = groom.sliders.curl
  const styleCurl = groom.curl.kind !== 'none'
  if (styleCurl || curlSlider > 0) {
    const amplitude =
      Math.min(1.2, styleCurl ? groom.curl.amplitude * (1 + 0.2 * curlSlider) : 0.6 + curlSlider) *
      cmHs *
      (styleCurl ? 1 : Math.min(1, curlSlider / 0.1))
    const period = Math.max(5, styleCurl ? groom.curl.period : 6 - curlSlider) * cmHs
    const start = groom.curl.start
    for (const strip of strips) {
      const phase =
        lockRandom(strip.lock) * 2 * Math.PI + (unitHash(seed ^ 0xc041, strip.root) - 0.5) * 0.6
      const n = strip.count
      for (let k = 1; k < n; k++) {
        const at = (k / (n - 1)) * strip.length
        const ramp = smooth(start * strip.length, start * strip.length + 3 * cmHs, at)
        if (ramp <= 0) continue
        const o = k * 3
        let tx = strip.points[o]! - strip.points[o - 3]!
        let ty = strip.points[o + 1]! - strip.points[o - 2]!
        let tz = strip.points[o + 2]! - strip.points[o - 1]!
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
        tx /= tl
        ty /= tl
        tz /= tl
        let bx = -tz
        let bz = tx
        const bl = Math.sqrt(bx * bx + bz * bz) || 1
        bx /= bl
        bz /= bl
        const wave = Math.cos((at / period) * 2 * Math.PI + phase) * amplitude * ramp
        void ty
        strip.points[o]! += bx * wave
        strip.points[o + 2]! += bz * wave
      }
    }
  }
  // Each layer set at its depth in the volume. The guides lie at the mid
  // layer's, so every point moves out of the hair's middle by the
  // difference (none at the root, where the clearance has yet to grow):
  // the hanging part goes with the lying part it leaves the head from, so
  // no strip kinks there. Then out of the head and the eyes, eased.
  const smoothed: number[] = []
  const [ox, oy, oz] = state.origin
  for (const strip of strips) {
    const standoff = standoffOf(seed, strip.lock, mm)
    const depth = layerDepth(strip.layer)
    const n = strip.count
    const seg = strip.length / (n - 1)
    const volumes = new Float32Array(n)
    // The volume's noise is coarse (VOLUME_CELL): read every few points, between them in line.
    const sampled: number[] = []
    for (let k = 1; k < n; k += VOLUME_EVERY) sampled.push(k)
    if (sampled[sampled.length - 1] !== n - 1) sampled.push(n - 1)
    for (const k of sampled) {
      volumes[k] = volumeAt(
        g,
        strip.points[k * 3]!,
        strip.points[k * 3 + 1]!,
        strip.points[k * 3 + 2]!,
      )
    }
    for (let j = 0; j + 1 < sampled.length; j++) {
      const [from, to] = [sampled[j]!, sampled[j + 1]!]
      for (let k = from + 1; k < to; k++) {
        volumes[k] = volumes[from]! + ((volumes[to]! - volumes[from]!) * (k - from)) / (to - from)
      }
    }
    const clears = new Float32Array(n)
    for (let k = 1; k < n; k++) {
      const o = k * 3
      let want = clearance(g, volumes[k]!, k * seg, standoff, depth)
      if (strip.layer === LAYER.inner) want = Math.max(want, INNER_CLEAR * mm)
      clears[k] = want
      const shift = want - clearance(g, volumes[k]!, k * seg, 0, LAYER_DEPTH.mid)
      const y = strip.points[o + 1]!
      const below = smooth(oy, oy - ENVELOPE_TURN, y)
      const dx = strip.points[o]! - ox
      const dy = (y - oy) * (1 - below)
      const dz = strip.points[o + 2]! - oz
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      strip.points[o]! += (dx / dl) * shift
      strip.points[o + 1]! += (dy / dl) * shift
      strip.points[o + 2]! += (dz / dl) * shift
    }
    for (let pass = 0; pass < STRIP_PASSES; pass++) {
      for (let k = 1; k < n; k++) collide(g, strip.points, k * 3, clears[k]!)
      smoothPath(strip.points, n, smoothed)
      // Its segments back to their length, from the root out, each its own
      // way (as eased): a strip drawn in toward the head is shorter round
      // it, and a chain restored from the moved points would fold back.
      for (let k = 1; k < n; k++) {
        const o = k * 3
        const dx = smoothed[o]! - smoothed[o - 3]!
        const dy = smoothed[o + 1]! - smoothed[o - 2]!
        const dz = smoothed[o + 2]! - smoothed[o - 1]!
        const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
        strip.points[o] = strip.points[o - 3]! + (dx / dl) * seg
        strip.points[o + 1] = strip.points[o - 2]! + (dy / dl) * seg
        strip.points[o + 2] = strip.points[o - 1]! + (dz / dl) * seg
      }
    }
    for (let k = 1; k < n; k++) {
      collide(g, strip.points, k * 3, LEAST_CLEAR * state.cm)
      collideMiddle(g, strip.points, k * 3 - 3, k * 3, LEAST_CLEAR * state.cm)
    }
    for (let k = 1; k < n; k++) outOfEyes(state.keepOut, strip.points, k * 3)
    arcLengths(strip.points, n, strip.s)
  }
  // Cut: at the first crossing below the level, by a short style's ear, nape and block.
  const table = hairlineTable(groom)
  for (const strip of strips) {
    const c = strip.root
    const n = strip.count
    let end = strip.s[n - 1]!
    let how = 0
    const isFringe = roots.group[c] === GROUP.fringe
    if (Number.isFinite(strip.level)) {
      if (strip.points[1]! < strip.level + 0.5 * state.cm && !isFringe) {
        end = Math.min(end, BELOW_CUT * cmHs)
        how = 2
      } else {
        let crossed = -1
        for (let k = 1; k < n; k++) {
          const y0 = strip.points[k * 3 - 2]!
          const y1 = strip.points[k * 3 + 1]!
          if (y1 < strip.level && y0 >= strip.level) {
            crossed =
              strip.s[k - 1]! +
              (strip.s[k]! - strip.s[k - 1]!) * ((y0 - strip.level) / (y0 - y1 || 1))
            break
          }
        }
        if (crossed >= 0) {
          end = crossed
          how = 1
        } else if (isFringe && end > FRINGE_MOST * cmHs) {
          end = FRINGE_MOST * cmHs
          how = 2
        }
      }
    }
    if (groom.short.earArch || groom.undercut) {
      for (let k = 1; k < n; k++) {
        const o = k * 3
        const [x, y, z] = [strip.points[o]!, strip.points[o + 1]!, strip.points[o + 2]!]
        let stop = false
        if (groom.short.earArch) {
          for (const ear of state.ears) {
            if ((x - state.origin[0]) * ear.side < ear.inner - state.cm) continue
            const height = ear.top - ear.y + OVER_EAR * mm
            const width = ear.depth + OVER_EAR * mm
            const ez = (z - ear.z) / width
            const ey = (y - ear.y) / height
            if (ez * ez + ey * ey < 1) stop = true
          }
        }
        if (groom.undercut && !isFringe) {
          const [a, e] = state.templateAngles(x, y, z)
          const line =
            groom.undercut.line -
            BLOCK_DRAPE[0] -
            (BLOCK_DRAPE[1] - BLOCK_DRAPE[0]) * smooth(1.6, 2.8, Math.abs(a))
          if (e < line && smooth(0.75, 1.05, Math.abs(a)) > 0.5) stop = true
        }
        if (stop) {
          if (strip.s[k - 1]! < end) {
            end = Math.max(strip.s[k - 1]!, 0.3 * state.cm)
            how = 3
          }
          break
        }
      }
    }
    void table
    strip.cut = how || strip.cut
    if (end < strip.s[n - 1]! - 1e-9) {
      truncate(strip, end)
      // Its new end, between two points clear of the eyes, may not be.
      if (outOfEyes(state.keepOut, strip.points, (strip.count - 1) * 3)) {
        arcLengths(strip.points, strip.count, strip.s)
      }
    }
    strip.length = strip.s[strip.count - 1]!
  }
  // 단발's ends turned under, over the last quarter.
  if (groom.endCurl > 0) {
    for (const strip of strips) {
      if (roots.group[strip.root] === GROUP.fringe || strip.cut !== 1) continue
      const n = strip.count
      const from = END_CURL_FROM * strip.length
      const fullCurl = smooth(END_CURL_LENGTH[0] * cmHs, END_CURL_LENGTH[1] * cmHs, strip.length)
      for (let k = 1; k < n; k++) {
        if (strip.s[k]! <= from) continue
        const u = (strip.s[k]! - from) / (strip.length - from || 1)
        const hx = strip.points[k * 3]! - state.origin[0]
        const hz = strip.points[k * 3 + 2]! - state.origin[2]
        const hl = Math.sqrt(hx * hx + hz * hz) || 1
        // A short strand (by the nape, under the cut) barely turns: no hook on it.
        const pull = groom.endCurl * 1.1 * state.cm * u * u * fullCurl
        strip.points[k * 3]! -= (hx / hl) * pull
        strip.points[k * 3 + 2]! -= (hz / hl) * pull
        strip.points[k * 3 + 1]! += pull * 0.5
        collide(g, strip.points, k * 3, LEAST_CLEAR * state.cm)
      }
      arcLengths(strip.points, n, strip.s)
      strip.length = strip.s[n - 1]!
    }
  }
}

/**
 * A polyline's inner points halfway to their neighbours' middle, into
 * `out` (flat; the polyline itself is left as it was).
 */
function smoothPath(points: Float32Array, count: number, out: number[]) {
  out.length = count * 3
  for (let i = 0; i < 3; i++) {
    out[i] = points[i]!
    out[(count - 1) * 3 + i] = points[(count - 1) * 3 + i]!
  }
  for (let k = 1; k < count - 1; k++) {
    for (let axis = 0; axis < 3; axis++) {
      const o = k * 3 + axis
      out[o] = points[o]! * 0.5 + (points[o - 3]! + points[o + 3]!) * 0.25
    }
  }
}

/** A strip cut back to arc length `end` (in place). */
function truncate(strip: Strip, end: number) {
  const n = strip.count
  let k = 1
  while (k < n - 1 && strip.s[k]! < end) k++
  const t = (end - strip.s[k - 1]!) / (strip.s[k]! - strip.s[k - 1]! || 1)
  for (let axis = 0; axis < 3; axis++) {
    strip.points[k * 3 + axis] =
      strip.points[(k - 1) * 3 + axis]! * (1 - t) + strip.points[k * 3 + axis]! * t
  }
  strip.count = k + 1
  arcLengths(strip.points, strip.count, strip.s)
}

/**
 * A strip resampled by curvature: a point wherever it has turned `turn`
 * since the last kept one, and at least every `spacing`; its last point
 * kept. Into `out` (flat), returning how many points.
 */
function resample(strip: Path, turn: number, spacing: number, out: number[]) {
  const n = strip.count
  const p = strip.points
  out.push(p[0]!, p[1]!, p[2]!)
  let last = 0
  let kept = 1
  let dx = p[3]! - p[0]!
  let dy = p[4]! - p[1]!
  let dz = p[5]! - p[2]!
  let dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
  const cosTurn = Math.cos(turn)
  for (let k = 1; k < n - 1; k++) {
    const ex = p[k * 3 + 3]! - p[k * 3]!
    const ey = p[k * 3 + 4]! - p[k * 3 + 1]!
    const ez = p[k * 3 + 5]! - p[k * 3 + 2]!
    const el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1
    const bent = (dx * ex + dy * ey + dz * ez) / (dl * el) < cosTurn
    if (bent || strip.s[k + 1]! - strip.s[last]! > spacing) {
      out.push(p[k * 3]!, p[k * 3 + 1]!, p[k * 3 + 2]!)
      kept++
      last = k
      dx = ex
      dy = ey
      dz = ez
      dl = el
    }
  }
  out.push(p[(n - 1) * 3]!, p[(n - 1) * 3 + 1]!, p[(n - 1) * 3 + 2]!)
  return kept + 1
}

// ---------------------------------------------------------------------------
// The whole grow, in stages.

/** A grow's strips and what is known of each, before they are laid out as ribbons (for the tests). */
export type Grown = {
  roots: Roots
  strips: StripSet
  info: StripInfo
  /** How many strips the tier's budget allowed, of its roots. */
  budget: { roots: number; strips: number; meanSegments: number; widen: number }
  ms: Record<string, number>
}

function* growStages(
  head: HeadData,
  groom: Groom,
  tier: Tier,
  shapeInput: ShapeInput,
  seed: number,
): Generator<string, Grown> {
  if (groom.gather)
    throw new Error(`hair grow: tied styles (${groom.sliders.style}) are not grown yet`)
  const state = stateOf(head)
  const ms: Record<string, number> = {}
  let clock = performance.now()
  const lap = (name: string) => {
    const now = performance.now()
    ms[name] = now - clock
    clock = now
  }
  const shape = state.shape(shapeInput)
  const picked = styleRoots(state, groom)
  const cmHs = state.cm * state.hs
  const g: Grower = {
    state,
    shape,
    groom,
    cmHs,
    noiseSeed: (seed ^ SEED.noise) >>> 0,
    shares: { crown: 0, top: 0, sides: 0, back: 0, nape: 0 },
  }
  const tierRoots = Math.max(1, Math.round(picked.cand.length * TIER_SHARE[tier]))
  const roots = placeRoots(state, shape, picked, tierRoots)
  lap('roots')
  yield 'roots'
  const guidesKey = `${shapeInput.version}|${cutKey(groom.sliders)}|${groom.who.sex}|${seed}`
  let guides: Guides
  if (state.lastGuides?.key === guidesKey) guides = { ...state.lastGuides.guides, roots }
  else {
    guides = growGuides(g, roots, (seed ^ SEED.guides) >>> 0)
    state.lastGuides = { key: guidesKey, guides }
  }
  lap('guides')
  yield 'guides'
  // The budget: as many strips as the tier's cap holds at the guides' mean segments.
  const { turn, spacing } = RESAMPLE[tier]
  const scratch: number[] = []
  let segments = 0
  for (const path of guides.paths) {
    scratch.length = 0
    segments += resample(path, turn, spacing * state.cm * state.hs, scratch) - 1
  }
  const meanSegments = Math.max(1, segments / Math.max(1, guides.paths.length))
  const extra = tier === 'studio' ? 1 + STRAY_SHARE : 1
  const fits = Math.floor(groom.caps[tier] / (2 * meanSegments * extra))
  const wanted = Math.min(roots.count, Math.round(groom.strips * TIER_SHARE[tier]), fits)
  const strips = growStripPaths(g, guides, roots, wanted, (seed ^ SEED.strips) >>> 0)
  lap('blend')
  yield 'blend'
  shapeStrips(g, strips, roots, (seed ^ SEED.strips) >>> 0)
  lap('strips')
  yield 'strips'
  const widen = Math.sqrt(Math.round(groom.strips * TIER_SHARE[tier]) / Math.max(1, strips.length))
  const set = layOut(g, strips, roots, tier, (seed ^ SEED.strips) >>> 0, Math.max(1, widen))
  lap('layout')
  return {
    roots,
    strips: set.strips,
    info: set.info,
    budget: { roots: roots.count, strips: strips.length, meanSegments, widen },
    ms,
  }
}

/**
 * The strips resampled by curvature and laid out (with strays and baby
 * hair in the studio), in root order, the budget's cap kept.
 */
function layOut(g: Grower, strips: Strip[], roots: Roots, tier: Tier, seed: number, widen: number) {
  const { state, groom, cmHs } = g
  const { turn, spacing } = RESAMPLE[tier]
  const points: number[] = []
  const start: number[] = [0]
  const meta: {
    strip: Strip
    layer: Layer
    width: number
    taper: number
    atlas: number
  }[] = []
  const fringeSlider = groom.sliders.fringe
  const curly = groom.atlasCurl > 0 || groom.sliders.curl > 0.6
  const atlasOf = (kind: keyof typeof ATLAS, c: number) =>
    ATLAS[kind] + Math.floor(unitHash(seed ^ 0xa71a, c) * ATLAS_VARIANTS[kind])
  let triangles = 0
  const cap = groom.caps[tier]
  const push = (path: Path, entry: (typeof meta)[number]) => {
    const before = points.length
    const n = resample(path, turn, spacing * cmHs, points)
    if (triangles + 2 * (n - 1) > cap) {
      points.length = before
      return false
    }
    triangles += 2 * (n - 1)
    start.push(points.length / 3)
    meta.push(entry)
    return true
  }
  // 앞머리 thins the fringe by its strips, its roots kept for every value.
  const fringeDensity = FRINGE_DENSITY[0] + (FRINGE_DENSITY[1] - FRINGE_DENSITY[0]) * fringeSlider
  for (const strip of strips) {
    const c = strip.root
    const fringe = roots.group[c] === GROUP.fringe
    if (fringe && unitHash(seed ^ 0xf719, c) >= fringeDensity) continue
    const band = roots.density[c]! < 1
    let width =
      (strip.layer === LAYER.inner
        ? groom.width.inner
        : strip.layer === LAYER.mid
          ? groom.width.mid
          : groom.width.outer) *
      cmHs *
      (0.8 + 0.4 * unitHash(seed ^ 0x3d17, c)) *
      widen
    if (band) width *= 0.4 + 0.6 * roots.density[c]!
    if (fringe) {
      const fringeWidth =
        (FRINGE_WIDTH[0] + (FRINGE_WIDTH[1] - FRINGE_WIDTH[0]) * fringeSlider) * cmHs
      width = Math.min(width, fringeWidth * widen)
    }
    const kind: keyof typeof ATLAS =
      band || (fringe && fringeSlider < SEE_THROUGH)
        ? 'wispy'
        : curly && strip.layer !== LAYER.inner
          ? 'curly'
          : strip.layer === LAYER.inner
            ? 'dense'
            : strip.layer === LAYER.mid
              ? 'medium'
              : 'wispy'
    if (
      !push(strip, {
        strip,
        layer: strip.layer,
        width,
        taper: groom.tipTaper,
        atlas: atlasOf(kind, c),
      })
    )
      break
  }
  if (tier === 'studio') {
    // Strays: a few outer strips again, thinner, standing a little off the hair.
    for (const strip of strips) {
      if (strip.layer === LAYER.inner || unitHash(seed ^ 0x57a7, strip.root) >= STRAY_SHARE)
        continue
      const out = (0.3 + 0.7 * unitHash(seed ^ 0x57a8, strip.root)) * STRAY_OUT * cmHs
      const copy = Float32Array.from(strip.points.subarray(0, strip.count * 3))
      for (let k = 1; k < strip.count; k++) {
        const u = strip.s[k]! / (strip.length || 1)
        const o = k * 3
        const dx = copy[o]! - state.origin[0]
        const dy = copy[o + 1]! - state.origin[1]
        const dz = copy[o + 2]! - state.origin[2]
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
        const lift = out * u
        copy[o]! += (dx / r) * lift
        copy[o + 1]! += (dy / r) * lift
        copy[o + 2]! += (dz / r) * lift
        outOfEyes(state.keepOut, copy, o)
      }
      const stray: Path = {
        points: copy,
        s: strip.s,
        lying: strip.lying,
        count: strip.count,
        length: strip.length,
      }
      const width =
        (STRAY_WIDTH[0] + (STRAY_WIDTH[1] - STRAY_WIDTH[0]) * unitHash(seed ^ 0x57a9, strip.root)) *
        cmHs
      if (
        !push(stray, {
          strip,
          layer: LAYER.stray,
          width,
          taper: 0.5,
          atlas: atlasOf('stray', strip.root),
        })
      )
        break
    }
    // Baby hair along the front and the temples: short, fine, off the comb.
    const band: Strip[] = strips.filter(
      (strip) => roots.density[strip.root]! < 1 && Math.abs(roots.a[strip.root]!) < 1.3,
    )
    const babies = Math.min(
      band.length,
      Math.round(BABY[0] + (BABY[1] - BABY[0]) * unitHash(seed ^ 0xbab0, 0)),
    )
    const flow = [0, 0, 0]
    for (let b = 0; b < babies; b++) {
      const strip = band[Math.floor((b / babies) * band.length)]!
      const c = strip.root
      const length =
        (BABY_LENGTH[0] + (BABY_LENGTH[1] - BABY_LENGTH[0]) * unitHash(seed ^ 0xbab1, b)) * cmHs
      const n = Math.max(3, Math.ceil(length / (0.3 * cmHs)) + 1)
      const at = new Float32Array(n * 3)
      at.set(roots.pos.subarray(c * 3, c * 3 + 3))
      const dx = at[0]! - state.origin[0]
      const dy = at[1]! - state.origin[1]
      const dz = at[2]! - state.origin[2]
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      const d: V3 = [dx / r, dy / r, dz / r]
      comb(groom, d, roots.group[c]!, flow)
      // Turned off the comb about the head's normal.
      const angle = (unitHash(seed ^ 0xbab2, b) - 0.5) * 2 * BABY_TURN
      const [cs, sn] = [Math.cos(angle), Math.sin(angle)]
      const side = [
        d[1] * flow[2]! - d[2] * flow[1]!,
        d[2] * flow[0]! - d[0] * flow[2]!,
        d[0] * flow[1]! - d[1] * flow[0]!,
      ]
      const way = [0, 1, 2].map((axis) => flow[axis]! * cs + side[axis]! * sn)
      const seg = length / (n - 1)
      for (let k = 1; k < n; k++) {
        for (let axis = 0; axis < 3; axis++)
          at[k * 3 + axis] = at[(k - 1) * 3 + axis]! + way[axis]! * seg
        collide(g, at, k * 3, 1 * state.mm)
      }
      const s = new Float32Array(n)
      const total = arcLengths(at, n, s)
      const baby: Path = {
        points: at,
        s,
        lying: new Uint8Array(n).fill(1),
        count: n,
        length: total,
      }
      if (
        !push(baby, {
          strip,
          layer: LAYER.baby,
          width: BABY_WIDTH * cmHs,
          taper: 0.6,
          atlas: atlasOf('stray', c + b),
        })
      )
        break
    }
  }
  const count = meta.length
  const set: StripSet = {
    count,
    start: Uint32Array.from(start),
    points: Float32Array.from(points),
    s: new Float32Array(points.length / 3),
    width: new Float32Array(count),
    taper: new Float32Array(count),
    layer: new Uint8Array(count),
    atlas: new Uint8Array(count),
    lock: new Float32Array(count),
    strand: new Uint32Array(count),
    twist: new Float32Array(count),
    flip: new Uint8Array(count),
    vOffset: new Float32Array(count),
    bones: new Uint16Array(count * 4),
    weights: new Float32Array(count * 4),
  }
  const info: StripInfo = {
    root: new Uint32Array(count),
    a: new Float32Array(count),
    e: new Float32Array(count),
    group: new Uint8Array(count),
    lock: new Int32Array(count),
    layer: new Uint8Array(count),
    field: new Float32Array(count),
    cut: new Uint8Array(count),
    level: new Float32Array(count),
    standoff: new Float32Array(count),
  }
  const pair = [0, 0, 0, 0]
  meta.forEach(({ strip, layer, width, taper, atlas }, i) => {
    const c = strip.root
    const first = set.start[i]!
    const n = set.start[i + 1]! - first
    arcLengths(set.points.subarray(first * 3, (first + n) * 3), n, set.s.subarray(first, first + n))
    set.width[i] = width
    set.taper[i] = taper
    set.layer[i] = layer
    set.atlas[i] = atlas
    set.lock[i] = unitHash(seed ^ 0x10c4, strip.lock)
    set.strand[i] = c
    set.twist[i] = layer === LAYER.inner ? (unitHash(seed ^ 0x7e15, c) - 0.5) * 0.7 : 0
    set.flip[i] = unitHash(seed ^ 0xf11b, c + 31 * i) < 0.5 ? 1 : 0
    set.vOffset[i] = unitHash(seed ^ 0x0ff5, c + 17 * i) * ATLAS_REPEAT * cmHs
    skinOf(g, roots, c, pair)
    set.bones.set([pair[0]!, pair[1]!, 0, 0], i * 4)
    set.weights.set([pair[2]!, pair[3]!, 0, 0], i * 4)
    info.root[i] = c
    info.a[i] = roots.a[c]!
    info.e[i] = roots.e[c]!
    info.group[i] = roots.group[c]!
    info.lock[i] = strip.lock
    info.layer[i] = layer
    info.field[i] = strip.field
    info.cut[i] = layer === LAYER.baby || layer === LAYER.stray ? 255 : strip.cut
    info.level[i] = strip.level
    info.standoff[i] = standoffOf(seed, strip.lock, state.mm)
  })
  return { strips: set, info }
}

/**
 * A strip's skinning as two bones and weights (into out: bone, bone,
 * weight, weight): the head alone over the rigid cranium; lower, its
 * root's own skinning (face bones as the head), its two largest weights.
 */
function skinOf(g: Grower, roots: Roots, c: number, out: number[]) {
  const { state } = g
  out[0] = state.headBone
  out[1] = state.headBone
  out[2] = 1
  out[3] = 0
  if (roots.pos[c * 3 + 1]! >= state.neck + CRANIUM_RIGID) return
  const t = roots.tri[c]!
  const u = roots.bary[c * 2]!
  const v = roots.bary[c * 2 + 1]!
  const shares = new Map<number, number>()
  ;[1 - u - v, u, v].forEach((w, k) => {
    const i = state.index[t * 3 + k]!
    for (let j = 0; j < 4; j++) {
      const weight = state.skinWeight[i * 4 + j]!
      if (weight <= 0) continue
      let bone = state.skinIndex[i * 4 + j]!
      if (state.faceBones.has(bone)) bone = state.headBone
      shares.set(bone, (shares.get(bone) ?? 0) + weight * w)
    }
  })
  const best = [...shares].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 2)
  const sum = best.reduce((total, [, w]) => total + w, 0) || 1
  out[0] = best[0]?.[0] ?? state.headBone
  out[1] = best[1]?.[0] ?? out[0]
  out[2] = (best[0]?.[1] ?? 1) / sum
  out[3] = best[1] ? best[1][1] / sum : 0
  if (out[3] === 0) out[1] = out[0]!
}

/** Grows a groom's strips at once (the stages run through): for tests and offline tools. */
export function growStrips(
  head: HeadData,
  groom: Groom,
  tier: Tier,
  shape: ShapeInput,
  seed: number,
): Grown {
  const stages = growStages(head, groom, tier, shape, seed)
  for (;;) {
    const next = stages.next()
    if (next.done) return next.value
  }
}

/** The seed a character's style is grown with. */
export const growSeed = (avatar: string, style: string) => fnv1a(`${avatar}|${style}`)

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
  const stages = growStages(head, groom, tier, shape, seed)
  let grown: Grown
  for (;;) {
    const next = stages.next()
    if (next.done) {
      grown = next.value
      break
    }
    if (yieldTo && (await yieldTo())) return null
  }
  const state = stateOf(head)
  let clock = performance.now()
  const { strips, info } = grown
  const cmHs = state.cm * state.hs
  const depth = depthInHair(strips, state.origin, 2.5 * cmHs)
  const frame: RibbonFrame = {
    origin: state.origin,
    repeat: ATLAS_REPEAT * cmHs,
    neck: state.neck,
    fade: FOLLOW_FADE * cmHs,
  }
  const pick = (layers: readonly number[]) => {
    const out: number[] = []
    for (let i = 0; i < strips.count; i++) if (layers.includes(strips.layer[i]!)) out.push(i)
    return out
  }
  const ms: Record<string, number> = { ...grown.ms, depth: performance.now() - clock }
  clock = performance.now()
  if (yieldTo && (await yieldTo())) return null
  const innerIds = pick([LAYER.inner, LAYER.mid])
  const outerIds = pick([LAYER.outer, LAYER.baby])
  const strayIds = pick([LAYER.stray])
  const inner = ribbons(strips, innerIds, depth, frame)
  const outer = ribbons(strips, outerIds, depth, frame)
  const strays = tier === 'studio' ? ribbons(strips, strayIds, depth, frame) : undefined
  ms.ribbons = performance.now() - clock
  if (yieldTo && (await yieldTo())) return null
  clock = performance.now()
  const soft = strays ? joinRibbons([outer, strays]) : undefined
  ms.soft = performance.now() - clock
  const { roots } = grown
  const grownAt = roots.pos
  let low = Number.POSITIVE_INFINITY
  const ends: number[] = []
  for (let i = 0; i < strips.count; i++) {
    if (info.cut[i] === 255) continue
    const last = strips.start[i + 1]! - 1
    ends.push(strips.points[last * 3 + 1]!)
    low = Math.min(low, strips.points[last * 3 + 1]!)
  }
  ends.sort((x, y) => x - y)
  const triangles = (inner.index.length + outer.index.length + (strays?.index.length ?? 0)) / 3
  return {
    key: `${state.avatar}|${cutKey(groom.sliders)}|${tier}|${shape.version}`,
    tier,
    geometries: { inner, outer, ...(strays ? { strays } : {}), ...(soft ? { soft } : {}) },
    strips: { inner: innerIds.length, outer: outerIds.length, strays: strayIds.length },
    roots: { tri: roots.tri, bary: roots.bary, grown: grownAt },
    touchesBody: groom.touchesBody,
    hairline: hairlineTable(groom),
    part: { x: PART_SHIFT * groom.sliders.part, fade: PART_FADE[1] },
    undercut: groom.undercut,
    ombre: {
      earY: state.ears.length > 0 ? Math.max(...state.ears.map((ear) => ear.top)) : state.eyeY,
      cutY: ends.length > 0 ? ends[Math.floor(ends.length * 0.1)]! : low,
    },
    stats: { ms, triangles },
  }
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
