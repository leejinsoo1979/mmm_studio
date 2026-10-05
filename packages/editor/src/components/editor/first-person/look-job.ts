import type { BodyBind } from './bare-feet'
import { connectedFrom } from './face-fill'
import { runFaceJob } from './face-job'
import { type FacePaint, hairHued, hasFacePaint, paintFace, shaveHead } from './face-paint'
import { maskImage } from './face-swap'
import {
  dressLegs,
  type FeetBody,
  type FeetDonor,
  type FittedFeet,
  paintFeet,
  type WornFeet,
  wornFeet,
} from './feet-job'
import type { AvatarFeet } from './footwear'
import { forEachTexel, renderFront, tintIris } from './front-render'
import { bleedHair } from './hair-bleed'
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
  toneSkin,
  unpackTriangles,
} from './look-pixels'

/**
 * A Rocketbox body's materials: `<code>_head`, `<code>_body` and, on about
 * half of them, `<code>_opacity` (hair cards and lashes); the rest have
 * their hair, if any, painted on the head. `<code>_feet` is borrowed bare
 * feet's (see feet-job.ts).
 */
export type Part = 'head' | 'body' | 'opacity' | 'feet'

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

/** A look to put on a body (see `AvatarPaint`), with the character's face landmarks. */
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
  } | null
  paint: FacePaint
  bald: boolean
  feet: AvatarFeet
  /**
   * Out of shoes, the body mesh with them in its bind pose and the donor
   * whose bare feet go on in their place (see feet-job.ts); null when shod,
   * or when either couldn't be had (the shoes stay on).
   */
  feetBind: BodyBind | null
  feetDonor: FeetDonor | null
  /**
   * The character's face landmarks (packed fractions of its front view):
   * without them (not loaded, or none for this character) the face photo
   * and all the paint but the irises' are left out.
   */
  target: number[] | null
}

/**
 * The textures the look changes, whether the face was left out because its
 * photo couldn't be read (the rest still goes on), and the borrowed feet
 * to wear (null: the shoes).
 */
export type LookResult = {
  parts: Partial<Record<Part, ImageBitmap>>
  faceFailed: boolean
  feet: FittedFeet | null
}

/** Everything about a body's textures a look needs, worked out once per body. */
export type Analysis = {
  head: Pixels
  body: Pixels
  opacity: Pixels | null
  geometry: HeadGeometry
  hairMask: Float32Array
  /** The hair's colour (its cards', or what is painted on the crown where the cards' is gear's), null for a bare head. */
  hairColor: Rgb | null
  headSkinMask: Float32Array
  bodySkinMask: Float32Array
  hairLum: number
  headHairLum: number
  /** The skin's usual colour on the head's texture and on the body's. */
  skin: Rgb
  bodySkin: Rgb
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

/**
 * The cheeks on the front view, either side of the nose between the eyes
 * and the mouth: bare skin on every face (the middle strip lower down
 * takes in lips and nostrils, and a lip-red skin colour leaves the skin
 * itself out of the skin's mask).
 */
const CHEEK_SIDE: readonly [number, number] = [0.07, 0.2]
const CHEEK_HEIGHT: readonly [number, number] = [0.52, 0.64]

/** The skin's colour: the cheeks, facing the front. */
const skinColor = (head: Pixels, geometry: HeadGeometry) =>
  colorWhere(
    head,
    geometry.skin,
    (x, y, n) => {
      const side = Math.abs(x - 0.5)
      return (
        n >= 0.5 &&
        side >= CHEEK_SIDE[0] &&
        side <= CHEEK_SIDE[1] &&
        y >= CHEEK_HEIGHT[0] &&
        y <= CHEEK_HEIGHT[1]
      )
    },
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
 * colour, and — when the mask comes from a guess at the hair's colour from
 * the crown, or the hair is too fair to tell from the face's own light and
 * shade — the face and jaw below the eyes (the lowest brows sit above 0.45
 * of the front view on every character), where a shadowed cheek or a dark
 * skin can match that colour. The back of the head keeps its hair.
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

/** Hair at least this light (a share of the skin's lightness) is fair: on the face it can't be told from the skin's light and shade. */
const FAIR_HAIR = 0.7

/** The front view's side (px) hair is followed on: fine enough for strands, cheap to walk. */
const HAIR_VIEW = 512

/**
 * Clears a head's hair mask of what only looks like hair: patches on the
 * face — a forehead, the shadow under an eye — the colour of light hair,
 * but apart from the hair. Hair is what, on the front view, reaches the
 * crown or the head's sides (a fringe over the face does).
 */
function keepConnectedHair(mask: Float32Array, head: Pixels, geometry: HeadGeometry) {
  const drawn = renderFront(maskImage(mask, head.width, head.height), geometry.all, HAIR_VIEW).image
  const front = new Float32Array(HAIR_VIEW * HAIR_VIEW)
  const seeds = new Float32Array(HAIR_VIEW * HAIR_VIEW)
  for (let i = 0; i < front.length; i++) {
    if (drawn.data[i * 4 + 3] === 0) continue
    front[i] = drawn.data[i * 4]! / 255
    const x = ((i % HAIR_VIEW) + 0.5) / HAIR_VIEW
    const y = (Math.floor(i / HAIR_VIEW) + 0.5) / HAIR_VIEW
    seeds[i] = y < 0.2 || Math.abs(x - 0.5) > 0.3 ? 1 : 0
  }
  const hair = connectedFrom(front, seeds, HAIR_VIEW, HAIR_VIEW, 0.5)
  forEachTexel(
    head,
    geometry.all,
    (tri) => tri.n[0]! + tri.n[1]! + tri.n[2]! > 0,
    (texel, tri, w0, w1, w2) => {
      if (mask[texel]! <= 0) return
      const x = tri.x[0]! * w0 + tri.x[1]! * w1 + tri.x[2]! * w2
      const y = tri.y[0]! * w0 + tri.y[1]! * w1 + tri.y[2]! * w2
      const px = Math.min(HAIR_VIEW - 1, Math.max(0, Math.floor(x * HAIR_VIEW)))
      const py = Math.min(HAIR_VIEW - 1, Math.max(0, Math.floor(y * HAIR_VIEW)))
      const p = py * HAIR_VIEW + px
      // Where the front view shows hair that reaches no other hair.
      if (front[p]! >= 0.5 && hair[p]! < 0.5) mask[texel] = 0
    },
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
  // A crown of a colour hair never is (a blue cap, camouflage, a hijab) is
  // gear, not hair to dye or shave; so is a card's colour that isn't a
  // hair's (the opacity texture's gear, a helmet's visor or reflective
  // strip, outweighing the hair): the crown under the cards is the hair's.
  const crown = crownColor(head, geometry)
  const painted =
    hairHued(crown) && colorDistance(...crown, skin, skinLum) > BARE_CROWN ? crown : null
  const cards = opacity && meanColor(opacity)
  const hairColour = cards && hairHued(cards) ? cards : painted
  const hairOnHead = hairColour
    ? hairMask(head, hairColour, skin)
    : new Float32Array(head.width * head.height)
  if (hairColour) {
    const guessed = hairColour !== cards || luminance(...hairColour) >= FAIR_HAIR * skinLum
    clearHairlessTexels(hairOnHead, head, geometry, guessed)
    keepConnectedHair(hairOnHead, head, geometry)
  }
  const headSkinMask = similarityMask(head, skin)
  for (let i = 0; i < headSkinMask.length; i++) headSkinMask[i]! *= 1 - hairOnHead[i]!
  const bodySkinMask = similarityMask(body, skin, 0.08, 0.2)
  return {
    head,
    body,
    opacity,
    geometry,
    hairMask: hairOnHead,
    hairColor: hairColour,
    headSkinMask,
    bodySkinMask,
    hairLum: cards ? luminance(...cards) : 0,
    headHairLum: maskedLuminance(head, hairOnHead),
    skin,
    bodySkin: meanColor(body, bodySkinMask),
  }
}

/**
 * Where a head with hair cards has their hair painted on — its hair shell,
 * which the hairstyle library is built from (see
 * scripts/characters/gen-hair-styles.ts). Unlike `analyseBody`'s mask, which
 * the look tunes for dye and shave, it stays the one the library's shells
 * were fitted to: the cards' colour told from the skin's down the middle of
 * the face (the cheeks and nose), the face below the eyes kept whatever the
 * hair's shade.
 */
export function cardHairMask(head: Pixels, opacity: Pixels, geometry: HeadGeometry): Float32Array {
  const skin = colorWhere(
    head,
    geometry.skin,
    (x, y, n) => n >= 0.6 && Math.abs(x - 0.5) <= 0.14 && y >= 0.55 && y <= 0.72,
    [200, 160, 140],
  )
  const mask = hairMask(head, meanColor(opacity), skin)
  clearHairlessTexels(mask, head, geometry, false)
  keepConnectedHair(mask, head, geometry)
  return mask
}

const copyPixels = (pixels: Pixels): Pixels => ({
  data: new Uint8ClampedArray(pixels.data),
  width: pixels.width,
  height: pixels.height,
})

/** The last few heads dyed and shaved, by what they depend on: each holds 16 MB, and a paint slider's drag repeats them. */
const bases = new Map<string, Pixels>()
const BASES_KEPT = 2

/**
 * A body's head dyed and shaved as a look asks (see `dressBody`), its own
 * copy. `name` names the look's body, dyes and shave.
 */
function baseHead(
  analysis: Analysis,
  name: string,
  { hair, skin, bald, target }: Pick<LookJob, 'hair' | 'skin' | 'bald' | 'target'>,
): Pixels {
  let base = bases.get(name)
  if (base) {
    bases.delete(name)
  } else {
    base = copyPixels(analysis.head)
    if (skin) toneSkin(base, hexToRgb(skin), analysis.skin, analysis.headSkinMask)
    // A shaved head's painted hair goes, not dyed: the shave finds it by its
    // own colour, and the hair worn over it is dyed on its own.
    if (hair && !bald) dye(base, hexToRgb(hair), analysis.headHairLum, analysis.hairMask)
    if (bald && target) {
      shaveHead(base, analysis.geometry, analysis.headSkinMask, target, analysis.hairColor)
    }
  }
  bases.set(name, base)
  if (bases.size > BASES_KEPT) bases.delete(bases.keys().next().value!)
  return copyPixels(base)
}

/**
 * A body's textures dressed in a look: the ones it changes, each its own
 * copy. On the head, in order: the skin tone, the hair dye, a shave, the
 * swapped face (onto the skin as dyed, the dyes' masks being the
 * character's own face and not the photo's), the face paint over it all,
 * and the irises last (a face photo's, unless the paint picks one).
 * `photo` is the face's photo, read (null leaves the face out).
 */
export function dressBody(
  analysis: Analysis,
  job: Omit<LookJob, 'body'> & { key: string },
  photo: Pixels | null,
): Partial<Record<Part, Pixels>> {
  const { face, hair, skin, paint, target } = job
  // The shave, like the rest of the paint, goes by the landmarks: it keeps
  // the face below the eyes and the brows.
  const bald = job.bald && target !== null
  const swap = face && photo && target
  const eyes = paint.eyes ?? face?.eyes ?? null
  const changed: Partial<Record<Part, Pixels>> = {}
  if (swap || hair || skin || bald || eyes || (target && hasFacePaint(paint))) {
    const base = `${job.key}|${hair}|${skin}|${bald}`
    let head = baseHead(analysis, base, { hair, skin, bald, target })
    // A shaved head has no hair left over its face.
    const hairMask = bald ? null : analysis.hairMask
    if (swap) {
      try {
        head = runFaceJob({
          head,
          avatar: bald ? `${job.key}|bald` : job.key,
          front: base,
          geometry: analysis.geometry,
          hair: hairMask,
          photo,
          photoKey: face.photo,
          points: face.points,
          target,
          blend: face.blend,
          light: face.light,
        })
      } catch (error) {
        // The dyes still go on; the face is left out.
        console.warn('[look] face swap failed', error)
      }
    }
    if (target) {
      paintFace(head, analysis.geometry, target, paint, {
        beard: hair ? hexToRgb(hair) : null,
        hair: hairMask,
      })
    }
    if (eyes) for (const eye of analysis.geometry.eyes) tintIris(head, eye, hexToRgb(eyes))
    changed.head = head
  }
  if (hair && analysis.opacity) {
    const opacity = copyPixels(analysis.opacity)
    dye(opacity, hexToRgb(hair), analysis.hairLum)
    // Under the cut-away texels, the dyed colour: the dye leaves them, and
    // the canvas the texture was read through left them black.
    bleedHair(opacity)
    changed.opacity = opacity
  }
  const feet = feetBodyOf(analysis, job)
  const worn = feet && job.feetDonor && wornFeet(feet, job.feetDonor, job.feet.wear)
  if (skin || worn) {
    const body = copyPixels(analysis.body)
    const tone = skin ? hexToRgb(skin) : null
    if (feet && worn) {
      dressLegs(body, feet, worn, job.feet, tone)
      // After the legs, so bare feet match them as dressed.
      changed.feet = paintFeet(body, feet, job.feetDonor!, worn, job.feet, tone)
    } else if (tone) {
      toneSkin(body, tone, analysis.bodySkin, analysis.bodySkinMask)
    }
    changed.body = body
  }
  return changed
}

const feetBodies = new WeakMap<Analysis, FeetBody>()

/**
 * A body's own texture as its borrowed feet need it, kept with its
 * analysis: its bind pose crosses with every job out of shoes, but the
 * first is kept, so what is worked out from it is kept too.
 */
function feetBodyOf(analysis: Analysis, job: Pick<LookJob, 'feetBind'>): FeetBody | null {
  let found = feetBodies.get(analysis)
  if (!found && job.feetBind) {
    found = {
      bind: job.feetBind,
      texture: analysis.body,
      face: analysis.skin,
      bodySkin: analysis.bodySkin,
      bodySkinMask: analysis.bodySkinMask,
    }
    feetBodies.set(analysis, found)
  }
  return found ?? null
}

/** The feet a look puts on a body (see feet-job.ts), as the main thread wears them; null to keep its shoes. */
function fittedFeet(analysis: Analysis, job: LookJob): FittedFeet | null {
  const feet = feetBodyOf(analysis, job)
  const worn: WornFeet | null =
    feet && job.feetDonor && wornFeet(feet, job.feetDonor, job.feet.wear)
  return worn
    ? { key: `${job.body.key}|${worn.kind}`, hidden: worn.hidden, mesh: worn.mesh, seam: worn.seam }
    : null
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

/**
 * Pixels as a bitmap, their colours as they are: one from a canvas holds
 * them premultiplied by alpha, which the GPU then gets — every see-through
 * texel of the hair cards darkened, and the colour bled under the cut-away
 * ones gone.
 */
function bitmapOf(pixels: Pixels): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(pixels.data, pixels.width, pixels.height), {
    premultiplyAlpha: 'none',
  })
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
  const analysis = analysisOf(job.body)
  const changed = dressBody(analysis, { ...job, key: job.body.key }, photo)
  const parts: Partial<Record<Part, ImageBitmap>> = {}
  for (const part of Object.keys(changed) as Part[]) parts[part] = await bitmapOf(changed[part]!)
  return { parts, faceFailed, feet: fittedFeet(analysis, job) }
}
