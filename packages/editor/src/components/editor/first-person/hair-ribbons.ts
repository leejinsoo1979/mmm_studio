import type { RibbonArrays } from './hair-grow'
import type { V3 } from './hair-scalp'
import { smoothstep } from './head-skull'

/**
 * Grown strips laid out as ribbons: two vertices per strip point, both on
 * its centreline (the material spreads them by the signed half-width, flat
 * on the head for the inner layer and toward the camera for the rest), in
 * the one vertex layout every style, tier and layer geometry shares; and
 * how deep in the hair each point lies, worked out once per build. Pure.
 */

/** Which layer of the hair a strip is: written into `hairShape.z` (× 16) for the material. */
export const LAYER = { inner: 0, mid: 1, outer: 2, stray: 3, baby: 4 } as const
export type Layer = (typeof LAYER)[keyof typeof LAYER]

/**
 * The strand atlas's layers (see the hair material): the first of each
 * kind, its variants after it. A strip's is written into `hairShape.z`.
 */
export const ATLAS = { dense: 0, medium: 2, wispy: 4, stray: 6, curly: 8, solid: 11 } as const
/** Variants of each kind, after its first layer. */
export const ATLAS_VARIANTS = {
  dense: 2,
  medium: 2,
  wispy: 2,
  stray: 2,
  curly: 3,
  solid: 1,
} as const

/** Numbers per vertex of each attribute. */
export const RIBBON_ITEM_SIZES = {
  position: 3,
  normal: 3,
  tangent: 4,
  uv: 2,
  hairData: 4,
  hairShape: 4,
  skinIndex: 4,
  skinWeight: 4,
} as const

/**
 * Strips as the generator leaves them, in root order: each one's points
 * (`start[i]` to `start[i + 1]`, flat in `points`) and arc length at each,
 * and per strip its full width at the root (bind units), layer, atlas
 * layer, lock random, strand id, twist (inner layer), card flip, v offset
 * and skinning (two bones and their weights).
 */
export type StripSet = {
  count: number
  start: Uint32Array
  points: Float32Array
  s: Float32Array
  width: Float32Array
  taper: Float32Array
  layer: Uint8Array
  atlas: Uint8Array
  lock: Float32Array
  strand: Uint32Array
  twist: Float32Array
  flip: Uint8Array
  vOffset: Float32Array
  bones: Uint16Array
  weights: Float32Array
}

/** Bins round a volume's middle for depth in the hair: by azimuth, by height. */
const DEPTH_BINS = 48

/** How far below the head's middle (bind units) the envelope turns from round O to round its vertical axis. */
const ENVELOPE_TURN = 0.08

/** How far a point reaches out of the hair's middle: from O above it, from its vertical axis below. */
function reach(origin: V3, x: number, y: number, z: number) {
  const below = smoothstep(origin[1], origin[1] - ENVELOPE_TURN, y)
  const dy = (y - origin[1]) * (1 - below)
  const dx = x - origin[0]
  const dz = z - origin[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * How deep in the hair each strip point lies, 0 on the outside to 1 at
 * `full` (bind units) in: against the outermost reach of all the strips
 * round it (binned by azimuth and height, blurred once, read bilinear).
 * Worked out once per build, so every prefix of it shares it.
 */
export function depthInHair(strips: StripSet, origin: V3, full: number): Float32Array {
  const { points } = strips
  const n = points.length / 3
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    low = Math.min(low, points[i * 3 + 1]!)
    high = Math.max(high, points[i * 3 + 1]!)
  }
  const span = Math.max(1e-6, high - low)
  const B = DEPTH_BINS
  const binX = (x: number, z: number) =>
    ((Math.atan2(x - origin[0], z - origin[2]) + Math.PI) / (2 * Math.PI)) * B - 0.5
  const binY = (y: number) => ((y - low) / span) * (B - 1)
  const outer = new Float32Array(B * B)
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]
    const bx = (Math.round(binX(x, z)) + B) % B
    const by = Math.min(B - 1, Math.max(0, Math.round(binY(y))))
    const at = by * B + bx
    outer[at] = Math.max(outer[at]!, reach(origin, x, y, z))
  }
  const blurred = new Float32Array(B * B)
  for (let y = 0; y < B; y++) {
    for (let x = 0; x < B; x++) {
      let sum = 0
      let weight = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= B) continue
        for (let dx = -1; dx <= 1; dx++) {
          const v = outer[yy * B + ((x + dx + B) % B)]!
          if (v <= 0) continue
          sum += v
          weight++
        }
      }
      blurred[y * B + x] = weight > 0 ? Math.max(outer[y * B + x]!, sum / weight) : 0
    }
  }
  const depth = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]
    const fx = binX(x, z)
    const fy = Math.min(B - 1, Math.max(0, binY(y)))
    const ix = Math.floor(fx)
    const iy = Math.min(B - 2, Math.floor(fy))
    const tx = fx - ix
    const ty = fy - iy
    const at = (bx: number, by: number) => blurred[by * B + ((bx + B) % B)]!
    const out =
      (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) +
      (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty
    depth[i] = Math.min(1, Math.max(0, (out - reach(origin, x, y, z)) / full))
  }
  return depth
}

/** What a ribbon build reads besides the strips: the head's middle, the length scale and the neck. */
export type RibbonFrame = {
  origin: V3
  /** Bind units per atlas repeat along a strand (8 cm on the head). */
  repeat: number
  /** Where strands stop following the head's shape: full above `neck`, none from `neck − fade`. */
  neck: number
  fade: number
}

/**
 * The ribbons of some of a build's strips (`which`, in the order given)
 * as one geometry's arrays.
 */
export function ribbons(
  strips: StripSet,
  which: readonly number[],
  depth: Float32Array,
  frame: RibbonFrame,
): RibbonArrays {
  let points = 0
  let segments = 0
  for (const c of which) {
    const n = strips.start[c + 1]! - strips.start[c]!
    points += n
    segments += n - 1
  }
  const vertices = points * 2
  const position = new Float32Array(vertices * 3)
  const normal = new Float32Array(vertices * 3)
  const tangent = new Float32Array(vertices * 4)
  const uv = new Float32Array(vertices * 2)
  const hairData = new Float32Array(vertices * 4)
  const hairShape = new Float32Array(vertices * 4)
  const skinIndex = new Uint16Array(vertices * 4)
  const skinWeight = new Float32Array(vertices * 4)
  const index = new Uint32Array(segments * 6)
  const { origin } = frame
  let v = 0
  let at = 0
  for (const c of which) {
    const first = strips.start[c]!
    const n = strips.start[c + 1]! - first
    const length = strips.s[first + n - 1]! || 1
    const half = strips.width[c]! / 2
    const twist = strips.twist[c]!
    const cosT = Math.cos(twist)
    const sinT = Math.sin(twist)
    const shape = strips.atlas[c]! + 16 * strips.layer[c]!
    const flip = strips.flip[c]!
    const base = v
    for (let k = 0; k < n; k++) {
      const p = (first + k) * 3
      const x = strips.points[p]!
      const y = strips.points[p + 1]!
      const z = strips.points[p + 2]!
      const kn = Math.min(n - 1, k + 1)
      const kp = Math.max(0, k - 1)
      let tx = strips.points[(first + kn) * 3]! - strips.points[(first + kp) * 3]!
      let ty = strips.points[(first + kn) * 3 + 1]! - strips.points[(first + kp) * 3 + 1]!
      let tz = strips.points[(first + kn) * 3 + 2]! - strips.points[(first + kp) * 3 + 2]!
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
      tx /= tl
      ty /= tl
      tz /= tl
      // The envelope's outward direction, square to the strand.
      const below = smoothstep(origin[1], origin[1] - ENVELOPE_TURN, y)
      let ox = x - origin[0]
      let oy = (y - origin[1]) * (1 - below)
      let oz = z - origin[2]
      const along = ox * tx + oy * ty + oz * tz
      ox -= tx * along
      oy -= ty * along
      oz -= tz * along
      let ol = Math.sqrt(ox * ox + oy * oy + oz * oz)
      if (ol < 1e-9) {
        ox = 0
        oy = 1
        oz = 0
        ol = 1
      }
      ox /= ol
      oy /= ol
      oz /= ol
      if (twist !== 0) {
        // Turned about the strand: t × out, then out·cos + (t × out)·sin.
        const bx = ty * oz - tz * oy
        const by = tz * ox - tx * oz
        const bz = tx * oy - ty * ox
        ox = ox * cosT + bx * sinT
        oy = oy * cosT + by * sinT
        oz = oz * cosT + bz * sinT
      }
      const s = strips.s[first + k]!
      const u = s / length
      const width = half * (1 - strips.taper[c]! * u ** 1.5)
      const follow = 1 - smoothstep(frame.neck, frame.neck - frame.fade, y)
      const deep = depth[first + k]!
      for (let side = -1; side <= 1; side += 2) {
        position[v * 3] = x
        position[v * 3 + 1] = y
        position[v * 3 + 2] = z
        normal[v * 3] = ox
        normal[v * 3 + 1] = oy
        normal[v * 3 + 2] = oz
        tangent[v * 4] = tx
        tangent[v * 4 + 1] = ty
        tangent[v * 4 + 2] = tz
        tangent[v * 4 + 3] = 1
        uv[v * 2] = side < 0 !== (flip === 1) ? 0 : 1
        uv[v * 2 + 1] = (s + strips.vOffset[c]!) / frame.repeat
        hairData[v * 4] = u
        hairData[v * 4 + 1] = deep
        hairData[v * 4 + 2] = strips.lock[c]!
        hairData[v * 4 + 3] = strips.strand[c]!
        hairShape[v * 4] = side * width
        hairShape[v * 4 + 1] = s
        hairShape[v * 4 + 2] = shape
        hairShape[v * 4 + 3] = follow
        for (let j = 0; j < 4; j++) {
          skinIndex[v * 4 + j] = strips.bones[c * 4 + j]!
          skinWeight[v * 4 + j] = strips.weights[c * 4 + j]!
        }
        v++
      }
    }
    for (let k = 0; k < n - 1; k++) {
      const a = base + k * 2
      index[at++] = a
      index[at++] = a + 1
      index[at++] = a + 2
      index[at++] = a + 1
      index[at++] = a + 3
      index[at++] = a + 2
    }
  }
  return { position, normal, tangent, uv, hairData, hairShape, skinIndex, skinWeight, index }
}

/** Geometries' arrays one after another (an index into each moved past those before). */
export function joinRibbons(parts: readonly RibbonArrays[]): RibbonArrays {
  const total = (key: keyof RibbonArrays) => parts.reduce((sum, part) => sum + part[key].length, 0)
  const joined = {} as RibbonArrays
  for (const key of Object.keys(RIBBON_ITEM_SIZES) as (keyof typeof RIBBON_ITEM_SIZES)[]) {
    const out = new (parts[0]![key].constructor as Float32ArrayConstructor)(total(key))
    let offset = 0
    for (const part of parts) {
      out.set(part[key] as Float32Array, offset)
      offset += part[key].length
    }
    ;(joined as Record<string, unknown>)[key] = out
  }
  const index = new Uint32Array(total('index'))
  let offset = 0
  let vertices = 0
  for (const part of parts) {
    for (let i = 0; i < part.index.length; i++) index[offset + i] = part.index[i]! + vertices
    offset += part.index.length
    vertices += part.position.length / 3
  }
  joined.index = index
  return joined
}
