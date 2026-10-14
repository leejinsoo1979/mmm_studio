import type { AvatarGender } from '../avatar-catalog'
import { deltaE } from '../look-pixels'
import type { CaptureView } from './avatar-job'
import type { BaseBody } from './base-body'
import { type Camera, cameraCentre, project } from './camera'
import type { FitResult } from './fit'
import type { HairLength, HairStyleName } from './hair-library'
import type { Rgb } from './hair-paint'
import { type HeadModel, vertexNormals } from './head-model'
import type { Vec3 } from './linalg'
import { classPlane } from './segment'
import { fillTriangles } from './silhouette'
import { linearToSrgb, srgbToLinear } from './texture'

/**
 * The person's hair read off every photo (the segmenter's hair class
 * against the fitted head, each photo through its solved camera): how much
 * of the scalp shows hair, how far the hair stands off the skull, how low
 * it reaches (anywhere, and beside the face: long hair that does not fall
 * beside the face is gathered back), a fringe, and its colour with the
 * photos' light taken out — then the library's style that fits it
 * (hair-library.ts).
 */

export type HairReading = {
  length: HairLength
  tied: boolean
  volume: 'flat' | 'normal' | 'big'
  fringe: boolean
  /** The hair's colour (linear), its light taken out as the skin's is; null where none showed. */
  colour: Rgb | null
  /** What it was read from (mm, shares 0–1), for the report. */
  measures: {
    views: number
    scalpHair: number
    thicknessMm: number
    lowestMm: number | null
    sideMm: number | null
    fringe: number
  }
}

/** A plane's value (0–255) where it counts as that class. */
const SURE = 128
/** The scalp: the crown above every hairline, and the back of the head above the nape (m from the eyes). */
const CROWN = 0.09
const BACK = 0.03
const NAPE = -0.02
/** Less of the scalp than this showing hair is a bald head. */
const BALD_SCALP = 0.35
/**
 * "Hair" on the scalp nearer the skin's own colour than this (CIELAB ΔE),
 * once the photos' light is taken out, is a shaved scalp's skin that the
 * segmenter took for hair.
 */
const BARE_SCALP_DE = 12
/** Hair standing less than this (mm) off the skull is a buzz cut, more than this a big volume. */
const BUZZ_MM = 10
const BIG_MM = 45
/** Lowest hair anywhere (mm from the eyes) at or below this is long, and below this past the shoulders. */
const LONG_MM = -150
const SHOULDER_MM = -330
/**
 * Hair beside the face, seen from the front, reaching this low (mm from the
 * eyes) is medium: a bob falls to the jaw, where short hair ends by the ears
 * however low it reaches at the nape. Long hair not reaching it there is
 * gathered back.
 */
const SIDE_MM = -80
/** The lower forehead under hair for a fringe. */
const FRINGE_SHARE = 0.45
/** The face's top above the eyes (m): below it, ahead of the ears, hair is a beard or a fringe. */
const FACE_TOP = 0.03
/** How dark hair photographs against its colour (its own strands shade it), as the skin's light is taken out. */
const HAIR_SHADE = 1.5
/**
 * The sheen on hair (linear lightness, the skin's light taken out): about
 * the same whatever the hair's colour, so most of what dark hair shows; it
 * is taken off, down to no less than SHEEN_FLOOR of the hair's lightness.
 */
const SHEEN = 0.006
const SHEEN_FLOOR = 0.35

type ViewData = {
  view: CaptureView
  camera: Camera
  hair: Uint8Array
  skin: (i: number) => number
  person: Uint8Array
}

export function readHair(
  views: CaptureView[],
  fit: FitResult,
  base: BaseBody,
  skinAlbedo: Rgb,
): HairReading {
  const model = base.head
  const positions = fit.positions
  const { eyes, earZ } = model.frame
  const count = model.vertices.length
  const normals = vertexNormals(positions, model.triangles, count)
  const data: ViewData[] = []
  views.forEach((view, k) => {
    const camera = fit.cameras[k]
    if (!(view.classes && camera)) return
    const face = classPlane(view.classes, 'faceSkin')
    const body = classPlane(view.classes, 'bodySkin')
    const hair = classPlane(view.classes, 'hair')
    const person = new Uint8Array(view.width * view.height)
    const background = classPlane(view.classes, 'background')
    for (let i = 0; i < person.length; i++)
      person[i] = (view.mask ? view.mask[i]! : 255 - background[i]!) > SURE ? 1 : 0
    data.push({ view, camera, hair, skin: (i) => face[i]! + body[i]!, person })
  })
  const measures = {
    views: data.length,
    scalpHair: 0,
    thicknessMm: 0,
    lowestMm: null as number | null,
    sideMm: null as number | null,
    fringe: 0,
  }
  if (!data.length) {
    return { length: 'short', tied: false, volume: 'normal', fringe: false, colour: null, measures }
  }

  // The scalp: how much of it, where a photo faces it, shows hair rather than skin.
  let hairSum = 0
  let skinSum = 0
  for (const d of data) {
    const centre = cameraCentre(d.camera)
    for (let i = 0; i < count; i++) {
      if (!model.skin[i]) continue
      const y = model.rest[i * 3 + 1]! - eyes[1]
      const z = model.rest[i * 3 + 2]!
      if (!(y > CROWN || (z < earZ - BACK && y > NAPE))) continue
      const p: Vec3 = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!]
      const toward: Vec3 = [centre[0] - p[0], centre[1] - p[1], centre[2] - p[2]]
      const length = Math.hypot(...toward)
      const facing =
        (normals[i * 3]! * toward[0] +
          normals[i * 3 + 1]! * toward[1] +
          normals[i * 3 + 2]! * toward[2]) /
        length
      if (facing < 0.3) continue
      const at = pixelOf(d.camera, p)
      if (at < 0) continue
      hairSum += facing * d.hair[at]!
      skinSum += facing * d.skin(at)
    }
  }
  measures.scalpHair = hairSum + skinSum > 0 ? hairSum / (hairSum + skinSum) : 0

  // How far the hair stands off the skull, above the eyes: the outline's area past the fitted
  // head's, over the head's outline there.
  let thickness = 0
  let thicknessViews = 0
  for (const d of data) {
    const { width, height } = d.view
    const xy = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      const [u, v] = project(d.camera, [
        positions[i * 3]!,
        positions[i * 3 + 1]!,
        positions[i * 3 + 2]!,
      ])
      xy[i * 2] = u
      xy[i * 2 + 1] = v
    }
    const skull = new Uint8Array(width * height)
    fillTriangles(xy, model.triangles, width, height, skull, 1)
    const eyeRow = Math.round(project(d.camera, eyes)[1])
    const top = Math.max(0, Math.min(height, eyeRow))
    let extra = 0
    let edge = 0
    for (let y = 0; y < top; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const outline = d.person[i] || d.hair[i]! > SURE
        if (outline && !skull[i]) extra++
        if (
          skull[i] &&
          (x === 0 ||
            !skull[i - 1] ||
            x === width - 1 ||
            !skull[i + 1] ||
            y === 0 ||
            !skull[i - width])
        )
          edge++
      }
    }
    if (edge < 10) continue
    const depth = toCameraDepth(d.camera, eyes)
    thickness += ((extra / edge) * depth) / d.camera.focal
    thicknessViews++
  }
  measures.thicknessMm = thicknessViews ? (thickness / thicknessViews) * 1000 : 0

  // How low the hair reaches: the lowest hair pixel joined to the hair over the skull, put on the
  // vertical through the head's middle; in the front photos, that is beside the face.
  const middle: Vec3 = [eyes[0], eyes[1], (eyes[2] + model.frame.earZ) / 2 - 0.03]
  let lowest = Number.POSITIVE_INFINITY
  let side = Number.POSITIVE_INFINITY
  for (const d of data) {
    const row = lowestHairRow(d, model, positions)
    if (row === null) continue
    const height = heightAtRow(d.camera, middle, row) - eyes[1]
    lowest = Math.min(lowest, height)
    if (Math.abs(d.view.yaw) < 0.35) side = Math.min(side, height)
  }
  measures.lowestMm = Number.isFinite(lowest) ? lowest * 1000 : null
  measures.sideMm = Number.isFinite(side) ? side * 1000 : null

  // A fringe: hair over the lower forehead, from the brows halfway up (a hairline far back on the
  // forehead is not a fringe).
  for (const d of data) {
    if (Math.abs(d.view.yaw) > 0.35 || !d.view.landmarks) continue
    const ring = [9, 336, 296, 334, 333, 337, 151, 108, 104, 105, 66, 107]
    const xy = ring.flatMap((l) => [d.view.landmarks![l * 2]!, d.view.landmarks![l * 2 + 1]!])
    const triangles: number[] = []
    for (let i = 1; i < ring.length - 1; i++) triangles.push(0, i, i + 1)
    const { width, height } = d.view
    const forehead = new Uint8Array(width * height)
    fillTriangles(xy, triangles, width, height, forehead, 1)
    let under = 0
    let all = 0
    for (let i = 0; i < forehead.length; i++) {
      if (!forehead[i]) continue
      all++
      if (d.hair[i]! > SURE) under++
    }
    if (all) measures.fringe = Math.max(measures.fringe, under / all)
  }

  const seen = hairColour(data, eyes, skinAlbedo)
  const srgb = (c: Rgb) => c.map((v) => linearToSrgb(v)) as Rgb
  const bare = seen !== null && deltaE(srgb(seen.lit), srgb(skinAlbedo)) < BARE_SCALP_DE
  const colour = seen?.colour ?? null
  const bald = (measures.scalpHair < BALD_SCALP || bare) && measures.thicknessMm < BUZZ_MM
  // Hair hanging past the neck is long however flat it lies on top (a ponytail).
  const lowestMm = measures.lowestMm ?? 0
  const sideMm = measures.sideMm ?? lowestMm
  const length: HairLength = bald
    ? 'bald'
    : lowestMm <= LONG_MM
      ? 'long'
      : sideMm <= SIDE_MM
        ? 'medium'
        : measures.thicknessMm < BUZZ_MM
          ? 'buzz'
          : 'short'
  return {
    length,
    tied: length === 'long' && sideMm > SIDE_MM,
    volume:
      measures.thicknessMm > BIG_MM ? 'big' : measures.thicknessMm < BUZZ_MM ? 'flat' : 'normal',
    fringe: measures.fringe > FRINGE_SHARE,
    colour,
    measures,
  }
}

/** The library's style for a reading: none for a bald head. */
export function hairStyleFor(reading: HairReading, gender: AvatarGender): HairStyleName | null {
  if (reading.length === 'bald') return null
  if (reading.length === 'buzz') return 'buzz'
  if (reading.volume === 'big') return 'afro01'
  if (reading.length === 'long') {
    if (reading.tied) return 'ponytail01'
    return (reading.measures.lowestMm ?? 0) > SHOULDER_MM ? 'long01-shoulder' : 'long01'
  }
  if (reading.length === 'medium') return reading.fringe ? 'bob02' : 'long01-bob'
  return reading.fringe || gender === 'female' ? 'short03' : 'short02'
}

function pixelOf(camera: Camera, p: Vec3): number {
  const [u, v] = project(camera, p)
  const x = Math.floor(u)
  const y = Math.floor(v)
  if (x < 0 || y < 0 || x >= camera.width || y >= camera.height) return -1
  return y * camera.width + x
}

function toCameraDepth(camera: Camera, p: Vec3): number {
  const r = camera.rotation
  return r[6]! * p[0] + r[7]! * p[1] + r[8]! * p[2] + camera.translation[2]
}

/** The body height (m) on the vertical through `middle` that lands on image row `row`. */
function heightAtRow(camera: Camera, middle: Vec3, row: number): number {
  let best = middle[1]
  let bestError = Number.POSITIVE_INFINITY
  for (let dy = 0.2; dy >= -0.8; dy -= 0.0025) {
    const v = project(camera, [middle[0], middle[1] + dy, middle[2]])[1]
    const error = Math.abs(v - row)
    if (error < bestError) {
      bestError = error
      best = middle[1] + dy
    }
  }
  return best
}

/**
 * The lowest row of hair joined (through hair) to the hair about the skull's
 * top half, never through the face (a beard joined to the sideburns is not
 * hair hanging down).
 */
function lowestHairRow(d: ViewData, model: HeadModel, positions: Float64Array): number | null {
  const { width, height } = d.view
  const count = model.vertices.length
  const triangles = model.triangles
  const xy = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const [u, v] = project(d.camera, [
      positions[i * 3]!,
      positions[i * 3 + 1]!,
      positions[i * 3 + 2]!,
    ])
    xy[i * 2] = u
    xy[i * 2 + 1] = v
  }
  const skull = new Uint8Array(width * height)
  fillTriangles(xy, triangles, width, height, skull, 1)
  // The face: skin ahead of the ears and below the brows.
  const { eyes, earZ } = model.frame
  const onFace = (v: number) =>
    model.rest[v * 3 + 2]! > earZ && model.rest[v * 3 + 1]! < eyes[1] + FACE_TOP
  const face = new Uint8Array(width * height)
  fillTriangles(xy, triangles, width, height, face, 1, (t) =>
    [0, 1, 2].every((k) => onFace(triangles[t * 3 + k]!)),
  )
  let top = height
  let bottom = 0
  for (let i = 0; i < skull.length; i++) {
    if (!skull[i]) continue
    const y = Math.floor(i / width)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  if (top >= bottom) return null
  const upper = top + (bottom - top) * 0.4
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  for (let i = 0; i < skull.length; i++) {
    const y = Math.floor(i / width)
    if (y > upper || d.hair[i]! <= SURE || face[i]) continue
    seen[i] = 1
    stack.push(i)
  }
  let lowest = -1
  while (stack.length) {
    const i = stack.pop()!
    const y = Math.floor(i / width)
    if (y > lowest) lowest = y
    const x = i % width
    for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
      if (n < 0 || n >= seen.length || seen[n] || face[n] || d.hair[n]! <= SURE) continue
      seen[n] = 1
      stack.push(n)
    }
  }
  return lowest < 0 ? null : lowest
}

/**
 * The hair's colour: the median of the surest hair pixels above the eyes
 * (no beard) over every photo (linear), brought to the skin's light — the
 * photos' skin against the skin's colour, by lightness only — its sheen
 * taken off and lifted for the shade hair casts on itself. Also the colour
 * as lit, before those two: where the "hair" is a shaved scalp's skin, that
 * is the skin's own colour.
 */
function hairColour(
  data: ViewData[],
  eyes: Vec3,
  skinAlbedo: Rgb,
): { colour: Rgb; lit: Rgb } | null {
  const hair: number[][] = [[], [], []]
  const skin: number[] = []
  // Only pixels well inside the hair (its edges mix in what is behind it).
  const inner = (d: ViewData, i: number, width: number) =>
    [i, i - 3, i + 3, i - 3 * width, i + 3 * width].every((j) => (d.hair[j] ?? 0) > 230)
  for (const d of data) {
    const { rgba, width, height } = d.view
    const eyeRow = project(d.camera, eyes)[1]
    for (let i = 0; i < width * height; i += 2) {
      if (i / width < eyeRow && inner(d, i, width)) {
        for (let k = 0; k < 3; k++) hair[k]!.push(srgbToLinear(rgba[i * 4 + k]!))
      } else if (d.skin(i) > 230 && Math.abs(d.view.yaw) < 0.35) {
        skin.push(
          0.2126 * srgbToLinear(rgba[i * 4]!) +
            0.7152 * srgbToLinear(rgba[i * 4 + 1]!) +
            0.0722 * srgbToLinear(rgba[i * 4 + 2]!),
        )
      }
    }
  }
  if (hair[0]!.length < 50) return null
  const median = (list: number[]) => {
    list.sort((a, b) => a - b)
    return list[list.length >> 1]!
  }
  const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const gain = skin.length > 50 ? luma(skinAlbedo) / Math.max(median(skin), 1e-4) : 1
  const lit = hair.map((c) => median(c) * gain) as Rgb
  const lightness = Math.max(luma(lit), 1e-6)
  const kept = Math.max(lightness - SHEEN, lightness * SHEEN_FLOOR) / lightness
  return { colour: lit.map((c) => Math.min(1, c * kept * HAIR_SHADE)) as Rgb, lit }
}
