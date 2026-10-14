import {
  type AvatarImages,
  type BaseBody,
  baseMeshMoves,
  buildAvatarGlb,
  movedPositions,
} from './base-body'
import type { Camera } from './camera'
import { landmarkUvs, texelKinds } from './features'
import { composite, fillVertexColors, pushPull, rasterizeVertexColors, toneGains } from './fill'
import { type FitOptions, type FitResult, type FitView, fitHead } from './fit'
import { vertexNormals } from './head-model'
import type { FaceBlendshapes, SegmentMasks } from './segment'
import { fillTriangles } from './silhouette'
import {
  blendViews,
  delight,
  depthBuffer,
  linearRgb,
  linearToSrgb,
  matchExposure,
  median,
  type PhotoImage,
  type ProjectedView,
  projectView,
  rasterizeUv,
  srgbToLinear,
  TEXEL_SKIN,
  type UvMesh,
} from './texture'

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

/** Texels per side the photos are laid at (the face island then holds ≈ 730 photo pixels across). */
const WORKING = 1024

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
  const { headSkin } = base
  const headPositions = movedPositions(base, headSkin.primitive, moves)
  const headMesh: UvMesh = {
    positions: headPositions,
    normals: vertexNormals(headPositions, headSkin.mesh.triangles, headPositions.length / 3),
    uvs: headSkin.mesh.uvs,
    triangles: headSkin.mesh.triangles,
  }
  // What hides the head from a photo: the head and the neck and shoulders below it.
  const occluder = occluderMesh(base, moves)
  const texels = rasterizeUv(headMesh, WORKING)
  const kind = texelKinds(texels, landmarkUvs(base.head, headSkin.weld, headSkin.mesh.uvs))
  const projected: ProjectedView[] = []
  const lightFit: number[] = []
  views.forEach((view, k) => {
    const camera = fit.cameras[k]!
    const photo: PhotoImage = {
      width: view.width,
      height: view.height,
      rgb: linearRgb(view.rgba, view.width, view.height),
      mask: view.mask,
      skin: view.skin,
    }
    const seen = projectView(texels, kind, photo, camera, depthBuffer(occluder, camera))
    lightFit.push(delight(seen, texels, kind, camera).fit)
    projected.push(seen)
    progress(0.45 + (0.25 * (k + 1)) / views.length, 'texture')
  })
  // The front photo sets the exposure the others are matched to.
  const front = views.findIndex((view) => view.slot === 'front')
  for (const view of projected) {
    const reference = projected[front >= 0 ? front : 0]!
    if (view !== reference) matchExposure(view, reference, kind)
  }
  const blended = blendViews(projected, WORKING * WORKING)
  // Each view's projection (16 MB at the working size) is not read again: let it go before the
  // fill and the pictures need their own memory (a phone's tab has little to spare).
  projected.length = 0

  // The photos' skin in the tone the texture should hold (the front photo's skin, read on the page).
  const target = hexLinear(colors.skin)
  const photoSkin = skinMedian(
    blended.color,
    (i) => kind[i] === TEXEL_SKIN && blended.weight[i]! > 0.6,
  )
  const photoGains = toneGains(photoSkin, target)
  for (let i = 0; i < blended.weight.length; i++) {
    for (let k = 0; k < 3; k++)
      blended.color[i * 3 + k] = blended.color[i * 3 + k]! * photoGains[k]!
  }
  let seenTexels = 0
  let skinTexels = 0
  for (let i = 0; i < blended.weight.length; i++) {
    if (texels.triangle[i]! < 0) continue
    skinTexels++
    if (blended.weight[i]! > 0.5) seenTexels++
  }

  // The skin carried on where no photo saw it.
  const vertexCount = headPositions.length / 3
  const vertexColor = new Float32Array(vertexCount * 3)
  const vertexWeight = new Float32Array(vertexCount)
  for (let v = 0; v < vertexCount; v++) {
    const x = Math.min(WORKING - 1, Math.max(0, Math.floor(headMesh.uvs[v * 2]! * WORKING)))
    const y = Math.min(WORKING - 1, Math.max(0, Math.floor(headMesh.uvs[v * 2 + 1]! * WORKING)))
    // The best-seen texel around the vertex.
    let best = -1
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = x + dx
        const py = y + dy
        if (px < 0 || py < 0 || px >= WORKING || py >= WORKING) continue
        const i = py * WORKING + px
        if (best < 0 || blended.weight[i]! > blended.weight[best]!) best = i
      }
    }
    if (best < 0) continue
    vertexWeight[v] = kind[best] === TEXEL_SKIN ? blended.weight[best]! : 0
    for (let k = 0; k < 3; k++) vertexColor[v * 3 + k] = blended.color[best * 3 + k]!
  }
  const fillColors = fillVertexColors(headMesh, headSkin.weld, vertexColor, vertexWeight, target)
  const fill = rasterizeVertexColors(headMesh, fillColors, WORKING)
  const covered = new Uint8Array(WORKING * WORKING)
  for (let i = 0; i < covered.length; i++) covered[i] = texels.triangle[i]! >= 0 ? 1 : 0
  pushPull(fill, covered, WORKING, 3)
  const seen = new Uint8Array(WORKING * WORKING)
  for (let i = 0; i < seen.length; i++) seen[i] = blended.weight[i]! > 0 ? 1 : 0
  pushPull(blended.color, seen, WORKING, 3)
  const coverage = Float32Array.from(blended.weight)
  pushPull(coverage, covered, WORKING, 1)
  progress(0.8, 'texture')

  const images: AvatarImages = new Map()
  const head = await decodeImage(base, 'head_color', codec)
  const headUv = base.meta.headUV
  const baseSkin = textureSkinMedian(head, headMesh)
  const keep = ['mouth', 'sockets']
    .map((name) => headUv.boxes[name])
    .filter((box): box is [number, number, number, number] => Boolean(box))
    // The boxes are v up (Blender's); the texture's rows run down.
    .map(([u0, v0, u1, v1]) => [u0, 1 - v1, u1, 1 - v0] as [number, number, number, number])
  const headPixels = composite({
    base: head.data,
    size: head.width,
    gains: toneGains(baseSkin, target),
    photo: blended.color,
    coverage,
    fill,
    working: WORKING,
    keep,
  })
  images.set('head_color', await codec.encode(headPixels, head.width, head.height, 0.92))

  const body = await decodeImage(base, 'body_color', codec)
  const bodySkin = bodySkinMedian(base, body)
  images.set(
    'body_color',
    await codec.encode(tone(body.data, toneGains(bodySkin, target)), body.width, body.height, 0.9),
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
  const glb = buildAvatarGlb(base, moves, images, { dropBrows: true })
  progress(1, 'pack')
  const done = performance.now()
  return {
    glb,
    fit,
    report: {
      views: fit.views,
      lightFit,
      photoShare: skinTexels ? seenTexels / skinTexels : 0,
      cameras: fit.cameras,
      seconds: {
        fit: (fitted - started) / 1000,
        texture: (textured - fitted) / 1000,
        pack: (done - textured) / 1000,
      },
    },
  }
}

/** The head's skin and the body's (neck, shoulders) as they stand after `moves`: what hides the face from a camera. */
function occluderMesh(base: BaseBody, moves: Float64Array): UvMesh {
  const positions: number[] = []
  const triangles: number[] = []
  base.primitives.forEach((p, index) => {
    if (p.material !== 'Head_Skin' && p.material !== 'Body_Skin') return
    const moved = movedPositions(base, index, moves)
    const offset = positions.length / 3
    for (let i = 0; i < moved.length; i++) positions.push(moved[i]!)
    for (const i of p.indices) triangles.push(i + offset)
  })
  const n = positions.length / 3
  return {
    positions: Float32Array.from(positions),
    normals: new Float32Array(n * 3),
    uvs: new Float32Array(n * 2),
    triangles: Uint32Array.from(triangles),
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

/** Median linear colour of the texels `use` picks. */
function skinMedian(color: Float32Array, use: (i: number) => boolean): [number, number, number] {
  const channels: number[][] = [[], [], []]
  for (let i = 0; i < color.length / 3; i++) {
    if (!use(i)) continue
    for (let k = 0; k < 3; k++) channels[k]!.push(color[i * 3 + k]!)
  }
  return channels.map((list) => (list.length ? median(list) : 0.3)) as [number, number, number]
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

/** The base head texture's skin: its face island's texels the head covers (cheeks, forehead…). */
function textureSkinMedian(
  image: { data: ArrayLike<number>; width: number; height: number },
  mesh: UvMesh,
): [number, number, number] {
  const mask = new Uint8Array(image.width * image.height)
  const xy = new Float32Array((mesh.uvs.length / 2) * 2)
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    xy[i] = mesh.uvs[i]! * image.width
    xy[i + 1] = mesh.uvs[i + 1]! * image.height
  }
  fillTriangles(xy, mesh.triangles, image.width, image.height, mask)
  return imageMedian(image.data, (i) => mask[i]! > 0)
}

function bodySkinMedian(
  base: BaseBody,
  image: { data: ArrayLike<number>; width: number; height: number },
) {
  const p = base.primitives.find((one) => one.material === 'Body_Skin')
  if (!p) return imageMedian(image.data, () => true)
  const uv = p.attributes.TEXCOORD_0!.values
  const xy = new Float32Array(uv.length)
  for (let i = 0; i < uv.length; i += 2) {
    xy[i] = uv[i]! * image.width
    xy[i + 1] = uv[i + 1]! * image.height
  }
  const mask = new Uint8Array(image.width * image.height)
  fillTriangles(xy, p.indices, image.width, image.height, mask)
  return imageMedian(image.data, (i) => mask[i]! > 0)
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
