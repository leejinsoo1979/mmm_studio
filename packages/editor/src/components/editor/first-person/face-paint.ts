/**
 * What the player paints on their character's face: iris colour, brows,
 * make-up, facial hair and freckles. Colours are hex (null keeps the
 * character's own), amounts 0–1 and the brows' darkness and thickness −1–1
 * (0 leaving them as they are).
 */

import { dilate, fillFrom } from './face-fill'
import { FACE_PARTS, facePointOf, featureRegions, type Point, unpackPoints } from './face-points'
import { forEachTexel, renderFront, sampleColor } from './front-render'
import type { HeadGeometry } from './head-geometry'
import { type HeadTriangle, hexToRgb, luminance, type Pixels, type Rgb } from './look-pixels'

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
function mixTowards(colour: Float64Array, towards: Rgb, w: number) {
  for (let c = 0; c < 3; c++) colour[c] = colour[c]! + (towards[c]! - colour[c]!) * w
}

/** A face's landmarks on its front view, and its scale: the distance between its eyes' centres. */
type Face = { points: Point[]; at: (landmark: number) => Point; eyes: number }

function faceOf(target: readonly number[]): Face {
  const points = unpackPoints(target)
  const centre = (indices: readonly number[]): Point => [
    indices.reduce((sum, i) => sum + points[i]![0], 0) / indices.length,
    indices.reduce((sum, i) => sum + points[i]![1], 0) / indices.length,
  ]
  const [rx, ry] = centre(FACE_PARTS.rightEye)
  const [lx, ly] = centre(FACE_PARTS.leftEye)
  return {
    points,
    at: (landmark) => points[facePointOf(landmark)]!,
    eyes: Math.hypot(lx - rx, ly - ry),
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
 * (`strands`), only where the hair lies thick all round (`locks`: the
 * hair's mask takes in a brow's darkest hairs too, but a fringe over the
 * brow is hair throughout), or not at all (null).
 */
type UnderHair = 'strands' | 'locks' | null

/** How far round a texel (texels) the hair is taken in to tell locks of it from a brow's hairs. */
const LOCK_REACH = 4

/** The share of the texels round it that must be hair for a lock to hide what is under it (fully from the second). */
const LOCK_FROM = 0.4
const LOCK_TO = 0.75

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

/**
 * One thing painted on the face: the box on the front view it keeps to,
 * how the character's hair over it hides it, and what it does to a texel
 * showing at a point there — `paint` changes the texel's colour (in place,
 * by `strength` 0–1; `texel` is its index, for detail as fine as the
 * texture's own), and `moves`, where there is one, says where on the front
 * view the texel takes its colour from instead (an offset into `offset`;
 * false for nowhere else).
 */
type Layer = {
  box: Box
  underHair: UnderHair
  moves?: (x: number, y: number, offset: Float64Array) => boolean
  paint: (colour: Float64Array, x: number, y: number, strength: number, texel: number) => void
}

/** How far lipstick fades across the lips' edge, either side, as a share of the mouth's height. */
const LIP_FEATHER = 0.1

function lipsLayer(face: Face, front: Pixels, tint: Rgb, amount: number): Layer {
  const outline = FACE_PARTS.lips.map((i) => face.points[i]!)
  const height = Math.hypot(face.at(0)[0] - face.at(17)[0], face.at(0)[1] - face.at(17)[1])
  const lips = areaOf(outline, LIP_FEATHER * height)
  // The lips' own lightness: the tint keeps each texel's relative to it.
  const own = frontColours(
    front,
    lips.box,
    (x, y) => outlineDistance(outline, x, y) < -lips.feather,
  )
  const ref = luminance(...quantile(own, 0.5, tint))
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
      along * 1.5,
    ),
    underHair: 'strands',
    paint: (colour, x, y, strength) => {
      let glow = 0
      for (const spot of spots) {
        const dx = x - spot.x
        const dy = y - spot.y
        const a = (dx * spot.ax + dy * spot.ay) / along
        const b = (dx * spot.ay - dy * spot.ax) / across
        glow = Math.max(glow, Math.exp(-2 * (a * a + b * b)))
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
        if (s < -0.2 || s > 1 + SHADOW_WING) continue
        const lidY = s <= 1 ? heightAt(lid, x) : outer[1] - (s - 1) * Math.abs(width) * SHADOW_RISE
        const span = lidY - heightAt(brow, x)
        if (!(span > 0)) continue
        const up = (lidY - y) / span
        const w =
          smoothstep(-0.06, 0.04, up) *
          (1 - smoothstep(SHADOW_REACH * 0.45, SHADOW_REACH, up)) *
          smoothstep(-0.15, 0.15, s) *
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
          const size = Math.hypot(dx, dy) || 1e-9
          const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (size * size)))
          const distance = Math.hypot(x - ax - t * dx, y - ay - t * dy)
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
            ? 1 - smoothstep(width * 0.55, width, nearest)
            : 1 - smoothstep(0, width * 0.3, nearest)
        ink = Math.max(ink, w)
      }
      if (ink > 0) mixTowards(colour, LINER_COLOUR, amount * ink * strength)
    },
  }
}

/** A brow's spine (the middle of its landmarks' upper and lower edges, outer end to inner) and half-thickness along it. */
type BrowSpine = { stations: Point[]; halves: number[] }

/** Where a point lies by a brow: see `browFrame`. */
type BrowFrame = { across: number; half: number; past: number; nx: number; ny: number }

/**
 * Where a point lies by a brow: how far across it from its spine
 * (`across`, up the face positive, along `nx`, `ny`), the brow's
 * half-thickness there, and how far past its ends.
 */
function browFrame({ stations, halves }: BrowSpine, x: number, y: number, frame: BrowFrame) {
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i + 1 < stations.length; i++) {
    const [ax, ay] = stations[i]!
    const [bx, by] = stations[i + 1]!
    const length = Math.hypot(bx - ax, by - ay) || 1e-9
    const tx = (bx - ax) / length
    const ty = (by - ay) / length
    const along = (x - ax) * tx + (y - ay) * ty
    const t = Math.min(1, Math.max(0, along / length))
    const distance = (x - ax - (bx - ax) * t) ** 2 + (y - ay - (by - ay) * t) ** 2
    if (distance >= nearest) continue
    nearest = distance
    const up = ty > 0 ? 1 : -1
    frame.nx = ty * up
    frame.ny = -tx * up
    frame.across = (x - ax) * frame.nx + (y - ay) * frame.ny
    frame.half = halves[i]! + (halves[i + 1]! - halves[i]!) * t
    frame.past =
      i === 0 && along < 0
        ? -along
        : i + 2 === stations.length && along > length
          ? along - length
          : 0
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
 * darker half's median of what lies this near its spine (× its
 * half-thickness), the skin's as the lighter side of what lies between
 * these two distances from it (clear of the brow, short of the eye).
 */
const BROW_CORE = 0.5
const BROW_SKIN_FROM = 1.6
const BROW_SKIN_TO = 2.6

/** A brow's colour where the front view shows none. */
const FALLBACK_BROW: Rgb = [60, 45, 35]

/** How much a brow's darkness at 1 darkens its hairs, and at −1 fades them into the skin. */
const BROW_DARKEN = 0.6
const BROW_FADE = 0.85

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

function browLayers(face: Face, front: Pixels, paint: FacePaint): Layer[] {
  const scale = 1 + BROW_GROWTH * paint.browThickness
  const tint = paint.browColor ? hexToRgb(paint.browColor) : null
  const frame: BrowFrame = { across: 0, half: 0, past: 0, nx: 0, ny: 0 }
  return BROW_EDGES.map(([upper, lower]) => {
    const spine: BrowSpine = {
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
    const thickest = Math.max(...spine.halves)
    const box = boxAround(
      spine.stations,
      thickest * Math.max(BROW_END, Math.max(1, scale) * BROW_EDGE + BROW_EASE, BROW_REACH * scale),
    )
    // The brow's hairs and the skin round it, as they are.
    const where = (test: (frame: BrowFrame) => boolean) => (x: number, y: number) => {
      browFrame(spine, x, y, frame)
      return frame.past === 0 && test(frame)
    }
    const hair = quantile(
      frontColours(
        front,
        box,
        where(({ across, half }) => Math.abs(across) < half * BROW_CORE),
      ),
      0.25,
      FALLBACK_BROW,
    )
    const skin = quantile(
      frontColours(
        front,
        box,
        where(
          ({ across, half }) =>
            Math.abs(across) > half * BROW_SKIN_FROM && Math.abs(across) < half * BROW_SKIN_TO,
        ),
      ),
      0.6,
      FALLBACK_SKIN,
    )
    const skinLum = luminance(...skin)
    const contrast = Math.max(BROW_CONTRAST, skinLum - luminance(...hair))
    const fade = BROW_FADE * Math.max(0, -paint.browDarkness)
    const darken = BROW_DARKEN * Math.max(0, paint.browDarkness)
    return {
      box,
      underHair: 'locks',
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
      paint: (colour, x, y, strength) => {
        browFrame(spine, x, y, frame)
        const reach = frame.half * Math.max(1, scale)
        const region =
          (1 - smoothstep(reach * BROW_EDGE, reach * BROW_REACH, Math.abs(frame.across))) *
          (1 - smoothstep(0, BROW_END * frame.half, frame.past))
        if (region <= 0) return
        const share = (skinLum - luminance(colour[0]!, colour[1]!, colour[2]!)) / contrast
        const w = region * strength * smoothstep(BROW_HAIR_FROM, BROW_HAIR_TO, share)
        if (w <= 0) return
        // A new colour shifts each hair by the brow's change of colour, so
        // the brow keeps its texture.
        if (tint) for (let c = 0; c < 3; c++) colour[c] = colour[c]! + (tint[c]! - hair[c]!) * w
        if (fade > 0) mixTowards(colour, skin, fade * w)
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

/** A beard where no hair colour is known: dark brown. */
export const DEFAULT_BEARD: Rgb = [58, 42, 32]

/** The least lightness a beard's strands keep, so a black one still shows its strands. */
const BEARD_FLOOR = 34

function beardLayer(face: Face, skinLum: number, paint: FacePaint, tint: Rgb): Layer {
  const { beard, beardAmount: amount } = paint
  const e = face.eyes
  const outline = (landmarks: readonly number[]) => landmarks.map(face.at)
  // A full beard and stubble cover the jaw and neck, but not the lips.
  const whole = beard === 'full' || beard === 'stubble'
  const feather = (whole ? BEARD_FEATHER : TRIMMED_FEATHER) * e
  const areas =
    beard === 'mustache'
      ? [areaOf(outline(MUSTACHE), feather)]
      : beard === 'goatee'
        ? [areaOf(outline(MUSTACHE), feather), areaOf(outline(CHIN), feather)]
        : [areaOf(outline(FULL_BEARD), feather)]
  const lips = areaOf(
    FACE_PARTS.lips.map((i) => face.points[i]!),
    TRIMMED_FEATHER * e * 0.4,
  )
  const jaw = byX(outline(JAW))
  const neck = BEARD_NECK * e
  const [jawLeft, jawRight] = [jaw[0]![0], jaw[jaw.length - 1]![0]]
  const box = joinBoxes([
    ...areas.map((area) => area.box),
    ...(whole ? [boxAround(jaw, neck)] : []),
  ])
  const grown = fieldOf(box, feather, (x, y) => {
    let m = 0
    for (const area of areas) m = Math.max(m, cover(area, x, y))
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
  const lift = lightness < BEARD_FLOOR ? BEARD_FLOOR / Math.max(1, lightness) : 1
  const hairColour = (colour: Float64Array, shade: number): Rgb => {
    // Lit as the skin under it is.
    const lit = Math.sqrt(luminance(colour[0]!, colour[1]!, colour[2]!) / Math.max(1, skinLum))
    return [0, 1, 2].map((c) => Math.min(255, tint[c]! * lift * lit * shade)) as Rgb
  }
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
        w = shadow + (1 - shadow) * (stub ? STUB_COLOUR * (0.5 + 0.5 * amount) : 0)
      } else {
        const strands =
          0.5 * valueNoise(x / (STRAND_WIDTH * e), y / (STRAND_LENGTH * e), 2) +
          0.3 * valueNoise(x / (LOCK_WIDTH * e), y / (LOCK_LENGTH * e), 3) +
          0.2 * grain
        const growth = m * (0.5 + 0.5 * amount)
        const hair = smoothstep(1 - growth - STRAND_EDGE, 1 - growth + STRAND_EDGE, strands)
        const under = BEARD_UNDER * growth
        w = under + (1 - under) * hair * BEARD_HAIR
        shade = 0.5 + 1.1 * strands
      }
      mixTowards(colour, hairColour(colour, shade), w * strength)
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
      most = Math.max(most, Math.exp(-2 * (a * a + b * b)))
    }
    return most
  }
  const cell = FRECKLE_CELL * face.eyes
  return {
    box: joinBoxes(
      patches.map(
        ({ x, y, across, down }): Box => [
          x - across * 1.6,
          y - down * 1.6,
          x + across * 1.6,
          y + down * 1.6,
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
          const fx = (i + 0.15 + 0.7 * hash(i, j, 4)) * cell
          const fy = (j + 0.15 + 0.7 * hash(i, j, 5)) * cell
          const here = density(fx, fy)
          if (here < 0.05) continue
          const radius =
            cell * (FRECKLE_SMALLEST + (FRECKLE_LARGEST - FRECKLE_SMALLEST) * hash(i, j, 6))
          const d = Math.hypot(x - fx, y - fy)
          if (d >= radius) continue
          const depth = (0.45 + 0.45 * hash(i, j, 7)) * (0.55 + 0.45 * amount)
          dark = Math.max(dark, (1 - smoothstep(radius * 0.35, radius, d)) * here * depth)
        }
      }
      const w = dark * strength
      for (let c = 0; c < 3; c++) colour[c]! *= 1 - w * (1 - FRECKLE_TINT[c]!)
    },
  }
}

/** What painting a face needs besides the face. */
export type PaintContext = {
  /** The colour a beard grows in: the hair's dye, or the character's own hair, or DEFAULT_BEARD. */
  beard: Rgb
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
  const skinLum = () => luminance(...skinColour(face, front()))
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
    layers.push(lipsLayer(face, front(), hexToRgb(paint.lips), paint.lipAmount))
  }
  if (paint.liner > 0) layers.push(linerLayer(face, paint.liner))
  if (paint.beard !== 'none' && paint.beardAmount > 0) {
    layers.push(beardLayer(face, skinLum(), paint, context.beard))
  }
  if (layers.length === 0) return

  const bounds = joinBoxes(layers.map((layer) => layer.box))
  const { width, height } = head
  // Reshaped brows read the texture as it was, around them.
  const source: Pixels = layers.some((layer) => layer.moves)
    ? { data: new Uint8ClampedArray(head.data), width, height }
    : head
  const colour = new Float64Array(3)
  const offset = new Float64Array(2)
  const step = new Float64Array(4)
  const sample = new Uint8ClampedArray(3)
  let stepOf: HeadTriangle | null = null
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
    const p = texel * 4
    for (let c = 0; c < 3; c++) colour[c] = source.data[p + c]!
    const { hair } = context
    for (const layer of layers) {
      if (!inBox(layer.box, x, y)) continue
      const strength =
        facing *
        (!hair || !layer.underHair
          ? 1
          : layer.underHair === 'strands'
            ? 1 - hair[texel]!
            : 1 - smoothstep(LOCK_FROM, LOCK_TO, hairAround(hair, width, height, texel)))
      if (strength <= 0) continue
      if (layer.moves?.(x, y, offset)) {
        if (tri !== stepOf) {
          stepOf = tri
          textureStep(tri, step)
        }
        const dx = offset[0]! * strength
        const dy = offset[1]! * strength
        const u = tri.u[0]! * w0 + tri.u[1]! * w1 + tri.u[2]! * w2 + step[0]! * dx + step[1]! * dy
        const v = tri.v[0]! * w0 + tri.v[1]! * w1 + tri.v[2]! * w2 + step[2]! * dx + step[3]! * dy
        sampleColor(source, u * width - 0.5, v * height - 0.5, sample, 0)
        for (let c = 0; c < 3; c++) colour[c] = sample[c]!
      }
      layer.paint(colour, x, y, strength, texel)
    }
    for (let c = 0; c < 3; c++) head.data[p + c] = colour[c]!
  })
}

/** How much smaller than the head's texture a shaved scalp is worked out on first: its skin is filled in smooth, so coarse will do. */
const SHAVE_SCALE = 4

/** Where a texel counts as hair to shave (its share of hair, fully from the second): low, so no strand is left. */
const SHAVE_FROM = 0.05
const SHAVE_TO = 0.4

/**
 * Where, on the coarse grid, the hair is dense enough to shave all of it
 * (fully from the second): its darkest strands, too dark for the hair's
 * mask, and its gaps go too, and the fine hairs past its edge, fading out
 * over this many cells beyond it.
 */
const SHAVE_DENSE_FROM = 0.25
const SHAVE_DENSE_TO = 0.5
const SHAVE_CLOSE = 4

/**
 * How sure a texel must be of being skin (fully from the second) to fill a
 * shaved scalp from, and the ring round the hair it must lie in (coarse
 * cells from the hair): clear of the hair's shadow, and near enough to be
 * the skin the scalp runs into (not the throat's, say).
 */
const FILL_FROM = 0.5
const FILL_TO = 0.9
const FILL_CLEAR = 4
const FILL_RING = 8

/**
 * How far from the skin it is filled from (coarse cells) a shaved scalp
 * gives way to the skin's own tone: the fill, averaging whatever skin is
 * far off (a shadowed nape, an ear), would leave the scalp's halves (apart
 * on the texture) in different tones where they meet.
 */
const SCALP_BLEND = 6

/** How much darker than the skin around it a shaved scalp is. */
const SCALP_SHADOW = 0.04

/** The share of a shaved scalp's texels showing a stub of hair, and how much of the hair's colour a stub keeps. */
const STUBBLE_ROOTS = 0.3
const ROOT_COLOUR = 0.15

/** How far past the face's features (× the distance between the eyes) a shave takes only locks of hair (see `UnderHair`). */
const SHAVE_KEEP_OFF = 0.03

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
 * Shaves a head's painted hair (in place): the hair (`hair`, 0–1 per texel)
 * is filled with the skin around it (`skin`, 0–1 per texel), and further
 * from that skin with its tone (the cheeks', or the skin's median without
 * landmarks), a little darker and dotted with stubs of the hair it was.
 * Only the skin's own texels are shaved (the mouth's and eyes' textures can
 * look like hair); with the character's face landmarks (`target`), its
 * features — brows and lashes, nostrils, the line between the lips — are
 * kept, whatever the hair's mask took of them, and only a lock over them
 * (a fringe) goes.
 */
export function shaveHead(
  head: Pixels,
  geometry: HeadGeometry,
  hair: Float32Array,
  skin: Float32Array,
  target: readonly number[] | null,
) {
  const { data, width, height } = head
  const face = target && faceOf(target)
  const kept = face
    ? featureRegions(face.points).map((outline) => areaOf(outline, SHAVE_KEEP_OFF * face.eyes))
    : []
  const keptBox = kept.length > 0 ? joinBoxes(kept.map((area) => area.box)) : null
  const features =
    keptBox &&
    fieldOf(keptBox, kept[0]!.feather, (x, y) => {
      let there = 0
      for (const area of kept) there = Math.max(there, cover(area, x, y))
      return there
    })
  const onSkin = new Uint8Array(width * height)
  const keep = new Float32Array(width * height)
  forEachTexel(
    head,
    geometry.skin,
    () => true,
    (texel, tri, w0, w1, w2) => {
      onSkin[texel] = 1
      if (!features || tri.n[0]! * w0 + tri.n[1]! * w1 + tri.n[2]! * w2 <= 0) return
      const there = features(
        tri.x[0]! * w0 + tri.x[1]! * w1 + tri.x[2]! * w2,
        tri.y[0]! * w0 + tri.y[1]! * w1 + tri.y[2]! * w2,
      )
      if (there <= 0) return
      keep[texel] =
        there * (1 - smoothstep(LOCK_FROM, LOCK_TO, hairAround(hair, width, height, texel)))
    },
  )

  // A coarse grid of the skin: how much hair each cell has, and the colour
  // of its bare skin clear of the hair, to fill the shaved scalp from.
  const cw = Math.ceil(width / SHAVE_SCALE)
  const ch = Math.ceil(height / SHAVE_SCALE)
  const density = new Float32Array(cw * ch)
  const texels = new Float32Array(cw * ch)
  const known = new Float32Array(cw * ch)
  const colours = new Float64Array(cw * ch * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!onSkin[i]) continue
      const j = Math.floor(y / SHAVE_SCALE) * cw + Math.floor(x / SHAVE_SCALE)
      texels[j]! += 1
      density[j]! += smoothstep(SHAVE_FROM, SHAVE_TO, hair[i]!)
      const k = smoothstep(FILL_FROM, FILL_TO, skin[i]!)
      known[j]! += k
      for (let c = 0; c < 3; c++) colours[j * 3 + c]! += data[i * 4 + c]! * k
    }
  }
  const small: Pixels = { data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch }
  const dense = new Float32Array(cw * ch)
  const skins: Rgb[] = []
  for (let j = 0; j < known.length; j++) {
    if (texels[j]! > 0) {
      dense[j] = smoothstep(SHAVE_DENSE_FROM, SHAVE_DENSE_TO, density[j]! / texels[j]!)
    }
    if (known[j]! <= 0) continue
    for (let c = 0; c < 3; c++) small.data[j * 4 + c] = colours[j * 3 + c]! / known[j]!
    known[j] = Math.min(1, known[j]! / (SHAVE_SCALE * SHAVE_SCALE))
    if (!face && known[j]! >= 0.5) {
      skins.push([small.data[j * 4]!, small.data[j * 4 + 1]!, small.data[j * 4 + 2]!])
    }
  }
  const tone = face
    ? skinColour(face, renderFront(head, geometry.all, MEASURE_VIEW).image)
    : quantile(
        skins.sort((a, b) => luminance(...a) - luminance(...b)),
        0.5,
        FALLBACK_SKIN,
      )
  const near = dilate(dense, cw, ch, FILL_CLEAR)
  const ring = dilate(dense, cw, ch, FILL_RING)
  for (let j = 0; j < known.length; j++) known[j]! *= (1 - near[j]!) * ring[j]!
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
  const closed = blurField(dilate(dense, cw, ch, SHAVE_CLOSE), cw, ch, SHAVE_CLOSE)

  const scalp = new Uint8ClampedArray(3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!onSkin[i]) continue
      const cx = (x + 0.5) / SHAVE_SCALE - 0.5
      const cy = (y + 0.5) / SHAVE_SCALE - 0.5
      // The hair's own texels shaved, with their shadow; the gaps closed
      // round them just filled, so the shadow ends where the hair did.
      const shaven = smoothstep(SHAVE_FROM, SHAVE_TO, hair[i]!) * (1 - keep[i]!)
      const w = Math.max(shaven, sampleField(closed, cw, ch, cx, cy) * (1 - keep[i]!))
      if (w <= 0) continue
      sampleColor(filled, cx, cy, scalp, 0)
      const root = hash(x, y, 8) < STUBBLE_ROOTS ? ROOT_COLOUR * shaven : 0
      const p = i * 4
      for (let c = 0; c < 3; c++) {
        const bare = scalp[c]! * (1 - SCALP_SHADOW * shaven)
        const shaved = bare + (data[p + c]! - bare) * root
        data[p + c] = data[p + c]! + (shaved - data[p + c]!) * w
      }
    }
  }
}
