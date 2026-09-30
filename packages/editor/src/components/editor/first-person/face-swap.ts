import { connectedFrom, dilate, erode, fillFrom } from './face-fill'
import {
  FACE_PARTS,
  faceRegion,
  featureRegions,
  marginRing,
  type Point,
  unpackPoints,
} from './face-points'
import { delaunay, flattenLighting, polygonMask, seamlessClone, warpTriangles } from './face-warp'
import { bakeFront, type FrontImage } from './front-render'
import {
  colorDistance,
  type HeadTriangle,
  luminance,
  type Pixels,
  type Rgb,
  similarityMask,
} from './look-pixels'

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** The head's front view, in pixels a side: the face is swapped there. */
export const FRONT = 1024

export type FaceWarp = {
  /** The photo warped onto the character's face, on its front view. */
  warped: Pixels
  /** The face (brows to chin) the swap replaces: where the blend solves. */
  region: Float32Array
  /** The region, fading in from its edge: how much of the photo there is trusted. */
  inner: Float32Array
  /** How much of the swapped face each front-view pixel bakes in (feathered at the rim). */
  weight: Float32Array
  /** The brows, eyes, nose and lips: kept whatever their colour. */
  features: Float32Array
  /** Inside the face and clear of the features' fringes: where bare skin to fill from can show. */
  clear: Float32Array
  /** Where the photo's bare skin shows, to learn its colour. */
  cheeks: Point[]
  /** Just past the top of the face, where the photo's hair shows (if it has any), to learn its colour. */
  crown: Float32Array
}

/**
 * The photo warped onto a character's face: each of its landmarks (`points`,
 * packed fractions of the photo) onto the character's (`target`, fractions
 * of its front view), a triangle mesh between them and a ring past the
 * face's outline, plus the masks the swap needs on the front view.
 */
export function warpFace(
  photo: Pixels,
  points: readonly number[],
  target: readonly number[],
): FaceWarp {
  const source = unpackPoints(points).map(([x, y]) => [x * photo.width, y * photo.height] as Point)
  const dest = unpackPoints(target).map(([x, y]) => [x * FRONT, y * FRONT] as Point)
  const from = [...FACE_PARTS.warp.map((i) => source[i]!), ...marginRing(source)]
  const to = [...FACE_PARTS.warp.map((i) => dest[i]!), ...marginRing(dest)]
  const outline = faceRegion(dest)
  const inner = polygonMask(outline, FRONT, FRONT, FRONT * 0.04)
  const features = featureMask(featureRegions(dest))
  const fringe = dilate(features, FRONT, FRONT, FRONT * 0.012)
  const oval = polygonMask(
    FACE_PARTS.oval.map((i) => dest[i]!),
    FRONT,
    FRONT,
    0,
  )
  const ring = polygonMask(marginRing(dest), FRONT, FRONT, 0)
  const browTop = Math.min(...FACE_PARTS.brows.map((i) => dest[i]![1]))
  const crown = new Float32Array(FRONT * FRONT)
  for (let y = 0; y < Math.min(FRONT, browTop); y++) {
    for (let x = 0; x < FRONT; x++) {
      crown[y * FRONT + x] = ring[y * FRONT + x]! * (1 - oval[y * FRONT + x]!)
    }
  }
  return {
    warped: warpTriangles(photo, from, to, delaunay(to), FRONT, FRONT),
    region: polygonMask(outline, FRONT, FRONT, 1),
    inner,
    weight: polygonMask(outline, FRONT, FRONT, FRONT * 0.03),
    features,
    clear: inner.map((value, i) => value * (1 - fringe[i]!)),
    cheeks: FACE_PARTS.cheeks.map((i) => dest[i]!),
    crown,
  }
}

/** The features' outlines filled in, on the front view (softened a little at their edges). */
function featureMask(outlines: readonly Point[][]): Float32Array {
  const mask = new Float32Array(FRONT * FRONT)
  for (const outline of outlines) {
    const part = polygonMask(outline, FRONT, FRONT, FRONT * 0.008)
    for (let i = 0; i < mask.length; i++) mask[i] = Math.max(mask[i]!, part[i]!)
  }
  return mask
}

/** The median colour (by lightness) of the pixels around some points. */
function colorAround(image: Pixels, points: readonly Point[], radius: number): Rgb | null {
  const samples: Rgb[] = []
  const r = Math.max(1, Math.round(radius))
  for (const [px, py] of points) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(px) + dx
        const y = Math.round(py) + dy
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
        const p = (y * image.width + x) * 4
        if (image.data[p + 3] === 0) continue
        samples.push([image.data[p]!, image.data[p + 1]!, image.data[p + 2]!])
      }
    }
  }
  if (samples.length === 0) return null
  samples.sort((a, b) => luminance(...a) - luminance(...b))
  return samples[Math.floor(samples.length / 2)]!
}

/**
 * The photo's hair: the darker half of what shows past the top of the face
 * (its median by lightness). Null when that is no different from the skin
 * (a bald head, a forehead running up to the photo's edge).
 */
function hairColor(image: Pixels, crown: Float32Array, skin: Rgb): Rgb | null {
  const samples: Rgb[] = []
  for (let i = 0, p = 0; i < crown.length; i++, p += 4) {
    if (crown[i]! < 0.5 || image.data[p + 3] === 0) continue
    samples.push([image.data[p]!, image.data[p + 1]!, image.data[p + 2]!])
  }
  if (samples.length < 50) return null
  samples.sort((a, b) => luminance(...a) - luminance(...b))
  const hair = samples[Math.floor(samples.length / 4)]!
  return colorDistance(...hair, skin, luminance(...skin)) > 0.3 ? hair : null
}

/** A mask (0–1 per texel) as an image renderFront can draw: its value in red. */
export function maskImage(mask: Float32Array, width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    data[p] = mask[i]! * 255
    data[p + 3] = 255
  }
  return { data, width, height }
}

/**
 * The photo's face on the character's front view, ready to blend: its
 * shading evened out (`light`), and whatever in it isn't face — hair across
 * the forehead, the background past a jaw the landmarks missed — filled in
 * from the skin around it.
 */
export function photoFace(warp: FaceWarp, light: number): Pixels {
  // Bare skin in the photo: all but its hair (anything no nearer the skin's
  // colour than the hair's by a clear margin, so a strand's soft edge goes
  // too) and the skin just by it, which the hair shades darker and redder;
  // the features are kept whatever their colour.
  const photoSkin = colorAround(warp.warped, warp.cheeks, FRONT * 0.012)
  const photoHair = photoSkin && hairColor(warp.warped, warp.crown, photoSkin)
  const skinLike = new Float32Array(FRONT * FRONT).fill(1)
  if (photoSkin && photoHair) {
    const skinLum = luminance(...photoSkin)
    const hairLum = luminance(...photoHair)
    const hairy = new Float32Array(FRONT * FRONT)
    const { data } = warp.warped
    for (let i = 0, p = 0; i < hairy.length; i++, p += 4) {
      if (data[p + 3] === 0) continue
      const r = data[p]!
      const g = data[p + 1]!
      const b = data[p + 2]!
      const margin =
        colorDistance(r, g, b, photoSkin, skinLum) - colorDistance(r, g, b, photoHair, hairLum)
      hairy[i] = smoothstep(-0.15, -0.02, margin)
    }
    const grown = dilate(hairy, FRONT, FRONT, FRONT * 0.02)
    for (let i = 0; i < skinLike.length; i++) skinLike[i] = 1 - grown[i]!
  }
  const bareSkin = new Float32Array(FRONT * FRONT)
  const known = new Float32Array(FRONT * FRONT)
  for (let i = 0; i < known.length; i++) {
    const feature = warp.features[i]!
    bareSkin[i] = warp.clear[i]! * skinLike[i]!
    known[i] = warp.inner[i]! * (feature + (1 - feature) * skinLike[i]!)
  }
  // Its shading evened out over the face alone; the rest is skin, filled in
  // from the bare skin around it (not from brows or lips).
  const lit: Pixels = { data: new Uint8ClampedArray(warp.warped.data), width: FRONT, height: FRONT }
  flattenLighting(lit, known, light, FRONT * 0.05)
  const filled = fillFrom(lit, bareSkin)
  for (let i = 0, p = 0; i < known.length; i++, p += 4) {
    const keep = known[i]!
    if (keep <= bareSkin[i]!) continue
    for (let c = 0; c < 3; c++) {
      filled.data[p + c] = filled.data[p + c]! + (lit.data[p + c]! - filled.data[p + c]!) * keep
    }
  }
  // Inside the face, what the photo showed no face in is filled again as a
  // membrane stretched over the face around it (a blend with no detail of
  // its own), so it meets that face without a step.
  const holes = new Float32Array(FRONT * FRONT)
  for (let i = 0; i < holes.length; i++) {
    const feature = warp.features[i]!
    if (warp.region[i]! > 0.5 && feature + (1 - feature) * skinLike[i]! < 0.9) holes[i] = 1
  }
  const flat: Pixels = {
    data: new Uint8ClampedArray(FRONT * FRONT * 4),
    width: FRONT,
    height: FRONT,
  }
  return seamlessClone(flat, filled, holes, 1)
}

/**
 * The player's face on a character's front view: `image`, to bake where
 * `weight` says (0–1 per pixel). The photo's face (`photo`, from `photoFace`) meets
 * the character's skin in the gradient domain — the photo's features on the
 * character's skin tone, without a seam (`blend` below 1 lets the photo's
 * own colours back in) — with the character's own hair over its front view
 * (`hair`, 0–1 per pixel) filled in first, so none of it tints the face,
 * and left where it lies after.
 */
export function composeFace(
  front: FrontImage,
  hair: Float32Array,
  warp: FaceWarp,
  photo: Pixels,
  blend: number,
): { image: Pixels; weight: Float32Array } {
  // The character's bare skin, its hair over the face filled in: the tone
  // the face meets.
  const ownSkin = colorAround(front.image, warp.cheeks, FRONT * 0.012)
  const ownLike = ownSkin ? similarityMask(front.image, ownSkin, 0.12, 0.3) : null
  for (let i = 0; ownLike && i < ownLike.length; i++) ownLike[i]! *= 1 - hair[i]!
  const bare = ownLike
    ? erode(ownLike, FRONT, FRONT, FRONT * 0.004)
    : new Float32Array(FRONT * FRONT)
  const target = fillFrom(front.image, bare)

  const composite = seamlessClone(photo, target, warp.region, 1)
  // The character's hair stays over the new face (a fringe over a brow
  // too), its wispy edges with it: all the hair that reaches past the
  // features. Its own brows and lashes, apart from that, give way to the
  // photo's.
  const outside = warp.features.map((feature) => 1 - feature)
  const over = dilate(connectedFrom(hair, outside, FRONT, FRONT, 0.5), FRONT, FRONT, FRONT * 0.002)
  const weight = new Float32Array(FRONT * FRONT)
  for (let i = 0, p = 0; i < weight.length; i++, p += 4) {
    const w = warp.weight[i]!
    if (w <= 0) continue
    weight[i] = w * (1 - over[i]!)
    // Less than a full blend brings the photo's colours back, faded out
    // towards the rim (a partial solve would leave a step there instead).
    const own = (1 - blend) * w
    if (own <= 0) continue
    for (let c = 0; c < 3; c++) {
      composite.data[p + c] =
        composite.data[p + c]! + (photo.data[p + c]! - composite.data[p + c]!) * own
    }
  }
  return { image: composite, weight }
}

/** Swaps the player's face onto a head texture's skin (in place): see `composeFace`. */
export function swapFace(
  head: Pixels,
  skin: readonly HeadTriangle[],
  front: FrontImage,
  hair: Float32Array,
  warp: FaceWarp,
  photo: Pixels,
  blend: number,
) {
  const { image, weight } = composeFace(front, hair, warp, photo, blend)
  bakeFront(head, skin, { image, depth: front.depth }, weight)
}
