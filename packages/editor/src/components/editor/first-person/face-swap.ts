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
import { bakeFront, type FrontImage, forEachTexel } from './front-render'
import {
  byLightness,
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
  /**
   * Where no hair can be, whatever its colour: the middle of the face below
   * the brows (hair falls over the forehead and down the face's sides; a
   * shadowed cheek on a dark skin can be as dark as the hair).
   */
  hairless: Float32Array
  /** Each brow's outline (grown to take in its fringe), and the distance between the irises, in pixels. */
  brows: Point[][]
  eyes: number
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
  const regions = featureRegions(dest)
  const features = featureMask(regions)
  const [rightIris, leftIris] = [FACE_PARTS.rightIris[0]!, FACE_PARTS.leftIris[0]!].map(
    (i) => dest[i]!,
  )
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
  const outlinePoints = FACE_PARTS.oval.map((i) => dest[i]!)
  const [ox, oy] = [
    outlinePoints.reduce((sum, [x]) => sum + x, 0) / outlinePoints.length,
    outlinePoints.reduce((sum, [, y]) => sum + y, 0) / outlinePoints.length,
  ]
  const middle = polygonMask(
    outlinePoints.map(([x, y]) => [ox + (x - ox) * 0.82, oy + (y - oy) * 0.82] as Point),
    FRONT,
    FRONT,
    FRONT * 0.02,
  )
  const browBottom = Math.max(...FACE_PARTS.brows.map((i) => dest[i]![1]))
  const hairless = new Float32Array(FRONT * FRONT)
  for (let y = Math.max(0, Math.floor(browBottom)); y < FRONT; y++) {
    for (let x = 0; x < FRONT; x++) hairless[y * FRONT + x] = middle[y * FRONT + x]!
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
    hairless,
    brows: regions.slice(0, 2),
    eyes: Math.hypot(rightIris![0] - leftIris![0], rightIris![1] - leftIris![1]),
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
  return byLightness(samples, 0.5)
}

/**
 * How unlike the skin the hair past the top of the face must be to be told
 * from it. Past a short haircut that band is mostly the wall behind, often
 * a beige near the skin's; taking that for hair would wipe the face's own
 * shading. Hair that close to the skin (light blonde) is left in.
 */
const HAIR_APART = 0.3

/**
 * The photo's hair: the darker half of what shows past the top of the face
 * (its median by lightness). Null when that is hardly different from the
 * skin (a bald head, a forehead running up to the photo's edge).
 */
function hairColor(image: Pixels, crown: Float32Array, skin: Rgb): Rgb | null {
  const samples: Rgb[] = []
  for (let i = 0, p = 0; i < crown.length; i++, p += 4) {
    if (crown[i]! < 0.5 || image.data[p + 3] === 0) continue
    samples.push([image.data[p]!, image.data[p + 1]!, image.data[p + 2]!])
  }
  if (samples.length < 50) return null
  const hair = byLightness(samples, 0.25)
  return colorDistance(...hair, skin, luminance(...skin)) > HAIR_APART ? hair : null
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
 * How much of the band just above a brow the photo's hair must cover for
 * the brow to count as under a fringe; how far above the brow that band
 * lies, and how far past the brow the character's own is kept (× the
 * distance between the eyes).
 */
const COVERED = 0.45
const BAND_ABOVE = 0.1
const KEEP_PAST = 0.1

/**
 * Where the photo's fringe hides its brows: the brows, and the forehead
 * above them, whose hair (`hair`, connected to the crown's) covers the
 * band just above them. The photo shows no brow there to take — its own
 * would come out as a smear of hair — so the character keeps its own.
 */
function fringeCover(warp: FaceWarp, hair: Float32Array): Float32Array {
  const shift = Math.max(1, Math.round(BAND_ABOVE * warp.eyes))
  const covered: [number, number, number][] = []
  for (const outline of warp.brows) {
    const brow = polygonMask(outline, FRONT, FRONT, 0)
    let band = 0
    let hidden = 0
    for (let i = 0; i + shift * FRONT < brow.length; i++) {
      const above = brow[i + shift * FRONT]! * (1 - brow[i]!)
      band += above
      hidden += above * hair[i]!
    }
    if (band > 0 && hidden / band > COVERED) {
      const xs = outline.map(([x]) => x)
      covered.push([Math.min(...xs), Math.max(...xs), Math.max(...outline.map(([, y]) => y))])
    }
  }
  const cover = new Float32Array(FRONT * FRONT)
  const reach = KEEP_PAST * warp.eyes
  // Both brows hidden: the fringe hides between them too.
  const spans: [number, number, number][] =
    covered.length === 2
      ? [
          [
            Math.min(covered[0]![0], covered[1]![0]),
            Math.max(covered[0]![1], covered[1]![1]),
            Math.max(covered[0]![2], covered[1]![2]),
          ],
        ]
      : covered
  for (const [from, to, bottom] of spans) {
    for (let py = 0; py < Math.min(FRONT, Math.ceil(bottom + reach)); py++) {
      const down = smoothstep(bottom + reach, bottom, py)
      const last = Math.min(FRONT, Math.ceil(to + reach))
      for (let px = Math.max(0, Math.floor(from - reach)); px < last; px++) {
        const side = Math.min(smoothstep(from - reach, from, px), smoothstep(to + reach, to, px))
        const i = py * FRONT + px
        cover[i] = Math.max(cover[i]!, down * side)
      }
    }
  }
  return cover
}

/**
 * The photo's face on the character's front view, ready to blend (`image`):
 * its shading evened out (`light`), and whatever in it isn't face — hair
 * across the forehead, the background past a jaw the landmarks missed —
 * filled in from the skin around it. `covered` (0–1 per pixel) is where a
 * fringe hid the photo's brows: the character's own stay there.
 */
export type PhotoFace = { image: Pixels; covered: Float32Array }

export function photoFace(warp: FaceWarp, light: number): PhotoFace {
  // Bare skin in the photo: all but its hair — anything no nearer the
  // skin's colour than the hair's by a clear margin (so a strand's soft edge
  // goes too) that reaches the hair past the top of the face (a mole,
  // freckles, a beard or a shadow inside the face stay) — and the skin just
  // by it, which the hair shades darker and redder. The features are kept
  // whatever their colour.
  const photoSkin = colorAround(warp.warped, warp.cheeks, FRONT * 0.012)
  const photoHair = photoSkin && hairColor(warp.warped, warp.crown, photoSkin)
  const skinLike = new Float32Array(FRONT * FRONT).fill(1)
  let covered: Float32Array = new Float32Array(FRONT * FRONT)
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
      hairy[i] = smoothstep(-0.15, -0.02, margin) * (1 - warp.hairless[i]!)
    }
    const reaching = connectedFrom(hairy, warp.crown, FRONT, FRONT, 0.5)
    covered = fringeCover(warp, reaching)
    const grown = dilate(reaching, FRONT, FRONT, FRONT * 0.02)
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
  // What's known beyond the bare skin (the features) comes back over the
  // fill by the share the fill left out.
  for (let i = 0, p = 0; i < known.length; i++, p += 4) {
    const bare = bareSkin[i]!
    const keep = known[i]!
    if (keep <= bare) continue
    const share = (keep - bare) / (1 - bare)
    for (let c = 0; c < 3; c++) {
      filled.data[p + c] = filled.data[p + c]! + (lit.data[p + c]! - filled.data[p + c]!) * share
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
  return { image: seamlessClone(flat, filled, holes, 1), covered }
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
  { image: photo, covered }: PhotoFace,
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
    weight[i] = w * (1 - over[i]!) * (1 - covered[i]!)
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
  photo: PhotoFace,
  blend: number,
) {
  const { image, weight } = composeFace(front, hair, warp, photo, blend)
  bakeFront(head, skin, { image, depth: front.depth }, weight)
}

/**
 * Where on the front view the forehead's colour is read, under the swapped
 * face's top (× the brows' height over the eyes, above the brows; across
 * BAND_ACROSS of the brows' span), and where the skin above takes it on:
 * none from CARRY_FROM over the brows, wholly from CARRY_TO over the top
 * of the face (see faceRegion), over the face's width (FACE_SIDES × half
 * its width at the eyes) and facing the front (CARRY_FACING).
 */
const BAND: readonly [number, number] = [0.05, 0.45]
const BAND_ACROSS = 0.8
const CARRY_FROM = 0.3
const CARRY_TO = 0.2
const FACE_SIDES: readonly [number, number] = [0.75, 1.15]
const CARRY_FACING: readonly [number, number] = [0.1, 0.5]

/** The forehead's shift in colour is never more than this (a share either way). */
const CARRY_MOST = 0.35

/** Forehead texels read for its shift fewer than this say nothing. */
const LEAST_BAND = 50

/**
 * A bald head's forehead runs on up into its scalp, so the swapped face
 * can't end at the top of its forehead: blended in with the character's
 * skin round it (see composeFace), the photo's own light — a face lit
 * brighter in the middle than at its rim — leaves its forehead a pale
 * patch under a darker band and a scalp of the skin's colour. The skin
 * above the face takes on the face's shift in colour instead (in place, on
 * `head` as swapped, `before` as it was): as much as the swap shifted the
 * forehead's middle (see BAND), fading in up to the top of the face.
 * `target` is the character's face landmarks, `triangles` its head's.
 * Returns that shift (per channel, a factor), or null where too little of
 * the forehead shows to read it.
 */
export function carryFaceTone(
  head: Pixels,
  before: Pixels,
  triangles: readonly HeadTriangle[],
  target: readonly number[],
): Rgb | null {
  const points = unpackPoints(target)
  const brows = FACE_PARTS.brows.map((i) => points[i]!)
  const browTop = Math.min(...brows.map(([, y]) => y))
  const browXs = brows.map(([x]) => x)
  const [browLeft, browRight] = [Math.min(...browXs), Math.max(...browXs)]
  const middle = (browLeft + browRight) / 2
  const eyes = [...FACE_PARTS.leftEye, ...FACE_PARTS.rightEye].map((i) => points[i]!)
  const eyeLevel = eyes.reduce((sum, [, y]) => sum + y, 0) / eyes.length
  const browHeight = Math.max(1e-6, eyeLevel - browTop)
  const outline = FACE_PARTS.oval.map((i) => points[i]!)
  const halfWidth =
    (Math.max(...outline.map(([x]) => x)) - Math.min(...outline.map(([x]) => x))) / 2
  // The top of the swapped face (see faceRegion).
  const top = browTop - browHeight * 0.9
  const at = (tri: HeadTriangle, w0: number, w1: number, w2: number) =>
    [
      tri.x[0]! * w0 + tri.x[1]! * w1 + tri.x[2]! * w2,
      tri.y[0]! * w0 + tri.y[1]! * w1 + tri.y[2]! * w2,
      tri.n[0]! * w0 + tri.n[1]! * w1 + tri.n[2]! * w2,
    ] as const
  const now: Rgb[] = []
  const was: Rgb[] = []
  const reach = ((browRight - browLeft) / 2) * BAND_ACROSS
  forEachTexel(
    head,
    triangles,
    () => true,
    (texel, tri, w0, w1, w2) => {
      const [x, y, n] = at(tri, w0, w1, w2)
      if (n < CARRY_FACING[1] || Math.abs(x - middle) > reach) return
      if (y > browTop - BAND[0] * browHeight || y < browTop - BAND[1] * browHeight) return
      const p = texel * 4
      now.push([head.data[p]!, head.data[p + 1]!, head.data[p + 2]!])
      was.push([before.data[p]!, before.data[p + 1]!, before.data[p + 2]!])
    },
  )
  if (now.length < LEAST_BAND) return null
  const after = byLightness(now, 0.5)
  const own = byLightness(was, 0.5)
  const shift = [0, 1, 2].map((c) =>
    Math.min(1 + CARRY_MOST, Math.max(1 - CARRY_MOST, after[c]! / Math.max(1, own[c]!))),
  ) as Rgb
  forEachTexel(
    head,
    triangles,
    () => true,
    (texel, tri, w0, w1, w2) => {
      const [x, y, n] = at(tri, w0, w1, w2)
      const w =
        smoothstep(browTop - CARRY_FROM * browHeight, top - CARRY_TO * browHeight, y) *
        (1 -
          smoothstep(FACE_SIDES[0] * halfWidth, FACE_SIDES[1] * halfWidth, Math.abs(x - middle))) *
        smoothstep(CARRY_FACING[0], CARRY_FACING[1], n)
      if (w <= 0) return
      const p = texel * 4
      for (let c = 0; c < 3; c++) {
        head.data[p + c] =
          head.data[p + c]! + (before.data[p + c]! * shift[c]! - head.data[p + c]!) * w
      }
    },
  )
  return shift
}
