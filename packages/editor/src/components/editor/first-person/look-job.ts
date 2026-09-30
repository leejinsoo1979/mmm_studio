import { runFaceJob } from './face-job'
import { forEachTexel } from './front-render'
import type { HeadGeometry } from './head-geometry'
import {
  colorDistance,
  dye,
  type HeadTriangle,
  hairMask,
  hexToRgb,
  luminance,
  maskedLuminance,
  meanColor,
  type Pixels,
  type Rgb,
  similarityMask,
  unpackTriangles,
} from './look-pixels'

/**
 * A Rocketbox body's materials: `<code>_head`, `<code>_body` and, on about
 * half of them, `<code>_opacity` (hair cards and lashes); the rest have
 * their hair, if any, painted on the head.
 */
export type Part = 'head' | 'body' | 'opacity'

/** A head's geometry packed into flat arrays (see `packTriangles`), to cross to a worker cheaply. */
export type PackedGeometry = { all: Float32Array; skin: Float32Array; eyes: Float32Array[] }

/** A body as a look needs it: its textures as the GPU has them and its head's geometry. */
export type LookBody = {
  /** Names these textures: what is worked out from them is kept under it. */
  key: string
  head: ImageBitmap
  body: ImageBitmap
  opacity: ImageBitmap | null
  geometry: PackedGeometry
}

/** A look to put on a body (see `AvatarLook`), with the character's face landmarks. */
export type LookJob = {
  body: LookBody
  /** The character, whose face landmarks `target` are. */
  avatar: string
  hair: string | null
  skin: string | null
  face: {
    photo: string
    points: number[]
    blend: number
    light: number
    eyes: string | null
    target: number[]
  } | null
}

/**
 * The textures the look changes, and whether the face was left out because
 * its photo couldn't be read (the rest still goes on).
 */
export type LookResult = { parts: Partial<Record<Part, ImageBitmap>>; faceFailed: boolean }

/** Everything about a body's textures a look needs, worked out once per body. */
export type Analysis = {
  head: Pixels
  body: Pixels
  opacity: Pixels | null
  geometry: HeadGeometry
  hairMask: Float32Array
  headSkinMask: Float32Array
  bodySkinMask: Float32Array
  hairLum: number
  headHairLum: number
  skinLum: number
  bodySkinLum: number
}

/**
 * The median colour (by lightness, so brows and nostrils don't pull it off)
 * of the head's texture under the triangles centred in part of its front
 * view.
 */
function colorWhere(
  head: Pixels,
  triangles: readonly HeadTriangle[],
  within: (x: number, y: number, n: number) => boolean,
  fallback: Rgb,
): Rgb {
  const samples: Rgb[] = []
  for (const tri of triangles) {
    const x = (tri.x[0]! + tri.x[1]! + tri.x[2]!) / 3
    const y = (tri.y[0]! + tri.y[1]! + tri.y[2]!) / 3
    const n = (tri.n[0]! + tri.n[1]! + tri.n[2]!) / 3
    if (!within(x, y, n)) continue
    const u = (tri.u[0]! + tri.u[1]! + tri.u[2]!) / 3
    const v = (tri.v[0]! + tri.v[1]! + tri.v[2]!) / 3
    const p =
      (Math.min(head.height - 1, Math.floor(v * head.height)) * head.width +
        Math.min(head.width - 1, Math.floor(u * head.width))) *
      4
    samples.push([head.data[p]!, head.data[p + 1]!, head.data[p + 2]!])
  }
  if (samples.length === 0) return fallback
  samples.sort((a, b) => luminance(...a) - luminance(...b))
  return samples[Math.floor(samples.length / 2)]!
}

/** The skin's colour: the cheeks and nose, facing the front. */
const skinColor = (head: Pixels, geometry: HeadGeometry) =>
  colorWhere(
    head,
    geometry.skin,
    (x, y, n) => n >= 0.6 && Math.abs(x - 0.5) <= 0.14 && y >= 0.55 && y <= 0.72,
    [200, 160, 140],
  )

/** The crown's colour: a head without hair cards has its hair, if any, painted there. */
const crownColor = (head: Pixels, geometry: HeadGeometry) =>
  colorWhere(
    head,
    geometry.all,
    (x, y) => Math.abs(x - 0.5) <= 0.12 && y >= 0.03 && y <= 0.12,
    [60, 45, 35],
  )

/**
 * A crown nearer the skin's colour than this is bare (a bald or shaved head)
 * or cut off under a covering: the head has no painted hair to find.
 */
const BARE_CROWN = 0.2

/**
 * Clears a head's hair mask where no hair is: the eyeballs, whatever their
 * colour, and — when the mask comes from a guess at painted hair's colour —
 * the face and jaw below the eyes (the lowest brows sit above 0.45 of the
 * front view on every character), where a shadowed cheek or a dark skin can
 * match that colour. The back of the head keeps its hair.
 */
function clearHairlessTexels(
  mask: Float32Array,
  head: Pixels,
  geometry: HeadGeometry,
  painted: boolean,
) {
  const clear = (texel: number) => {
    mask[texel] = 0
  }
  forEachTexel(head, geometry.eyes.flat(), () => true, clear)
  if (!painted) return
  forEachTexel(
    head,
    geometry.skin,
    (tri) => {
      const x = (tri.x[0]! + tri.x[1]! + tri.x[2]!) / 3
      const y = (tri.y[0]! + tri.y[1]! + tri.y[2]!) / 3
      return Math.abs(x - 0.5) < 0.28 && y > 0.45 && tri.n[0]! + tri.n[1]! + tri.n[2]! > -0.6
    },
    clear,
  )
}

/** What a look needs to know of a body's textures (see `Analysis`). */
export function analyseBody(
  head: Pixels,
  body: Pixels,
  opacity: Pixels | null,
  geometry: HeadGeometry,
): Analysis {
  const skin = skinColor(head, geometry)
  const skinLum = luminance(...skin)
  const crown = opacity ? null : crownColor(head, geometry)
  const painted = crown && colorDistance(...crown, skin, skinLum) > BARE_CROWN ? crown : null
  const hairColour = opacity ? meanColor(opacity) : painted
  const hairOnHead = hairColour
    ? hairMask(head, hairColour, skin)
    : new Float32Array(head.width * head.height)
  if (hairColour) clearHairlessTexels(hairOnHead, head, geometry, !opacity)
  const headSkinMask = similarityMask(head, skin)
  for (let i = 0; i < headSkinMask.length; i++) headSkinMask[i]! *= 1 - hairOnHead[i]!
  const bodySkinMask = similarityMask(body, skin, 0.08, 0.2)
  return {
    head,
    body,
    opacity,
    geometry,
    hairMask: hairOnHead,
    headSkinMask,
    bodySkinMask,
    hairLum: opacity ? luminance(...meanColor(opacity)) : 0,
    headHairLum: maskedLuminance(head, hairOnHead),
    skinLum,
    bodySkinLum: maskedLuminance(body, bodySkinMask),
  }
}

const copyPixels = (pixels: Pixels): Pixels => ({
  data: new Uint8ClampedArray(pixels.data),
  width: pixels.width,
  height: pixels.height,
})

/**
 * A body's textures dressed in a look: the ones it changes (the swapped
 * face, hair dye, skin tone), each its own copy. `photo` is the face's
 * photo, read (null leaves the face out).
 */
export function dressBody(
  analysis: Analysis,
  job: Omit<LookJob, 'body'> & { key: string },
  photo: Pixels | null,
): Partial<Record<Part, Pixels>> {
  const { face, hair, skin } = job
  const changed: Partial<Record<Part, Pixels>> = {}
  if ((face && photo) || hair || skin) {
    let head = copyPixels(analysis.head)
    if (hair) dye(head, hexToRgb(hair), analysis.headHairLum, analysis.hairMask)
    if (skin) dye(head, hexToRgb(skin), analysis.skinLum, analysis.headSkinMask)
    // The face goes on last: the dyes' masks are the character's own face,
    // not the photo's, and the face's colours meet the skin as dyed.
    if (face && photo) {
      try {
        head = runFaceJob({
          head,
          avatar: job.key,
          front: `${job.key}|${hair}|${skin}`,
          geometry: analysis.geometry,
          hair: analysis.hairMask,
          photo,
          photoKey: face.photo,
          points: face.points,
          target: face.target,
          blend: face.blend,
          light: face.light,
          eyes: face.eyes,
        })
      } catch (error) {
        // The dyes still go on; the face is left out.
        console.warn('[look] face swap failed', error)
      }
    }
    changed.head = head
  }
  if (hair && analysis.opacity) {
    const opacity = copyPixels(analysis.opacity)
    dye(opacity, hexToRgb(hair), analysis.hairLum)
    changed.opacity = opacity
  }
  if (skin) {
    const body = copyPixels(analysis.body)
    dye(body, hexToRgb(skin), analysis.bodySkinLum, analysis.bodySkinMask)
    changed.body = body
  }
  return changed
}

/** A canvas to read and write pixels on, wherever this runs. */
function canvasOf(width: number, height: number) {
  return new OffscreenCanvas(width, height)
}

function pixelsOf(bitmap: ImageBitmap): Pixels {
  const canvas = canvasOf(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0)
  return context.getImageData(0, 0, bitmap.width, bitmap.height)
}

function bitmapOf(pixels: Pixels): ImageBitmap {
  const canvas = canvasOf(pixels.width, pixels.height)
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0)
  return canvas.transferToImageBitmap()
}

/** The last few bodies' analyses: each holds a few tens of MB. */
const analyses = new Map<string, Analysis>()
const ANALYSES_KEPT = 3

function analysisOf(body: LookBody): Analysis {
  let analysis = analyses.get(body.key)
  if (analysis) {
    analyses.delete(body.key)
  } else {
    analysis = analyseBody(
      pixelsOf(body.head),
      pixelsOf(body.body),
      body.opacity && pixelsOf(body.opacity),
      {
        all: unpackTriangles(body.geometry.all),
        skin: unpackTriangles(body.geometry.skin),
        eyes: body.geometry.eyes.map(unpackTriangles),
      },
    )
  }
  analyses.set(body.key, analysis)
  if (analyses.size > ANALYSES_KEPT) analyses.delete(analyses.keys().next().value!)
  return analysis
}

/** Larger than this a side, a face photo is none the studio made: it isn't read. */
const PHOTO_MAX = 2048

const photos = new Map<string, Promise<Pixels>>()

/** A face photo's pixels (a few recent ones kept; one that failed can be tried again). */
function photoPixels(photo: string): Promise<Pixels> {
  let found = photos.get(photo)
  if (!found) {
    found = fetch(photo)
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        const { width, height } = bitmap
        if (!(width > 0 && height > 0 && width <= PHOTO_MAX && height <= PHOTO_MAX)) {
          bitmap.close()
          throw new Error(`face photo ${width}×${height}`)
        }
        const pixels = pixelsOf(bitmap)
        bitmap.close()
        return pixels
      })
    found.catch(() => photos.delete(photo))
    photos.set(photo, found)
    if (photos.size > 4) photos.delete(photos.keys().next().value!)
  }
  return found
}

/** Dresses a body in a look (see `dressBody`), from and to bitmaps, keeping what it can for next time. */
export async function runLookJob(job: LookJob): Promise<LookResult> {
  let faceFailed = false
  const photo = job.face
    ? await photoPixels(job.face.photo).catch(() => {
        faceFailed = true
        return null
      })
    : null
  const changed = dressBody(analysisOf(job.body), { ...job, key: job.body.key }, photo)
  const parts: Partial<Record<Part, ImageBitmap>> = {}
  for (const part of Object.keys(changed) as Part[]) parts[part] = bitmapOf(changed[part]!)
  return { parts, faceFailed }
}
