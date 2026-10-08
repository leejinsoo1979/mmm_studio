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
 * the surfaces it was built from (`radius`; 0 where the head is open, at
 * the neck), and of the first surface alone (`headRadius`, `headTri` its
 * triangle there or −1), which roots stand on.
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
  const corner = [0, 0, 0]
  surfaces.forEach(({ points, index }, s) => {
    const texelOf = (x: number, y: number, z: number, out: number[]) => {
      octEncode(x - ox, y - oy, z - oz, encoded)
      out[0] = ((encoded[0]! + 1) / 2) * size - 0.5
      out[1] = ((encoded[1]! + 1) / 2) * size - 0.5
    }
    const uv = [0, 0]
    for (let t = 0; t < index.length / 3; t++) {
      const [ia, ib, ic] = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!]
      const stamp = s * 1e7 + t
      const test = (i: number, j: number) => {
        const at = texel(size, i, j)
        if (seen[at] === stamp) return
        seen[at] = stamp
        const tx = at % size
        const ty = Math.floor(at / size)
        octDecode(((tx + 0.5) / size) * 2 - 1, ((ty + 0.5) / size) * 2 - 1, decoded)
        const d = rayTriangle(points, ia, ib, ic, ox, oy, oz, decoded[0]!, decoded[1]!, decoded[2]!)
        if (d <= 0) return
        if (d > radius[at]!) radius[at] = d
        if (s === 0 && d > headRadius[at]!) {
          headRadius[at] = d
          headTri[at] = t
        }
      }
      const cover = (
        p: readonly number[],
        q: readonly number[],
        r: readonly number[],
        depth: number,
      ) => {
        const places = [p, q, r].map((v) => {
          texelOf(v[0]!, v[1]!, v[2]!, uv)
          return [uv[0]!, uv[1]!]
        })
        const lo = [0, 1].map((k) => Math.min(...places.map((v) => v[k]!)))
        const hi = [0, 1].map((k) => Math.max(...places.map((v) => v[k]!)))
        if (depth < 4 && Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!) > size / 8) {
          const mid = (u: readonly number[], v: readonly number[]) =>
            u.map((x, k) => (x + v[k]!) / 2)
          const pq = mid(p, q)
          const qr = mid(q, r)
          const rp = mid(r, p)
          cover(p, pq, rp, depth + 1)
          cover(pq, q, qr, depth + 1)
          cover(rp, qr, r, depth + 1)
          cover(pq, qr, rp, depth + 1)
          return
        }
        for (let j = Math.floor(lo[1]!) - 1; j <= Math.ceil(hi[1]!) + 1; j++) {
          for (let i = Math.floor(lo[0]!) - 1; i <= Math.ceil(hi[0]!) + 1; i++) test(i, j)
        }
      }
      const pointOf = (v: number) => {
        corner[0] = points[v * 3]!
        corner[1] = points[v * 3 + 1]!
        corner[2] = points[v * 3 + 2]!
        return [corner[0], corner[1], corner[2]]
      }
      cover(pointOf(ia), pointOf(ib), pointOf(ic), 0)
    }
  })
  return { size, origin, radius, headRadius, headTri }
}

/**
 * The map's radius toward unit (dx, dy, dz), bilinear: 0 where any texel
 * round it is open (the neck's rim), so nothing is pushed into the hole.
 */
export function radiusAt(map: RadiusMap, dx: number, dy: number, dz: number) {
  const { size, radius } = map
  octEncode(dx, dy, dz, encoded)
  const fx = ((encoded[0]! + 1) / 2) * size - 0.5
  const fy = ((encoded[1]! + 1) / 2) * size - 0.5
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const r00 = radius[texel(size, ix, iy)]!
  const r10 = radius[texel(size, ix + 1, iy)]!
  const r01 = radius[texel(size, ix, iy + 1)]!
  const r11 = radius[texel(size, ix + 1, iy + 1)]!
  if (r00 === 0 || r10 === 0 || r01 === 0 || r11 === 0) return 0
  return (r00 * (1 - tx) + r10 * tx) * (1 - ty) + (r01 * (1 - tx) + r11 * tx) * ty
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
  return {
    spheres: eyes.map((eye) => ({
      centre: [eye[0]!, eye[1]!, eye[2]!] as V3,
      radius: (EYEBALL + PAST_EYE) * cm,
    })),
    box: lashes
      ? {
          min: lashes.min.map((v) => v - PAST_LASHES * cm) as V3,
          max: lashes.max.map((v) => v + PAST_LASHES * cm) as V3,
        }
      : null,
  }
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
