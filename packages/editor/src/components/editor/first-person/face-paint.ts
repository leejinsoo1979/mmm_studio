/**
 * What the player paints on their character's face: iris colour, brows,
 * make-up, facial hair and freckles. Colours are hex (null keeps the
 * character's own), amounts 0–1 and the brows' darkness and thickness −1–1
 * (0 leaving them as they are).
 */

import { connectedFrom, dilate, fillFrom } from './face-fill'
import { FACE_PARTS, facePointOf, type Point, unpackPoints } from './face-points'
import { forEachTexel, renderFront, sampleColor } from './front-render'
import type { HeadGeometry } from './head-geometry'
import {
  colorDistance,
  type HeadTriangle,
  hexToRgb,
  luminance,
  type Pixels,
  type Rgb,
} from './look-pixels'

export const BEARD_STYLES = ['none', 'stubble', 'mustache', 'goatee', 'full'] as const
export type BeardStyle = (typeof BEARD_STYLES)[number]

export type FacePaint = {
  eyes: string | null
  browColor: string | null
  browDarkness: number
  browThickness: number
  lips: string | null
  lipAmount: number
  blush: string | null
  blushAmount: number
  shadow: string | null
  shadowAmount: number
  liner: number
  beard: BeardStyle
  beardAmount: number
  freckles: number
}

export const NO_PAINT: FacePaint = {
  eyes: null,
  browColor: null,
  browDarkness: 0,
  browThickness: 0,
  lips: null,
  lipAmount: 0.6,
  blush: null,
  blushAmount: 0.5,
  shadow: null,
  shadowAmount: 0.5,
  liner: 0,
  beard: 'none',
  beardAmount: 0.7,
  freckles: 0,
}

const HEX = /^#[0-9a-f]{6}$/i
const hex = (value: unknown) => (typeof value === 'string' && HEX.test(value) ? value : null)
const within = (value: unknown, low: number, high: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(high, Math.max(low, value))
    : fallback

/** Face paint as saved or received (anything unknown or out of range made safe). */
export function readFacePaint(value: unknown): FacePaint {
  const paint = value as Partial<FacePaint> | null
  if (!paint || typeof paint !== 'object') return NO_PAINT
  return {
    eyes: hex(paint.eyes),
    browColor: hex(paint.browColor),
    browDarkness: within(paint.browDarkness, -1, 1, 0),
    browThickness: within(paint.browThickness, -1, 1, 0),
    lips: hex(paint.lips),
    lipAmount: within(paint.lipAmount, 0, 1, NO_PAINT.lipAmount),
    blush: hex(paint.blush),
    blushAmount: within(paint.blushAmount, 0, 1, NO_PAINT.blushAmount),
    shadow: hex(paint.shadow),
    shadowAmount: within(paint.shadowAmount, 0, 1, NO_PAINT.shadowAmount),
    liner: within(paint.liner, 0, 1, 0),
    beard: BEARD_STYLES.includes(paint.beard as BeardStyle) ? (paint.beard as BeardStyle) : 'none',
    beardAmount: within(paint.beardAmount, 0, 1, NO_PAINT.beardAmount),
    freckles: within(paint.freckles, 0, 1, 0),
  }
}

/** Whether the paint changes anything on the face. */
export const hasFacePaint = (paint: FacePaint | null | undefined) =>
  Boolean(
    paint &&
      (paint.eyes ||
        paint.browColor ||
        paint.browDarkness !== 0 ||
        paint.browThickness !== 0 ||
        (paint.lips && paint.lipAmount > 0) ||
        (paint.blush && paint.blushAmount > 0) ||
        (paint.shadow && paint.shadowAmount > 0) ||
        paint.liner > 0 ||
        (paint.beard !== 'none' && paint.beardAmount > 0) ||
        paint.freckles > 0),
  )

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** A pseudo-random number (0–1) for a cell of a grid: the same every time, so paint doesn't flicker as it's redone. */
function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth noise (0–1): a grid's random values (a cell apart per unit) blended across the cells. */
function valueNoise(x: number, y: number, seed: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smoothstep(0, 1, x - x0)
  const fy = smoothstep(0, 1, y - y0)
  const top = hash(x0, y0, seed) + (hash(x0 + 1, y0, seed) - hash(x0, y0, seed)) * fx
  const bottom = hash(x0, y0 + 1, seed) + (hash(x0 + 1, y0 + 1, seed) - hash(x0, y0 + 1, seed)) * fx
  return top + (bottom - top) * fy
}

/** A box on the head's front view (fractions of it): left, top, right, bottom. */
type Box = [number, number, number, number]

const inBox = (box: Box, x: number, y: number) =>
  x >= box[0] && y >= box[1] && x <= box[2] && y <= box[3]

function boxAround(points: readonly Point[], margin: number): Box {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return [
    Math.min(...xs) - margin,
    Math.min(...ys) - margin,
    Math.max(...xs) + margin,
    Math.max(...ys) + margin,
  ]
}

const joinBoxes = (boxes: readonly Box[]): Box => [
  Math.min(...boxes.map((box) => box[0])),
  Math.min(...boxes.map((box) => box[1])),
  Math.max(...boxes.map((box) => box[2])),
  Math.max(...boxes.map((box) => box[3])),
]

/** An outline's signed distance from a point: negative inside it. */
function outlineDistance(outline: readonly Point[], x: number, y: number) {
  let inside = false
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, ay] = outline[j]!
    const [bx, by] = outline[i]!
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside
    const dx = bx - ax
    const dy = by - ay
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
    nearest = Math.min(nearest, (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2)
  }
  return inside ? -Math.sqrt(nearest) : Math.sqrt(nearest)
}

/** Part of the face, as an outline on the front view whose edge fades over `feather` either side of it. */
type Area = { outline: Point[]; feather: number; box: Box }

const areaOf = (outline: Point[], feather: number): Area => ({
  outline,
  feather,
  box: boxAround(outline, feather),
})

/** How much of a point an area covers (0–1). */
const cover = (area: Area, x: number, y: number) =>
  inBox(area.box, x, y)
    ? 1 - smoothstep(-area.feather, area.feather, outlineDistance(area.outline, x, y))
    : 0

/** A bilinear sample of a `width` × `height` grid of values at pixel-centre coordinates (clamped to it). */
function sampleField(grid: Float32Array, width: number, height: number, px: number, py: number) {
  const x = Math.min(width - 1, Math.max(0, px))
  const y = Math.min(height - 1, Math.max(0, py))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const upper =
    grid[y0 * width + x0]! + (grid[y0 * width + x1]! - grid[y0 * width + x0]!) * (x - x0)
  const lower =
    grid[y1 * width + x0]! + (grid[y1 * width + x1]! - grid[y1 * width + x0]!) * (x - x0)
  return upper + (lower - upper) * (y - y0)
}

/** How many grid cells a soft outline's fading edge spans when it is drawn out before painting. */
const FIELD_CELLS = 5

/**
 * A value over the front view drawn out on a grid over a box, `feather`
 * being the finest detail it has, read back bilinearly (0 outside the
 * box): an outline's distance, worked out once per grid point rather than
 * per texel.
 */
function fieldOf(box: Box, feather: number, value: (x: number, y: number) => number) {
  const [left, top] = box
  const cells = FIELD_CELLS / feather
  const columns = Math.max(2, Math.ceil((box[2] - left) * cells) + 1)
  const rows = Math.max(2, Math.ceil((box[3] - top) * cells) + 1)
  const grid = new Float32Array(columns * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      grid[j * columns + i] = value(left + i / cells, top + j / cells)
    }
  }
  return (x: number, y: number) => {
    const gx = (x - left) * cells
    const gy = (y - top) * cells
    return gx >= 0 && gy >= 0 && gx <= columns - 1 && gy <= rows - 1
      ? sampleField(grid, columns, rows, gx, gy)
      : 0
  }
}

/** A line's height at `x` (its points in order of x), level past its ends. */
function heightAt(line: readonly Point[], x: number) {
  if (x <= line[0]![0]) return line[0]![1]
  for (let i = 1; i < line.length; i++) {
    const [bx, by] = line[i]!
    if (x > bx) continue
    const [ax, ay] = line[i - 1]!
    return bx > ax ? ay + ((by - ay) * (x - ax)) / (bx - ax) : by
  }
  return line[line.length - 1]![1]
}

const byX = (points: readonly Point[]) => [...points].sort((a, b) => a[0] - b[0])

/**
 * Tints a colour (in place, 0–255 floats) towards `tint` by `w`, keeping
 * its lightness relative to `ref` (the painted area's usual lightness), so
 * the texture's shading and detail show through.
 */
function tintKeepingLight(colour: Float64Array, tint: Rgb, ref: number, w: number) {
  if (w <= 0) return
  const ratio = luminance(colour[0]!, colour[1]!, colour[2]!) / Math.max(1, ref)
  for (let c = 0; c < 3; c++) {
    colour[c] = colour[c]! + (Math.min(255, tint[c]! * ratio) - colour[c]!) * w
  }
}

/** Mixes a colour (in place) towards another by `w`. */
function mixTowards(colour: Float64Array, towards: ArrayLike<number>, w: number) {
  for (let c = 0; c < 3; c++) colour[c] = colour[c]! + (towards[c]! - colour[c]!) * w
}

/**
 * A face's landmarks on its front view, its scale (`eyes`: the distance
 * between its eyes' centres) and the height of the line through those
 * centres at any `x`.
 */
type Face = {
  points: Point[]
  at: (landmark: number) => Point
  eyes: number
  eyeLine: (x: number) => number
}

function faceOf(target: readonly number[]): Face {
  const points = unpackPoints(target)
  const centre = (indices: readonly number[]): Point => [
    indices.reduce((sum, i) => sum + points[i]![0], 0) / indices.length,
    indices.reduce((sum, i) => sum + points[i]![1], 0) / indices.length,
  ]
  const [rx, ry] = centre(FACE_PARTS.rightEye)
  const [lx, ly] = centre(FACE_PARTS.leftEye)
  const slope = lx === rx ? 0 : (ly - ry) / (lx - rx)
  return {
    points,
    at: (landmark) => points[facePointOf(landmark)]!,
    eyes: Math.hypot(lx - rx, ly - ry),
    eyeLine: (x) => ry + (x - rx) * slope,
  }
}

/**
 * The colours the front view shows inside a box where `where` holds, darkest
 * first (pixels nothing is drawn on left out).
 */
function frontColours(front: Pixels, box: Box, where: (x: number, y: number) => boolean): Rgb[] {
  const size = front.width
  const colours: Rgb[] = []
  const top = Math.max(0, Math.floor(box[1] * size))
  const bottom = Math.min(size - 1, Math.ceil(box[3] * size))
  const left = Math.max(0, Math.floor(box[0] * size))
  const right = Math.min(size - 1, Math.ceil(box[2] * size))
  for (let py = top; py <= bottom; py++) {
    for (let px = left; px <= right; px++) {
      const p = (py * size + px) * 4
      if (front.data[p + 3] === 0 || !where((px + 0.5) / size, (py + 0.5) / size)) continue
      colours.push([front.data[p]!, front.data[p + 1]!, front.data[p + 2]!])
    }
  }
  return colours.sort((a, b) => luminance(...a) - luminance(...b))
}

const quantile = (sorted: readonly Rgb[], at: number, fallback: Rgb): Rgb =>
  sorted.length > 0
    ? sorted[Math.min(sorted.length - 1, Math.floor(at * sorted.length))]!
    : fallback

/** The front view's side (px) a face's colours are measured on: they are medians, so coarse will do. */
const MEASURE_VIEW = 512

/** How far round the cheeks' landmarks the skin's colour is measured (× the distance between the eyes). */
const SKIN_SAMPLE = 0.06

/** The skin's colour when the front view shows none. */
const FALLBACK_SKIN: Rgb = [200, 160, 140]

/** The skin's colour: the front view's round the cheeks' landmarks, by median lightness. */
function skinColour(face: Face, front: Pixels): Rgb {
  const cheeks = FACE_PARTS.cheeks.map((i) => face.points[i]!)
  const reach = SKIN_SAMPLE * face.eyes
  return quantile(
    frontColours(front, boxAround(cheeks, reach), (x, y) =>
      cheeks.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= reach * reach),
    ),
    0.5,
    FALLBACK_SKIN,
  )
}

/**
 * How the character's hair over a painted layer hides it: texel by texel
 * (`strands`); where the hair lies thick all round, and its strands near a
 * lot more of it (`locks`: the hair's mask takes in a brow's darkest hairs
 * too, scattered, and those are the brow's; a fringe over the brow is hair
 * throughout, and its tips lie by it); or not at all (null).
 */
type UnderHair = 'strands' | 'locks' | null

/** The coarse grid (texels a cell) the hair's density is read on to tell a fringe's strands from a brow's hairs, and how many cells round each it takes in. */
const FRINGE_CELL = 8
const FRINGE_REACH = 2

/** The share of the texture round a strand the hair must take for the strand to be a fringe's (fully from the second). */
const FRINGE_FROM = 0.25
const FRINGE_TO = 0.5

const fringes = new WeakMap<Float32Array, Float32Array>()

/** How much of the texture round each cell of a coarse grid (see `FRINGE_*`) the hair's mask takes: worked out once per mask. */
function fringeDensity(hair: Float32Array, width: number, height: number): Float32Array {
  const found = fringes.get(hair)
  if (found) return found
  const cw = Math.ceil(width / FRINGE_CELL)
  const ch = Math.ceil(height / FRINGE_CELL)
  const sums = new Float32Array(cw * ch)
  const counts = new Float32Array(cw * ch)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const j = Math.floor(y / FRINGE_CELL) * cw + Math.floor(x / FRINGE_CELL)
      sums[j]! += hair[y * width + x]!
      counts[j]!++
    }
  }
  for (let j = 0; j < sums.length; j++) sums[j]! /= Math.max(1, counts[j]!)
  const density = blurField(sums, cw, ch, FRINGE_REACH)
  fringes.set(hair, density)
  return density
}

/**
 * How much a lock of hair covers a texel (0–1, see `UnderHair`): where the
 * hair lies thick all round, or the texel is a strand near a lot more of
 * it (`fringe`, its density on a coarse grid `fw` × `fh`: see
 * fringeDensity).
 */
function lockOver(
  hair: Float32Array,
  fringe: Float32Array,
  fw: number,
  fh: number,
  width: number,
  height: number,
  texel: number,
) {
  const lock = smoothstep(LOCK_FROM, LOCK_TO, hairAround(hair, width, height, texel))
  const x = texel % width
  const y = (texel - x) / width
  const near = smoothstep(
    FRINGE_FROM,
    FRINGE_TO,
    sampleField(fringe, fw, fh, (x + 0.5) / FRINGE_CELL - 0.5, (y + 0.5) / FRINGE_CELL - 0.5),
  )
  return Math.max(lock, smoothstep(STRAND_FROM, STRAND_TO, hair[texel]!) * near)
}

/** How far round a texel (texels) the hair is taken in to tell locks of it from a brow's hairs. */
const LOCK_REACH = 4

/** The share of the texels round it that must be hair for a lock to hide what is under it (fully from the second). */
const LOCK_FROM = 0.4
const LOCK_TO = 0.75

/** How much hair a texel must be (fully from the second) to be a strand of a lock (see `lockOver`). */
const STRAND_FROM = 0.05
const STRAND_TO = 0.4

/** How thickly hair lies round a texel: the share of the texels near it the hair's mask takes. */
function hairAround(hair: Float32Array, width: number, height: number, texel: number) {
  const x = texel % width
  const y = (texel - x) / width
  let sum = 0
  let count = 0
  for (let j = Math.max(0, y - LOCK_REACH); j <= Math.min(height - 1, y + LOCK_REACH); j++) {
    for (let i = Math.max(0, x - LOCK_REACH); i <= Math.min(width - 1, x + LOCK_REACH); i++) {
      sum += hair[j * width + i]!
      count++
    }
  }
  return sum / count
}

/** Reads the head's texture as it was, before any paint (into `out`), at an offset on the front view from the texel being painted. */
type Look = (dx: number, dy: number, out: Uint8ClampedArray) => void

/**
 * One thing painted on the face: the box on the front view it keeps to,
 * how the character's hair over it hides it, and what it does to a texel
 * showing at a point there — `paint` changes the texel's colour (in place,
 * by `strength` 0–1; `texel` is its index, for detail as fine as the
 * texture's own; `look` reads the texture round it, for a layer that
 * `looks`), and `moves`, where there is one, says where on the front view
 * the texel takes its colour from instead (an offset into `offset`; false
 * for nowhere else).
 */
type Layer = {
  box: Box
  underHair: UnderHair
  looks?: boolean
  moves?: (x: number, y: number, offset: Float64Array) => boolean
  paint: (
    colour: Float64Array,
    x: number,
    y: number,
    strength: number,
    texel: number,
    look: Look,
  ) => void
}

/** How far lipstick fades across the lips' edge, either side, as a share of the mouth's height. */
const LIP_FEATHER = 0.1

/** The upper lip's outer edge between the mouth's corners (MediaPipe landmarks), and the inner edge each point of it faces. */
const UPPER_LIP = [185, 40, 39, 37, 0, 267, 269, 270, 409] as const
const UPPER_LIP_INNER = [191, 80, 81, 82, 13, 312, 311, 310, 415] as const

/**
 * How far up past its landmarks the upper lip's edge is looked for (a
 * share of the lip's height there), in this many steps: a character's
 * landmarks can sit inside its lips, and the lip reaches as far as the
 * front view stays nearer the lips' colour than the skin's.
 */
const LIP_SEARCH = 0.6
const LIP_SEARCH_STEPS = 6

/** How far above the upper lip the skin by it is read (a share of the lip's height past the search). */
const LIP_SKIN_ABOVE = 0.4

/** The side (px) of the close front view the lips' edge is found on: finer than a whole view drawn at once. */
const MOUTH_VIEW = 256

/**
 * The lips' outline (as FACE_PARTS.lips), the upper lip's edge moved up
 * to where its colour ends (see `LIP_SEARCH`), by the median of how far
 * it reaches past each of its landmarks. `own` is the lips' colour.
 */
function lipOutline(face: Face, head: Pixels, geometry: HeadGeometry, own: Rgb): Point[] {
  const outline = FACE_PARTS.lips.map((i) => face.points[i]!)
  const tops = UPPER_LIP.map(face.at)
  const inner = UPPER_LIP_INNER.map(face.at)
  // Framing the lips and all the search above them, the skin's colour too.
  const farthest = tops.map(([tx, ty], k): Point => {
    const [ix, iy] = inner[k]!
    const share = LIP_SEARCH + LIP_SKIN_ABOVE
    return [tx + (tx - ix) * share, ty + (ty - iy) * share]
  })
  const view = closeView(head, geometry.all, boxAround([...outline, ...farthest], 0), MOUTH_VIEW)
  const sample = new Uint8ClampedArray(3)
  const at = (k: number, share: number): Rgb => {
    const [tx, ty] = tops[k]!
    const [ix, iy] = inner[k]!
    view(tx + (tx - ix) * share, ty + (ty - iy) * share, sample)
    return [sample[0]!, sample[1]!, sample[2]!]
  }
  const skins = tops.map((_, k) => at(k, LIP_SEARCH + LIP_SKIN_ABOVE))
  const skin = quantile(
    skins.sort((a, b) => luminance(...a) - luminance(...b)),
    0.5,
    FALLBACK_SKIN,
  )
  const ownLum = luminance(...own)
  const skinLum = luminance(...skin)
  const reaches = tops.map((_, k) => {
    let reach = 0
    for (let step = 1; step <= LIP_SEARCH_STEPS; step++) {
      const share = (LIP_SEARCH * step) / LIP_SEARCH_STEPS
      const colour = at(k, share)
      if (colorDistance(...colour, own, ownLum) >= colorDistance(...colour, skin, skinLum)) break
      reach = share
    }
    return reach
  })
  const reach = [...reaches].sort((a, b) => a - b)[Math.floor(reaches.length / 2)]!
  const moved = new Map(
    UPPER_LIP.map((landmark, k): [number, Point] => {
      const [tx, ty] = tops[k]!
      const [ix, iy] = inner[k]!
      return [facePointOf(landmark), [tx + (tx - ix) * reach, ty + (ty - iy) * reach]]
    }),
  )
  return FACE_PARTS.lips.map((i) => moved.get(i) ?? face.points[i]!)
}

/** The lips' own colour: the median of what the front view shows well inside their landmarks. */
function lipColour(face: Face, front: Pixels): Rgb {
  const outline = FACE_PARTS.lips.map((i) => face.points[i]!)
  const lips = areaOf(outline, LIP_FEATHER * mouthHeight(face))
  return quantile(
    frontColours(front, lips.box, (x, y) => outlineDistance(outline, x, y) < -lips.feather),
    0.5,
    FALLBACK_SKIN,
  )
}

/** The mouth's height, the upper lip's top to the lower lip's bottom. */
const mouthHeight = (face: Face) =>
  Math.hypot(face.at(0)[0] - face.at(17)[0], face.at(0)[1] - face.at(17)[1])

function lipsLayer(face: Face, outline: Point[], own: Rgb, tint: Rgb, amount: number): Layer {
  const lips = areaOf(outline, LIP_FEATHER * mouthHeight(face))
  // The tint keeps each texel's lightness relative to the lips'.
  const ref = luminance(...own)
  const covered = fieldOf(lips.box, lips.feather, (x, y) => cover(lips, x, y))
  return {
    box: lips.box,
    underHair: null,
    paint: (colour, x, y, strength) =>
      tintKeepingLight(colour, tint, ref, amount * strength * covered(x, y)),
  }
}

/**
 * A blush's reach along the cheekbone and across it (× the distance between
 * the eyes, where it has faded to a seventh), and how much colour it lays
 * at its heart.
 */
const BLUSH_ALONG = 0.42
const BLUSH_ACROSS = 0.26
const BLUSH_STRENGTH = 0.5

/** How a patch of colour (a blush, freckles' density) falls off: e^−(this × distance²), distance in its reaches — a seventh at its reach. */
const PATCH_FALLOFF = 2

/** How far past its reach (× it) a patch's box goes: it has faded to under a hundredth there. */
const PATCH_BOX = 1.6

/** How far from the cheek's landmark towards the eye's outer corner a blush sits (a share of the way): up on the cheekbone. */
const BLUSH_LIFT = 0.3

/** The cheeks' landmarks, each with its eye's outer corner (the image's left first). */
const CHEEK_CORNERS = [
  [50, 33],
  [280, 263],
] as const

function blushLayer(face: Face, skinLum: number, tint: Rgb, amount: number): Layer {
  const spots = CHEEK_CORNERS.map(([cheek, corner]) => {
    const [cx, cy] = face.at(cheek)
    const [ex, ey] = face.at(corner)
    const length = Math.hypot(ex - cx, ey - cy) || 1
    return {
      x: cx + (ex - cx) * BLUSH_LIFT,
      y: cy + (ey - cy) * BLUSH_LIFT,
      ax: (ex - cx) / length,
      ay: (ey - cy) / length,
    }
  })
  const along = BLUSH_ALONG * face.eyes
  const across = BLUSH_ACROSS * face.eyes
  return {
    box: boxAround(
      spots.map(({ x, y }): Point => [x, y]),
      along * PATCH_BOX,
    ),
    underHair: 'strands',
    paint: (colour, x, y, strength) => {
      let glow = 0
      for (const spot of spots) {
        const dx = x - spot.x
        const dy = y - spot.y
        const a = (dx * spot.ax + dy * spot.ay) / along
        const b = (dx * spot.ay - dy * spot.ax) / across
        glow = Math.max(glow, Math.exp(-PATCH_FALLOFF * (a * a + b * b)))
      }
      tintKeepingLight(colour, tint, skinLum, BLUSH_STRENGTH * amount * glow * strength)
    },
  }
}

/** Each eye's upper lid, outer corner to inner (MediaPipe landmarks), the image's left eye first. */
const UPPER_LIDS = [
  [33, 246, 161, 160, 159, 158, 157, 173, 133],
  [263, 466, 388, 387, 386, 385, 384, 398, 362],
] as const

/** Each brow's upper and lower edge, outer end to inner, in the same order as UPPER_LIDS. */
const BROW_EDGES = [
  [
    [70, 63, 105, 66, 107],
    [46, 53, 52, 65, 55],
  ],
  [
    [300, 293, 334, 296, 336],
    [276, 283, 282, 295, 285],
  ],
] as const

/**
 * How far up from the lash line towards the brow eyeshadow reaches (a share
 * of the way), fading over its upper part, and how much colour it lays on
 * the lid at its fullest.
 */
const SHADOW_REACH = 0.75
const SHADOW_STRENGTH = 0.7

/** How far past the eye's outer corner eyeshadow sweeps (× the eye's width), and how steeply it rises there. */
const SHADOW_WING = 0.3
const SHADOW_RISE = 0.4

/** How far past the eye's inner corner eyeshadow may reach (× the eye's width), fading in over this much either side of the corner. */
const SHADOW_INNER = 0.2
const SHADOW_INNER_FADE = 0.15

/** Eyeshadow starts on the lash line: fading in from this far below it to this far above (shares of the way to the brow). */
const SHADOW_LASH_FROM = -0.06
const SHADOW_LASH_TO = 0.04

/** Eyeshadow is full up to this share of its reach, fading out over the rest. */
const SHADOW_FULL = 0.45

function shadowLayer(face: Face, skinLum: number, tint: Rgb, amount: number): Layer {
  const eyes = UPPER_LIDS.map((lid, k) => {
    const outer = face.at(lid[0])
    const inner = face.at(lid[lid.length - 1]!)
    return {
      outer,
      inner,
      lid: byX(lid.map(face.at)),
      brow: byX(BROW_EDGES[k]![1].map(face.at)),
      width: outer[0] - inner[0],
    }
  })
  const box = joinBoxes(
    eyes.map(({ outer, inner, brow, width }) =>
      boxAround([outer, inner, ...brow, [outer[0] + width * SHADOW_WING, outer[1]]], 0),
    ),
  )
  return {
    box,
    underHair: null,
    paint: (colour, x, y, strength) => {
      for (const { outer, inner, lid, brow, width } of eyes) {
        const s = (x - inner[0]) / width
        if (s < -SHADOW_INNER || s > 1 + SHADOW_WING) continue
        const lidY = s <= 1 ? heightAt(lid, x) : outer[1] - (s - 1) * Math.abs(width) * SHADOW_RISE
        const span = lidY - heightAt(brow, x)
        if (!(span > 0)) continue
        const up = (lidY - y) / span
        const w =
          smoothstep(SHADOW_LASH_FROM, SHADOW_LASH_TO, up) *
          (1 - smoothstep(SHADOW_REACH * SHADOW_FULL, SHADOW_REACH, up)) *
          smoothstep(-SHADOW_INNER_FADE, SHADOW_INNER_FADE, s) *
          (1 - smoothstep(1, 1 + SHADOW_WING, s))
        tintKeepingLight(colour, tint, skinLum, SHADOW_STRENGTH * amount * w * strength)
      }
    },
  }
}

/** The eyeliner's width at the eye's inner and outer corner (× the distance between the eyes). */
const LINER_INNER = 0.012
const LINER_OUTER = 0.03

/** The liner's flick past the outer corner: its length (× the distance between the eyes) and its rise (radians). */
const LINER_WING = 0.1
const LINER_RISE = 0.45

/** Eyeliner's colour: a soft black. */
const LINER_COLOUR: Rgb = [26, 20, 22]

/** Above its line eyeliner is solid out to this share of its width, fading to its edge; below, it fades over this share (onto the lashes' root). */
const LINER_SOLID = 0.55
const LINER_UNDER = 0.3

function linerLayer(face: Face, amount: number): Layer {
  const lines = UPPER_LIDS.map((lid) => {
    const points = [...lid].reverse().map(face.at)
    const inner = points[0]!
    const outer = points[points.length - 1]!
    // The flick leaves the corner along the eye, turned up.
    const dx = outer[0] - inner[0]
    const dy = outer[1] - inner[1]
    const length = Math.hypot(dx, dy) || 1
    const turn = dx > 0 ? -LINER_RISE : LINER_RISE
    const reach = LINER_WING * face.eyes
    const tip: Point = [
      outer[0] + ((dx * Math.cos(turn) - dy * Math.sin(turn)) / length) * reach,
      outer[1] + ((dx * Math.sin(turn) + dy * Math.cos(turn)) / length) * reach,
    ]
    const line = [...points, tip]
    const lengths = [0]
    for (let i = 1; i < line.length; i++) {
      lengths.push(
        lengths[i - 1]! + Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]),
      )
    }
    return { line, lengths, corner: lengths[lengths.length - 2]! }
  })
  const widest = LINER_OUTER * face.eyes
  return {
    box: joinBoxes(lines.map(({ line }) => boxAround(line, widest))),
    underHair: null,
    paint: (colour, x, y, strength) => {
      let ink = 0
      for (const { line, lengths, corner } of lines) {
        // The nearest point on the line: how far along it, and how far above or below.
        let nearest = Number.POSITIVE_INFINITY
        let along = 0
        let above = 0
        for (let i = 0; i + 1 < line.length; i++) {
          const [ax, ay] = line[i]!
          const [bx, by] = line[i + 1]!
          const dx = bx - ax
          const dy = by - ay
          const size = Math.sqrt(dx * dx + dy * dy) || 1e-9
          const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (size * size)))
          const distance = Math.sqrt((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2)
          if (distance >= nearest) continue
          nearest = distance
          along = lengths[i]! + t * size
          // Up the face is above, whichever way the segment runs.
          const cross = ((x - ax) * dy - (y - ay) * dx) / size
          above = dx > 0 ? cross : -cross
        }
        const total = lengths[lengths.length - 1]!
        const width =
          along <= corner
            ? (LINER_INNER + (LINER_OUTER - LINER_INNER) * smoothstep(0, corner, along)) * face.eyes
            : LINER_OUTER * face.eyes * (1 - (along - corner) / (total - corner))
        if (width <= 0) continue
        const w =
          above >= 0
            ? 1 - smoothstep(width * LINER_SOLID, width, nearest)
            : 1 - smoothstep(0, width * LINER_UNDER, nearest)
        ink = Math.max(ink, w)
      }
      if (ink > 0) mixTowards(colour, LINER_COLOUR, amount * ink * strength)
    },
  }
}

/** A brow's spine (the middle of its landmarks' upper and lower edges, outer end to inner) and half-thickness along it. */
type BrowSpine = { stations: Point[]; halves: number[] }

/** Where a point lies by a brow: see `browFrame`. */
type BrowFrame = {
  across: number
  half: number
  past: number
  nx: number
  ny: number
  segment: number
  t: number
}

const newBrowFrame = (): BrowFrame => ({
  across: 0,
  half: 0,
  past: 0,
  nx: 0,
  ny: 0,
  segment: 0,
  t: 0,
})

/**
 * Where a point lies by a brow: how far across it from its spine
 * (`across`, up the face positive, along the normal `nx`, `ny`), the
 * brow's half-thickness there, how far past its ends, and the spine's
 * segment it is nearest and how far along that (`t`, a share of it: below
 * 0 or over 1 only past the brow's ends).
 */
function browFrame({ stations, halves }: BrowSpine, x: number, y: number, frame: BrowFrame) {
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i + 1 < stations.length; i++) {
    const [ax, ay] = stations[i]!
    const [bx, by] = stations[i + 1]!
    const length = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2) || 1e-9
    const tx = (bx - ax) / length
    const ty = (by - ay) / length
    const along = (x - ax) * tx + (y - ay) * ty
    const t = Math.min(1, Math.max(0, along / length))
    const distance = (x - ax - (bx - ax) * t) ** 2 + (y - ay - (by - ay) * t) ** 2
    if (distance >= nearest) continue
    nearest = distance
    // Of the segment's two normals, the one up the view (y runs down it).
    const up = tx >= 0 ? 1 : -1
    frame.nx = ty * up
    frame.ny = -tx * up
    frame.across = (x - ax) * frame.nx + (y - ay) * frame.ny
    frame.half = halves[i]! + (halves[i + 1]! - halves[i]!) * t
    const first = i === 0 && along < 0
    const last = i + 2 === stations.length && along > length
    frame.past = first ? -along : last ? along - length : 0
    frame.segment = i
    frame.t = first || last ? along / length : t
  }
}

/** How much a brow's thickness at ±1 stretches it across (1 + this) or narrows it (1 − this). */
const BROW_GROWTH = 0.6

/**
 * A reshaped brow's texture is stretched across it out to its new edge and
 * this much further (× its new half-thickness), and from there eases back
 * to the skin as it was over this much more (× its half-thickness).
 */
const BROW_EDGE = 1.15
const BROW_EASE = 0.9

/** How far past a brow's ends (× its half-thickness) its reshaping and colour fade out. */
const BROW_END = 1.5

/**
 * Brow hairs are looked for out to this far across (× the brow's
 * half-thickness), and a texel counts as hair by how far its lightness lies
 * from the skin's towards the brow's (at least this many levels apart):
 * none of it up to the first share of the way (the skin's own shading),
 * all of it from the second.
 */
const BROW_REACH = 1.9
const BROW_CONTRAST = 16
const BROW_HAIR_FROM = 0.25
const BROW_HAIR_TO = 0.7

/**
 * A brow's own colours, measured on the front view: its hairs' as the
 * darker half's median (see BROW_HAIR_QUANTILE) of what lies this near its
 * spine (× its half-thickness), the skin's as the lighter side (see
 * BROW_SKIN_QUANTILE) of what lies between these two distances from it
 * (clear of the brow, short of the eye).
 */
const BROW_CORE = 0.5
const BROW_SKIN_FROM = 1.6
const BROW_SKIN_TO = 2.6

/** Where among a brow's colours, darkest first, its hairs' is read: the darker half's median. */
const BROW_HAIR_QUANTILE = 0.25

/** Where among the colours round a brow, darkest first, the skin's is read: past the middle, clear of stray hairs and shadow. */
const BROW_SKIN_QUANTILE = 0.6

/** A brow's colour where the front view shows none. */
const FALLBACK_BROW: Rgb = [60, 45, 35]

/** How much a brow's darkness at 1 darkens its hairs, and at −1 fades them into the skin. */
const BROW_DARKEN = 0.6
const BROW_FADE = 0.85

/**
 * How far up and down the face from where it is (× its brow's
 * half-thickness) a fading hair reads the skin it fades to: clear of the
 * brow on both sides, so it takes the skin's own grain and, between the
 * two, the tone just there — not one colour for the whole brow, nor the
 * lighter forehead's alone.
 */
const BROW_FADE_OUT = 2

/**
 * The most a recoloured brow's texel is lit past the new colour, for being
 * lighter than the brow's hairs: a hair's edge, half skin, keeps to the
 * new colour rather than glowing.
 */
const BROW_TINT_LIGHTEST = 1.15

/**
 * How much of the skin under them shows through hairs of a new colour as
 * light as the skin (less for a darker one, none for one as dark as the
 * brow was): fair brows are fine, and read as skin more than paint.
 */
const BROW_TINT_SHOW = 0.45

/** Where across a brow (from its spine) a point `across` from it takes its colour from, the brow stretched `scale` times. */
function browSource(across: number, half: number, scale: number) {
  const distance = Math.abs(across)
  const stretched = scale * half * BROW_EDGE
  const eased = stretched + half * BROW_EASE
  const source =
    distance <= stretched
      ? distance / scale
      : distance >= eased
        ? distance
        : stretched / scale +
          ((eased - stretched / scale) * (distance - stretched)) / (eased - stretched)
  return Math.sign(across) * source
}

/** A brow's spine, from its upper and lower edges' landmarks (see BROW_EDGES). */
function browSpine(face: Face, [upper, lower]: (typeof BROW_EDGES)[number]): BrowSpine {
  return {
    stations: upper.map((landmark, i) => {
      const [ux, uy] = face.at(landmark)
      const [lx, ly] = face.at(lower[i]!)
      return [(ux + lx) / 2, (uy + ly) / 2] as Point
    }),
    halves: upper.map((landmark, i) => {
      const [ux, uy] = face.at(landmark)
      const [lx, ly] = face.at(lower[i]!)
      return Math.hypot(ux - lx, uy - ly) / 2
    }),
  }
}

/** A brow's hairs' colour and the skin's round it, on the front view (see `BROW_CORE`, `BROW_SKIN_*`). */
function browColours(front: Pixels, spine: BrowSpine, frame: BrowFrame) {
  const box = boxAround(spine.stations, Math.max(...spine.halves) * BROW_SKIN_TO)
  const where = (test: (across: number) => boolean) => (x: number, y: number) => {
    browFrame(spine, x, y, frame)
    return frame.past === 0 && test(Math.abs(frame.across) / frame.half)
  }
  return {
    hair: quantile(
      frontColours(
        front,
        box,
        where((across) => across < BROW_CORE),
      ),
      BROW_HAIR_QUANTILE,
      FALLBACK_BROW,
    ),
    skin: quantile(
      frontColours(
        front,
        box,
        where((across) => across > BROW_SKIN_FROM && across < BROW_SKIN_TO),
      ),
      BROW_SKIN_QUANTILE,
      FALLBACK_SKIN,
    ),
  }
}

function browLayers(face: Face, front: Pixels, paint: FacePaint): Layer[] {
  const scale = 1 + BROW_GROWTH * paint.browThickness
  const tint = paint.browColor ? hexToRgb(paint.browColor) : null
  const fade = BROW_FADE * Math.max(0, -paint.browDarkness)
  const darken = BROW_DARKEN * Math.max(0, paint.browDarkness)
  const frame = newBrowFrame()
  const above = new Uint8ClampedArray(3)
  const below = new Uint8ClampedArray(3)
  const bare = new Float64Array(3)
  return BROW_EDGES.map((edges) => {
    const spine = browSpine(face, edges)
    const thickest = Math.max(...spine.halves)
    const box = boxAround(
      spine.stations,
      thickest * Math.max(BROW_END, Math.max(1, scale) * BROW_EDGE + BROW_EASE, BROW_REACH * scale),
    )
    const { hair, skin } = browColours(front, spine, frame)
    const hairLum = Math.max(1, luminance(...hair))
    const skinLum = luminance(...skin)
    const contrast = Math.max(BROW_CONTRAST, skinLum - hairLum)
    const show = tint
      ? BROW_TINT_SHOW * smoothstep(hairLum, Math.max(hairLum + 1, skinLum), luminance(...tint))
      : 0
    return {
      box,
      underHair: 'locks',
      looks: fade > 0 || show > 0,
      moves:
        scale === 1
          ? undefined
          : (x, y, offset) => {
              browFrame(spine, x, y, frame)
              const shift =
                (browSource(frame.across, frame.half, scale) - frame.across) *
                (1 - smoothstep(0, BROW_END * frame.half, frame.past))
              offset[0] = frame.nx * shift
              offset[1] = frame.ny * shift
              return shift !== 0
            },
      paint: (colour, x, y, strength, _texel, look) => {
        browFrame(spine, x, y, frame)
        const reach = frame.half * Math.max(1, scale)
        const region =
          (1 - smoothstep(reach * BROW_EDGE, reach * BROW_REACH, Math.abs(frame.across))) *
          (1 - smoothstep(0, BROW_END * frame.half, frame.past))
        if (region <= 0) return
        const lightness = luminance(colour[0]!, colour[1]!, colour[2]!)
        const share = (skinLum - lightness) / contrast
        const w = region * strength * smoothstep(BROW_HAIR_FROM, BROW_HAIR_TO, share)
        if (w <= 0) return
        if (fade > 0 || show > 0) {
          // The skin clear of the brow either side of the texel.
          const out = frame.half * BROW_FADE_OUT
          look(frame.nx * out, frame.ny * out, above)
          look(-frame.nx * out, -frame.ny * out, below)
          for (let c = 0; c < 3; c++) bare[c] = (above[c]! + below[c]!) / 2
        }
        // A new colour keeps each hair's lightness against the brow's, so
        // the brow keeps its texture.
        if (tint) {
          const ratio = Math.min(BROW_TINT_LIGHTEST, lightness / hairLum)
          for (let c = 0; c < 3; c++) {
            const hairs = Math.min(255, tint[c]! * ratio)
            colour[c] = colour[c]! + (hairs + (bare[c]! - hairs) * show - colour[c]!) * w
          }
        }
        if (fade > 0) mixTowards(colour, bare, fade * w)
        for (let c = 0; c < 3; c++) colour[c]! *= 1 - darken * w
      },
    }
  })
}

/** The mustache: under the nose, down to the upper lip and its corners (MediaPipe landmarks, round its outline). */
const MUSTACHE = [
  57, 186, 92, 165, 98, 2, 327, 391, 322, 410, 287, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61,
] as const

/** The chin a goatee covers: from the lower lip and the mouth's corners down to under the chin. */
const CHIN = [
  61, 57, 43, 204, 32, 148, 152, 377, 262, 424, 273, 287, 291, 375, 321, 405, 314, 17, 84, 181, 91,
  146,
] as const

/** A full beard: the jaw and cheeks below a line from the sideburns to under the nose. */
const FULL_BEARD = [
  234, 123, 187, 206, 203, 98, 2, 327, 423, 426, 411, 352, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
] as const

/** The jaw's outline from ear to ear, under which a full beard carries on down the neck. */
const JAW = [58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288] as const

/** How far a beard's edge fades either side of its outline (× the distance between the eyes): a full one's, a trimmed one's. */
const BEARD_FEATHER = 0.08
const TRIMMED_FEATHER = 0.035

/** How far down the neck under the jaw a full beard reaches (× the distance between the eyes). */
const BEARD_NECK = 0.3

/**
 * A beard's strands: smooth noise this fine across and this long down the
 * face (× the distance between the eyes), over coarser noise for the locks
 * they lie in, and a grain texel by texel (on the texture's own grid: finer
 * noise laid on the front view would beat against it in moiré).
 */
const STRAND_WIDTH = 0.005
const STRAND_LENGTH = 0.02
const LOCK_WIDTH = 0.015
const LOCK_LENGTH = 0.03

/** How softly a beard's strands stand out of the skin between them: their coverage's band either side of its threshold. */
const STRAND_EDGE = 0.18

/** How much of the beard's colour its strands, and the skin in its shadow under them, take at full growth. */
const BEARD_HAIR = 0.9
const BEARD_UNDER = 0.25

/** Stubble's stubs: the share of texels showing one, from a light shadow (amount 0) to a heavy one (amount 1). */
const STUBS_SPARSE = 0.2
const STUBS_DENSE = 0.5

/** How much of the beard's colour stubble's stubs, and the shadow between them, take (from amount 0 to 1). */
const STUB_COLOUR = 0.45
const STUBBLE_SHADOW: readonly [number, number] = [0.08, 0.26]

/** How much of a beard's strand pattern is its fine strands, the locks they lie in and each texel's own grain (together 1). */
const STRAND_SHARE = 0.5
const LOCK_SHARE = 0.3
const BEARD_GRAIN_SHARE = 0.2

/** How much of its area a beard grows over: this share at amount 0, all of it at 1. */
const BEARD_GROWTH_LEAST = 0.5

/** A strand's shade: this dark in the strand pattern's troughs, and this much lighter up to its peaks (strands catch the light). */
const STRAND_SHADE_LEAST = 0.5
const STRAND_SHADE_RANGE = 1.1

/** How much of its colour a stub of stubble shows: this share at amount 0, all of it at 1. */
const STUB_LEAST = 0.5

/** How far the lips' edge fades, where a full beard or stubble stops at them (× a trimmed beard's feather). */
const BEARD_LIP_FEATHER = 0.4

/**
 * How far a mustache hangs over the upper lip, a share of the way from the
 * lip's edge to its inner edge (a real one hangs over it, where the
 * landmarks' edge would leave a bare gap above it).
 */
const MUSTACHE_OVERHANG = 0.3

/**
 * A mustache thins out towards its tips: from this share of the way from
 * its middle to a tip, down to this much of its growth at the tip, so its
 * sides aren't a hard, square edge.
 */
const MUSTACHE_TAPER = 0.55
const MUSTACHE_TIP = 0.35

/** A beard where the character's brows show no colour apart from the skin's: a near-black brown. */
const DEFAULT_BEARD: Rgb = [38, 27, 20]

/** The character's own beard grows in its brows' colour when that is at least this unlike the skin (see colorDistance). */
const BEARD_APART = 0.15

/** The most of the skin's lightness a beard of the character's own colour has: it reads as hair on any skin, however dark. */
const OWN_BEARD_LIGHTEST = 0.55

/** The least lightness a beard's strands keep, so a black one still shows its strands; on dark skin at most this share of the skin's. */
const BEARD_FLOOR = 34
const BEARD_FLOOR_SHARE = 0.4

/**
 * The colour the character's own beard grows in: its brows' (as dark as
 * OWN_BEARD_LIGHTEST has it), or DEFAULT_BEARD's where they hardly stand
 * apart from the skin, or aren't a hair's colour (a cap's brim over them).
 */
function ownBeard(face: Face, front: Pixels, skin: Rgb): Rgb {
  const frame = newBrowFrame()
  const brows = BROW_EDGES.map((edges) => browColours(front, browSpine(face, edges), frame).hair)
  const mean: Rgb = [0, 1, 2].map((c) => (brows[0]![c]! + brows[1]![c]!) / 2) as Rgb
  const skinLum = luminance(...skin)
  const hairs = hairHued(mean) && colorDistance(...mean, skin, skinLum) >= BEARD_APART
  const colour = hairs ? mean : DEFAULT_BEARD
  const most = OWN_BEARD_LIGHTEST * skinLum
  const lightness = luminance(...colour)
  return lightness > most ? (colour.map((c) => (c * most) / lightness) as Rgb) : colour
}

/** The mustache's outline (see MUSTACHE), its lower edge hanging over the lips' (`lips`, as FACE_PARTS.lips) by MUSTACHE_OVERHANG. */
function mustacheOutline(face: Face, lips: readonly Point[]): Point[] {
  const edge = new Map(FACE_PARTS.lips.map((i, k) => [i, lips[k]!]))
  return MUSTACHE.map((landmark) => {
    const k = (UPPER_LIP as readonly number[]).indexOf(landmark)
    if (k < 0) return face.at(landmark)
    const [ex, ey] = edge.get(facePointOf(landmark))!
    const [ix, iy] = face.at(UPPER_LIP_INNER[k]!)
    return [ex + (ix - ex) * MUSTACHE_OVERHANG, ey + (iy - ey) * MUSTACHE_OVERHANG] as Point
  })
}

function beardLayer(
  face: Face,
  skinLum: number,
  paint: FacePaint,
  tint: Rgb,
  lipLine: readonly Point[],
): Layer {
  const { beard, beardAmount: amount } = paint
  const e = face.eyes
  const outline = (landmarks: readonly number[]) => landmarks.map(face.at)
  // A full beard and stubble cover the jaw and neck, but not the lips.
  const whole = beard === 'full' || beard === 'stubble'
  const feather = (whole ? BEARD_FEATHER : TRIMMED_FEATHER) * e
  const mustache = areaOf(mustacheOutline(face, lipLine), feather)
  const areas =
    beard === 'mustache'
      ? [mustache]
      : beard === 'goatee'
        ? [mustache, areaOf(outline(CHIN), feather)]
        : [areaOf(outline(FULL_BEARD), feather)]
  const lips = areaOf([...lipLine], TRIMMED_FEATHER * e * BEARD_LIP_FEATHER)
  const jaw = byX(outline(JAW))
  const neck = BEARD_NECK * e
  const [jawLeft, jawRight] = [jaw[0]![0], jaw[jaw.length - 1]![0]]
  const [tipLeft, tipRight] = [face.at(57)[0], face.at(287)[0]]
  const middle = (tipLeft + tipRight) / 2
  const halfWidth = Math.max(1e-6, Math.abs(tipRight - tipLeft) / 2)
  const taper = (x: number) =>
    1 - (1 - MUSTACHE_TIP) * smoothstep(MUSTACHE_TAPER, 1, Math.abs(x - middle) / halfWidth)
  const box = joinBoxes([
    ...areas.map((area) => area.box),
    ...(whole ? [boxAround(jaw, neck)] : []),
  ])
  const grown = fieldOf(box, feather, (x, y) => {
    let m = 0
    for (const area of areas)
      m = Math.max(m, cover(area, x, y) * (area === mustache ? taper(x) : 1))
    if (!whole) return m
    // From within the outline's fading edge, so the beard doesn't thin along the jaw.
    const below = y - heightAt(jaw, x)
    if (below > -feather && x > jawLeft && x < jawRight) {
      const sides = smoothstep(0, neck, Math.min(x - jawLeft, jawRight - x))
      m = Math.max(m, (1 - smoothstep(0, neck, below)) * sides)
    }
    return m
  })
  const onLips = fieldOf(lips.box, lips.feather, (x, y) => cover(lips, x, y))
  const region = whole ? (x: number, y: number) => grown(x, y) * (1 - onLips(x, y)) : grown
  const lightness = luminance(...tint)
  const floor = Math.min(BEARD_FLOOR, BEARD_FLOOR_SHARE * skinLum)
  const lift = lightness < floor ? floor / Math.max(1, lightness) : 1
  const strand = new Float64Array(3)
  return {
    box,
    underHair: 'strands',
    paint: (colour, x, y, strength, texel) => {
      const m = region(x, y)
      if (m <= 0) return
      const grain = hash(texel, 0, 1)
      let w: number
      let shade = 1
      if (beard === 'stubble') {
        const stub = grain < m * (STUBS_SPARSE + (STUBS_DENSE - STUBS_SPARSE) * amount)
        const shadow = m * (STUBBLE_SHADOW[0] + (STUBBLE_SHADOW[1] - STUBBLE_SHADOW[0]) * amount)
        w =
          shadow +
          (1 - shadow) * (stub ? STUB_COLOUR * (STUB_LEAST + (1 - STUB_LEAST) * amount) : 0)
      } else {
        const strands =
          STRAND_SHARE * valueNoise(x / (STRAND_WIDTH * e), y / (STRAND_LENGTH * e), 2) +
          LOCK_SHARE * valueNoise(x / (LOCK_WIDTH * e), y / (LOCK_LENGTH * e), 3) +
          BEARD_GRAIN_SHARE * grain
        const growth = m * (BEARD_GROWTH_LEAST + (1 - BEARD_GROWTH_LEAST) * amount)
        const hair = smoothstep(1 - growth - STRAND_EDGE, 1 - growth + STRAND_EDGE, strands)
        const under = BEARD_UNDER * growth
        w = under + (1 - under) * hair * BEARD_HAIR
        shade = STRAND_SHADE_LEAST + STRAND_SHADE_RANGE * strands
      }
      // Lit as the skin under it is.
      const lit = Math.sqrt(luminance(colour[0]!, colour[1]!, colour[2]!) / Math.max(1, skinLum))
      for (let c = 0; c < 3; c++) strand[c] = Math.min(255, tint[c]! * lift * lit * shade)
      mixTowards(colour, strand, w * strength)
    },
  }
}

/** The patches freckles fall on: the bridge of the nose and each cheek under the eye (landmarks, and their reach across and down × the distance between the eyes). */
const FRECKLE_PATCHES = [
  { landmarks: [195], across: 0.22, down: 0.28 },
  { landmarks: [118, 101], across: 0.3, down: 0.2 },
  { landmarks: [347, 330], across: 0.3, down: 0.2 },
] as const

/** Freckles lie one to a cell of this size (× the distance between the eyes), at most. */
const FRECKLE_CELL = 0.055

/** The share of the cells with a freckle, at full freckles. */
const FRECKLE_DENSITY = 0.8

/** A freckle's radius (× its cell), from the smallest to the largest. */
const FRECKLE_SMALLEST = 0.15
const FRECKLE_LARGEST = 0.35

/** What a freckle multiplies the skin's colour by at its darkest: browner and darker. */
const FRECKLE_TINT: Rgb = [0.72, 0.56, 0.46]

/** A freckle's centre lies at least this far in from its cell's sides (a share of the cell): neighbours seldom touch. */
const FRECKLE_INSET = 0.15

/** Where the patches' density is below this, no freckle is drawn. */
const FRECKLE_SPARSEST = 0.05

/** A freckle's depth: from the first to the first and second together, at random; and times this share at freckles 0, all of it at 1. */
const FRECKLE_DEPTH = 0.45
const FRECKLE_DEPTH_RANGE = 0.45
const FRECKLE_FAINTEST = 0.55

/** How much of a freckle's radius is solid before its edge fades. */
const FRECKLE_CORE = 0.35

function frecklesLayer(face: Face, amount: number): Layer {
  const patches = FRECKLE_PATCHES.map(({ landmarks, across, down }) => {
    const points = landmarks.map(face.at)
    return {
      x: points.reduce((sum, [x]) => sum + x, 0) / points.length,
      y: points.reduce((sum, [, y]) => sum + y, 0) / points.length,
      across: across * face.eyes,
      down: down * face.eyes,
    }
  })
  const density = (x: number, y: number) => {
    let most = 0
    for (const patch of patches) {
      const a = (x - patch.x) / patch.across
      const b = (y - patch.y) / patch.down
      most = Math.max(most, Math.exp(-PATCH_FALLOFF * (a * a + b * b)))
    }
    return most
  }
  const cell = FRECKLE_CELL * face.eyes
  return {
    box: joinBoxes(
      patches.map(
        ({ x, y, across, down }): Box => [
          x - across * PATCH_BOX,
          y - down * PATCH_BOX,
          x + across * PATCH_BOX,
          y + down * PATCH_BOX,
        ],
      ),
    ),
    underHair: 'strands',
    paint: (colour, x, y, strength) => {
      const cx = Math.floor(x / cell)
      const cy = Math.floor(y / cell)
      let dark = 0
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (let i = cx - 1; i <= cx + 1; i++) {
          if (hash(i, j, 3) >= FRECKLE_DENSITY * amount) continue
          const fx = (i + FRECKLE_INSET + (1 - 2 * FRECKLE_INSET) * hash(i, j, 4)) * cell
          const fy = (j + FRECKLE_INSET + (1 - 2 * FRECKLE_INSET) * hash(i, j, 5)) * cell
          const here = density(fx, fy)
          if (here < FRECKLE_SPARSEST) continue
          const radius =
            cell * (FRECKLE_SMALLEST + (FRECKLE_LARGEST - FRECKLE_SMALLEST) * hash(i, j, 6))
          const d = Math.sqrt((x - fx) ** 2 + (y - fy) ** 2)
          if (d >= radius) continue
          const depth =
            (FRECKLE_DEPTH + FRECKLE_DEPTH_RANGE * hash(i, j, 7)) *
            (FRECKLE_FAINTEST + (1 - FRECKLE_FAINTEST) * amount)
          dark = Math.max(dark, (1 - smoothstep(radius * FRECKLE_CORE, radius, d)) * here * depth)
        }
      }
      const w = dark * strength
      for (let c = 0; c < 3; c++) colour[c]! *= 1 - w * (1 - FRECKLE_TINT[c]!)
    },
  }
}

/** What painting a face needs besides the face. */
export type PaintContext = {
  /** The colour a beard grows in: the hair's dye, or null for the character's own (see `ownBeard`). */
  beard: Rgb | null
  /** Where the head's texture shows the character's hair (0–1 per texel): it lies over the paint. Null when there is none. */
  hair: Float32Array | null
}

/**
 * Where a texel starts to take paint, by how squarely it faces the front
 * (the normal's forward part): anything turned towards it at all, as a
 * beard goes on under the jaw.
 */
const FACING_FROM = -0.02
const FACING_TO = 0.08

/** How a triangle's texture moves (u, v per front-view x, y): to find a texel's neighbours on the front view. */
function textureStep(tri: HeadTriangle, out: Float64Array) {
  const dx1 = tri.x[1]! - tri.x[0]!
  const dy1 = tri.y[1]! - tri.y[0]!
  const dx2 = tri.x[2]! - tri.x[0]!
  const dy2 = tri.y[2]! - tri.y[0]!
  const du1 = tri.u[1]! - tri.u[0]!
  const dv1 = tri.v[1]! - tri.v[0]!
  const du2 = tri.u[2]! - tri.u[0]!
  const dv2 = tri.v[2]! - tri.v[0]!
  const det = dx1 * dy2 - dx2 * dy1
  if (Math.abs(det) < 1e-12) {
    out.fill(0)
    return
  }
  out[0] = (du1 * dy2 - du2 * dy1) / det
  out[1] = (du2 * dx1 - du1 * dx2) / det
  out[2] = (dv1 * dy2 - dv2 * dy1) / det
  out[3] = (dv2 * dx1 - dv1 * dx2) / det
}

/**
 * Paints a face on a head's texture (in place): brows reshaped and
 * recoloured, lipstick, blush, eyeshadow, eyeliner, a beard and freckles.
 * Each is laid out on the head's front view by the character's face
 * landmarks (`target`, packed fractions of it) and measured against the
 * colours the front view shows, and each texel of the face's skin takes
 * them where it shows there, keeping its own detail (the texture is finer
 * than any front view a face could be drawn on in time). The iris is
 * tintIris's.
 */
export function paintFace(
  head: Pixels,
  geometry: HeadGeometry,
  target: readonly number[],
  paint: FacePaint,
  context: PaintContext,
) {
  const face = faceOf(target)
  let measured: Pixels | null = null
  const front = () => {
    measured ??= renderFront(head, geometry.all, MEASURE_VIEW).image
    return measured
  }
  let skin: Rgb | null = null
  const skinTone = () => {
    skin ??= skinColour(face, front())
    return skin
  }
  const skinLum = () => luminance(...skinTone())
  let lips: { own: Rgb; outline: Point[] } | null = null
  const lipLine = () => {
    if (!lips) {
      const own = lipColour(face, front())
      lips = { own, outline: lipOutline(face, head, geometry, own) }
    }
    return lips
  }
  const layers: Layer[] = []
  if (paint.browColor || paint.browDarkness !== 0 || paint.browThickness !== 0) {
    layers.push(...browLayers(face, front(), paint))
  }
  if (paint.freckles > 0) layers.push(frecklesLayer(face, paint.freckles))
  if (paint.blush && paint.blushAmount > 0) {
    layers.push(blushLayer(face, skinLum(), hexToRgb(paint.blush), paint.blushAmount))
  }
  if (paint.shadow && paint.shadowAmount > 0) {
    layers.push(shadowLayer(face, skinLum(), hexToRgb(paint.shadow), paint.shadowAmount))
  }
  if (paint.lips && paint.lipAmount > 0) {
    const { own, outline } = lipLine()
    layers.push(lipsLayer(face, outline, own, hexToRgb(paint.lips), paint.lipAmount))
  }
  if (paint.liner > 0) layers.push(linerLayer(face, paint.liner))
  if (paint.beard !== 'none' && paint.beardAmount > 0) {
    const tint = context.beard ?? ownBeard(face, front(), skinTone())
    layers.push(beardLayer(face, skinLum(), paint, tint, lipLine().outline))
  }
  if (layers.length === 0) return

  const bounds = joinBoxes(layers.map((layer) => layer.box))
  const { width, height } = head
  const { hair } = context
  const fringe =
    hair && layers.some((layer) => layer.underHair === 'locks')
      ? fringeDensity(hair, width, height)
      : null
  const fringeWidth = Math.ceil(width / FRINGE_CELL)
  const fringeHeight = Math.ceil(height / FRINGE_CELL)
  // Reshaped and faded brows read the texture as it was, around them.
  const source: Pixels = layers.some((layer) => layer.moves || layer.looks)
    ? { data: new Uint8ClampedArray(head.data), width, height }
    : head
  const colour = new Float64Array(3)
  const offset = new Float64Array(2)
  const step = new Float64Array(4)
  const sample = new Uint8ClampedArray(3)
  let stepOf: HeadTriangle | null = null
  // The texel being painted: its triangle and where it lies on the texture.
  let current: HeadTriangle | null = null
  let u = 0
  let v = 0
  const read = (dx: number, dy: number, out: Uint8ClampedArray) => {
    if (current !== stepOf) {
      stepOf = current
      textureStep(current!, step)
    }
    const su = u + step[0]! * dx + step[1]! * dy
    const sv = v + step[2]! * dx + step[3]! * dy
    sampleColor(source, su * width - 0.5, sv * height - 0.5, out, 0)
  }
  const underHair = (layer: Layer, texel: number) => {
    if (!hair || !layer.underHair) return 1
    if (layer.underHair === 'strands') return 1 - hair[texel]!
    return 1 - lockOver(hair, fringe!, fringeWidth, fringeHeight, width, height, texel)
  }
  const overBounds = (tri: HeadTriangle) =>
    Math.max(tri.n[0]!, tri.n[1]!, tri.n[2]!) > FACING_FROM &&
    Math.max(tri.x[0]!, tri.x[1]!, tri.x[2]!) >= bounds[0] &&
    Math.max(tri.y[0]!, tri.y[1]!, tri.y[2]!) >= bounds[1] &&
    Math.min(tri.x[0]!, tri.x[1]!, tri.x[2]!) <= bounds[2] &&
    Math.min(tri.y[0]!, tri.y[1]!, tri.y[2]!) <= bounds[3]
  forEachTexel(head, geometry.skin, overBounds, (texel, tri, w0, w1, w2) => {
    const facing = smoothstep(
      FACING_FROM,
      FACING_TO,
      tri.n[0]! * w0 + tri.n[1]! * w1 + tri.n[2]! * w2,
    )
    if (facing <= 0) return
    const x = tri.x[0]! * w0 + tri.x[1]! * w1 + tri.x[2]! * w2
    const y = tri.y[0]! * w0 + tri.y[1]! * w1 + tri.y[2]! * w2
    if (!inBox(bounds, x, y)) return
    current = tri
    u = tri.u[0]! * w0 + tri.u[1]! * w1 + tri.u[2]! * w2
    v = tri.v[0]! * w0 + tri.v[1]! * w1 + tri.v[2]! * w2
    const p = texel * 4
    for (let c = 0; c < 3; c++) colour[c] = source.data[p + c]!
    for (const layer of layers) {
      if (!inBox(layer.box, x, y)) continue
      const strength = facing * underHair(layer, texel)
      if (strength <= 0) continue
      if (layer.moves?.(x, y, offset)) {
        read(offset[0]! * strength, offset[1]! * strength, sample)
        for (let c = 0; c < 3; c++) colour[c] = sample[c]!
      }
      layer.paint(colour, x, y, strength, texel, read)
    }
    for (let c = 0; c < 3; c++) head.data[p + c] = colour[c]!
  })
}

/** How much smaller than the head's texture a shaved scalp is worked out on first: its skin is filled in smooth, so coarse will do. */
const SHAVE_SCALE = 4

/**
 * Beside the face, the band the hair's colour is read in: from this far
 * above the eyes to this far below them, and out from the face's outline
 * this far (all × the distance between the eyes) — temples, sideburns and
 * hair down the sides, where caps and goggles seldom reach.
 */
const SIDE_ABOVE = 0.3
const SIDE_BELOW = 0.5
const SIDE_OUT = 0.3

/** How unlike the skin (see colorDistance) a colour in that band must be to be hair, or something over it. */
const SIDE_APART = 0.35

/** The share of the band hair must take to be read there; as much of anything else there is gear over the sides (a cap, a hijab). */
const SIDE_SHARE = 0.15

/** Where among the hair's colours in the band, darkest first, its colour is read: on the dark side, clear of strands blended with the skin between them. */
const SIDE_HAIR_QUANTILE = 0.35

/**
 * Hair's hues: red over blue by at least this, and this much more per
 * level of lightness (warmer than grey); green over blue by at least this
 * share of red's lead, less a little slack (no redder than red hair); no
 * greener than red; red over blue by at most this share of red (no more
 * saturated than hair); and no lighter than this. Not a blue or
 * camouflage cap, a beret's or hijab's crimson, braid's gold or a chef's
 * white.
 */
const HAIR_WARMTH = 2
const HAIR_WARMTH_LIGHT = 0.06
const HAIR_REDDEST = 0.2
const HAIR_HUE_SLACK = 3
const HAIR_SATURATED = 0.8
const HAIR_LIGHTEST = 185

/** Whether a colour is one hair comes in (see `HAIR_*`). */
export function hairHued([r, g, b]: Rgb) {
  return (
    r - b >= HAIR_WARMTH + HAIR_WARMTH_LIGHT * luminance(r, g, b) &&
    g - b >= HAIR_REDDEST * (r - b) - HAIR_HUE_SLACK &&
    r >= g &&
    r - b <= HAIR_SATURATED * r &&
    luminance(r, g, b) <= HAIR_LIGHTEST
  )
}

/** The crown is read on the front view above the face's top (landmark 10) from this far above it, and this far either side of it (× the distance between the eyes). */
const CROWN_ABOVE = 0.15
const CROWN_ACROSS = 0.5

/**
 * The crown is hair, not a bald scalp, when its colour is at least this
 * unlike the skin's (see colorDistance), or its hue this unlike (its
 * colour brought to the skin's lightness): fair hair is hardly darker.
 */
const CROWN_APART = 0.2
const CROWN_HUE_APART = 0.125

/** How unlike the skin's a colour's hue is: its distance (see colorDistance) brought to the skin's lightness. */
function hueDistance(colour: Rgb, skin: Rgb) {
  const skinLum = luminance(...skin)
  const scale = skinLum / Math.max(1, luminance(...colour))
  const [r, g, b] = colour.map((c) => Math.min(255, c * scale)) as Rgb
  return colorDistance(r, g, b, skin, skinLum)
}

/** The crown's colour on the front view (see `CROWN_*`) if it is hair's: a hair's hue, standing apart from the skin. */
function crownHair(face: Face, front: Pixels, skin: Rgb): Rgb | null {
  const [cx, cy] = face.at(10)
  const e = face.eyes
  const crown = quantile(
    frontColours(
      front,
      [cx - CROWN_ACROSS * e, 0, cx + CROWN_ACROSS * e, cy - CROWN_ABOVE * e],
      () => true,
    ),
    0.5,
    skin,
  )
  return standsApart(crown, skin) && hairHued(crown) ? crown : null
}

/** Whether a colour stands apart from the skin enough to be hair's, not a bald scalp's (see `CROWN_*APART`). */
const standsApart = (colour: Rgb, skin: Rgb) =>
  colorDistance(...colour, skin, luminance(...skin)) > CROWN_APART ||
  hueDistance(colour, skin) > CROWN_HUE_APART

/**
 * The colour of the hair a shave takes off: what lies beside the face (see
 * `SIDE_*`) where enough of it is hair; else, the sides being bare, the
 * crown's (see `crownHair`, or `crown`, the analysis's: see analyseBody)
 * if that is a hair's hue. Null when there is no hair to take, or the
 * sides are under something that isn't hair (a hijab, a cap down to the
 * ears): gear stays, and the hair under it.
 */
function hairToShave(face: Face, front: Pixels, skin: Rgb, crown: Rgb | null): Rgb | null {
  const oval = FACE_PARTS.oval.map((i) => face.points[i]!)
  const e = face.eyes
  const reach = SIDE_OUT * e
  const centre = face.eyeLine(0.5)
  const band = frontColours(
    front,
    [0, centre - SIDE_ABOVE * e, 1, centre + SIDE_BELOW * e],
    (x, y) => {
      const out = outlineDistance(oval, x, y)
      return out > 0 && out < reach
    },
  )
  const skinLum = luminance(...skin)
  const apart = band.filter((c) => colorDistance(...c, skin, skinLum) > SIDE_APART)
  const hair = apart.filter(hairHued)
  const side = quantile(hair, SIDE_HAIR_QUANTILE, skin)
  if (hair.length > 0 && hair.length >= SIDE_SHARE * band.length && standsApart(side, skin)) {
    return side
  }
  if (apart.length > 0 && apart.length >= SIDE_SHARE * band.length) return null
  return crownHair(face, front, skin) ?? (crown && hairHued(crown) ? crown : null)
}

/**
 * A texel is hair by how much nearer the hair's colour it lies than the
 * skin's (see colorDistance): not at all from the first, fully from the
 * second (as hairMask has it) —
 */
const HAIR_NEARER_FROM = -0.04
const HAIR_NEARER_TO = 0.08

/** — and only so far from the hair's colour, fully up to the first distance and not at all from the second: a cap of another colour stays. */
const HAIR_NEAR = 0.25
const HAIR_FAR = 0.45

/** Below this lightness a pixel's hue is noise: darker than the hair, it is the hair's deepest shadow. */
const NEAR_BLACK = 8

/**
 * How like `hair` each pixel is (0–1; see `HAIR_NEARER_*`, `HAIR_NEAR`),
 * `skin` being the skin's colour: none where nothing is drawn. A pixel
 * darker than the hair is only as far from it as its hue (brought up to
 * the hair's lightness): the hair's shadows are hair.
 */
function hairLikeness(head: Pixels, hair: Rgb, skin: Rgb): Float32Array {
  const { data } = head
  const like = new Float32Array(data.length / 4)
  const hairLum = luminance(...hair)
  const skinLum = luminance(...skin)
  for (let i = 0, p = 0; i < like.length; i++, p += 4) {
    const r = data[p]!
    const g = data[p + 1]!
    const b = data[p + 2]!
    if (data[p + 3] === 0) continue
    const lightness = luminance(r, g, b)
    const lift = hairLum / Math.max(1, lightness)
    const darker = lift > 1
    const toHair = !darker
      ? colorDistance(r, g, b, hair, hairLum)
      : lightness < NEAR_BLACK
        ? 0
        : colorDistance(r * lift, g * lift, b * lift, hair, hairLum)
    if (toHair >= HAIR_FAR) continue
    const toSkin = colorDistance(r, g, b, skin, skinLum)
    const nearer = darker ? colorDistance(r, g, b, hair, hairLum) : toHair
    like[i] =
      smoothstep(HAIR_NEARER_FROM, HAIR_NEARER_TO, toSkin - nearer) *
      (1 - smoothstep(HAIR_NEAR, HAIR_FAR, toHair))
  }
  return like
}

/**
 * Below the eyes a shave leaves the face be — beard, stubble and shading —
 * out to its outline, or on a bearded face this far past it (the jaw's
 * sides, a beard's reach towards the ears; hair falling beside a beardless
 * face goes), and down the neck under the jaw, giving way over this much
 * (all × the distance between the eyes).
 */
const GUARD_OUT = 0.02
const GUARD_BEARD = 0.2
const GUARD_EDGE = 0.08

/** A face is bearded when this share of its chin (the lower lip to the chin's tip, inside its outline) is nearer the hair's colour than the skin's. */
const BEARDED = 0.3

/** Whether a face has a beard of the hair's colour (see BEARDED). */
function bearded(face: Face, front: Pixels, hair: Rgb, skin: Rgb) {
  const oval = FACE_PARTS.oval.map((i) => face.points[i]!)
  const [left, , right] = boxAround(oval, 0)
  const chin = frontColours(
    front,
    [left, face.at(17)[1], right, face.at(152)[1]],
    (x, y) => outlineDistance(oval, x, y) < 0,
  )
  const hairLum = luminance(...hair)
  const skinLum = luminance(...skin)
  const hairy = chin.filter(
    (c) => colorDistance(...c, hair, hairLum) < colorDistance(...c, skin, skinLum),
  )
  return hairy.length >= BEARDED * chin.length
}

/** How squarely a texel must face the front (the normal's forward part) to be guarded, fully from the second: the nape's hair is shaved. */
const GUARD_FACING_FROM = -0.35
const GUARD_FACING_TO = -0.1

/**
 * How much of a texel a shave must leave be (0–1; see `GUARD_*`), by where
 * it shows on the front view (`x`, `y`) and how squarely it faces it (`n`).
 * `falling`, only for a beardless face, is the scalp's hair on the front
 * view (see `joinedHair`): what falls over the face's sides goes.
 */
function faceGuard(face: Face, falling: ((x: number, y: number) => number) | null) {
  const e = face.eyes
  const edge = GUARD_EDGE * e
  const reach = (falling ? GUARD_OUT : GUARD_BEARD) * e
  const oval = FACE_PARTS.oval.map((i) => face.points[i]!)
  const jaw = byX(JAW.map(face.at))
  const jawLeft = jaw[0]![0]
  const jawRight = jaw[jaw.length - 1]![0]
  const [left, , right] = boxAround(oval, reach + edge)
  const top = Math.min(face.eyeLine(left), face.eyeLine(right)) - edge
  const guarded = fieldOf([left, top, right, 1], edge, (x, y) => {
    const below = smoothstep(-edge, edge, y - face.eyeLine(x))
    if (below <= 0) return 0
    const near = 1 - smoothstep(reach - edge, reach + edge, outlineDistance(oval, x, y))
    const neck =
      smoothstep(-edge, edge, y - heightAt(jaw, x)) *
      smoothstep(-edge, edge, Math.min(x - jawLeft, jawRight - x))
    return below * Math.max(near, neck)
  })
  const inside = FALLING_HAIR_IN * e
  const sides =
    falling &&
    fieldOf([left, top, right, 1], edge, (x, y) =>
      smoothstep(-inside - edge, -inside + edge, outlineDistance(oval, x, y)),
    )
  return (x: number, y: number, n: number) =>
    guarded(x, y) *
    smoothstep(GUARD_FACING_FROM, GUARD_FACING_TO, n) *
    (sides ? 1 - falling!(x, y) * sides(x, y) : 1)
}

/**
 * On a beardless face, hair falling over its sides below the eyes goes
 * too (see `joinedHair`), out from this far inside the face's outline (×
 * the distance between the eyes; the eyes, nose and mouth lie well inside
 * it).
 */
const FALLING_HAIR_IN = 0.45

/**
 * How like hair (see hairLikeness) the front view must be for the scalp's
 * hair to be followed from where it surely is: this far above the brows'
 * tops (× the distance between the eyes), clear of the brows themselves.
 */
const JOINED_HAIR_LIKE = 0.5
const JOINED_HAIR_ABOVE = 0.1

/**
 * How much of each point of the front view is the scalp's hair: hair
 * joined to the hair above the brows (see `JOINED_HAIR_*`) — a fringe, or
 * hair falling beside the face; not brows, a beard or shadows of the
 * hair's colour on their own.
 */
function joinedHair(face: Face, front: Pixels, hair: Rgb, skin: Rgb) {
  const size = front.width
  const like = hairLikeness(front, hair, skin)
  const browTop = Math.min(...FACE_PARTS.brows.map((i) => face.points[i]![1]))
  const above = browTop - JOINED_HAIR_ABOVE * face.eyes
  const seeds = new Float32Array(like.length)
  for (let i = 0; i < like.length; i++) {
    if ((Math.floor(i / size) + 0.5) / size < above) seeds[i] = 1
  }
  // Grown a pixel, to take in the strands' soft edges.
  const joined = dilate(connectedFrom(like, seeds, size, size, JOINED_HAIR_LIKE), size, size, 1)
  return (x: number, y: number) => sampleField(joined, size, size, x * size - 0.5, y * size - 0.5)
}

/** The eyes' lower lids, outer corner to inner (MediaPipe landmarks), in the same order as UPPER_LIDS. */
const LOWER_LIDS = [
  [33, 7, 163, 144, 145, 153, 154, 155, 133],
  [263, 249, 390, 373, 374, 380, 381, 382, 362],
] as const

/**
 * How far round a brow, and round an eye (its lashes and lid crease), a
 * shave keeps the character's own texels whatever the hair's colour took
 * of them (× the distance between the eyes), fading out over the last:
 * only a lock of hair over them (a fringe) goes.
 */
const KEEP_BROW = 0.04
const KEEP_EYE = 0.07
const KEEP_EDGE = 0.02

/**
 * How much of each point of the front view (0–1) a shave keeps as each
 * brow, and as the eyes (see `KEEP_*`), with the box each brow's keeps to.
 */
function featureKeep(face: Face) {
  const e = face.eyes
  const edge = KEEP_EDGE * e
  const near = (outlines: Point[][], reach: number) => {
    const box = joinBoxes(outlines.map((outline) => boxAround(outline, reach + edge)))
    const there = fieldOf(box, edge, (x, y) => {
      let most = 0
      for (const outline of outlines) {
        most = Math.max(
          most,
          1 - smoothstep(reach - edge, reach + edge, outlineDistance(outline, x, y)),
        )
      }
      return most
    })
    return { box, there }
  }
  return {
    brows: BROW_EDGES.map(([upper, lower]) =>
      near([[...upper, ...[...lower].reverse()].map(face.at)], KEEP_BROW * e),
    ),
    eyes: near(
      UPPER_LIDS.map((upper, k) => [...upper, ...[...LOWER_LIDS[k]!].reverse()].map(face.at)),
      KEEP_EYE * e,
    ).there,
  }
}

/** Where a texel counts as hair to shave (its likeness to hair, fully from the second): low, so no strand is left. */
const SHAVE_FROM = 0.05
const SHAVE_TO = 0.4

/**
 * Where, on the coarse grid, the hair is dense enough to shave all of it
 * (fully from the second): its darkest strands, too dark for the hair's
 * colour, and its gaps go too, and the fine hairs past its edge, fading out
 * over this many cells beyond it.
 */
const SHAVE_DENSE_FROM = 0.25
const SHAVE_DENSE_TO = 0.5
const SHAVE_CLOSE = 4

/**
 * How sure a texel the shave leaves be must be of being skin (fully from
 * the second) to fill a shaved scalp from, and the ring round the hair it
 * must lie in (coarse cells from the hair): near enough to be the skin the
 * scalp runs into (not the throat's, say).
 */
const FILL_FROM = 0.5
const FILL_TO = 0.9
const FILL_RING = 8

/**
 * How far from the skin it is filled from (coarse cells) a shaved scalp
 * gives way to one tone (see `scalpTone`): the fill, averaging whatever skin is
 * far off (a shadowed nape, an ear), would leave the scalp's halves (apart
 * on the texture) in different tones where they meet.
 */
const SCALP_BLEND = 6

/**
 * The scalp's tone is the forehead's, read this far up from the brows'
 * tops (× the distance between the eyes) where it is skin (see analyseBody)
 * — when that is this share of it, not all under a fringe. The nose's
 * bridge stands in for it where its colour is at least this like the
 * cheeks' skin (see colorDistance; blush can make them redder).
 */
const FOREHEAD_REACH = 0.3
const FOREHEAD_SHARE = 0.1
const FOREHEAD_LIKE = 0.3

/**
 * Under a fringe, the tone is read round the bridge of the nose (these
 * landmarks, this far round × the distance between the eyes: below any
 * fringe, clear of blush), on its lit side (this far up its colours,
 * darkest first) as the forehead is lit.
 */
const NOSE_BRIDGE = [6, 197] as const
const NOSE_BRIDGE_REACH = 0.08
const NOSE_BRIDGE_LIT = 0.7

/** How much darker than the skin around it a shaved scalp is. */
const SCALP_SHADOW = 0.04

/** The share of a shaved scalp's texels showing a stub of hair, and how much of the hair's colour a stub keeps. */
const STUBBLE_ROOTS = 0.3
const ROOT_COLOUR = 0.15

/**
 * A shaved scalp's grain: the bare skin's own spread of lightness from
 * texel to texel (at most this much), laid on as noise this many texels
 * across over texel-fine noise, so it has pores like the rest of the skin
 * rather than a flat, painted look.
 */
const GRAIN_MOST = 0.08
const GRAIN_CELL = 3

/** How much of the grain is the coarser noise and how much the texel-fine, and their sum's spread (for noise each −1–1). */
const GRAIN_COARSE = 0.7
const GRAIN_FINE = 0.5
const GRAIN_SPREAD = 0.38

/** A grid of values each averaged over the square `radius` cells round it (a box blur, in two passes). */
function blurField(grid: Float32Array, width: number, height: number, radius: number) {
  const pass = (source: Float32Array, across: boolean) => {
    const out = new Float32Array(source.length)
    const length = across ? width : height
    const lines = across ? height : width
    for (let line = 0; line < lines; line++) {
      const at = (k: number) => (across ? line * width + k : k * width + line)
      let sum = 0
      let count = 0
      for (let k = 0; k < Math.min(length, radius); k++) {
        sum += source[at(k)]!
        count++
      }
      for (let k = 0; k < length; k++) {
        if (k + radius < length) {
          sum += source[at(k + radius)]!
          count++
        }
        if (k - radius - 1 >= 0) {
          sum -= source[at(k - radius - 1)]!
          count--
        }
        out[at(k)] = sum / count
      }
    }
    return out
  }
  return pass(pass(grid, true), false)
}

/**
 * The tone a shaved scalp takes far from other skin when the forehead's is
 * under a fringe (see `shaveable`): the bridge of the nose's, where it is
 * skin (nearer the cheeks' `skin` than the hair's colour, and not far off
 * it); else the cheeks'.
 */
function scalpTone(face: Face, front: Pixels, skin: Rgb, hair: Rgb): Rgb {
  const skinLum = luminance(...skin)
  const hairLum = luminance(...hair)
  const bare = (c: Rgb) => {
    const toSkin = colorDistance(...c, skin, skinLum)
    return toSkin < FOREHEAD_LIKE && toSkin < colorDistance(...c, hair, hairLum)
  }
  const bridge = NOSE_BRIDGE.map(face.at)
  const reach = NOSE_BRIDGE_REACH * face.eyes
  const nose = frontColours(front, boxAround(bridge, reach), (x, y) =>
    bridge.some(([bx, by]) => (x - bx) ** 2 + (y - by) ** 2 <= reach * reach),
  ).filter(bare)
  return quantile(nose, NOSE_BRIDGE_LIT, skin)
}

/** A brow is under a fringe (and restored whole after a shave: see `restoreBrows`) when locks of hair cover this share of its core. */
const BROW_HIDDEN = 0.35

/**
 * What a shave leaves be and what it may take: per texel of the face's
 * skin, how free it is to shave (0–1: not the face below the eyes, see
 * `faceGuard`, nor the brows and eyes but for a lock of the scalp's hair
 * over them, see `featureKeep`, `lockOver` and `joined`; a brow the
 * fringe hides goes whole, to be restored); how much of each brow a fringe
 * covers; and which texels show the forehead (see `FOREHEAD_*`).
 */
function shaveable(
  head: Pixels,
  geometry: HeadGeometry,
  face: Face,
  like: Float32Array,
  beard: boolean,
  joined: (x: number, y: number) => number,
) {
  const { width, height } = head
  const brows = FACE_PARTS.brows.map((i) => face.points[i]!)
  const [browLeft, browTop, browRight] = boxAround(brows, 0)
  const band: Box = [browLeft, browTop - FOREHEAD_REACH * face.eyes, browRight, browTop]
  const forehead = new Uint8Array(width * height)
  const guard = faceGuard(face, beard ? null : joined)
  const keep = featureKeep(face)
  const fringe = fringeDensity(like, width, height)
  const fringeWidth = Math.ceil(width / FRINGE_CELL)
  const fringeHeight = Math.ceil(height / FRINGE_CELL)
  const spines = BROW_EDGES.map((edges) => browSpine(face, edges))
  const covered = spines.map(() => ({ locks: 0, texels: 0 }))
  // What each brow keeps: freed, texel by texel, if a fringe hides it.
  const browKept = spines.map(() => ({ texels: [] as number[], free: [] as number[] }))
  const browKeeps = new Float64Array(spines.length)
  const frame = newBrowFrame()
  const onSkin = new Uint8Array(width * height)
  const free = new Float32Array(width * height)
  forEachTexel(
    head,
    geometry.skin,
    () => true,
    (texel, tri, w0, w1, w2) => {
      onSkin[texel] = 1
      const n = tri.n[0]! * w0 + tri.n[1]! * w1 + tri.n[2]! * w2
      const x = tri.x[0]! * w0 + tri.x[1]! * w1 + tri.x[2]! * w2
      const y = tri.y[0]! * w0 + tri.y[1]! * w1 + tri.y[2]! * w2
      let kept = 0
      if (n > 0 && inBox(band, x, y)) forehead[texel] = 1
      const guarded = guard(x, y, n)
      if (n > 0) {
        const eye = keep.eyes(x, y)
        let there = eye
        for (let k = 0; k < spines.length; k++) {
          const brow = keep.brows[k]!
          browKeeps[k] = inBox(brow.box, x, y) ? brow.there(x, y) : 0
          there = Math.max(there, browKeeps[k]!)
        }
        if (there > 0) {
          const lock =
            lockOver(like, fringe, fringeWidth, fringeHeight, width, height, texel) * joined(x, y)
          kept = there * (1 - lock)
          for (let k = 0; k < spines.length; k++) {
            if (!(browKeeps[k]! > 0)) continue
            browKept[k]!.texels.push(texel)
            browKept[k]!.free.push((1 - guarded) * (1 - eye * (1 - lock)))
            browFrame(spines[k]!, x, y, frame)
            if (frame.past > 0 || Math.abs(frame.across) > frame.half) continue
            covered[k]!.locks += lock
            covered[k]!.texels++
          }
        }
      }
      free[texel] = (1 - guarded) * (1 - kept)
    },
  )
  const cover = covered.map(({ locks, texels }) => (texels > 0 ? locks / texels : 0))
  cover.forEach((share, k) => {
    if (share <= BROW_HIDDEN) return
    const { texels, free: freed } = browKept[k]!
    texels.forEach((texel, i) => {
      free[texel] = Math.max(free[texel]!, freed[i]!)
    })
  })
  return { onSkin, free, cover, forehead }
}

/** Lightness levels the forehead's colours are counted in, for their median (see `medianTone`). */
const TONE_BINS = 256

/** Counts a texel's colour (`texel` of `data`) by its lightness (see `medianTone`). */
function countTone(tones: Float64Array, data: Uint8ClampedArray, texel: number) {
  const p = texel * 4
  const bin = Math.min(TONE_BINS - 1, Math.floor(luminance(data[p]!, data[p + 1]!, data[p + 2]!)))
  tones[bin * 4]!++
  for (let c = 0; c < 3; c++) tones[bin * 4 + 1 + c]! += data[p + c]!
}

/**
 * The median colour of some counted by lightness (`tones`: per level, the
 * count and the summed colour), the colours at that level averaged; null
 * when fewer than `least` were counted.
 */
function medianTone(tones: Float64Array, least: number): Rgb | null {
  let total = 0
  for (let bin = 0; bin < TONE_BINS; bin++) total += tones[bin * 4]!
  if (total <= 0 || total < least) return null
  let below = 0
  for (let bin = 0; bin < TONE_BINS; bin++) {
    const count = tones[bin * 4]!
    below += count
    if (count > 0 && below >= total / 2) {
      return [0, 1, 2].map((c) => tones[bin * 4 + 1 + c]! / count) as Rgb
    }
  }
  return null
}

/**
 * Shaves a head's hair (in place), laid out by the character's face
 * landmarks (`target`): the hair (by its colour, see `hairToShave`: gear
 * of other colours stays) is filled with the skin around it (`skin`, 0–1
 * per texel, how surely each texel is skin), and further from that skin
 * with the forehead's tone (see `scalpTone`), a little darker and grained
 * like skin, dotted with stubs of the hair it was; the hair's shadow on
 * the skin by it is lifted (see `shadowLift`). Below the eyes the face is
 * left be (see `faceGuard`: beards, stubble, shading), and above them the
 * brows and lashes but for a lock of hair over them (a fringe); a brow the
 * fringe hid is put back (see `restoreBrows`). `crown` is the crown's hair
 * colour, if any (see analyseBody).
 */
export function shaveHead(
  head: Pixels,
  geometry: HeadGeometry,
  skin: Float32Array,
  target: readonly number[],
  crown: Rgb | null,
) {
  const { data, width, height } = head
  const face = faceOf(target)
  const front = renderFront(head, geometry.all, MEASURE_VIEW).image
  const skinTone = skinColour(face, front)
  const hair = hairToShave(face, front, skinTone, crown)
  if (!hair) return
  const like = hairLikeness(head, hair, skinTone)
  const beard = bearded(face, front, hair, skinTone)
  const joined = joinedHair(face, front, hair, skinTone)
  const { onSkin, free, cover, forehead } = shaveable(head, geometry, face, like, beard, joined)

  // A coarse grid of the skin: how much hair each cell has.
  const cw = Math.ceil(width / SHAVE_SCALE)
  const ch = Math.ceil(height / SHAVE_SCALE)
  const density = new Float32Array(cw * ch)
  const texels = new Float32Array(cw * ch)
  const cellOf = (i: number) =>
    Math.floor(Math.floor(i / width) / SHAVE_SCALE) * cw + Math.floor((i % width) / SHAVE_SCALE)
  for (let i = 0; i < onSkin.length; i++) {
    if (!onSkin[i]) continue
    const j = cellOf(i)
    texels[j]! += 1
    density[j]! += smoothstep(SHAVE_FROM, SHAVE_TO, like[i]!) * free[i]!
  }
  const dense = new Float32Array(cw * ch)
  for (let j = 0; j < dense.length; j++) {
    if (texels[j]! > 0) {
      dense[j] = smoothstep(SHAVE_DENSE_FROM, SHAVE_DENSE_TO, density[j]! / texels[j]!)
    }
  }
  const closed = blurField(dilate(dense, cw, ch, SHAVE_CLOSE), cw, ch, SHAVE_CLOSE)

  // How much of each texel goes: the hair's own texels, with their shadow;
  // the gaps closed round them, and out past them, fading, so the shadow
  // ends where the hair did.
  const shaved = new Float32Array(onSkin.length)
  for (let i = 0; i < onSkin.length; i++) {
    if (!onSkin[i] || free[i]! <= 0) continue
    const cx = ((i % width) + 0.5) / SHAVE_SCALE - 0.5
    const cy = (Math.floor(i / width) + 0.5) / SHAVE_SCALE - 0.5
    shaved[i] =
      free[i]! *
      Math.max(smoothstep(SHAVE_FROM, SHAVE_TO, like[i]!), sampleField(closed, cw, ch, cx, cy))
  }

  // The skin the shave leaves be, by the hair, to fill it from: the fill
  // meets it where the shave fades out, without a seam.
  // The shadow lift reads the skin's colour where the shave fades out too.
  const known = new Float32Array(cw * ch)
  const colours = new Float64Array(cw * ch * 3)
  const bare = new Float32Array(cw * ch)
  const bareColours = new Float64Array(cw * ch * 3)
  const tones = new Float64Array(TONE_BINS * 4)
  let foreheadTexels = 0
  for (let i = 0; i < onSkin.length; i++) {
    if (!onSkin[i]) continue
    // The forehead's own skin, clear of any fringe (the shave takes that).
    if (forehead[i]) {
      foreheadTexels++
      if (skin[i]! >= FILL_TO && shaved[i]! <= 0) countTone(tones, data, i)
    }
    const k = smoothstep(FILL_FROM, FILL_TO, skin[i]!)
    if (k <= 0) continue
    const j = cellOf(i)
    const hairless = k * (1 - smoothstep(SHAVE_FROM, SHAVE_TO, like[i]!))
    bare[j]! += hairless
    for (let c = 0; c < 3; c++) bareColours[j * 3 + c]! += data[i * 4 + c]! * hairless
    if (shaved[i]! > 0) continue
    known[j]! += k
    for (let c = 0; c < 3; c++) colours[j * 3 + c]! += data[i * 4 + c]! * k
  }
  const tone =
    medianTone(tones, FOREHEAD_SHARE * foreheadTexels) ?? scalpTone(face, front, skinTone, hair)
  const lift = shadowLift(dense, bareColours, bare, cw, ch, tone)
  const small: Pixels = { data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch }
  for (let j = 0; j < known.length; j++) {
    if (known[j]! <= 0) continue
    for (let c = 0; c < 3; c++) {
      // Lifted no further than the tone: the fill takes no light patch from a light cell.
      const own = colours[j * 3 + c]! / known[j]!
      small.data[j * 4 + c] = Math.min(own * lift[c]![j]!, Math.max(own, tone[c]!))
    }
    known[j] = Math.min(1, known[j]! / (SHAVE_SCALE * SHAVE_SCALE))
  }
  const grain = Math.min(GRAIN_MOST, skinGrain(head, onSkin, free, shaved, skin, small, known, cw))
  const ring = dilate(dense, cw, ch, FILL_RING)
  for (let j = 0; j < known.length; j++) known[j]! *= ring[j]!
  const filled = fillFrom(small, known)
  const nearSkin = blurField(
    dilate(
      known.map((k) => (k > 0 ? 1 : 0)),
      cw,
      ch,
      SCALP_BLEND,
    ),
    cw,
    ch,
    SCALP_BLEND,
  )
  for (let j = 0; j < nearSkin.length; j++) {
    for (let c = 0; c < 3; c++) {
      filled.data[j * 4 + c] = tone[c]! + (filled.data[j * 4 + c]! - tone[c]!) * nearSkin[j]!
    }
  }

  // The cells a lift reaches, and their neighbours (a texel's lift is read between cells).
  const lifted = dilate(
    lift[0]!.map((_, j) => (lift[0]![j]! > 1 || lift[1]![j]! > 1 || lift[2]![j]! > 1 ? 1 : 0)),
    cw,
    ch,
    1,
  )
  const scalp = new Uint8ClampedArray(3)
  for (let i = 0; i < onSkin.length; i++) {
    if (!onSkin[i] || free[i]! <= 0) continue
    const x = i % width
    const y = (i - x) / width
    const cx = (x + 0.5) / SHAVE_SCALE - 0.5
    const cy = (y + 0.5) / SHAVE_SCALE - 0.5
    const p = i * 4
    if (lifted[cellOf(i)]! > 0) {
      for (let c = 0; c < 3; c++) {
        data[p + c] = data[p + c]! * (1 + (sampleField(lift[c]!, cw, ch, cx, cy) - 1) * free[i]!)
      }
    }
    const w = shaved[i]!
    if (w <= 0) continue
    sampleColor(filled, cx, cy, scalp, 0)
    const noise =
      GRAIN_COARSE * (2 * valueNoise(x / GRAIN_CELL, y / GRAIN_CELL, 9) - 1) +
      GRAIN_FINE * (2 * hash(x, y, 10) - 1)
    const pores = 1 + (grain * noise) / GRAIN_SPREAD
    const hairy = smoothstep(SHAVE_FROM, SHAVE_TO, like[i]!) * free[i]!
    const root = hash(x, y, 8) < STUBBLE_ROOTS ? ROOT_COLOUR * hairy : 0
    for (let c = 0; c < 3; c++) {
      const bare = scalp[c]! * (1 - SCALP_SHADOW * hairy) * pores
      const stubbed = bare + (data[p + c]! - bare) * root
      data[p + c] = data[p + c]! + (stubbed - data[p + c]!) * w
    }
  }
  restoreBrows(head, geometry, face, cover, shaved, hair)
}

/**
 * The hair's shadow on the skin by it — a forehead painted darker under
 * the hairline — is lifted towards the scalp's tone over this many coarse
 * cells out from the hair, fading, by at most this much (its own detail
 * kept): without the hair over it, it would be a dark band.
 */
const SHADOW_LIFT_REACH = 6
const SHADOW_LIFT_MOST = 1.35

/** The share of the cells round it that must be skin for a cell's lift to be sure (fully from this): fading out where little skin was seen. */
const SHADOW_LIFT_SURE = 0.25

/**
 * How much each colour channel of the skin by the hair is lifted (see
 * `SHADOW_LIFT_*`), per cell of the coarse grid: the scalp's `tone` over
 * the skin's own colour round the cell (from `colours`, the skin's summed
 * by how much of each cell is skin, `weights`), never darkened. `dense` is
 * where the hair is.
 */
function shadowLift(
  dense: Float32Array,
  colours: Float64Array,
  weights: Float32Array,
  cw: number,
  ch: number,
  tone: Rgb,
): Float32Array[] {
  // Blurred twice, a tent rather than a box: no square edges to the lift.
  const soften = (grid: Float32Array) =>
    blurField(blurField(grid, cw, ch, SHADOW_LIFT_REACH / 2), cw, ch, SHADOW_LIFT_REACH / 2)
  const reach = soften(dilate(dense, cw, ch, SHADOW_LIFT_REACH))
  const around = soften(weights)
  return [0, 1, 2].map((c) => {
    const channel = new Float32Array(cw * ch)
    for (let j = 0; j < channel.length; j++) channel[j] = colours[j * 3 + c]!
    const mean = soften(channel)
    const lift = new Float32Array(cw * ch).fill(1)
    for (let j = 0; j < lift.length; j++) {
      if (!(around[j]! > 0 && mean[j]! > 0)) continue
      const wanted = (tone[c]! * around[j]!) / mean[j]!
      const sure = smoothstep(0, SHADOW_LIFT_SURE, around[j]!)
      lift[j] = 1 + (Math.min(SHADOW_LIFT_MOST, Math.max(1, wanted)) - 1) * reach[j]! * sure
    }
    return lift
  })
}

/**
 * The bare skin's spread of lightness from texel to texel, as a share of
 * its lightness: over the skin a shave may take (see `shaveable`) but
 * leaves (`shaved` 0), each texel against its coarse cell's colour
 * (`small`, where `known`, the share of the cell that is skin, holds for
 * most of it).
 */
function skinGrain(
  head: Pixels,
  onSkin: Uint8Array,
  free: Float32Array,
  shaved: Float32Array,
  skin: Float32Array,
  small: Pixels,
  known: Float32Array,
  cw: number,
) {
  const { data, width, height } = head
  let sum = 0
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!onSkin[i] || free[i]! < 1 || shaved[i]! > 0 || skin[i]! < FILL_FROM) continue
      const j = Math.floor(y / SHAVE_SCALE) * cw + Math.floor(x / SHAVE_SCALE)
      if (known[j]! < FILL_FROM) continue
      const cell = luminance(small.data[j * 4]!, small.data[j * 4 + 1]!, small.data[j * 4 + 2]!)
      if (cell <= 0) continue
      const own = luminance(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!)
      sum += (own / cell - 1) ** 2
      count++
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0
}

/** How far out from a restored brow's spine (× its half-thickness) it is drawn, fading from the first to the second. */
const RESTORED_FROM = 1.1
const RESTORED_TO = 1.8

/** How far above and below a brow's spine (× its half-thickness) the skin round it is read, to tell its hairs by. */
const BROW_SKIN_AT = 2.1

/** The side (px) of the close front view a mirrored brow is read from: finer than the texture's own. */
const BROW_VIEW = 256

/**
 * A brow drawn where neither shows: strands this long along it and this
 * fine across (× the distance between the eyes), in noise that is hair
 * from the first level to the second, over a solid share of colour
 * between them; how thick the brow is (thinning from the first share of
 * its half-thickness out to the second), how much of the hair's colour it
 * takes at its heart, and how much darker it is than the hair.
 */
const DRAWN_STRAND_LENGTH = 0.02
const DRAWN_STRAND_WIDTH = 0.003
const DRAWN_HAIR_FROM = 0.3
const DRAWN_HAIR_TO = 0.7
const DRAWN_SOLID = 0.55
const DRAWN_BODY_FROM = 0.2
const DRAWN_BODY_TO = 1.1
const DRAWN_DENSITY = 0.8
const DRAWN_SHADE = 0.9

/**
 * A front view of part of the head (`box`, fractions of the whole front
 * view), `size` px a side: finer than a whole view drawn at once. Returns
 * a bilinear sampler of it at points of the whole view.
 */
function closeView(head: Pixels, triangles: readonly HeadTriangle[], box: Box, size: number) {
  const [left, top] = box
  const side = Math.max(box[2] - left, box[3] - top)
  const moved = triangles
    .filter(
      (tri) =>
        Math.max(tri.x[0]!, tri.x[1]!, tri.x[2]!) >= left &&
        Math.min(tri.x[0]!, tri.x[1]!, tri.x[2]!) <= left + side &&
        Math.max(tri.y[0]!, tri.y[1]!, tri.y[2]!) >= top &&
        Math.min(tri.y[0]!, tri.y[1]!, tri.y[2]!) <= top + side,
    )
    .map((tri) => ({
      ...tri,
      x: tri.x.map((x) => (x - left) / side),
      y: tri.y.map((y) => (y - top) / side),
    }))
  const image = renderFront(head, moved, size).image
  return (x: number, y: number, out: Uint8ClampedArray) =>
    sampleColor(image, ((x - left) / side) * size - 0.5, ((y - top) / side) * size - 0.5, out, 0)
}

/**
 * Puts back what a shaved fringe hid of the brows (in place; `cover`, as
 * BROW_EDGES, is how much of each locks of hair covered): a brow under the
 * fringe (see BROW_HIDDEN) whole, else just what was shaved of it
 * (`shaved`, per texel). The other brow is mirrored across the face, its
 * hairs darkening the shaved skin as they darken the skin round them; or,
 * that one hidden too, a brow is drawn in strands of the hair's colour
 * (`hair`).
 */
function restoreBrows(
  head: Pixels,
  geometry: HeadGeometry,
  face: Face,
  cover: readonly number[],
  shaved: Float32Array,
  hair: Rgb,
) {
  const { data } = head
  const spines = BROW_EDGES.map((edges) => browSpine(face, edges))
  const hidden = cover.map((share) => share > BROW_HIDDEN)
  const frame = newBrowFrame()
  const sample = new Uint8ClampedArray(3)
  const above = new Uint8ClampedArray(3)
  const below = new Uint8ClampedArray(3)
  const tint = hair.map((c) => c * DRAWN_SHADE) as Rgb
  const e = face.eyes
  spines.forEach((spine, k) => {
    if (!(cover[k]! > 0)) return
    const other = spines.length - 1 - k
    const source = hidden[other] ? null : spines[other]!
    const view =
      source &&
      closeView(
        head,
        geometry.all,
        boxAround(source.stations, Math.max(...source.halves) * (BROW_SKIN_AT + 1)),
        BROW_VIEW,
      )
    const lengths = [0]
    for (let i = 1; i < spine.stations.length; i++) {
      const [ax, ay] = spine.stations[i - 1]!
      const [bx, by] = spine.stations[i]!
      lengths.push(lengths[i - 1]! + Math.hypot(bx - ax, by - ay))
    }
    const box = boxAround(spine.stations, Math.max(...spine.halves) * (RESTORED_TO + BROW_END))
    const overBox = (tri: HeadTriangle) =>
      Math.max(tri.n[0]!, tri.n[1]!, tri.n[2]!) > 0 &&
      Math.max(tri.x[0]!, tri.x[1]!, tri.x[2]!) >= box[0] &&
      Math.max(tri.y[0]!, tri.y[1]!, tri.y[2]!) >= box[1] &&
      Math.min(tri.x[0]!, tri.x[1]!, tri.x[2]!) <= box[2] &&
      Math.min(tri.y[0]!, tri.y[1]!, tri.y[2]!) <= box[3]
    forEachTexel(head, geometry.skin, overBox, (texel, tri, w0, w1, w2) => {
      const facing = smoothstep(0, FACING_TO, tri.n[0]! * w0 + tri.n[1]! * w1 + tri.n[2]! * w2)
      const x = tri.x[0]! * w0 + tri.x[1]! * w1 + tri.x[2]! * w2
      const y = tri.y[0]! * w0 + tri.y[1]! * w1 + tri.y[2]! * w2
      // A brow partly under the fringe gets back only what was shaved of it.
      const put = facing * (hidden[k] ? 1 : shaved[texel]!)
      if (put <= 0 || !inBox(box, x, y)) return
      browFrame(spine, x, y, frame)
      const ends = 1 - smoothstep(0, BROW_END * frame.half, frame.past)
      const p = texel * 4
      if (view && source) {
        const w =
          (1 -
            smoothstep(
              RESTORED_FROM * frame.half,
              RESTORED_TO * frame.half,
              Math.abs(frame.across),
            )) *
          ends *
          put
        if (w <= 0) return
        // The same place by the other brow: as far along it, and as far
        // across for its thickness.
        const i = frame.segment
        const [ax, ay] = source.stations[i]!
        const [bx, by] = source.stations[i + 1]!
        const length = Math.hypot(bx - ax, by - ay) || 1e-9
        const up = bx >= ax ? 1 : -1
        const nx = ((by - ay) / length) * up
        const ny = (-(bx - ax) / length) * up
        const t = Math.min(1, Math.max(0, frame.t))
        const half = source.halves[i]! + (source.halves[i + 1]! - source.halves[i]!) * t
        const across = (frame.across * half) / Math.max(1e-9, frame.half)
        const px = ax + (bx - ax) * frame.t
        const py = ay + (by - ay) * frame.t
        view(px + nx * across, py + ny * across, sample)
        view(px + nx * half * BROW_SKIN_AT, py + ny * half * BROW_SKIN_AT, above)
        view(px - nx * half * BROW_SKIN_AT, py - ny * half * BROW_SKIN_AT, below)
        for (let c = 0; c < 3; c++) {
          const around = Math.max(1, (above[c]! + below[c]!) / 2)
          const darker = Math.min(1, sample[c]! / around)
          data[p + c] = data[p + c]! * (1 + (darker - 1) * w)
        }
        return
      }
      const along =
        lengths[frame.segment]! + frame.t * (lengths[frame.segment + 1]! - lengths[frame.segment]!)
      const body =
        (1 - smoothstep(DRAWN_BODY_FROM, DRAWN_BODY_TO, Math.abs(frame.across) / frame.half)) * ends
      if (body <= 0) return
      const strands = smoothstep(
        DRAWN_HAIR_FROM,
        DRAWN_HAIR_TO,
        valueNoise(along / (DRAWN_STRAND_LENGTH * e), frame.across / (DRAWN_STRAND_WIDTH * e), 11),
      )
      const w = DRAWN_DENSITY * body * (DRAWN_SOLID + (1 - DRAWN_SOLID) * strands) * put
      for (let c = 0; c < 3; c++) data[p + c] = data[p + c]! + (tint[c]! - data[p + c]!) * w
    })
  })
}
