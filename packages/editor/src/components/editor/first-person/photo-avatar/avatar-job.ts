import { type AvatarImages, type BaseBody, baseMeshMoves, buildAvatarGlb } from './base-body'
import type { Camera } from './camera'
import { type Expression, transferExpressions } from './expressions'
import {
  eyeTexture,
  innerSurfaces,
  LASHES,
  lashPositions,
  lipsTogether,
  paintInnerSurfaces,
  photoWhites,
  scleraColour,
  sealLips,
  TEETH_TONE,
  TONGUE_TONE,
  toneImage,
} from './eyes'
import { type FitOptions, type FitResult, type FitView, fitHead, PUPIL_DISTANCE } from './fit'
import { editMaterials } from './glb'
import { type DressedPicture, dressHair } from './hair-glb'
import type { HairStyle, HairStyleName } from './hair-library'
import { type HairReading, hairStyleFor, readHair } from './hair-match'
import { hairGains, scalpDensity, tintScalp, tonePicture } from './hair-paint'
import type { FaceBlendshapes, SegmentMasks } from './segment'
import { SKIN_MATERIAL_EDITS, skinTextures } from './skin-texture'
import { srgbToLinear } from './texture'

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

/** A style of the hair library and its pictures (bytes as served), by name (see hair-library.ts). */
export type HairSource = (
  name: HairStyleName,
) => Promise<{ style: HairStyle; pictures: Map<string, Uint8Array> }>

export type AvatarJobReport = {
  views: FitResult['views']
  /** Per view, how well a smooth light explained its skin (r²). */
  lightFit: number[]
  /** How much of the head's skin texels a photo saw well. */
  photoShare: number
  /** Each view's solved camera (the fitted head's frame to its pixels). */
  cameras: Camera[]
  /** The hair read off the photos and the style given for it (null: bald). */
  hair: HairReading & { style: HairStyleName | null }
  seconds: { fit: number; texture: number; pack: number }
}

export type AvatarJobResult = {
  glb: Uint8Array
  report: AvatarJobReport
  fit: FitResult
}

/** The hair's colour (sRGB) where no photo showed any. */
const UNSEEN_HAIR = '#3b2a20'

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
  expressions,
  views,
  colors,
  codec,
  hair,
  progress = () => {},
  fitOptions = {},
}: {
  base: BaseBody
  /** The face's expressions on the base mesh (base-files.ts), carried onto the fitted head. */
  expressions: readonly Expression[]
  views: CaptureView[]
  colors: CaptureColors
  codec: PictureCodec
  hair: HairSource
  progress?: (fraction: number, stage: 'fit' | 'texture' | 'pack') => void
  /** The fit's settings, past what the capture implies. */
  fitOptions?: FitOptions
}): Promise<AvatarJobResult> {
  const started = performance.now()
  progress(0.02, 'fit')
  const fit = fitCapture(base, views, fitOptions)
  const fitted = performance.now()
  progress(0.45, 'texture')

  const fitMoves = baseMeshMoves(base, fit.positions)
  const jaw = expressions.find((one) => one.name === 'jawOpen')
  const moves = jaw && lipsTogether(views) ? sealLips(base, fitMoves, jaw) : fitMoves
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
  paintInnerSurfaces(
    skin.head,
    head.width,
    innerSurfaces(base, moves, skin.texels),
    skin.texels.size,
    skin.albedo,
  )

  const gender = base.meta.gender
  const reading = readHair(views, fit, base, skin.albedo)
  const styleName = hairStyleFor(reading, gender)
  const style = styleName ? await hair(styleName) : null
  const hairColour = reading.colour ?? hexLinear(colors.hair ?? UNSEEN_HAIR)
  if (style)
    tintScalp(
      skin.head,
      scalpDensity(style.style, gender, base.headSkin.mesh, base.headSkin.weld, head.width),
      hairColour,
    )

  const images: AvatarImages = new Map()
  images.set('head_color', await codec.encode(skin.head, head.width, head.height, 0.92))
  images.set('body_color', await codec.encode(skin.body, body.width, body.height, 0.9))
  images.set(
    'head_roughness',
    await codec.encode(skin.roughness, roughness.width, roughness.height, 0.9),
  )
  const whites = photoWhites(views)
  if (colors.eyes || whites) {
    const eyes = await decodeImage(base, 'eye_color', codec)
    images.set(
      'eye_color',
      await codec.encode(
        eyeTexture(
          base,
          eyes,
          colors.eyes ? hexLinear(colors.eyes) : null,
          whites ? scleraColour(whites, skin.gains) : null,
        ),
        eyes.width,
        eyes.height,
        0.92,
      ),
    )
  }
  for (const [name, gains] of [
    ['teeth_color', TEETH_TONE],
    ['tongue_color', TONGUE_TONE],
  ] as const) {
    const picture = await decodeImage(base, name, codec)
    images.set(
      name,
      await codec.encode(toneImage(picture, gains), picture.width, picture.height, 0.9),
    )
  }
  const pictures = new Map<string, DressedPicture>()
  if (style) {
    const decoded = new Map<string, Awaited<ReturnType<PictureCodec['decode']>>>()
    for (const [file, bytes] of style.pictures)
      decoded.set(file, await codec.decode(bytes, 'image/webp'))
    const own = style.style.parts.find((part) => part.material === 'Hair')!.texture
    const gains = hairGains(decoded.get(own)!.data, hairColour)
    for (const [file, picture] of decoded) {
      pictures.set(
        file,
        await codec.encode(tonePicture(picture.data, gains), picture.width, picture.height, 0.9),
      )
    }
  }
  const textured = performance.now()
  progress(0.92, 'pack')
  const basemesh = new Float64Array(base.basemesh.length)
  for (let i = 0; i < basemesh.length; i++) basemesh[i] = base.basemesh[i]! + moves[i]!
  const lashes = lashPositions(base, moves, gender)
  const avatar = buildAvatarGlb(base, moves, images, {
    dropBrows: true,
    expressions: transferExpressions(base, moves, expressions),
    placed: lashes ? new Map([[lashes.index, lashes.positions]]) : undefined,
    opacity: { Eyelashes: LASHES[gender].opacity },
  })
  const glb = dressHair(
    editMaterials(avatar, SKIN_MATERIAL_EDITS),
    base,
    { style: style?.style ?? null, gender, basemesh, pictures, colour: hairColour },
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
      hair: { ...reading, style: styleName },
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
