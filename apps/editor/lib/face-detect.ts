import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import { FACE_PARTS, FACE_POINT_INDICES, type FacePoint, packPoints } from '@pascal-app/editor'

/**
 * Finding a face in a player's photo with MediaPipe's Face Landmarker (its
 * 478 landmarks and head pose), cropping the photo around it, and reading its
 * skin and iris colours. MediaPipe (a 150 kB script, a 12 MB runtime and a
 * 4 MB model, the last two served from /mediapipe) is only fetched once a
 * player adds a photo.
 */

type FaceImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap

/** An RGBA image: `ImageData` or anything shaped like it. */
type RgbaPixels = { data: Uint8ClampedArray; width: number; height: number }

type Rgb = [number, number, number]

export type CropBox = { x: number; y: number; size: number }

export type DetectedFace = {
  /** All 478 landmarks, in pixels of the image. */
  points: FacePoint[]
  /** Degrees; see `poseFromMatrix`. */
  yaw: number
  pitch: number
  roll: number
}

let landmarker: Promise<FaceLandmarker> | null = null

/**
 * The Face Landmarker, created once. A failed load is forgotten so the next
 * call retries, and so is a landmarker whose WebGL context is lost (a phone
 * reclaiming its GPU, or the browser its oldest context): MediaPipe then
 * finds no face in anything, without an error.
 */
export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (landmarker) return landmarker
  const loading: Promise<FaceLandmarker> = createFaceLandmarker(() => {
    if (landmarker !== loading) return
    landmarker = null
    loading.then((lost) => lost.close()).catch(() => {})
  }).catch((error: unknown) => {
    if (landmarker === loading) landmarker = null
    throw error
  })
  landmarker = loading
  return loading
}

async function createFaceLandmarker(onContextLost: () => void) {
  const { FaceLandmarker } = await import('@mediapipe/tasks-vision')
  const create = async (delegate: 'GPU' | 'CPU') => {
    // MediaPipe's WebGL canvas (its own fallback kind, which every browser can run WebGL on),
    // made here so its context's loss can be heard.
    const canvas = document.createElement('canvas')
    const created = await FaceLandmarker.createFromOptions(
      {
        wasmLoaderPath: '/mediapipe/vision_wasm_internal.js',
        wasmBinaryPath: '/mediapipe/vision_wasm_internal.wasm',
      },
      {
        canvas,
        baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate },
        runningMode: 'IMAGE',
        numFaces: 4,
        outputFacialTransformationMatrixes: true,
      },
    )
    canvas.addEventListener('webglcontextlost', onContextLost, { once: true })
    return created
  }
  try {
    return await create('GPU')
  } catch {
    // The GPU delegate needs MediaPipe's GL service, which not every browser and driver can
    // start; the CPU runs the same model. (Either way MediaPipe reads the photo through WebGL.)
    return create('CPU')
  }
}

const imageSize = (image: FaceImage) =>
  'naturalWidth' in image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height }

/** The largest face in the image (a group photo's nearest), or null when there is none. */
export async function detectFace(image: FaceImage): Promise<DetectedFace | null> {
  const found = (await loadFaceLandmarker()).detect(image)
  const { width, height } = imageSize(image)
  let largest: DetectedFace | null = null
  let largestArea = 0
  for (const [i, landmarks] of found.faceLandmarks.entries()) {
    const points = landmarks.map(({ x, y }): FacePoint => [x * width, y * height])
    const { left, top, right, bottom } = bounds(points)
    const area = (right - left) * (bottom - top)
    if (area <= largestArea) continue
    largestArea = area
    const matrix = found.facialTransformationMatrixes[i]
    largest = { points, ...(matrix ? poseFromMatrix(matrix.data) : { yaw: 0, pitch: 0, roll: 0 }) }
  }
  return largest
}

type Vector = [number, number, number]

const normalise = ([x, y, z]: Vector): Vector => {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * A face's turn from MediaPipe's facial transformation matrix: 4×4,
 * column-major, carrying the canonical face (x to the subject's left, y up,
 * z out of the face) into the space of a virtual camera (x to the image's
 * right, y up, z towards the camera, the face in front of it). Its columns
 * are the face's axes (normalised: the fit scales them too) and position.
 *
 * The turn is measured against the line from the face to the camera, not
 * the camera's axis: a face looking into the lens from the top of a
 * half-length portrait is head-on, though the camera sees it from below.
 * Roll comes first, as the lean of the whole head in the photo, then the nod
 * and the turn about the head's own axes, so a photo on its side reads as a
 * 90° roll and nothing else. In degrees:
 * - yaw > 0: the subject has turned to their left (the image's right, when upright);
 * - pitch > 0: the subject's chin is up;
 * - roll > 0: the head leans to the subject's right shoulder (anticlockwise in the photo).
 */
export function poseFromMatrix(data: readonly number[]) {
  const column = (c: number) => normalise([data[c * 4]!, data[c * 4 + 1]!, data[c * 4 + 2]!])
  // A face can only be seen in front of the camera; any other position is no line of sight.
  const sight: Vector = data[14]! < 0 ? normalise([-data[12]!, -data[13]!, -data[14]!]) : [0, 0, 1]
  const across = normalise([sight[2], 0, -sight[0]])
  const upright: Vector = [
    sight[1] * across[2],
    sight[2] * across[0] - sight[0] * across[2],
    -sight[1] * across[0],
  ]
  const seen = (axis: Vector): Vector => [dot(axis, across), dot(axis, upright), dot(axis, sight)]
  const right = seen(column(0))
  const up = seen(column(1))
  const forward = seen(column(2))
  const degrees = 180 / Math.PI
  return {
    yaw: Math.atan2(-right[2], forward[2]) * degrees,
    pitch: -Math.asin(Math.min(1, Math.max(-1, up[2]))) * degrees,
    roll: Math.atan2(-up[0], up[1]) * degrees,
  }
}

function bounds(points: readonly FacePoint[]) {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    if (x < left) left = x
    if (x > right) right = x
    if (y < top) top = y
    if (y > bottom) bottom = y
  }
  return { left, top, right, bottom }
}

/** Places a span of `size` along an image `extent` long: inside it when it fits, else covering it. */
const slide = (start: number, size: number, extent: number) =>
  Math.min(Math.max(start, Math.min(0, extent - size)), Math.max(0, extent - size))

/**
 * The square a face is cropped to, in pixels: 1.7× the landmarks' larger
 * side (room for the margin a face swap blends across), centred on them and
 * raised by 8 % of their height, as the landmarks stop short of the
 * forehead's top. It slides into the image where it fits, so a face near an
 * edge keeps real pixels around it; only a face filling the photo leaves
 * the square overhanging it (the crop repeats the edge pixels there).
 */
export function cropBox(points: readonly FacePoint[], width: number, height: number): CropBox {
  const { left, top, right, bottom } = bounds(points)
  const size = 1.7 * Math.max(right - left, bottom - top)
  const centreX = (left + right) / 2
  const centreY = (top + bottom) / 2 - 0.08 * (bottom - top)
  return {
    x: slide(centreX - size / 2, size, width),
    y: slide(centreY - size / 2, size, height),
    size,
  }
}

/** The face points (the swap's subset of the 478) as packed fractions of the crop. */
export function facePointsIn(points478: readonly FacePoint[], box: CropBox): number[] {
  return packPoints(
    FACE_POINT_INDICES.map((index) => {
      const [x, y] = points478[index]!
      return [(x - box.x) / box.size, (y - box.y) / box.size] as FacePoint
    }),
  )
}

/**
 * The face's crop as a JPEG (no more than `longest` pixels a side) with its
 * face points. Where the square overhangs the photo, the photo's edge rows
 * and columns are stretched across it, so the swap's margin never meets a
 * blank.
 */
export function cropFacePhoto(
  image: FaceImage,
  face: DetectedFace,
  longest = 512,
): { photo: string; points: number[] } {
  const { width, height } = imageSize(image)
  const box = cropBox(face.points, width, height)
  const side = Math.max(1, Math.round(Math.min(longest, box.size)))
  const scale = side / box.size
  // Along each axis: the overhang before the photo, the overhang after it, then the photo. The
  // overhangs reach a pixel into the photo, which is drawn over them: an overhang less than a
  // pixel wide is drawn anti-aliased, and where it met the photo's edge the pixel stayed partly
  // transparent, a dark line in the JPEG.
  const spans = (start: number, length: number) => {
    const at = start * scale
    const end = (start + length) * scale
    return [
      { from: 0, extent: 1, at: 0, size: at + 1, shown: at > 0 },
      { from: length - 1, extent: 1, at: end - 1, size: side - end + 1, shown: end < side },
      { from: 0, extent: length, at, size: length * scale, shown: true },
    ]
  }
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')!
  context.imageSmoothingQuality = 'high'
  for (const column of spans(-box.x, width)) {
    if (!column.shown) continue
    for (const row of spans(-box.y, height)) {
      if (!row.shown) continue
      context.drawImage(
        image,
        column.from,
        row.from,
        column.extent,
        row.extent,
        column.at,
        row.at,
        column.size,
        row.size,
      )
    }
  }
  return {
    photo: canvas.toDataURL('image/jpeg', 0.9),
    points: facePointsIn(face.points, box),
  }
}

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

/**
 * Calls `visit` with the data offset of every pixel whose centre lies
 * between `inner` and `outer` from `centre` and, when given, inside the
 * polygon `within` (even–odd). Past the image's edge its edge pixels stand
 * in (as they do in the crop).
 */
function forEachPixelInRing(
  pixels: RgbaPixels,
  [cx, cy]: FacePoint,
  inner: number,
  outer: number,
  visit: (offset: number) => void,
  within?: readonly FacePoint[],
) {
  const { width, height } = pixels
  const innerSq = inner * inner
  const outerSq = outer * outer
  // Where each row's centre line crosses `within`'s edges, left to right: a pixel is inside
  // when an odd number of them lie to its right. Rows are walked only between their first and
  // last crossing, and an eye's opening crosses few of the rows round its iris.
  const crossings: number[] = []
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
    const centreY = y + 0.5
    const dy = centreY - cy
    let left = Math.floor(cx - outer)
    let right = Math.ceil(cx + outer)
    if (within) {
      crossingsOf(within, centreY, crossings)
      if (!crossings.length) continue
      left = Math.max(left, Math.floor(crossings[0]!))
      right = Math.min(right, Math.ceil(crossings[crossings.length - 1]!))
    }
    const row = Math.min(height - 1, Math.max(0, y)) * width
    let passed = 0
    for (let x = left; x <= right; x++) {
      const centreX = x + 0.5
      const dx = centreX - cx
      const distanceSq = dx * dx + dy * dy
      if (distanceSq < innerSq || distanceSq > outerSq) continue
      if (within) {
        while (passed < crossings.length && crossings[passed]! <= centreX) passed++
        if ((crossings.length - passed) % 2 === 0) continue
      }
      visit((row + Math.min(width - 1, Math.max(0, x))) * 4)
    }
  }
}

/** Where a polygon's edges cross the horizontal line at `y`, sorted, into `out`. */
function crossingsOf(polygon: readonly FacePoint[], y: number, out: number[]) {
  out.length = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > y === yj > y) continue
    const x = xi + ((xj - xi) * (y - yi)) / (yj - yi)
    if (!Number.isNaN(x)) out.push(x)
  }
  out.sort((a, b) => a - b)
}

/** More samples than a disk or ring round a face ever holds (2^26): the index part of a sort key. */
const INDEX_SPAN = 67_108_864

/**
 * The mean colour of the pixels at `offsets`, less the darkest `dropDark`
 * and the lightest `dropLight` of them (fractions, by luminance).
 */
function meanByLightness(
  data: Uint8ClampedArray,
  offsets: readonly number[],
  dropDark: number,
  dropLight: number,
): Rgb {
  // Each pixel's lightness (to 1/65536) and index packed in one double, exactly: sorting those
  // natively is several times quicker than sorting indices with a comparator.
  const keys = new Float64Array(offsets.length)
  offsets.forEach((p, i) => {
    keys[i] = Math.round(luminance(data[p]!, data[p + 1]!, data[p + 2]!) * 65536) * INDEX_SPAN + i
  })
  keys.sort()
  const start = Math.floor(keys.length * dropDark)
  const end = keys.length - Math.floor(keys.length * dropLight)
  let r = 0
  let g = 0
  let b = 0
  for (let k = start; k < end; k++) {
    const p = offsets[keys[k]! % INDEX_SPAN]!
    r += data[p]!
    g += data[p + 1]!
    b += data[p + 2]!
  }
  const kept = Math.max(1, end - start)
  return [r / kept, g / kept, b / kept]
}

const distance = (a: FacePoint, b: FacePoint) => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * MediaPipe's landmarks for each eye (the subject's right, then left): the
 * iris's centre then four points on its rim, and the opening between the
 * lids (along the lower lid's edge, then back along the upper's).
 */
const EYES = [
  {
    iris: [468, 469, 470, 471, 472],
    opening: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  },
  {
    iris: [473, 474, 475, 476, 477],
    opening: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  },
] as const

/** Irises smaller than this (px) are too few pixels, and too blurred, to read. */
const MIN_IRIS_RADIUS = 3

/** How light the whites of the eyes are on the characters' textures' scale (their skins' lightness runs 50–150). */
const WHITE_LIGHTNESS = 165
/**
 * In the same light the whites of the eyes are at least this much lighter
 * than any skin, even the palest; whites that read darker were in shadow.
 */
const MIN_WHITE_CONTRAST = 1.1
/** Without the whites to go by, how much lighter a photo's skin reads than a texture's. */
const PHOTO_EXPOSURE = 0.72
/**
 * How far the whites may lift a lightness above what the usual exposure
 * gives (a factor): whites that dark are as likely in shade as in a dark
 * photo.
 */
const WHITE_TRUST = 1.8

/**
 * A lightness in a photo on the textures' scale: relative to the whites of
 * the eyes (`white`, when they show clearly lighter than `lightness`: that
 * takes out the photo's exposure), within reach of what the usual exposure
 * gives.
 */
function textureLightness(lightness: number, white: Rgb | null) {
  const usual = lightness * PHOTO_EXPOSURE
  const whiteLightness = white ? luminance(...white) : 0
  if (whiteLightness < MIN_WHITE_CONTRAST * lightness) return usual
  const measured = (lightness / whiteLightness) * WHITE_LIGHTNESS
  return Math.min(usual * WHITE_TRUST, measured)
}

/**
 * A skin colour from a photo as a character's texture holds it: its
 * lightness on the textures' scale (see `textureLightness`), and its tint —
 * which bright, flat photos wash out, and which a texture's skin always has
 * — kept in direction but made at least as strong as the palest texture's.
 */
export function skinAlbedo(skin: Rgb, white: Rgb | null): Rgb {
  const lightness = luminance(...skin)
  if (lightness <= 0) return [40, 28, 22]
  const target = Math.min(155, Math.max(40, textureLightness(lightness, white)))
  // The tint: red over green, green over blue, per unit of lightness.
  let redness = (skin[0] - skin[1]) / lightness
  let yellowness = (skin[1] - skin[2]) / lightness
  const strength = Math.hypot(redness, yellowness)
  const wanted = Math.min(0.6, Math.max(0.3, strength * 1.4))
  if (strength < 0.02) {
    redness = 0.8 * wanted
    yellowness = 0.6 * wanted
  } else {
    redness *= wanted / strength
    yellowness *= wanted / strength
  }
  return withTint(target, redness, yellowness)
}

/** The colour of a lightness and a tint (red over green, green over blue, per unit of lightness). */
function withTint(lightness: number, redness: number, yellowness: number): Rgb {
  const green = lightness * (1 - 0.2126 * redness + 0.0722 * yellowness)
  return [green + redness * lightness, green, green - yellowness * lightness]
}

/** How much of a photographed iris's tint is its own; the rest is light off the lids and skin. */
const IRIS_TINT = 0.75

/**
 * An iris colour from a photo as a character's eye texture holds it: its
 * lightness on the textures' scale (see `textureLightness`), its tint
 * softened.
 */
export function irisAlbedo(iris: Rgb, white: Rgb | null): Rgb {
  const lightness = luminance(...iris)
  if (lightness <= 0) return [16, 12, 10]
  const target = Math.min(140, Math.max(12, textureLightness(lightness, white)))
  return withTint(
    target,
    ((iris[0] - iris[1]) / lightness) * IRIS_TINT,
    ((iris[1] - iris[2]) / lightness) * IRIS_TINT,
  )
}

/**
 * More saturated than this ((max − min) / max) is not the white of an eye
 * but lid, lash shadow or iris, which is all a smile's or squint's narrowed
 * eyes may show.
 */
const MAX_WHITE_SATURATION = 0.25
/**
 * Less of the whites than this (as a share of the irises' area) is only the
 * shadowed sliver a squint leaves, no measure of the photo's light.
 */
const MIN_WHITE_SHOWING = 0.25

/** The lightest share of the whites' pixels, left out: glints of the light, not the whites' own shade. */
const WHITE_GLINTS = 0.1

/**
 * The whites of the eyes (the mean of the lighter half, less its glints, of the near-grey
 * pixels between the lids around each iris), or null when too little of
 * them shows.
 */
function scleraColor(pixels: RgbaPixels, points478: readonly FacePoint[]): Rgb | null {
  const { data } = pixels
  const offsets: number[] = []
  let irisArea = 0
  for (const { iris, opening } of EYES) {
    const [centreIndex, ...rimIndices] = iris
    const centre = points478[centreIndex]!
    const radius =
      rimIndices.reduce((sum, i) => sum + distance(centre, points478[i]!), 0) / rimIndices.length
    if (!(radius >= MIN_IRIS_RADIUS)) continue
    irisArea += Math.PI * radius * radius
    const lids = opening.map((i) => points478[i]!)
    forEachPixelInRing(
      pixels,
      centre,
      1.2 * radius,
      3 * radius,
      (p) => {
        const brightest = Math.max(data[p]!, data[p + 1]!, data[p + 2]!)
        const darkest = Math.min(data[p]!, data[p + 1]!, data[p + 2]!)
        if (brightest - darkest <= MAX_WHITE_SATURATION * brightest) offsets.push(p)
      },
      lids,
    )
  }
  if (!irisArea || offsets.length < MIN_WHITE_SHOWING * irisArea) return null
  return meanByLightness(data, offsets, 0.5, WHITE_GLINTS)
}

/**
 * The skin's colour (hex) as a character's texture would hold it (see
 * `skinAlbedo`): read from small disks on the cheeks, clear of the eyes,
 * nose and mouth, less their darkest and brightest fifth (stubble,
 * freckles, shadow, shine).
 */
export function sampleSkinColor(pixels: RgbaPixels, points478: readonly FacePoint[]): string {
  const eyes = distance(points478[EYES[0].iris[0]]!, points478[EYES[1].iris[0]]!)
  const radius = Math.max(1, 0.025 * eyes)
  const offsets: number[] = []
  for (const i of FACE_PARTS.cheeks) {
    forEachPixelInRing(pixels, points478[FACE_POINT_INDICES[i]!]!, 0, radius, (offset) =>
      offsets.push(offset),
    )
  }
  const skin = meanByLightness(pixels.data, offsets, 0.2, 0.2)
  return hex(...skinAlbedo(skin, scleraColor(pixels, points478)))
}

/** Darker than this is the pupil, lashes or the lid's shadow, not the iris's colour. */
const NEAR_BLACK = 20

/**
 * The irises' colour (hex): a ring between 35 % and 85 % of each iris's
 * radius (clear of the pupil and of the white around it), only where it
 * shows between the lids (a smile or a squint hides much of it), less its
 * catch lights and near-black pixels; then each channel's median over both
 * eyes, which shrugs off a lash across the ring. Null when the irises are
 * too small, or too hidden, to read.
 */
export function sampleIrisColor(
  pixels: RgbaPixels,
  points478: readonly FacePoint[],
): string | null {
  const { data } = pixels
  const lightnessAt = (p: number) => luminance(data[p]!, data[p + 1]!, data[p + 2]!)
  const reds = new Uint32Array(256)
  const greens = new Uint32Array(256)
  const blues = new Uint32Array(256)
  let total = 0
  for (const { iris, opening } of EYES) {
    const [centreIndex, ...rimIndices] = iris
    const centre = points478[centreIndex]!
    const radius =
      rimIndices.reduce((sum, i) => sum + distance(centre, points478[i]!), 0) / rimIndices.length
    if (!(radius >= MIN_IRIS_RADIUS)) continue
    const lids = opening.map((i) => points478[i]!)
    const forEachVisible = (visit: (offset: number) => void) =>
      forEachPixelInRing(pixels, centre, 0.35 * radius, 0.85 * radius, visit, lids)
    let brightest = 0
    forEachVisible((p) => {
      brightest = Math.max(brightest, lightnessAt(p))
    })
    forEachVisible((p) => {
      const lightness = lightnessAt(p)
      if (lightness > 0.9 * brightest || lightness < NEAR_BLACK) return
      reds[data[p]!]! += 1
      greens[data[p + 1]!]! += 1
      blues[data[p + 2]!]! += 1
      total++
    })
  }
  if (!total) return null
  const median = (histogram: Uint32Array) => {
    let seen = 0
    for (let value = 0; value < 256; value++) {
      seen += histogram[value]!
      if (seen * 2 > total) return value
    }
    return 255
  }
  return hex(median(reds), median(greens), median(blues))
}

const rgbOf = (hex: string): Rgb =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb

/**
 * The skin's and irises' colours (hex) as a character's textures would
 * hold them (see `skinAlbedo` and `irisAlbedo`); `eyes` is null when the
 * irises can't be read.
 */
export function sampleFaceColors(
  pixels: RgbaPixels,
  points478: readonly FacePoint[],
): { skin: string; eyes: string | null } {
  const iris = sampleIrisColor(pixels, points478)
  return {
    skin: sampleSkinColor(pixels, points478),
    eyes: iris && hex(...irisAlbedo(rgbOf(iris), scleraColor(pixels, points478))),
  }
}

/** A hint when the photo's face is turned or tilted too far for a clean swap, else null. */
export function poseMessage(face: DetectedFace): string | null {
  if (Math.abs(face.yaw) > 15)
    return '얼굴이 옆으로 돌아가 있어요. 정면을 바라본 사진이 가장 자연스러워요'
  if (Math.abs(face.pitch) > 15)
    return '고개가 위나 아래로 기울어 있어요. 정면을 바라본 사진이 가장 자연스러워요'
  if (Math.abs(face.roll) > 20) return '고개가 기울어 있어요. 똑바로 선 사진이 가장 자연스러워요'
  return null
}
