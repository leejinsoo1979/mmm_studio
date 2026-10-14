import type { HeadModel } from './head-model'
import { LIPS_INNER, LIPS_OUTER } from './landmark-sets'
import { fillTriangles } from './silhouette'
import type { Texels } from './texture'

/**
 * The face's features where the head's texture holds them: the eyes'
 * openings (the eyeballs show there, never the photo), and the lips, brows,
 * the lids round the eyes and the nose's wings and nostrils, which the
 * photos give whatever their colour. Found by MediaPipe's landmarks, which
 * sit at fixed places on the head, so the same outlines serve every photo.
 * Each is a soft mask (0–1) that fades over a few texels either side of its
 * outline, so nothing laid by it ends in a hard edge.
 */

/** Each landmark's place in the head's texture (u, v per landmark), NaN where it has none. */
export function landmarkUvs(
  model: HeadModel,
  weld: Uint32Array,
  uvs: Float32Array | Float64Array,
): Float32Array {
  // A texture coordinate for each base mesh vertex of the head's skin (the first copy of it).
  const uvOf = new Map<number, [number, number]>()
  for (let i = 0; i < weld.length; i++) {
    if (!uvOf.has(weld[i]!)) uvOf.set(weld[i]!, [uvs[i * 2]!, uvs[i * 2 + 1]!])
  }
  const out = new Float32Array(478 * 2).fill(Number.NaN)
  for (let l = 0; l < 478; l++) {
    let u = 0
    let v = 0
    let ok = true
    for (let k = 0; k < 3; k++) {
      const local = model.landmarkVertices[l * 3 + k]!
      const at = local >= 0 ? uvOf.get(model.vertices[local]!) : undefined
      if (!at) {
        ok = false
        break
      }
      const w = model.landmarkWeights[l * 3 + k]!
      u += w * at[0]
      v += w * at[1]
    }
    if (ok) {
      out[l * 2] = u
      out[l * 2 + 1] = v
    }
  }
  return out
}

/** The eyes' openings in order round them (the subject's left, then right). */
export const EYE_RINGS = [
  [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
  [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
] as const

/** Each brow as a ring: its lower edge out, its upper edge back (the subject's left, then right). */
export const BROW_RINGS = [
  [276, 283, 282, 295, 285, 336, 296, 334, 293, 300],
  [46, 53, 52, 65, 55, 107, 66, 105, 63, 70],
] as const

/**
 * A ring's landmarks (x, y per landmark in `points`) that lie with the rest
 * of it. A few of the landmark map's points (an eye's corner, an inner lip)
 * sit on skin out of sight of the photos it was made from — inside the
 * mouth, in the eye socket — whose texture coordinates are on another
 * island: a ring through them would cut across the face. Points without a
 * place (NaN) are left out too.
 */
export function ringLandmarks(points: ArrayLike<number>, indices: readonly number[]): number[] {
  const known = indices.filter((i) => Number.isFinite(points[i * 2]!))
  const middle = (k: 0 | 1) => {
    const sorted = known.map((i) => points[i * 2 + k]!).sort((a, b) => a - b)
    return sorted[sorted.length >> 1] ?? 0
  }
  const mx = middle(0)
  const my = middle(1)
  const reach = known.map((i) => Math.hypot(points[i * 2]! - mx, points[i * 2 + 1]! - my))
  const typical = [...reach].sort((a, b) => a - b)[reach.length >> 1] ?? 0
  return known.filter((_, k) => reach[k]! <= 3 * typical + 1e-9)
}

/** A ring of landmarks (ringLandmarks') pushed out from its centre by `grow` (a fraction of its size), scaled. */
export function ring(
  points: ArrayLike<number>,
  indices: readonly number[],
  grow: number,
  scale = 1,
): number[] {
  const kept = ringLandmarks(points, indices)
  let cx = 0
  let cy = 0
  for (const i of kept) {
    cx += points[i * 2]!
    cy += points[i * 2 + 1]!
  }
  cx /= kept.length
  cy /= kept.length
  const out: number[] = []
  for (const i of kept) {
    out.push(
      (cx + (points[i * 2]! - cx) * (1 + grow)) * scale,
      (cy + (points[i * 2 + 1]! - cy) * (1 + grow)) * scale,
    )
  }
  return out
}

/**
 * A ring round some landmarks (points in `points`), in order of their angle
 * about their middle, pushed out from it by `grow` (a fraction of its size),
 * scaled: for a feature whose landmarks are not listed round it.
 */
export function aroundRing(
  points: ArrayLike<number>,
  indices: readonly number[],
  grow: number,
  scale = 1,
): number[] {
  const known = indices.filter((i) => Number.isFinite(points[i * 2]!))
  let cx = 0
  let cy = 0
  for (const i of known) {
    cx += points[i * 2]! / known.length
    cy += points[i * 2 + 1]! / known.length
  }
  const order = [...known].sort(
    (a, b) =>
      Math.atan2(points[a * 2 + 1]! - cy, points[a * 2]! - cx) -
      Math.atan2(points[b * 2 + 1]! - cy, points[b * 2]! - cx),
  )
  return ring(points, order, grow, scale)
}

/** Fills a closed ring (a fan from its centre: the rings here are star-shaped about it) into `out`. */
export function fillRing(
  points: number[],
  width: number,
  height: number,
  out: Uint8Array,
  value = 1,
) {
  const n = points.length / 2
  if (points.some((p) => !Number.isFinite(p))) return
  const triangles: number[] = []
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    cx += points[i * 2]!
    cy += points[i * 2 + 1]!
  }
  const xy = [...points, cx / n, cy / n]
  for (let i = 0; i < n; i++) triangles.push(n, i, (i + 1) % n)
  fillTriangles(xy, triangles, width, height, out, value)
}

/** Squared distance (in samples) along one line to the nearest sample where `f` is 0 (Felzenszwalb's lower envelope). */
function distanceLine(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  const meet = (q: number, p: number) => (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p)
  let k = 0
  v[0] = 0
  z[0] = Number.NEGATIVE_INFINITY
  z[1] = Number.POSITIVE_INFINITY
  for (let q = 1; q < n; q++) {
    let s = meet(q, v[k]!)
    while (s <= z[k]!) {
      k--
      s = meet(q, v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Number.POSITIVE_INFINITY
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    const p = v[k]!
    d[q] = (q - p) * (q - p) + f[p]!
  }
}

/** Euclidean distance (pixels) from every pixel to the nearest one `inside` marks (0 on them). */
export function distanceTo(inside: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e12
  const grid = new Float64Array(width * height)
  for (let i = 0; i < grid.length; i++) grid[i] = inside[i] ? 0 : INF
  const n = Math.max(width, height)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]!
    distanceLine(f, height, d, v, z)
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]!
  }
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x]!
    distanceLine(f, width, d, v, z)
    for (let x = 0; x < width; x++) out[y * width + x] = Math.sqrt(d[x]!)
  }
  return out
}

/**
 * A filled region made soft: 1 well inside, 0 well outside, ½ on its
 * outline, fading over `feather` pixels either side (by the distance to it).
 */
export function featherMask(
  inside: Uint8Array,
  width: number,
  height: number,
  feather: number,
): Float32Array {
  const outside = new Uint8Array(inside.length)
  for (let i = 0; i < inside.length; i++) outside[i] = inside[i] ? 0 : 1
  const toInside = distanceTo(inside, width, height)
  const toOutside = distanceTo(outside, width, height)
  const out = new Float32Array(inside.length)
  for (let i = 0; i < out.length; i++) {
    // Signed distance: > 0 inside.
    const signed = inside[i] ? toOutside[i]! - 0.5 : 0.5 - toInside[i]!
    const t = Math.min(1, Math.max(0, (signed + feather) / (2 * feather)))
    out[i] = t * t * (3 - 2 * t)
  }
  return out
}

/** The head texture's features at the texels' size, each 0–1. */
export type TexelFeatures = {
  size: number
  /** The eyes' openings: the eyeballs show there, never a photo. */
  eye: Float32Array
  /** The lips, brows, lids and nostrils: taken from the photos whatever their colour (not by the skin's). */
  feature: Float32Array
  /** The lips alone. */
  lips: Float32Array
  /** The brows alone. */
  brows: Float32Array
  /** Inside the lips (their inner surface, seen only when the mouth opens). */
  mouth: Float32Array
  /** The lips and the skin just round them, which a smile or an open mouth moves. */
  around: Float32Array
}

/** How far (texels at 1024) each feature's edge fades: the lips' border is crisp, a brow's soft. */
const LIP_FEATHER = 3
/** How far round the lips (a share of their size) a smile moves the skin, and how softly that ends (texels at 1024). */
const AROUND_LIPS = 0.35
const AROUND_FEATHER = 8
const BROW_FEATHER = 7
const EYE_FEATHER = 2
/**
 * Round each eye, out to the lid's fold and the skin under the lower lid (a share of the eye's
 * size), and round the nose's wings and nostrils: their lashes' line, folds and shadows are what
 * a face is known by, and too dark or busy to pass for skin.
 */
const EYE_SURROUND = 0.6
const SURROUND_FEATHER = 6
const NOSE_BASE = [
  4, 1, 19, 94, 2, 98, 327, 64, 294, 129, 358, 49, 279, 48, 278, 115, 344, 220, 440, 45, 275, 5,
] as const
const NOSE_GROW = 0.15

/** The features' soft masks, from the landmarks' places in the texture. */
export function texelFeatures(texels: Texels, landmarkUv: Float32Array): TexelFeatures {
  const { size } = texels
  const scale = size / 1024
  const lipsInside = new Uint8Array(size * size)
  fillRing(ring(landmarkUv, LIPS_OUTER, 0.06, size), size, size, lipsInside)
  const browsInside = new Uint8Array(size * size)
  for (const brow of BROW_RINGS)
    fillRing(ring(landmarkUv, brow, 0.3, size), size, size, browsInside)
  const eyeInside = new Uint8Array(size * size)
  for (const eye of EYE_RINGS) fillRing(ring(landmarkUv, eye, 0.02, size), size, size, eyeInside)
  const mouthInside = new Uint8Array(size * size)
  fillRing(ring(landmarkUv, LIPS_INNER, 0.1, size), size, size, mouthInside)
  const aroundInside = new Uint8Array(size * size)
  fillRing(ring(landmarkUv, LIPS_OUTER, AROUND_LIPS, size), size, size, aroundInside)
  const surroundInside = new Uint8Array(size * size)
  for (const eye of EYE_RINGS)
    fillRing(ring(landmarkUv, eye, EYE_SURROUND, size), size, size, surroundInside)
  fillRing(aroundRing(landmarkUv, NOSE_BASE, NOSE_GROW, size), size, size, surroundInside)
  const lips = featherMask(lipsInside, size, size, LIP_FEATHER * scale)
  const brows = featherMask(browsInside, size, size, BROW_FEATHER * scale)
  const eye = featherMask(eyeInside, size, size, EYE_FEATHER * scale)
  const mouth = featherMask(mouthInside, size, size, LIP_FEATHER * scale)
  const around = featherMask(aroundInside, size, size, AROUND_FEATHER * scale)
  const surround = featherMask(surroundInside, size, size, SURROUND_FEATHER * scale)
  const feature = new Float32Array(size * size)
  for (let i = 0; i < feature.length; i++) {
    feature[i] = Math.max(lips[i]!, brows[i]!, surround[i]!) * (1 - eye[i]!)
    if (texels.triangle[i]! < 0) feature[i] = 0
  }
  return { size, eye, feature, lips, brows, mouth, around }
}

/**
 * The openings of a photo's face, softly, in its pixels: inside the mouth
 * (between the lips: teeth, tongue, the dark of an open mouth) and between
 * the eyelids (the eyeballs). Neither is ever laid onto the skin around
 * it, however the fitted lids and lips fall. Null without landmarks.
 */
export function faceOpenings(
  landmarks: Float32Array | null,
  width: number,
  height: number,
): Float32Array | null {
  if (!landmarks) return null
  const inside = new Uint8Array(width * height)
  fillRing(ring(landmarks, LIPS_INNER, 0.15), width, height, inside)
  for (const eye of EYE_RINGS) fillRing(ring(landmarks, eye, 0.03), width, height, inside)
  if (!inside.includes(1)) return null
  // Closed lips leave only their meeting line: a pixel or two either side of it is still out.
  const mouthWidth = Math.hypot(
    landmarks[61 * 2]! - landmarks[291 * 2]!,
    landmarks[61 * 2 + 1]! - landmarks[291 * 2 + 1]!,
  )
  return featherMask(inside, width, height, Math.max(1, 0.03 * mouthWidth))
}
