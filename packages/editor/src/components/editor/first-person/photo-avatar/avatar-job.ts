import { type AvatarImages, type BaseBody, baseMeshMoves, buildAvatarGlb } from './base-body'
import type { Camera } from './camera'
import { toneGains } from './fill'
import { type FitOptions, type FitResult, type FitView, fitHead, PUPIL_DISTANCE } from './fit'
import { editMaterials } from './glb'
import type { FaceBlendshapes, SegmentMasks } from './segment'
import { fillTriangles } from './silhouette'
import { SKIN_MATERIAL_EDITS, skinTextures } from './skin-texture'
import { linearToSrgb, median, srgbToLinear } from './texture'

/**
 * A photo avatar made, start to finish, from photos already read (each
 * photo's pixels, MediaPipe's landmarks and the person's mask, found on the
 * page) and a base body: the head fitted to every photo at once, its skin
 * laid from them, and the base body's file rewritten with both. Pictures
 * are decoded and encoded by `codec` (the browser's in a worker; a stand-in
 * in tests).
 */

/** Where a photo was taken from, as the capture asked for it. */
export type CaptureSlot = 'front' | 'left45' | 'right45' | 'left90' | 'right90' | 'free'

export type CaptureView = Omit<FitView, 'mask' | 'skin' | 'covered'> & {
  slot: CaptureSlot
  /** RGBA bytes (sRGB), width × height. */
  rgba: Uint8ClampedArray | Uint8Array
  mask: Uint8Array | null
  skin: Uint8Array | null
  covered: Uint8Array | null
  /** The multiclass segmenter's per-class confidences at the view's size, or null. */
  classes: SegmentMasks | null
  /** The face's blendshapes where MediaPipe found a face, else null. */
  blendshapes: FaceBlendshapes | null
}

/** Colours as a character's textures hold them (sRGB hex), read from the front photo. */
export type CaptureColors = { skin: string; eyes: string | null; hair: string | null }

export type PictureCodec = {
  decode: (
    bytes: Uint8Array,
    mimeType: string,
  ) => Promise<{ data: Uint8ClampedArray | Uint8Array; width: number; height: number }>
  encode: (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    quality: number,
  ) => Promise<{ bytes: Uint8Array; mimeType: string }>
}

export type AvatarJobReport = {
  views: FitResult['views']
  /** Per view, how well a smooth light explained its skin (r²). */
  lightFit: number[]
  /** How much of the head's skin texels a photo saw well. */
  photoShare: number
  /** Each view's solved camera (the fitted head's frame to its pixels). */
  cameras: Camera[]
  seconds: { fit: number; texture: number; pack: number }
}

export type AvatarJobResult = {
  glb: Uint8Array
  report: AvatarJobReport
  fit: FitResult
}

const hexLinear = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [srgbToLinear((n >> 16) & 255), srgbToLinear((n >> 8) & 255), srgbToLinear(n & 255)]
}

/** The head fitted to every view, as the job fits it. */
export function fitCapture(
  base: BaseBody,
  views: CaptureView[],
  fitOptions: FitOptions = {},
): FitResult {
  return fitHead(base.head, views, {
    sameCamera: views.every((view) => view.slot !== 'free'),
    pupils: PUPIL_DISTANCE[base.meta.gender],
    ...fitOptions,
  })
}

export async function runAvatarJob({
  base,
  views,
  colors,
  codec,
  progress = () => {},
  fitOptions = {},
}: {
  base: BaseBody
  views: CaptureView[]
  colors: CaptureColors
  codec: PictureCodec
  progress?: (fraction: number, stage: 'fit' | 'texture' | 'pack') => void
  /** The fit's settings, past what the capture implies. */
  fitOptions?: FitOptions
}): Promise<AvatarJobResult> {
  const started = performance.now()
  progress(0.02, 'fit')
  const fit = fitCapture(base, views, fitOptions)
  const fitted = performance.now()
  progress(0.45, 'texture')

  const moves = baseMeshMoves(base, fit.positions)
  const head = await decodeImage(base, 'head_color', codec)
  const body = await decodeImage(base, 'body_color', codec)
  const roughness = await decodeImage(base, 'head_roughness', codec)
  const skin = skinTextures({
    base,
    views,
    cameras: fit.cameras,
    moves,
    head,
    body,
    roughness,
    progress: (fraction) => progress(0.45 + 0.4 * fraction, 'texture'),
  })
  const images: AvatarImages = new Map()
  images.set('head_color', await codec.encode(skin.head, head.width, head.height, 0.92))
  images.set('body_color', await codec.encode(skin.body, body.width, body.height, 0.9))
  images.set(
    'head_roughness',
    await codec.encode(skin.roughness, roughness.width, roughness.height, 0.9),
  )
  if (colors.eyes) {
    const eyes = await decodeImage(base, 'eye_color', codec)
    images.set(
      'eye_color',
      await codec.encode(
        tintIris(base, eyes, hexLinear(colors.eyes)),
        eyes.width,
        eyes.height,
        0.92,
      ),
    )
  }
  if (colors.hair) {
    const hair = await decodeImage(base, 'hair_color', codec)
    const hairMedian = imageMedian(hair.data, (i) => hair.data[i * 4 + 3]! > 128)
    images.set(
      'hair_color',
      await codec.encode(
        tone(hair.data, toneGains(hairMedian, hexLinear(colors.hair)), 6),
        hair.width,
        hair.height,
        0.9,
      ),
    )
  }
  const textured = performance.now()
  progress(0.92, 'pack')
  const glb = editMaterials(
    buildAvatarGlb(base, moves, images, { dropBrows: true }),
    SKIN_MATERIAL_EDITS,
  )
  progress(1, 'pack')
  const done = performance.now()
  return {
    glb,
    fit,
    report: {
      views: fit.views,
      lightFit: skin.lightFit,
      photoShare: skin.photoShare,
      cameras: fit.cameras,
      seconds: {
        fit: (fitted - started) / 1000,
        texture: (textured - fitted) / 1000,
        pack: (done - textured) / 1000,
      },
    },
  }
}

async function decodeImage(base: BaseBody, name: string, codec: PictureCodec) {
  const { json, bin } = base.glb
  const image = json.images.find((one: { name?: string }) => one.name === name)
  if (!image) throw new Error(`base body without ${name}`)
  const view = json.bufferViews[image.bufferView]
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
  return codec.decode(bytes, image.mimeType)
}

/** Median linear colour of an RGBA image's pixels that `use` picks (every third pixel: plenty). */
function imageMedian(
  data: ArrayLike<number>,
  use: (i: number) => boolean,
): [number, number, number] {
  const channels: number[][] = [[], [], []]
  for (let i = 0; i < data.length / 4; i += 3) {
    if (!use(i)) continue
    for (let k = 0; k < 3; k++) channels[k]!.push(srgbToLinear(data[i * 4 + k]!))
  }
  return channels.map((list) => (list.length ? median(list) : 0.3)) as [number, number, number]
}

/** An RGBA image with per-channel gains (linear), alpha kept; gains clamped to `limit`. */
function tone(
  data: ArrayLike<number>,
  gains: [number, number, number],
  limit = 4,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length)
  const g = gains.map((value) => Math.min(limit, Math.max(1 / limit, value)))
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 3; k++) out[i + k] = linearToSrgb(srgbToLinear(data[i + k]!) * g[k]!)
    out[i + 3] = data[i + 3]!
  }
  return out
}

/**
 * The eye texture with its iris in the person's colour: each iris texel's
 * colour replaced by the target's, scaled by how light the texel is
 * against the iris's average, so the iris keeps its fibres and its dark rim.
 */
function tintIris(
  base: BaseBody,
  image: { data: ArrayLike<number>; width: number; height: number },
  target: [number, number, number],
): Uint8ClampedArray {
  const out = Uint8ClampedArray.from(image.data)
  const p = base.primitives.find((one) => one.material === 'Eye_Iris')
  if (!p?.attributes.TEXCOORD_0) return out
  const uv = p.attributes.TEXCOORD_0.values
  const xy = new Float32Array(uv.length)
  for (let i = 0; i < uv.length; i += 2) {
    xy[i] = uv[i]! * image.width
    xy[i + 1] = uv[i + 1]! * image.height
  }
  const mask = new Uint8Array(image.width * image.height)
  fillTriangles(xy, p.indices, image.width, image.height, mask)
  const light = (i: number) =>
    0.2126 * srgbToLinear(image.data[i * 4]!) +
    0.7152 * srgbToLinear(image.data[i * 4 + 1]!) +
    0.0722 * srgbToLinear(image.data[i * 4 + 2]!)
  const lights: number[] = []
  for (let i = 0; i < mask.length; i++) if (mask[i]) lights.push(light(i))
  const average = Math.max(median(lights), 1e-4)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const scale = light(i) / average
    for (let k = 0; k < 3; k++) out[i * 4 + k] = linearToSrgb(target[k]! * scale)
  }
  return out
}
