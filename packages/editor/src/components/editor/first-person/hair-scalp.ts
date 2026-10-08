import type { SkullData } from './hair-styles'
import { smoothstep } from './head-skull'

/**
 * Where on the scalp generated hair grows, read off the skull every head
 * shares (see hair-styles.ts) so a root has the same place on every head:
 * the scalp's frame (azimuth a round the head's middle, 0 in front and +
 * toward the character's left; elevation e over eye level), the hairline,
 * the progressive set of root candidates, a head's radius round its middle
 * (an octahedral map), and the eyes' keep-out. Also the integer random
 * numbers the hair is grown with, the same on every engine. Pure.
 */

export type V3 = [number, number, number]

/** mulberry32: integer-only, the same sequence on every engine. */
export function mulberry32(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a over a string's UTF-16 units. */
export function fnv1a(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** A steady number in [0, 1) for a pair of whole numbers: per-strip randoms never share one stream. */
export function unitHash(seed: number, n: number) {
  let h = Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(n + 0x632be5ab, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** 1-D value noise in [−1, 1], from integer hashes. */
export function noise1(x: number, seed: number) {
  const i = Math.floor(x)
  const f = x - i
  const t = f * f * (3 - 2 * f)
  const a = unitHash(seed, i) * 2 - 1
  const b = unitHash(seed, i + 1) * 2 - 1
  return a + (b - a) * t
}

/** 3-D value noise in [−1, 1] over cells one unit across, from integer hashes. */
export function noise3(x: number, y: number, z: number, seed: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const ease = (t: number) => t * t * (3 - 2 * t)
  const tx = ease(x - ix)
  const ty = ease(y - iy)
  const tz = ease(z - iz)
  let sum = 0
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz)
        const cell = (((ix + dx) * 73856093) ^ ((iy + dy) * 19349663) ^ ((iz + dz) * 83492791)) | 0
        sum += w * (unitHash(seed, cell) * 2 - 1)
      }
    }
  }
  return sum
}

/** Three octaves of `noise3`, about [−1, 1]. */
export const fbm3 = (x: number, y: number, z: number, seed: number) =>
  (noise3(x, y, z, seed) +
    0.5 * noise3(x * 2.03, y * 2.03, z * 2.03, seed + 1) +
    0.25 * noise3(x * 4.01, y * 4.01, z * 4.01, seed + 2)) /
  1.75

// ---------------------------------------------------------------------------
// The scalp's frame.

/** One centimetre in the template skull's units (an adult man's: about 0.895 m per unit). */
export const TEMPLATE_CM = 0.0112

/** Azimuth and elevation of a direction (any length) round a head's middle. */
export function angles(x: number, y: number, z: number): [a: number, e: number] {
  const r = Math.sqrt(x * x + y * y + z * z) || 1
  return [Math.atan2(x, z), Math.asin(Math.max(-1, Math.min(1, y / r)))]
}

/**
 * A head's middle for its scalp's frame: at eye level, halfway between the
 * front and back of what of `points` lies over eye level.
 */
export function frameOrigin(points: ArrayLike<number>, eyeY: number): V3 {
  let front = Number.NEGATIVE_INFINITY
  let back = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i += 3) {
    if (points[i + 1]! <= eyeY + 0.03) continue
    front = Math.max(front, points[i + 2]!)
    back = Math.min(back, points[i + 2]!)
  }
  return [0, eyeY, (front + back) / 2]
}

/** The template skull's frame: its middle and eye level, and each bald point's (a, e). */
export type TemplateFrame = { origin: V3; eyeY: number; a: Float32Array; e: Float32Array }

const frames = new WeakMap<SkullData, TemplateFrame>()

export function templateFrame(skull: SkullData): TemplateFrame {
  let frame = frames.get(skull)
  if (!frame) {
    const eyeY = (skull.bones.Bip01_LEye![1] + skull.bones.Bip01_REye![1]) / 2
    const origin = frameOrigin(skull.bald, eyeY)
    const count = skull.bald.length / 3
    const a = new Float32Array(count)
    const e = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const [ai, ei] = angles(
        skull.bald[i * 3]! - origin[0],
        skull.bald[i * 3 + 1]! - origin[1],
        skull.bald[i * 3 + 2]! - origin[2],
      )
      a[i] = ai
      e[i] = ei
    }
    frame = { origin, eyeY, a, e }
    frames.set(skull, frame)
  }
  return frame
}

// ---------------------------------------------------------------------------
// The hairline.

/** The base hairline: elevation (rad) by |a|, eased between entries (calibrated on three test heads). */
export const BASE_HAIRLINE: readonly (readonly [number, number])[] = [
  [0, 0.7],
  [0.45, 0.68],
  [0.75, 0.6],
  [1.0, 0.38],
  [1.12, -0.05],
  [1.3, -0.15],
  [1.38, 0.18],
  [1.65, 0.3],
  [1.92, 0.18],
  [2.05, -0.3],
  [2.4, -0.68],
  [2.8, -0.86],
  [Math.PI, -0.9],
]

export function baseHairline(a: number) {
  const x = Math.abs(a)
  for (let k = 1; k < BASE_HAIRLINE.length; k++) {
    const [x1, y1] = BASE_HAIRLINE[k]!
    if (x <= x1) {
      const [x0, y0] = BASE_HAIRLINE[k - 1]!
      const t = (x - x0) / (x1 - x0)
      return y0 + (y1 - y0) * t * t * (3 - 2 * t)
    }
  }
  return BASE_HAIRLINE[BASE_HAIRLINE.length - 1]![1]
}

/** Entries in a hairline table, evenly over |a| in [0, π]. */
export const HAIRLINE_STEPS = 33

/** A hairline table's elevation at azimuth a (linear between its entries). */
export function hairlineAt(table: ArrayLike<number>, a: number) {
  const f = (Math.min(Math.PI, Math.abs(a)) / Math.PI) * (HAIRLINE_STEPS - 1)
  const k = Math.min(HAIRLINE_STEPS - 2, Math.floor(f))
  const t = f - k
  return table[k]! * (1 - t) + table[k + 1]! * t
}

/**
 * The hairline's irregular edge (rad): ±0.035 at 9 per radian and ±0.015
 * at 31, the same along the whole hairline of every head, so the roots'
 * edge and the root layer's (its material repeats this) agree.
 */
export const hairlineWobble = (a: number) =>
  0.035 * noise1(a * 9, 0x51) + 0.015 * noise1(a * 31, 0x52)

/** How densely roots grow at (a, e) under a hairline table: 0 below it, 1 well inside. */
export const hairlineDensity = (table: ArrayLike<number>, a: number, e: number) =>
  smoothstep(-0.04, 0.05, e - hairlineAt(table, a) + hairlineWobble(a))

// ---------------------------------------------------------------------------
// Root candidates.

/**
 * Root candidates on the template's bald triangles, thrown pass by pass
 * (dart throwing, each pass's darts kept its gap from every dart before):
 * any prefix is well spread, so a far prefix is inside the game's, inside
 * the studio's. `tri` and `bary` (two per candidate: the second and third
 * corners' shares) place each on the template; `rand` decides whether a
 * style's density keeps it.
 */
export type Candidates = {
  count: number
  tri: Uint32Array
  bary: Float32Array
  point: Float32Array
  a: Float32Array
  e: Float32Array
  pass: Uint8Array
  rand: Float32Array
  /** Where each pass's candidates end. */
  passEnd: number[]
}

/** Each pass's gap (cm on the template) and how many darts it throws. */
export const ROOT_PASSES: readonly { gap: number; tries: number }[] = [
  { gap: 1.2, tries: 6000 },
  { gap: 0.6, tries: 26000 },
  { gap: 0.4, tries: 60000 },
]

const ROOTS_SEED = 0x7a11

const candidateSets = new WeakMap<SkullData, Map<string, Candidates>>()

/**
 * The template's root candidates over the region `inside` (by a, e)
 * keeps, worked out once per skull and region name.
 */
export function rootCandidates(
  skull: SkullData,
  region: string,
  inside: (a: number, e: number) => boolean,
): Candidates {
  let byRegion = candidateSets.get(skull)
  if (!byRegion) {
    byRegion = new Map()
    candidateSets.set(skull, byRegion)
  }
  const known = byRegion.get(region)
  if (known) return known
  const frame = templateFrame(skull)
  const { bald, triangles } = skull
  const count = triangles.length / 3
  const area = new Float64Array(count)
  let total = 0
  for (let t = 0; t < count; t++) {
    const [i, j, k] = [triangles[t * 3]!, triangles[t * 3 + 1]!, triangles[t * 3 + 2]!]
    const near = [i, j, k].some((v) => inside(frame.a[v]!, frame.e[v]!))
    if (!near) continue
    const ux = bald[j * 3]! - bald[i * 3]!
    const uy = bald[j * 3 + 1]! - bald[i * 3 + 1]!
    const uz = bald[j * 3 + 2]! - bald[i * 3 + 2]!
    const vx = bald[k * 3]! - bald[i * 3]!
    const vy = bald[k * 3 + 1]! - bald[i * 3 + 1]!
    const vz = bald[k * 3 + 2]! - bald[i * 3 + 2]!
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    area[t] = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz)
    total += area[t]!
  }
  const cdf = new Float64Array(count)
  let acc = 0
  for (let t = 0; t < count; t++) cdf[t] = acc += area[t]! / total
  const random = mulberry32(ROOTS_SEED)
  const tri: number[] = []
  const bary: number[] = []
  const point: number[] = []
  const ca: number[] = []
  const ce: number[] = []
  const pass: number[] = []
  const passEnd: number[] = []
  const [ox, oy, oz] = frame.origin
  ROOT_PASSES.forEach(({ gap, tries }, p) => {
    const cell = gap * TEMPLATE_CM
    const grid = new Map<number, number[]>()
    const key = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + z + 512
    const add = (n: number) => {
      const k = key(
        Math.floor(point[n * 3]! / cell),
        Math.floor(point[n * 3 + 1]! / cell),
        Math.floor(point[n * 3 + 2]! / cell),
      )
      const bucket = grid.get(k)
      if (bucket) bucket.push(n)
      else grid.set(k, [n])
    }
    for (let n = 0; n < point.length / 3; n++) add(n)
    for (let attempt = 0; attempt < tries; attempt++) {
      const u = random()
      let lo = 0
      let hi = count - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cdf[mid]! < u) lo = mid + 1
        else hi = mid
      }
      let r1 = random()
      let r2 = random()
      if (r1 + r2 > 1) {
        r1 = 1 - r1
        r2 = 1 - r2
      }
      const [i, j, k] = [triangles[lo * 3]!, triangles[lo * 3 + 1]!, triangles[lo * 3 + 2]!]
      const at = (axis: number) =>
        bald[i * 3 + axis]! * (1 - r1 - r2) + bald[j * 3 + axis]! * r1 + bald[k * 3 + axis]! * r2
      const x = at(0)
      const y = at(1)
      const z = at(2)
      const [a, e] = angles(x - ox, y - oy, z - oz)
      if (!inside(a, e)) continue
      const cx = Math.floor(x / cell)
      const cy = Math.floor(y / cell)
      const cz = Math.floor(z / cell)
      let clear = true
      for (let dx = -1; dx <= 1 && clear; dx++) {
        for (let dy = -1; dy <= 1 && clear; dy++) {
          for (let dz = -1; dz <= 1 && clear; dz++) {
            for (const n of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
              const ex = point[n * 3]! - x
              const ey = point[n * 3 + 1]! - y
              const ez = point[n * 3 + 2]! - z
              if (ex * ex + ey * ey + ez * ez < cell * cell) {
                clear = false
                break
              }
            }
          }
        }
      }
      if (!clear) continue
      tri.push(lo)
      bary.push(r1, r2)
      point.push(x, y, z)
      ca.push(a)
      ce.push(e)
      pass.push(p)
      add(point.length / 3 - 1)
    }
    passEnd.push(point.length / 3)
  })
  const n = point.length / 3
  const candidates: Candidates = {
    count: n,
    tri: Uint32Array.from(tri),
    bary: Float32Array.from(bary),
    point: Float32Array.from(point),
    a: Float32Array.from(ca),
    e: Float32Array.from(ce),
    pass: Uint8Array.from(pass),
    rand: Float32Array.from({ length: n }, (_, i) => unitHash(ROOTS_SEED, i)),
    passEnd,
  }
  byRegion.set(region, candidates)
  return candidates
}

// ---------------------------------------------------------------------------
// A head's radius round its middle.

/** Texels across an octahedral radius map. */
export const RADIUS_MAP_SIZE = 160

/**
 * The outermost hit of each ray from a head's middle (`origin`), over an
 * octahedral map (`y` up: the crown in the middle, nothing singular): of
 * the first surface (the head roots stand on: `headRadius`, `headTri` its
 * triangle there or −1), and in `radius` that, or where the head has no
 * hit the other surfaces' (0 where all are open, at the neck).
 */
export type RadiusMap = {
  size: number
  origin: V3
  radius: Float32Array
  headRadius: Float32Array
  headTri: Int32Array
}

/** A direction's place on the octahedral map, each in [−1, 1]. */
export function octEncode(x: number, y: number, z: number, out: number[]) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1
  let px = x / s
  let pz = z / s
  if (y < 0) {
    const fx = (1 - Math.abs(pz)) * (px >= 0 ? 1 : -1)
    const fz = (1 - Math.abs(px)) * (pz >= 0 ? 1 : -1)
    px = fx
    pz = fz
  }
  out[0] = px
  out[1] = pz
}

/** The unit direction at a place on the octahedral map. */
export function octDecode(px: number, pz: number, out: number[]) {
  let x = px
  let z = pz
  const y = 1 - Math.abs(px) - Math.abs(pz)
  if (y < 0) {
    x = (1 - Math.abs(pz)) * (px >= 0 ? 1 : -1)
    z = (1 - Math.abs(px)) * (pz >= 0 ? 1 : -1)
  }
  const l = Math.sqrt(x * x + y * y + z * z) || 1
  out[0] = x / l
  out[1] = y / l
  out[2] = z / l
}

/** A texel of the map, folded back over its edges as the octahedron joins them. */
function texel(size: number, i: number, j: number) {
  let x = i
  let y = j
  if (x < 0 || x >= size) {
    x = x < 0 ? 0 : size - 1
    y = size - 1 - y
  }
  if (y < 0 || y >= size) {
    y = y < 0 ? 0 : size - 1
    x = size - 1 - x
  }
  return Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))
}

const encoded = [0, 0]
const decoded = [0, 0, 0]

/** A ray from `o` along unit (dx, dy, dz) against triangle a, b, c (flat points): its distance, or −1. */
export function rayTriangle(
  points: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  bary?: number[],
) {
  const ax = points[a * 3]!
  const ay = points[a * 3 + 1]!
  const az = points[a * 3 + 2]!
  const e1x = points[b * 3]! - ax
  const e1y = points[b * 3 + 1]! - ay
  const e1z = points[b * 3 + 2]! - az
  const e2x = points[c * 3]! - ax
  const e2y = points[c * 3 + 1]! - ay
  const e2z = points[c * 3 + 2]! - az
  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < 1e-14) return -1
  const inv = 1 / det
  const tx = ox - ax
  const ty = oy - ay
  const tz = oz - az
  const u = (tx * px + ty * py + tz * pz) * inv
  if (u < -1e-7 || u > 1 + 1e-7) return -1
  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < -1e-7 || u + v > 1 + 1e-7) return -1
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv
  if (t <= 0) return -1
  if (bary) {
    bary[0] = u
    bary[1] = v
  }
  return t
}

/** Each texel's direction (x, y, z) on an octahedral map of a size, worked out once. */
const texelDirections = new Map<number, Float32Array>()

function directionsOf(size: number) {
  let found = texelDirections.get(size)
  if (!found) {
    found = new Float32Array(size * size * 3)
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        octDecode(((i + 0.5) / size) * 2 - 1, ((j + 0.5) / size) * 2 - 1, decoded)
        found.set(decoded, (j * size + i) * 3)
      }
    }
    texelDirections.set(size, found)
  }
  return found
}

/** A triangle's pieces are tested apart where its corners spread this far over the map (its folds). */
const PIECE_SPAN = 1 / 8
const PIECE_DEPTH = 4

/**
 * A head's radius map round `origin` from surfaces of triangles (flat
 * points and corners): the first is the head roots stand on. Each triangle
 * is tested only by the texels its own corners' (and, where it spans the
 * map's folds, its pieces') places cover.
 */
export function radiusMap(
  origin: V3,
  surfaces: readonly { points: ArrayLike<number>; index: ArrayLike<number> }[],
  size = RADIUS_MAP_SIZE,
): RadiusMap {
  const radius = new Float32Array(size * size)
  const headRadius = new Float32Array(size * size)
  const headTri = new Int32Array(size * size).fill(-1)
  const [ox, oy, oz] = origin
  const seen = new Int32Array(size * size).fill(-1)
  const directions = directionsOf(size)
  let stamp = 0
  // The triangle under test: a corner (from the middle) and two edges.
  let ax = 0
  let ay = 0
  let az = 0
  let e1x = 0
  let e1y = 0
  let e1z = 0
  let e2x = 0
  let e2y = 0
  let e2z = 0
  let head = false
  let tri = 0
  const test = (at: number) => {
    if (seen[at] === stamp) return
    seen[at] = stamp
    const dx = directions[at * 3]!
    const dy = directions[at * 3 + 1]!
    const dz = directions[at * 3 + 2]!
    const px = dy * e2z - dz * e2y
    const py = dz * e2x - dx * e2z
    const pz = dx * e2y - dy * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (det > -1e-14 && det < 1e-14) return
    const inv = 1 / det
    const u = -(ax * px + ay * py + az * pz) * inv
    if (u < -1e-7 || u > 1 + 1e-7) return
    const qx = -ay * e1z + az * e1y
    const qy = -az * e1x + ax * e1z
    const qz = -ax * e1y + ay * e1x
    const v = (dx * qx + dy * qy + dz * qz) * inv
    if (v < -1e-7 || u + v > 1 + 1e-7) return
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv
    if (d <= 0) return
    if (head) {
      if (d > headRadius[at]!) {
        headRadius[at] = d
        headTri[at] = tri
      }
    } else if (d > radius[at]!) radius[at] = d
  }
  const place = [0, 0]
  const placeOf = (x: number, y: number, z: number) => {
    octEncode(x, y, z, encoded)
    place[0] = ((encoded[0]! + 1) / 2) * size - 0.5
    place[1] = ((encoded[1]! + 1) / 2) * size - 0.5
  }
  // Corners relative to the middle; pieces split at their edges' middles.
  const cover = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    depth: number,
  ) => {
    placeOf(x0, y0, z0)
    const [u0, v0] = [place[0]!, place[1]!]
    placeOf(x1, y1, z1)
    const [u1, v1] = [place[0]!, place[1]!]
    placeOf(x2, y2, z2)
    const [u2, v2] = [place[0]!, place[1]!]
    const lu = Math.min(u0, u1, u2)
    const hu = Math.max(u0, u1, u2)
    const lv = Math.min(v0, v1, v2)
    const hv = Math.max(v0, v1, v2)
    if (depth < PIECE_DEPTH && Math.max(hu - lu, hv - lv) > size * PIECE_SPAN) {
      const [ax1, ay1, az1] = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
      const [bx1, by1, bz1] = [(x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2]
      const [cx1, cy1, cz1] = [(x2 + x0) / 2, (y2 + y0) / 2, (z2 + z0) / 2]
      cover(x0, y0, z0, ax1, ay1, az1, cx1, cy1, cz1, depth + 1)
      cover(ax1, ay1, az1, x1, y1, z1, bx1, by1, bz1, depth + 1)
      cover(cx1, cy1, cz1, bx1, by1, bz1, x2, y2, z2, depth + 1)
      cover(ax1, ay1, az1, bx1, by1, bz1, cx1, cy1, cz1, depth + 1)
      return
    }
    const i0 = Math.floor(lu) - 1
    const i1 = Math.ceil(hu) + 1
    const j0 = Math.floor(lv) - 1
    const j1 = Math.ceil(hv) + 1
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        test(i >= 0 && j >= 0 && i < size && j < size ? j * size + i : texel(size, i, j))
      }
    }
  }
  surfaces.forEach(({ points, index }, s) => {
    head = s === 0
    for (let t = 0; t < index.length / 3; t++) {
      const ia = index[t * 3]! * 3
      const ib = index[t * 3 + 1]! * 3
      const ic = index[t * 3 + 2]! * 3
      ax = points[ia]! - ox
      ay = points[ia + 1]! - oy
      az = points[ia + 2]! - oz
      const bx = points[ib]! - ox
      const by = points[ib + 1]! - oy
      const bz = points[ib + 2]! - oz
      const cx = points[ic]! - ox
      const cy = points[ic + 1]! - oy
      const cz = points[ic + 2]! - oz
      e1x = bx - ax
      e1y = by - ay
      e1z = bz - az
      e2x = cx - ax
      e2y = cy - ay
      e2z = cz - az
      tri = t
      stamp++
      cover(ax, ay, az, bx, by, bz, cx, cy, cz, 0)
    }
  })
  // The head where it is there; the other surfaces only where it is open.
  for (let at = 0; at < size * size; at++) if (headRadius[at]! > 0) radius[at] = headRadius[at]!
  return { size, origin, radius, headRadius, headTri }
}

/**
 * The map's radius toward unit (dx, dy, dz), bilinear over the texels
 * round it that are closed (by the neck's rim, its open ones left out), 0
 * where all are open.
 */
export function radiusAt(map: RadiusMap, dx: number, dy: number, dz: number) {
  const { size, radius } = map
  const s = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) || 1
  let px = dx / s
  let pz = dz / s
  if (dy < 0) {
    const fx = (1 - Math.abs(pz)) * (px >= 0 ? 1 : -1)
    pz = (1 - Math.abs(px)) * (pz >= 0 ? 1 : -1)
    px = fx
  }
  const fx = ((px + 1) / 2) * size - 0.5
  const fy = ((pz + 1) / 2) * size - 0.5
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  let r00: number
  let r10: number
  let r01: number
  let r11: number
  if (ix >= 0 && iy >= 0 && ix < size - 1 && iy < size - 1) {
    const at = iy * size + ix
    r00 = radius[at]!
    r10 = radius[at + 1]!
    r01 = radius[at + size]!
    r11 = radius[at + size + 1]!
  } else {
    r00 = radius[texel(size, ix, iy)]!
    r10 = radius[texel(size, ix + 1, iy)]!
    r01 = radius[texel(size, ix, iy + 1)]!
    r11 = radius[texel(size, ix + 1, iy + 1)]!
  }
  // By the rim of the opening, the texels round it that are closed.
  const w00 = r00 > 0 ? (1 - tx) * (1 - ty) : 0
  const w10 = r10 > 0 ? tx * (1 - ty) : 0
  const w01 = r01 > 0 ? (1 - tx) * ty : 0
  const w11 = r11 > 0 ? tx * ty : 0
  const weight = w00 + w10 + w01 + w11
  return weight > 0 ? (r00 * w00 + r10 * w10 + r01 * w01 + r11 * w11) / weight : 0
}

/**
 * Where the ray from the map's middle along unit (dx, dy, dz) leaves the
 * head the map was built on (its first surface: `points`, `index`), among
 * the triangles of the texels round it: the triangle (−1 for none), its
 * corners' shares (b, c) and the distance.
 */
export function onHead(
  map: RadiusMap,
  points: ArrayLike<number>,
  index: ArrayLike<number>,
  dx: number,
  dy: number,
  dz: number,
  out: { tri: number; u: number; v: number; t: number },
) {
  const { size, headTri, origin } = map
  octEncode(dx, dy, dz, encoded)
  const fx = Math.round(((encoded[0]! + 1) / 2) * size - 0.5)
  const fy = Math.round(((encoded[1]! + 1) / 2) * size - 0.5)
  out.tri = -1
  out.t = 0
  const bary = [0, 0]
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const t = headTri[texel(size, fx + i, fy + j)]!
      if (t < 0) continue
      const d = rayTriangle(
        points,
        index[t * 3]!,
        index[t * 3 + 1]!,
        index[t * 3 + 2]!,
        origin[0],
        origin[1],
        origin[2],
        dx,
        dy,
        dz,
        bary,
      )
      if (d > out.t) {
        out.tri = t
        out.u = bary[0]!
        out.v = bary[1]!
        out.t = d
      }
    }
  }
  return out.tri
}

// ---------------------------------------------------------------------------
// Eyes.

/** Spheres round the eyes and the lashes' box, which no fringe enters (bind units). */
export type EyeKeepOut = {
  spheres: { centre: V3; radius: number }[]
  box: { min: V3; max: V3 } | null
  /** Everything of it, for a quick miss. */
  bounds: { min: V3; max: V3 }
}

/** An eyeball's radius (cm), and how far past it and past the lashes' box hair keeps. */
const EYEBALL = 1.2
const PAST_EYE = 0.9
const PAST_LASHES = 0.3

export function eyeKeepOut(
  eyes: readonly (readonly number[])[],
  lashes: { min: V3; max: V3 } | null,
  cm: number,
): EyeKeepOut {
  const spheres = eyes.map((eye) => ({
    centre: [eye[0]!, eye[1]!, eye[2]!] as V3,
    radius: (EYEBALL + PAST_EYE) * cm,
  }))
  const box = lashes
    ? {
        min: lashes.min.map((v) => v - PAST_LASHES * cm) as V3,
        max: lashes.max.map((v) => v + PAST_LASHES * cm) as V3,
      }
    : null
  const min = [0, 1, 2].map((axis) =>
    Math.min(
      ...spheres.map((s) => s.centre[axis]! - s.radius),
      box?.min[axis] ?? Number.POSITIVE_INFINITY,
    ),
  ) as V3
  const max = [0, 1, 2].map((axis) =>
    Math.max(
      ...spheres.map((s) => s.centre[axis]! + s.radius),
      box?.max[axis] ?? Number.NEGATIVE_INFINITY,
    ),
  ) as V3
  return { spheres, box, bounds: { min, max } }
}

/** Whether a point is inside the keep-out. */
export function inEyes(keep: EyeKeepOut, x: number, y: number, z: number) {
  for (const { centre, radius } of keep.spheres) {
    const dx = x - centre[0]
    const dy = y - centre[1]
    const dz = z - centre[2]
    if (dx * dx + dy * dy + dz * dz < radius * radius) return true
  }
  const box = keep.box
  return (
    !!box &&
    x > box.min[0] &&
    x < box.max[0] &&
    y > box.min[1] &&
    y < box.max[1] &&
    z > box.min[2] &&
    z < box.max[2]
  )
}

/**
 * Pushes a point (in place, at `o`) out of the keep-out: out of a sphere
 * along its radius, out of the box forward or up, whichever is nearer.
 * Returns whether it moved.
 */
export function outOfEyes(keep: EyeKeepOut, p: Float32Array, o: number) {
  const { min, max } = keep.bounds
  if (
    p[o]! < min[0] ||
    p[o]! > max[0] ||
    p[o + 1]! < min[1] ||
    p[o + 1]! > max[1] ||
    p[o + 2]! < min[2] ||
    p[o + 2]! > max[2]
  ) {
    return false
  }
  let moved = false
  for (const { centre, radius } of keep.spheres) {
    const dx = p[o]! - centre[0]
    const dy = p[o + 1]! - centre[1]
    const dz = p[o + 2]! - centre[2]
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 >= radius * radius) continue
    const d = Math.sqrt(d2)
    // Straight out of the sphere, but never back into the face.
    const k = (radius * 1.0001) / (d || 1)
    p[o] = centre[0] + (d > 1e-9 ? dx * k : 0)
    p[o + 1] = centre[1] + (d > 1e-9 ? dy * k : radius)
    p[o + 2] = centre[2] + (d > 1e-9 ? dz * k : 0)
    moved = true
  }
  const box = keep.box
  if (
    box &&
    p[o]! > box.min[0] &&
    p[o]! < box.max[0] &&
    p[o + 1]! > box.min[1] &&
    p[o + 1]! < box.max[1] &&
    p[o + 2]! > box.min[2] &&
    p[o + 2]! < box.max[2]
  ) {
    const forward = box.max[2] - p[o + 2]!
    const up = box.max[1] - p[o + 1]!
    if (forward < up) p[o + 2] = box.max[2] + 1e-6
    else p[o + 1] = box.max[1] + 1e-6
    moved = true
  }
  return moved
}
