import type { HeadModel } from './head-model'
import { LIPS_OUTER } from './landmark-sets'
import { fillTriangles } from './silhouette'
import { TEXEL_EYE, TEXEL_FEATURE, TEXEL_SKIN, type Texels } from './texture'

/**
 * The face's features where the head's texture holds them: the eyes'
 * openings (the eyeballs show there, never the photo), and the lips and
 * brows, which the photos give whatever their colour. Found by MediaPipe's
 * landmarks, which sit at fixed places on the head, so the same outlines
 * serve every photo.
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
const EYE_RINGS = [
  [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
  [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
] as const

/** Each brow as a ring: its lower edge out, its upper edge back (the subject's left, then right). */
const BROW_RINGS = [
  [276, 283, 282, 295, 285, 336, 296, 334, 293, 300],
  [46, 53, 52, 65, 55, 107, 66, 105, 63, 70],
] as const

/**
 * A ring's landmarks that lie on the face with the rest of it. A few of the
 * landmark map's points (an eye's corner, an inner lip) sit on skin out of
 * sight of the photos it was made from — inside the mouth, in the eye
 * socket — whose texture coordinates are on another island: a ring through
 * them would cut across the face.
 */
export function ringLandmarks(uvs: Float32Array, indices: readonly number[]): number[] {
  const known = indices.filter((i) => Number.isFinite(uvs[i * 2]!))
  const middle = (k: 0 | 1) => {
    const sorted = known.map((i) => uvs[i * 2 + k]!).sort((a, b) => a - b)
    return sorted[sorted.length >> 1] ?? 0
  }
  const mu = middle(0)
  const mv = middle(1)
  const reach = known.map((i) => Math.hypot(uvs[i * 2]! - mu, uvs[i * 2 + 1]! - mv))
  const typical = [...reach].sort((a, b) => a - b)[reach.length >> 1] ?? 0
  return known.filter((_, k) => reach[k]! <= 3 * typical)
}

/** A ring of landmarks pushed out from its centre by `grow` (a fraction of its size). */
function ring(uvs: Float32Array, indices: readonly number[], grow: number, size: number): number[] {
  const kept = ringLandmarks(uvs, indices)
  let cx = 0
  let cy = 0
  for (const i of kept) {
    cx += uvs[i * 2]!
    cy += uvs[i * 2 + 1]!
  }
  cx /= kept.length
  cy /= kept.length
  const out: number[] = []
  for (const i of kept) {
    out.push(
      (cx + (uvs[i * 2]! - cx) * (1 + grow)) * size,
      (cy + (uvs[i * 2 + 1]! - cy) * (1 + grow)) * size,
    )
  }
  return out
}

/** Fills a closed ring (a fan from its centre: the rings here are star-shaped about it) into `out`. */
function fillRing(points: number[], size: number, out: Uint8Array, value: number) {
  const n = points.length / 2
  const triangles: number[] = []
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    cx += points[i * 2]!
    cy += points[i * 2 + 1]!
  }
  const xy = [...points, cx / n, cy / n]
  for (let i = 0; i < n; i++) triangles.push(n, i, (i + 1) % n)
  fillTriangles(xy, triangles, size, size, out, value)
}

/** What each texel is (skin, eye opening, or lip and brow), at the texels' size. */
export function texelKinds(texels: Texels, landmarkUv: Float32Array): Uint8Array {
  const { size } = texels
  const kind = new Uint8Array(size * size).fill(TEXEL_SKIN)
  for (const brow of BROW_RINGS)
    fillRing(ring(landmarkUv, brow, 0.25, size), size, kind, TEXEL_FEATURE)
  fillRing(ring(landmarkUv, LIPS_OUTER, 0.08, size), size, kind, TEXEL_FEATURE)
  for (const eye of EYE_RINGS) fillRing(ring(landmarkUv, eye, 0.05, size), size, kind, TEXEL_EYE)
  return kind
}
