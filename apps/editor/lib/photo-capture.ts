import type { ImageSegmenter } from '@mediapipe/tasks-vision'
import {
  type CaptureColors,
  type CaptureSlot,
  type CaptureView,
  classPlane,
  type GuideFrame,
  hairColor,
  SEGMENT_CLASSES,
  type SegmentMasks,
  sharpness,
  skinMaps,
  skinModel,
} from '@pascal-app/editor'
import { type DetectedFace, detectFaces, sampleFaceColors } from './face-detect'
import { quietMediaPipe } from './mediapipe-quiet'
import { type PoseSlot, SIDE_YAW, type SlotReading, slotFromReading } from './photo-slot'

/**
 * Reading photos for a photo avatar, all in this browser: each photo
 * scaled to a working size, MediaPipe's face landmarks and head turn on it,
 * the person's outline (MediaPipe's selfie segmenter — the profile of a side
 * view, where no landmarks are found), what each pixel is (its multiclass
 * segmenter: hair, face and body skin, clothes), the face's blendshapes,
 * and where it shows bare skin. Then
 * the skin, eye and hair colours from the front photo. Nothing leaves the
 * browser.
 */

/** Photos are worked on no larger than this a side. */
const WORKING_SIDE = 1024

type Picture = HTMLImageElement | HTMLCanvasElement | ImageBitmap

const sizeOf = (picture: Picture) =>
  'naturalWidth' in picture
    ? { width: picture.naturalWidth, height: picture.naturalHeight }
    : { width: picture.width, height: picture.height }

/** The picture at working size on a canvas, and its pixels. */
function workingCopy(picture: Picture) {
  const { width, height } = sizeOf(picture)
  const scale = Math.min(1, WORKING_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.imageSmoothingQuality = 'high'
  context.drawImage(picture, 0, 0, canvas.width, canvas.height)
  return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height) }
}

const segmenters = new Map<string, Promise<ImageSegmenter>>()

/** A MediaPipe image segmenter for a model under /mediapipe, created once. */
function loadSegmenter(model: string): Promise<ImageSegmenter> {
  const found = segmenters.get(model)
  if (found) return found
  const loading = (async () => {
    quietMediaPipe()
    const { ImageSegmenter } = await import('@mediapipe/tasks-vision')
    const create = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(
        {
          wasmLoaderPath: '/mediapipe/vision_wasm_internal.js',
          wasmBinaryPath: '/mediapipe/vision_wasm_internal.wasm',
        },
        {
          canvas: document.createElement('canvas'),
          baseOptions: { modelAssetPath: `/mediapipe/${model}`, delegate },
          runningMode: 'IMAGE',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        },
      )
    try {
      return await create('GPU')
    } catch {
      return create('CPU')
    }
  })()
  loading.catch(() => {
    if (segmenters.get(model) === loading) segmenters.delete(model)
  })
  segmenters.set(model, loading)
  return loading
}

/** The person against the background. */
const PERSON_MODEL = 'selfie_segmenter.tflite'
/** Background, hair, body skin, face skin, clothes, others (SEGMENT_CLASSES' order). */
const CLASS_MODEL = 'selfie_multiclass_256x256.tflite'

/** A segmenter's confidences (0–1) for each pixel of `canvas`, as bytes: one plane per class it gives. */
async function segmentPlanes(
  canvas: HTMLCanvasElement,
  model: string,
  classes: number,
): Promise<Uint8Array> {
  const size = canvas.width * canvas.height
  const out = new Uint8Array(size * classes)
  const result = (await loadSegmenter(model)).segment(canvas)
  try {
    for (let c = 0; c < classes; c++) {
      const mask = result.confidenceMasks?.[c]
      if (!mask) continue
      const values = mask.getAsFloat32Array()
      for (let i = 0; i < size; i++)
        out[c * size + i] = Math.round(Math.min(1, Math.max(0, values[i]!)) * 255)
    }
    return out
  } finally {
    result.close()
  }
}

type HeadBox = { x: number; y: number; size: number }

/** A square about the head: the face's box when MediaPipe found it, else the top of the person's outline. */
function headBox(
  width: number,
  height: number,
  face: DetectedFace | null,
  person: Uint8Array,
): HeadBox | null {
  let box: HeadBox | null = null
  if (face) {
    const xs = face.points.map((p) => p[0])
    const ys = face.points.map((p) => p[1])
    const size =
      2.2 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    box = {
      x: (Math.max(...xs) + Math.min(...xs)) / 2 - size / 2,
      y: (Math.max(...ys) + Math.min(...ys)) / 2 - size * 0.55,
      size,
    }
  } else {
    let top = height
    let left = width
    let right = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (person[y * width + x]! < 128) continue
        top = Math.min(top, y)
        if (y < top + height * 0.25) {
          left = Math.min(left, x)
          right = Math.max(right, x)
        }
      }
    }
    if (top < height && right > left) {
      const size = Math.max(right - left, height * 0.25) * 1.5
      box = { x: (left + right) / 2 - size / 2, y: top - size * 0.12, size }
    }
  }
  return box && box.size >= 32 ? box : null
}

/**
 * A segmenter's planes, sharp about the head: it sees a small (256-pixel)
 * copy of the picture, so it is run again on a square around the head (the
 * profile, the hairline) and that pasted over the whole picture's planes.
 */
async function segmentAboutHead(
  canvas: HTMLCanvasElement,
  box: HeadBox | null,
  whole: Uint8Array,
  model: string,
  classes: number,
): Promise<Uint8Array> {
  if (!box) return whole
  const { width, height } = canvas
  const side = 512
  const crop = document.createElement('canvas')
  crop.width = crop.height = side
  const context = crop.getContext('2d')!
  context.fillStyle = '#7f7f7f'
  context.fillRect(0, 0, side, side)
  const scale = side / box.size
  context.drawImage(canvas, -box.x * scale, -box.y * scale, width * scale, height * scale)
  const near = await segmentPlanes(crop, model, classes)
  const out = Uint8Array.from(whole)
  const size = width * height
  for (
    let y = Math.max(0, Math.floor(box.y));
    y < Math.min(height, Math.ceil(box.y + box.size));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(box.x));
      x < Math.min(width, Math.ceil(box.x + box.size));
      x++
    ) {
      const cx = Math.min(side - 1, Math.max(0, Math.floor((x - box.x) * scale)))
      const cy = Math.min(side - 1, Math.max(0, Math.floor((y - box.y) * scale)))
      for (let c = 0; c < classes; c++)
        out[c * size + y * width + x] = near[c * side * side + cy * side + cx]!
    }
  }
  return out
}

/** The person's outline, sharp about the head (see `segmentAboutHead`). */
async function personMask(
  canvas: HTMLCanvasElement,
  face: DetectedFace | null,
): Promise<Uint8Array> {
  const whole = await segmentPlanes(canvas, PERSON_MODEL, 1)
  const box = headBox(canvas.width, canvas.height, face, whole)
  return segmentAboutHead(canvas, box, whole, PERSON_MODEL, 1)
}

/** What each pixel is (SEGMENT_CLASSES), sharp about the head. */
async function classMasks(
  canvas: HTMLCanvasElement,
  face: DetectedFace | null,
  person: Uint8Array,
): Promise<SegmentMasks> {
  const classes = SEGMENT_CLASSES.length
  const whole = await segmentPlanes(canvas, CLASS_MODEL, classes)
  const box = headBox(canvas.width, canvas.height, face, person)
  const planes = await segmentAboutHead(canvas, box, whole, CLASS_MODEL, classes)
  return { width: canvas.width, height: canvas.height, planes }
}

const DEGREES = Math.PI / 180

/** How open the mouth is and how closed the eyes are, from the landmarks (0–1). */
function openness(points: DetectedFace['points']) {
  const d = (a: number, b: number) =>
    Math.hypot(points[a]![0] - points[b]![0], points[a]![1] - points[b]![1])
  const mouth = d(13, 14) / Math.max(d(61, 291), 1)
  const eye = (d(159, 145) / Math.max(d(33, 133), 1) + d(386, 374) / Math.max(d(362, 263), 1)) / 2
  return {
    mouthOpen: Math.min(1, mouth / 0.35),
    blink: Math.min(1, Math.max(0, (0.22 - eye) / 0.15)),
  }
}

/** The turn each capture slot asks for (degrees, > 0 to the subject's left). */
export const SLOT_YAW: Record<Exclude<CaptureSlot, 'free'>, number> = {
  front: 0,
  left45: 45,
  right45: -45,
  left90: 90,
  right90: -90,
}

export type ReadPhoto = {
  view: CaptureView
  face: DetectedFace | null
  faces: number
  /** The photo at working size, for the colours and a card picture. */
  canvas: HTMLCanvasElement
}

/** One photo read: its pixels, landmarks and turn, and the person's outline (skin comes after). */
export async function readPhoto(picture: Picture, slot: CaptureSlot): Promise<ReadPhoto> {
  const { canvas, pixels } = workingCopy(picture)
  const { largest: face, count } = await detectFaces(canvas)
  const asked = slot === 'free' ? 0 : SLOT_YAW[slot]
  // A side view: MediaPipe may still find a face, but past about 55° its points are guesses
  // (a "side" photo turned less than that is read as a turned one).
  const side = Math.abs(asked) === 90 && !(face && Math.abs(face.yaw) < 55)
  const landmarks = face && !side ? Float32Array.from(face.points.flat()) : null
  const mask = await personMask(canvas, face && !side ? face : null)
  const classes = await classMasks(canvas, face && !side ? face : null, mask)
  const measured = face && !side ? face.yaw : asked
  const view: CaptureView = {
    slot,
    width: canvas.width,
    height: canvas.height,
    rgba: pixels.data,
    landmarks,
    mask,
    skin: null,
    covered: null,
    classes,
    blendshapes: face && !side ? (face.blendshapes ?? null) : null,
    yaw: measured * DEGREES,
    pitch: face && !side ? face.pitch * DEGREES : undefined,
    roll: face && !side ? face.roll * DEGREES : undefined,
    guessedYaw: !landmarks,
    ...(face && !side ? openness(face.points) : {}),
  }
  return { view, face, faces: count, canvas }
}

/**
 * Which pose an uploaded photo shows (see photo-slot.ts): MediaPipe's turn,
 * or for a side view the segmenter's face skin and hair across the head;
 * null when the photo can't tell. Also how many faces it holds.
 */
export async function photoSlot(
  picture: Picture,
): Promise<{ slot: PoseSlot | null; yaw: number | null; faces: number }> {
  const { canvas } = workingCopy(picture)
  const { largest: face, count } = await detectFaces(canvas)
  const yaw = face?.yaw ?? null
  const reading: SlotReading = {
    yaw,
    faceSkinX: null,
    hairX: null,
    headX: null,
    neckX: null,
    headWidth: canvas.width,
  }
  if (yaw === null || Math.abs(yaw) >= SIDE_YAW) {
    const person = await personMask(canvas, null)
    const box = headBox(canvas.width, canvas.height, null, person)
    if (box) {
      const classes = await classMasks(canvas, null, person)
      Object.assign(reading, sideReading(canvas.width, canvas.height, box, person, classes))
      // A side view's guessed turn says less than its outline.
      reading.yaw = null
    }
  }
  return { slot: slotFromReading(reading), yaw, faces: count }
}

/** The middles (x) of a side view's face skin, hair, head outline and neck, in its head's box. */
function sideReading(
  width: number,
  height: number,
  box: HeadBox,
  person: Uint8Array,
  classes: SegmentMasks,
): Omit<SlotReading, 'yaw'> {
  const faceSkin = classPlane(classes, 'faceSkin')
  const hair = classPlane(classes, 'hair')
  const sums = { face: [0, 0], hair: [0, 0], head: [0, 0], neck: [0, 0] }
  const add = (sum: number[], x: number) => {
    sum[0]! += x
    sum[1]! += 1
  }
  // The head fills about the box's top two thirds; the neck is the band under it.
  const headBottom = box.y + box.size * 0.62
  const neckBottom = box.y + box.size * 0.8
  for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(height, neckBottom); y++) {
    for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(width, box.x + box.size); x++) {
      const i = y * width + x
      if (person[i]! < 128) continue
      if (y < headBottom) {
        add(sums.head, x)
        if (faceSkin[i]! > 127) add(sums.face, x)
        if (hair[i]! > 127) add(sums.hair, x)
      } else add(sums.neck, x)
    }
  }
  // A few stray pixels are not a face or hair to judge by.
  const least = box.size * box.size * 0.01
  const middle = ([sum, count]: number[]) => (count! > least ? sum! / count! : null)
  let left = width
  let right = 0
  for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(height, headBottom); y++) {
    for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(width, box.x + box.size); x++) {
      if (person[y * width + x]! < 128) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
  }
  return {
    faceSkinX: middle(sums.face),
    hairX: middle(sums.hair),
    headX: middle(sums.head),
    neckX: middle(sums.neck),
    headWidth: Math.max(1, right - left),
  }
}

const hex = (rgb: readonly number[]) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

const toSrgbByte = (linear: number) => {
  const c = Math.min(1, Math.max(0, linear))
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
}
const toLinear = (byte: number) => {
  const c = byte / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * Marks where every photo shows bare skin (by the front photo's cheeks) and
 * reads the colours the avatar's textures take: skin and eyes as the face
 * swap reads them, the hair from above the forehead in the same exposure.
 */
export function finishPhotos(photos: ReadPhoto[]): CaptureColors | null {
  const front =
    photos.find((photo) => photo.view.slot === 'front' && photo.face) ??
    photos.find((photo) => photo.face)
  if (!front?.face) return null
  const { view } = front
  const model = skinModel(
    view.rgba,
    view.width,
    view.height,
    view.landmarks ?? front.face.points.flat(),
  )
  for (const photo of photos) {
    const maps = model
      ? skinMaps(photo.view.rgba, photo.view.width, photo.view.height, model, photo.view.mask)
      : null
    photo.view.skin = maps?.skin ?? null
    photo.view.covered = maps?.covered ?? null
  }
  const pixels = { data: view.rgba as Uint8ClampedArray, width: view.width, height: view.height }
  const colors = sampleFaceColors(pixels, front.face.points)
  let hair: string | null = null
  if (model && view.skin) {
    const found = hairColor(
      view.rgba,
      view.width,
      view.height,
      front.face.points.flat(),
      view.mask,
      view.skin,
    )
    if (found) {
      // The photo's exposure, as the skin's: the hair keeps its ratio to the skin.
      const photoSkin = [model.luma, model.luma, model.luma].map((y) => toLinear(y))
      const target = [1, 3, 5].map((i) =>
        toLinear(Number.parseInt(colors.skin.slice(i, i + 2), 16)),
      )
      const lightTarget = 0.2126 * target[0]! + 0.7152 * target[1]! + 0.0722 * target[2]!
      const gain = lightTarget / Math.max(photoSkin[0]!, 1e-4)
      hair = hex(found.map((c) => toSrgbByte(c * gain)))
    }
  }
  return { skin: colors.skin, eyes: colors.eyes, hair }
}

/** The camera's frames are read this wide for the guide: enough to find a face, quick to. */
const GUIDE_WIDTH = 480
let guideCanvas: HTMLCanvasElement | null = null

/**
 * One camera frame read for the capture guide: the face's turn and size,
 * how sharp it is and, for a side view (where MediaPipe loses the face),
 * whether the person fills the frame and where their outline's centre is.
 */
export async function readGuideFrame(
  frame: HTMLCanvasElement,
  time: number,
  side: boolean,
): Promise<GuideFrame> {
  const scale = GUIDE_WIDTH / frame.width
  guideCanvas ??= document.createElement('canvas')
  const canvas = guideCanvas
  canvas.width = GUIDE_WIDTH
  canvas.height = Math.round(frame.height * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(frame, 0, 0, canvas.width, canvas.height)
  const { width, height } = canvas
  const { largest: face, count: faces } = await detectFaces(canvas)
  let box: [number, number, number, number] | null = null
  let centre: [number, number] | null = null
  let person = false
  if (face) {
    const xs = face.points.map((p) => p[0])
    const ys = face.points.map((p) => p[1])
    box = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ]
    centre = [(box[0] + box[2] / 2) / width, (box[1] + box[3] / 2) / height]
    person = true
  }
  if (side) {
    // The head from the person's outline: the top of it, as wide as it is there.
    const mask = await segmentPlanes(canvas, PERSON_MODEL, 1)
    let count = 0
    let sx = 0
    let sy = 0
    let top = height
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]! < 128) continue
        count++
        sx += x
        sy += y
        if (y < top) top = y
      }
    }
    person = count > width * height * 0.06
    if (person) {
      centre = [sx / count / width, sy / count / height]
      if (!box) {
        const size = height * 0.28
        box = [sx / count - size / 2, top, size, size]
      }
    }
  }
  let sharp = 0
  let light: FaceLight = { exposure: null, balance: null }
  if (box) {
    const pixels = context.getImageData(0, 0, width, height).data
    const gray = new Float32Array(width * height)
    for (let i = 0; i < gray.length; i++) {
      gray[i] = 0.299 * pixels[i * 4]! + 0.587 * pixels[i * 4 + 1]! + 0.114 * pixels[i * 4 + 2]!
    }
    sharp = sharpness(gray, width, box)
    if (face) light = faceLight(gray, width, height, face.points)
  }
  const eyes = face
    ? Math.hypot(
        face.points[468]![0] - face.points[473]![0],
        face.points[468]![1] - face.points[473]![1],
      ) / width
    : null
  const shape = (...names: string[]) =>
    face?.blendshapes ? Math.max(...names.map((name) => face.blendshapes?.[name] ?? 0)) : null
  return {
    time,
    yaw: face?.yaw ?? null,
    pitch: face?.pitch ?? null,
    roll: face?.roll ?? null,
    eyes,
    person,
    centre,
    sharpness: sharp,
    faces,
    ...light,
    blink: shape('eyeBlinkLeft', 'eyeBlinkRight'),
    jawOpen: shape('jawOpen'),
    smile: shape('mouthSmileLeft', 'mouthSmileRight'),
  }
}

/** How lit a face is (its mean luma, 0–255) and how evenly (the darker cheek's luma over the lighter one's). */
export type FaceLight = { exposure: number | null; balance: number | null }

/** How lit and how evenly a read photo's face is (see `faceLight`); nulls without a face. */
export function photoLight(photo: ReadPhoto): FaceLight {
  const { face, view } = photo
  if (!face) return { exposure: null, balance: null }
  const gray = new Float32Array(view.width * view.height)
  for (let i = 0; i < gray.length; i++) {
    gray[i] =
      0.299 * view.rgba[i * 4]! + 0.587 * view.rgba[i * 4 + 1]! + 0.114 * view.rgba[i * 4 + 2]!
  }
  return faceLight(gray, view.width, view.height, face.points)
}

/** The landmarks at the middle of each cheek. */
const CHEEKS = [50, 280] as const

/**
 * How lit a face is (the mean luma inside its landmarks' box, trimmed to the
 * middle half) and how evenly (the darker cheek's mean luma over the lighter
 * one's, each over a disc a fifth of the eyes' distance across).
 */
function faceLight(
  gray: Float32Array,
  width: number,
  height: number,
  points: DetectedFace['points'],
): FaceLight {
  const mean = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    inside: (x: number, y: number) => boolean,
  ) => {
    let sum = 0
    let count = 0
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
        if (!inside(x, y)) continue
        sum += gray[y * width + x]!
        count++
      }
    }
    return count ? sum / count : null
  }
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const [left, right, top, bottom] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ]
  const [w, h] = [right - left, bottom - top]
  const exposure = mean(left + w / 4, top + h / 4, right - w / 4, bottom - h / 4, () => true)
  const eyes = Math.hypot(points[468]![0] - points[473]![0], points[468]![1] - points[473]![1])
  const radius = Math.max(2, eyes / 5)
  const cheek = (index: number) => {
    const [cx, cy] = points[index]!
    return mean(
      cx - radius,
      cy - radius,
      cx + radius,
      cy + radius,
      (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius,
    )
  }
  const [a, b] = CHEEKS.map(cheek)
  const balance = a && b ? Math.min(a, b) / Math.max(a, b) : null
  return { exposure, balance }
}

/** The card picture of a photo avatar: the front photo about the face, as tall as the cards (128 × 208). */
export async function cardPicture(photo: ReadPhoto): Promise<Blob> {
  const { canvas, face } = photo
  const out = document.createElement('canvas')
  out.width = 256
  out.height = 416
  const context = out.getContext('2d')!
  context.fillStyle = '#1c1c1f'
  context.fillRect(0, 0, out.width, out.height)
  let x = 0
  let y = 0
  let w = canvas.width
  if (face) {
    const xs = face.points.map((p) => p[0])
    const ys = face.points.map((p) => p[1])
    const faceWidth = Math.max(...xs) - Math.min(...xs)
    w = faceWidth * 2.1
    x = (Math.max(...xs) + Math.min(...xs)) / 2 - w / 2
    // The face in the card's upper half, the shoulders below.
    y = Math.min(...ys) - ((w * 208) / 128) * 0.22
  }
  const h = (w * 208) / 128
  context.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height)
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => out.toBlob(resolve, type, 0.85))
  const blob = (await encode('image/webp')) ?? (await encode('image/jpeg'))
  if (!blob) throw new Error('card picture')
  return blob
}
