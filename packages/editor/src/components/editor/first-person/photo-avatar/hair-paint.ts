import type { HairStyle } from './hair-library'
import type { HeadFrame } from './head-model'
import { rasterTriangle } from './silhouette'
import { linearToSrgb, smooth, srgbToLinear, type Texels, type UvMesh } from './texture'

/**
 * A hair style's pictures in the person's hair colour, and the hairline on
 * the skin: under where hair grows (the style's scalp density) the head's
 * texture is tinted towards the hair's roots, so the hairline is a soft
 * thinning of hair instead of the cards' edge cut on bare skin.
 */

export type Rgb = [number, number, number]

/** How far the hair's colour may be pushed from a picture's own (per channel, linear). */
const MAX_GAIN = 12
/** How much of the skin under the densest hairline the roots hide, and how dark they read against the hair. */
const SCALP_COVER = 0.8
const ROOT_SHADE = 0.75

/** Median linear colour of an RGBA picture's solid pixels. */
export function pictureMedian(rgba: ArrayLike<number>): Rgb {
  const channels: number[][] = [[], [], []]
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! <= 128) continue
    for (let k = 0; k < 3; k++) channels[k]!.push(srgbToLinear(rgba[i + k]!))
  }
  return channels.map((list) => {
    if (!list.length) return 0.1
    list.sort((a, b) => a - b)
    return list[list.length >> 1]!
  }) as Rgb
}

/**
 * Per-channel gains (linear) taking a style's own picture — its cards', or
 * a buzz cut's — to `colour` at its solid pixels' median. Every picture of
 * the style takes the same gains, so its cap keeps its shade under them.
 */
export function hairGains(rgba: ArrayLike<number>, colour: Rgb): Rgb {
  const from = pictureMedian(rgba)
  return from.map((c, k) =>
    Math.min(MAX_GAIN, Math.max(1 / MAX_GAIN, colour[k]! / Math.max(c, 1e-4))),
  ) as Rgb
}

/** A picture with per-channel gains (linear), each strand keeping its light; alpha kept. */
export function tonePicture(rgba: ArrayLike<number>, gains: Rgb): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    for (let k = 0; k < 3; k++) out[i + k] = linearToSrgb(srgbToLinear(rgba[i + k]!) * gains[k]!)
    out[i + 3] = rgba[i + 3]!
  }
  return out
}

/**
 * The style's scalp density over the head's texture (size × size, 0–1):
 * per skin vertex its base mesh vertex's density, across the skin's
 * triangles in its UV layout.
 */
export function scalpDensity(
  style: HairStyle,
  gender: 'male' | 'female',
  mesh: UvMesh,
  weld: Uint32Array,
  size: number,
): Float32Array {
  const { vertices, density } = style.scalp[gender]
  const byBase = new Map<number, number>()
  for (let i = 0; i < vertices.length; i++) byBase.set(vertices[i]!, density[i]!)
  const perVertex = new Float32Array(weld.length)
  for (let v = 0; v < weld.length; v++) perVertex[v] = byBase.get(weld[v]!) ?? 0
  const out = new Float32Array(size * size)
  const { uvs, triangles } = mesh
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]!
    const b = triangles[t + 1]!
    const c = triangles[t + 2]!
    if (!(perVertex[a]! || perVertex[b]! || perVertex[c]!)) continue
    rasterTriangle(
      uvs[a * 2]! * size,
      uvs[a * 2 + 1]! * size,
      uvs[b * 2]! * size,
      uvs[b * 2 + 1]! * size,
      uvs[c * 2]! * size,
      uvs[c * 2 + 1]! * size,
      size,
      size,
      (pixel, w0, w1, w2) => {
        out[pixel] = w0 * perVertex[a]! + w1 * perVertex[b]! + w2 * perVertex[c]!
      },
    )
  }
  return out
}

/**
 * Where the photos show the person's hair over their scalp, on the head's
 * texture (size × size, 0–1): the crown and the back and sides of the head
 * (never the face, nor a fringe's forehead) take the hair's roots there, so
 * a parting or a gap between the style's cards shows the person's hair, not
 * their skin, and the hairline is theirs. `hair` is per texel of `texels`.
 */
export function scalpCover(
  hair: Float32Array,
  texels: Texels,
  frame: HeadFrame,
  size: number,
): Float32Array {
  const out = new Float32Array(size * size)
  const working = texels.size
  for (let y = 0; y < size; y++) {
    const ty = Math.min(working - 1, Math.floor(((y + 0.5) / size) * working))
    for (let x = 0; x < size; x++) {
      const tx = Math.min(working - 1, Math.floor(((x + 0.5) / size) * working))
      const t = ty * working + tx
      if (!(hair[t]! > 0) || texels.triangle[t]! < 0) continue
      const up = texels.position[t * 3 + 1]! - frame.eyes[1]
      const back = frame.earZ - texels.position[t * 3 + 2]!
      const scalp = Math.max(
        smooth(SCALP_FLOOR - 0.01, SCALP_FLOOR, up),
        smooth(0, 0.01, back) * smooth(SIDE_FLOOR - 0.01, SIDE_FLOOR, up),
      )
      out[y * size + x] = hair[t]! * scalp
    }
  }
  return out
}

/** Above this (m over the eyes) the head is scalp, under hair wherever a photo shows hair; behind the ears, above this. */
const SCALP_FLOOR = 0.065
const SIDE_FLOOR = 0.01

/** The head's texture (RGBA, in place) tinted towards the hair's roots by `density`. */
export function tintScalp(pixels: Uint8ClampedArray, density: Float32Array, colour: Rgb) {
  const root = colour.map((c) => c * ROOT_SHADE)
  for (let i = 0; i < density.length; i++) {
    const d = density[i]!
    if (!(d > 0)) continue
    const share = d * SCALP_COVER
    for (let k = 0; k < 3; k++) {
      const skin = srgbToLinear(pixels[i * 4 + k]!)
      pixels[i * 4 + k] = linearToSrgb(skin + (root[k]! - skin) * share)
    }
  }
}
