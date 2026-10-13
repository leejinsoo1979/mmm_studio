import { type HeadModel, landmarkPosition } from '../head-model'
import {
  apply3,
  choleskySolve,
  cross3,
  type Mat3,
  mulMat3,
  rotation,
  rotationLog,
  type Similarity,
  similarity,
  transpose3,
  type Vec3,
} from '../linalg'
import { fillTriangles } from '../silhouette'

/**
 * The photo avatar bench's geometry measure: a fitted head against the true
 * head it was photographed from, in millimetres, as the acceptance gates
 * read it. Shared by the browser bench (scripts/photo-avatar) and the
 * fixture tests, so both score a fit the same way.
 *
 * The fit is put in the truth's frame by its skull and ears (the top and
 * back of the head, and the ears), not by its face: a face that sits too
 * far forward on its head then counts as error. That alignment allows a
 * scale, which is reported apart (the head's absolute size) and taken out
 * of the profile's errors.
 *
 * The profile is the head's outline seen from the side (the silhouette of
 * its skin, projected along x): forehead, nose, lips, chin, under the chin
 * and down the neck. Named points are the turns of the truth's outline,
 * walking up and down from the nose's tip; a point's error is the fit's
 * outline minus the truth's at that height, in depth (+ = forward) for the
 * face's points and in height (+ = lower) under the chin.
 */

/** Raster resolution of every silhouette (m per pixel). */
const RES = 0.00025

export type Surface = { positions: ArrayLike<number>; triangles: ArrayLike<number> }

/** The truth's side outline: named points (truth frame, metres) and the line forehead → neck. */
export type SideProfile = {
  /** Height range and depth origin of the raster both heads are drawn into. */
  box: { top: number; bottom: number; back: number; front: number }
  /** Each named point: its height (y) and depth (z), or for the chin's underside its depth (z) and height (y). */
  points: Record<ProfilePoint, { y: number; z: number }>
  /** The submental line: heights of the chin's underside at depths `submental.z` (m). */
  submental: { z: number[]; y: number[] }
  /** The outline from the forehead (MediaPipe 10's height) down the face, under the chin, down the neck: [z, y] pairs. */
  line: number[]
}

export const PROFILE_POINTS = [
  'glabella',
  'nasion',
  'midBridge',
  'pronasale',
  'subnasale',
  'upperLip',
  'lowerLip',
  'pogonion',
  'menton',
] as const
export type ProfilePoint = (typeof PROFILE_POINTS)[number]

/** A ¾ outline: the head turned `yaw`, the extreme of its silhouette on the side the face turns to, per height. */
export type Outline = { yaw: number; top: number; rows: number; x: number[] }

export type TruthHead = {
  /** The truth's MediaPipe landmarks on its skin (truth frame, metres), null where none was lifted. */
  landmarks: (Vec3 | null)[]
  /** Points (and unit normals) of its skin, a few millimetres apart, for aligning a fit's skull and ears. */
  cloud: { points: Float32Array; normals: Float32Array }
  side: SideProfile
  outlines: Outline[]
  /** Its face's width (m) at the cheekbones and at the jaw, ahead of the ears (see `faceWidths`). */
  widths: { cheek: number; jaw: number; plane: number; cheekRows: [number, number]; jawRow: number }
  /** Whether the truth's units are real (a scan's may be a guess: then its scale is not scored). */
  absoluteScale: boolean
}

export type GeometryReport = {
  alignment: {
    /** The similarity carrying the fit onto the truth (skull and ears), for drawing them together. */
    transform: Similarity
    /** Fit's size over the truth's (from the skull and ears), less one: + is too big. */
    scaleError: number
    /** RMS (mm) of the skull and ears after alignment, the worst 30 % left out: how well defined the alignment is. */
    residualMm: number
    /** How many skull and ear points (weighted) it rests on: few where hair is modelled over the skull. */
    skullPoints: number
    /** Its rotation (degrees) and translation (mm) from the face-landmark start: how far the face alone would have misplaced it. */
    fromLandmarksDeg: number
    fromLandmarksMm: number
  }
  /** Fit minus truth (mm) at each named point; noseProjection is pronasale minus subnasale's error. */
  points: Record<ProfilePoint | 'noseProjection' | 'submental', number>
  /** Over the whole outline, forehead to neck: each truth point's distance to the fit's outline (mm). */
  profile: { mean: number; max: number; points: number }
  /** The face's median depth offset on its head (mm, + forward): the shift the points share. */
  faceOffset: number
  /** The ¾ outlines' mean distance (mm), each side and both. */
  outline45: { left: number; right: number; mean: number }
  /** Face width, fit over truth less one: absolute (with the fit's size) and in proportion (scaled). */
  width: { cheek: number; jaw: number; cheekScaled: number; jawScaled: number }
}

// ---------------------------------------------------------------------------------------------
// Rasters

type Raster = { width: number; height: number; data: Uint8Array }

/** Fills the surface's triangles, projected by `project` (to raster pixels), into a raster. */
function rasterise(
  surface: Surface,
  width: number,
  height: number,
  project: (p: Vec3) => [number, number],
  keep?: (a: Vec3, b: Vec3, c: Vec3) => boolean,
): Raster {
  const count = surface.positions.length / 3
  const xy = new Float64Array(count * 2)
  const at = (i: number): Vec3 => [
    surface.positions[i * 3]!,
    surface.positions[i * 3 + 1]!,
    surface.positions[i * 3 + 2]!,
  ]
  for (let i = 0; i < count; i++) {
    const [u, v] = project(at(i))
    xy[i * 2] = u
    xy[i * 2 + 1] = v
  }
  const data = new Uint8Array(width * height)
  const triangles = surface.triangles
  fillTriangles(
    xy,
    triangles,
    width,
    height,
    data,
    1,
    keep
      ? (t) => keep(at(triangles[t * 3]!), at(triangles[t * 3 + 1]!), at(triangles[t * 3 + 2]!))
      : undefined,
  )
  return { width, height, data }
}

/** The side raster: columns from `box.back` forward, rows from `box.top` down. */
function sideRaster(surface: Surface, box: SideProfile['box']): Raster {
  const width = Math.ceil((box.front - box.back) / RES)
  const height = Math.ceil((box.top - box.bottom) / RES)
  return rasterise(surface, width, height, ([, y, z]) => [
    (z - box.back) / RES,
    (box.top - y) / RES,
  ])
}

const rowOf = (box: SideProfile['box'], y: number) => Math.round((box.top - y) / RES - 0.5)
const colOf = (box: SideProfile['box'], z: number) => Math.round((z - box.back) / RES - 0.5)
const yOfRow = (box: SideProfile['box'], row: number) => box.top - (row + 0.5) * RES
const zOfCol = (box: SideProfile['box'], col: number) => box.back + (col + 0.5) * RES

type Side = {
  box: SideProfile['box']
  raster: Raster
  /** Per row (at its centre's height), the frontmost depth the skin reaches (m), NaN where none. */
  front: Float64Array
}

/**
 * The side view of a surface: its silhouette raster (for tracing and the
 * chin's underside) and, from where its triangles' edges cross each row's
 * height, its exact front.
 */
function sideOf(surface: Surface, box: SideProfile['box']): Side {
  const raster = closed(sideRaster(surface, box), CLOSE)
  const front = new Float64Array(raster.height).fill(Number.NaN)
  const p = surface.positions
  const t = surface.triangles
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = t[i + k]! * 3
      const b = t[i + ((k + 1) % 3)]! * 3
      const ya = p[a + 1]!
      const yb = p[b + 1]!
      if (ya === yb) continue
      const lo = Math.max(0, Math.ceil((box.top - Math.max(ya, yb)) / RES - 0.5))
      const hi = Math.min(raster.height - 1, Math.floor((box.top - Math.min(ya, yb)) / RES - 0.5))
      for (let row = lo; row <= hi; row++) {
        const z = p[a + 2]! + ((yOfRow(box, row) - ya) / (yb - ya)) * (p[b + 2]! - p[a + 2]!)
        if (!(z <= front[row]!)) front[row] = z
      }
    }
  }
  return { box, raster, front }
}

/** Gaps narrower than this many pixels (1 mm) in a silhouette are closed: the lips' parting, a nostril. */
const CLOSE = 4

/** A raster with its gaps up to 2·k pixels closed (dilated, then eroded, by a square of radius k). */
function closed(r: Raster, k: number): Raster {
  const grow = (data: Uint8Array, value: number) => {
    const { width, height } = r
    const rows = new Uint8Array(data.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let hit = false
        for (let d = -k; d <= k && !hit; d++) {
          const xx = x + d
          if (xx >= 0 && xx < width && data[y * width + xx] === value) hit = true
        }
        rows[y * width + x] = hit ? value : 1 - value
      }
    }
    const out = new Uint8Array(data.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let hit = false
        for (let d = -k; d <= k && !hit; d++) {
          const yy = y + d
          if (yy >= 0 && yy < height && rows[yy * width + x] === value) hit = true
        }
        out[y * width + x] = hit ? value : 1 - value
      }
    }
    return out
  }
  return { ...r, data: grow(grow(r.data, 1), 0) }
}

/**
 * The skin's underside in a column below a row (the chin's): the end of the run of covered pixels
 * from that row down; NaN where the run reaches the raster's bottom (the neck) or the row is open.
 */
function undersideAt(side: Side, col: number, from: number): number {
  const { raster } = side
  if (col < 0 || col >= raster.width || !raster.data[from * raster.width + col]) return Number.NaN
  let row = from
  while (row + 1 < raster.height && raster.data[(row + 1) * raster.width + col]) row++
  return row + 1 >= raster.height ? Number.NaN : yOfRow(side.box, row) - RES / 2
}

const frontAt = (side: Side, row: number) =>
  row >= 0 && row < side.front.length ? side.front[row]! : Number.NaN

/** The frontmost covered column of a raster row, or −1. */
function rasterFront(r: Raster, row: number): number {
  for (let c = r.width - 1; c >= 0; c--) if (r.data[row * r.width + c]) return c
  return -1
}

/**
 * The raster's outer boundary from a start pixel, clockwise (rows down): with
 * the region on the right, so down the face's front, back under the chin and
 * down the neck. Stops at row `untilRow` or after `limit` steps. Pixel
 * centres as [col, row].
 */
function trace(r: Raster, start: [number, number], untilRow: number, limit = 40000): number[] {
  const inside = (c: number, row: number) =>
    c >= 0 && row >= 0 && c < r.width && row < r.height && r.data[row * r.width + c] === 1
  // Neighbours clockwise (on screen, rows down): N, NE, E, SE, S, SW, W, NW.
  const dirs = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ] as const
  let [c, row] = start
  // Came from outside, to the east (in front of the face).
  let back = 2
  const out = [c, row]
  for (let step = 0; step < limit && row < untilRow; step++) {
    let found = -1
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8
      if (inside(c + dirs[d]![0], row + dirs[d]![1])) {
        found = d
        break
      }
    }
    if (found < 0) break
    c += dirs[found]![0]
    row += dirs[found]![1]
    // The new pixel's backtrack: the neighbour checked just before it, seen from the new pixel.
    const prev = dirs[(found + 7) % 8]!
    const bx = prev[0] - dirs[found]![0]
    const by = prev[1] - dirs[found]![1]
    back = dirs.findIndex((d) => d[0] === bx && d[1] === by)
    out.push(c, row)
    if (c === start[0] && row === start[1]) break
  }
  return out
}

/** A polyline ([u, v] pairs) resampled every `spacing` along its length, after a light smoothing. */
function resample(points: number[], spacing: number): number[] {
  const n = points.length / 2
  if (n < 2) return points.slice()
  // Smooth the pixel staircase over ±2 points.
  const smooth: number[] = []
  for (let i = 0; i < n; i++) {
    let su = 0
    let sv = 0
    let count = 0
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      su += points[j * 2]!
      sv += points[j * 2 + 1]!
      count++
    }
    smooth.push(su / count, sv / count)
  }
  const out = [smooth[0]!, smooth[1]!]
  let carried = 0
  for (let i = 1; i < n; i++) {
    const u0 = smooth[(i - 1) * 2]!
    const v0 = smooth[(i - 1) * 2 + 1]!
    const u1 = smooth[i * 2]!
    const v1 = smooth[i * 2 + 1]!
    const length = Math.hypot(u1 - u0, v1 - v0)
    let at = spacing - carried
    while (at <= length) {
      const t = at / length
      out.push(u0 + t * (u1 - u0), v0 + t * (v1 - v0))
      at += spacing
    }
    carried = length - (at - spacing)
  }
  return out
}

/** Distance from a point to a polyline ([u, v] pairs). */
function distanceToLine(u: number, v: number, line: ArrayLike<number>): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i]!
    const ay = line[i + 1]!
    const bx = line[i + 2]!
    const by = line[i + 3]!
    const dx = bx - ax
    const dy = by - ay
    const length2 = dx * dx + dy * dy
    const t = length2 > 0 ? Math.min(1, Math.max(0, ((u - ax) * dx + (v - ay) * dy) / length2)) : 0
    best = Math.min(best, Math.hypot(u - ax - t * dx, v - ay - t * dy))
  }
  return best
}

// ---------------------------------------------------------------------------------------------
// The truth's summary

const L = {
  forehead: 10,
  noseRoot: 168,
  tip: 1,
  chinBottom: 152,
  eyeRightOuter: 33,
  eyeLeftOuter: 263,
  mouthRight: 61,
  mouthLeft: 291,
} as const

/** How far below the chin's lowest point the profile follows the neck (m). */
const NECK_DEPTH = 0.04
const OUTLINE_YAWS = [45, -45]

function need(landmarks: readonly (Vec3 | null)[], l: number): Vec3 {
  const p = landmarks[l]
  if (!p) throw new Error(`the truth has no landmark ${l}`)
  return p
}

const UP = -1
const DOWN = 1

/**
 * From a row, walking up or down the profile, the next turn of its front:
 * the deepest (or most forward) row before the front has come back `by`
 * from it, looking no further than `reach` (m).
 */
function turn(
  side: Side,
  from: number,
  direction: number,
  kind: 'deepest' | 'front',
  by: number,
  reach: number,
): number {
  let best = from
  let bestZ = frontAt(side, from)
  const rows = Math.round(reach / RES)
  for (let k = 1; k <= rows; k++) {
    const row = from + k * direction
    const z = frontAt(side, row)
    if (Number.isNaN(z)) continue
    if (kind === 'deepest' ? z < bestZ : z > bestZ) {
      best = row
      bestZ = z
    } else if (kind === 'deepest' ? z > bestZ + by : z < bestZ - by) break
  }
  return best
}

/**
 * The chin's lowest point: down each column from the chin's row to where the
 * skin ends (a column that runs on down is the neck), the lowest over the
 * first 25 mm behind the chin's front. Null where every column runs on down.
 */
function mentonOf(side: Side, chinRow: number): { y: number; z: number } | null {
  const { box } = side
  const chinFront = frontAt(side, chinRow)
  if (Number.isNaN(chinFront)) return null
  let menton: { y: number; z: number } | null = null
  for (let col = colOf(box, chinFront - 0.025); col <= colOf(box, chinFront); col++) {
    const bottom = undersideAt(side, col, chinRow)
    if (!Number.isNaN(bottom) && (!menton || bottom < menton.y))
      menton = { y: bottom, z: zOfCol(box, col) }
  }
  return menton
}

/** The row (in [from, to] heights) whose front is the most forward (or the deepest). */
function extremeRow(side: Side, y0: number, y1: number, deepest: boolean): number {
  let best = -1
  let bestZ = deepest ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  const { box } = side
  for (let row = rowOf(box, Math.max(y0, y1)); row <= rowOf(box, Math.min(y0, y1)); row++) {
    const z = frontAt(side, row)
    if (Number.isNaN(z)) continue
    if (deepest ? z < bestZ : z > bestZ) {
      best = row
      bestZ = z
    }
  }
  if (best < 0) throw new Error('no profile between those heights')
  return best
}

/** The side profile of the truth (see SideProfile). */
export function sideProfile(surface: Surface, landmarks: readonly (Vec3 | null)[]): SideProfile {
  const y = (l: number) => need(landmarks, l)[1]
  const tipZ = need(landmarks, L.tip)[2]
  const box = {
    top: y(L.forehead) + 0.015,
    bottom: y(L.chinBottom) - NECK_DEPTH - 0.035,
    back: tipZ - 0.17,
    front: tipZ + 0.03,
  }
  const s = sideOf(surface, box)
  const at = (row: number) => ({ y: yOfRow(box, row), z: frontAt(s, row) })
  // The nose's tip is the profile's most forward point near its landmark's height; from it the
  // profile's turns, up and down, are its named points. A landmark lifted from a photo only bounds
  // where the tip is looked for: it can be millimetres off in height (and far off in depth where a
  // ray slips between the lips), and lips or a chin may stand further forward than the nose.
  const pronasale = extremeRow(s, y(L.tip) - 0.012, y(L.tip) + 0.012, false)
  const nasion = turn(s, pronasale, UP, 'deepest', 0.001, 0.045)
  const glabella = turn(s, nasion, UP, 'front', 0.001, 0.035)
  const midBridge = Math.round((nasion + pronasale) / 2)
  const subnasale = turn(s, pronasale, DOWN, 'deepest', 0.0008, 0.03)
  const upperLip = turn(s, subnasale, DOWN, 'front', 0.0008, 0.025)
  const stomion = turn(s, upperLip, DOWN, 'deepest', 0.0005, 0.015)
  const lowerLip = turn(s, stomion, DOWN, 'front', 0.0008, 0.02)
  const fold = turn(s, lowerLip, DOWN, 'deepest', 0.0008, 0.025)
  const pogonion = turn(s, fold, DOWN, 'front', 0.001, 0.03)
  const menton = mentonOf(s, pogonion)
  if (!menton) throw new Error('no chin underside in the truth')
  // Under the chin, from just behind the menton back to where the neck's front meets it.
  const neckRow = rowOf(box, menton.y - 0.03)
  const neckFront = frontAt(s, neckRow)
  const submental = { z: [] as number[], y: [] as number[] }
  for (let z = menton.z - 0.003; z > neckFront + 0.004; z -= 0.001) {
    const bottom = undersideAt(s, colOf(box, z), pogonion)
    if (Number.isNaN(bottom)) break
    submental.z.push(zOfCol(box, colOf(box, z)))
    submental.y.push(bottom)
  }
  // The whole line, traced from the forehead's front.
  const startRow = rowOf(box, y(L.forehead))
  const endRow = Math.min(rowOf(box, menton.y - NECK_DEPTH), s.raster.height - 2)
  const traced = trace(s.raster, [rasterFront(s.raster, startRow), startRow], endRow)
  const line: number[] = []
  for (let i = 0; i < traced.length; i += 2)
    line.push(zOfCol(box, traced[i]!), yOfRow(box, traced[i + 1]!))
  return {
    box,
    points: {
      glabella: at(glabella),
      nasion: at(nasion),
      midBridge: at(midBridge),
      pronasale: at(pronasale),
      subnasale: at(subnasale),
      upperLip: at(upperLip),
      lowerLip: at(lowerLip),
      pogonion: at(pogonion),
      menton,
    },
    submental,
    line: resample(line, 0.0005),
  }
}

/** The face's midline (x) and the nose's box, from the profile and the tip's landmark: what the ¾ outlines leave out. */
function noseBox(landmarks: readonly (Vec3 | null)[], side: SideProfile) {
  const { nasion, subnasale } = side.points
  return {
    mid: (need(landmarks, L.tip)[0] + need(landmarks, L.noseRoot)[0]) / 2,
    top: nasion.y + 0.004,
    bottom: subnasale.y - 0.004,
    back: subnasale.z - 0.012,
  }
}

/** The ¾ outline of a surface turned `yaw` degrees (see Outline), the nose left out. */
function outline(
  surface: Surface,
  landmarks: readonly (Vec3 | null)[],
  side: SideProfile,
  yaw: number,
  frame: { top: number; rows: number },
): Outline {
  const nose = noseBox(landmarks, side)
  const pivot = need(landmarks, L.noseRoot)
  const angle = (yaw * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const turn = (p: Vec3) => (p[0] - pivot[0]) * cos + (p[2] - pivot[2]) * sin
  const half = 0.15
  const width = Math.ceil((2 * half) / RES)
  const r = rasterise(
    surface,
    width,
    frame.rows,
    (p) => [(turn(p) + half) / RES, (frame.top - p[1]) / RES],
    (a, b, c) => {
      const inNose = (p: Vec3) =>
        Math.abs(p[0] - nose.mid) < 0.018 &&
        p[1] < nose.top &&
        p[1] > nose.bottom &&
        p[2] > nose.back
      return !(inNose(a) && inNose(b) && inNose(c))
    },
  )
  const x: number[] = []
  for (let row = 0; row < frame.rows; row++) {
    let found = Number.NaN
    if (yaw > 0) {
      for (let c = width - 1; c >= 0; c--)
        if (r.data[row * width + c]) {
          found = (c + 1) * RES - half
          break
        }
    } else {
      for (let c = 0; c < width; c++)
        if (r.data[row * width + c]) {
          found = c * RES - half
          break
        }
    }
    x.push(found)
  }
  return { yaw, top: frame.top, rows: frame.rows, x }
}

/** Rows the ¾ outlines cover: from the eyes' outer corners down to just above the chin's bottom. */
function outlineFrame(landmarks: readonly (Vec3 | null)[], side: SideProfile) {
  const top = (need(landmarks, L.eyeRightOuter)[1] + need(landmarks, L.eyeLeftOuter)[1]) / 2
  const bottom = side.points.menton.y + 0.002
  return { top, rows: Math.floor((top - bottom) / RES) }
}

/**
 * The face's width seen from the front, of the skin ahead of a plane 30 mm
 * behind the eyes' outer corners (so the ears and the sides of the skull
 * are left out): the widest it is over the cheekbones (25 to 5 mm under the
 * eyes), and at the jaw (10 mm under the mouth's corners). The corners are
 * landmarks a front photo places well; the outline's (234, 454) graze the
 * skin and are not.
 */
function faceWidths(surface: Surface, landmarks: readonly (Vec3 | null)[]): TruthHead['widths'] {
  const plane =
    (need(landmarks, L.eyeRightOuter)[2] + need(landmarks, L.eyeLeftOuter)[2]) / 2 - 0.03
  const eyes = (need(landmarks, L.eyeRightOuter)[1] + need(landmarks, L.eyeLeftOuter)[1]) / 2
  const mouth = (need(landmarks, L.mouthRight)[1] + need(landmarks, L.mouthLeft)[1]) / 2
  const cheekRows: [number, number] = [eyes - 0.025, eyes - 0.005]
  const jawRow = mouth - 0.01
  const { cheek, jaw } = widthsAt(surface, plane, cheekRows, jawRow, need(landmarks, L.tip)[0])
  return { cheek, jaw, plane, cheekRows, jawRow }
}

function widthsAt(
  surface: Surface,
  plane: number,
  cheekRows: [number, number],
  jawRow: number,
  mid: number,
): { cheek: number; jaw: number } {
  const top = cheekRows[1] + 0.002
  const rows = Math.ceil((top - (jawRow - 0.002)) / RES)
  const half = 0.13
  const width = Math.ceil((2 * half) / RES)
  const r = rasterise(
    surface,
    width,
    rows,
    (p) => [(p[0] - mid + half) / RES, (top - p[1]) / RES],
    (a, b, c) => a[2] > plane && b[2] > plane && c[2] > plane,
  )
  const span = (row: number) => {
    let lo = -1
    let hi = -1
    for (let c = 0; c < width; c++) {
      if (!r.data[row * width + c]) continue
      if (lo < 0) lo = c
      hi = c
    }
    return lo < 0 ? 0 : (hi - lo + 1) * RES
  }
  let cheek = 0
  for (let row = Math.round((top - cheekRows[1]) / RES); row <= (top - cheekRows[0]) / RES; row++)
    cheek = Math.max(cheek, span(row))
  return { cheek, jaw: span(Math.min(rows - 1, Math.round((top - jawRow) / RES))) }
}

/**
 * Points of the surface's skin about `spacing` apart (its vertices and
 * triangles' centres, one per grid cell), with their normals: the skull and
 * the ears only — the top of the head above the brows and behind the
 * forehead, and everything 5 cm or more behind the eyes — what a fit's skull
 * and ears are aligned to.
 */
function cloudOf(
  surface: Surface,
  landmarks: readonly (Vec3 | null)[],
  spacing: number,
): TruthHead['cloud'] {
  const eyes = need(landmarks, L.noseRoot)
  const floor = need(landmarks, L.chinBottom)[1] - 0.02
  const keep = (x: number, y: number, z: number) =>
    y > floor && ((y > eyes[1] + 0.01 && z < eyes[2] - 0.025) || z < eyes[2] - 0.05)
  const p = surface.positions
  const t = surface.triangles
  const count = p.length / 3
  const normals = new Float64Array(count * 3)
  const used = new Uint8Array(count)
  for (let i = 0; i < t.length; i++) used[t[i]!] = 1
  const faceNormals: Vec3[] = []
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i]! * 3
    const b = t[i + 1]! * 3
    const c = t[i + 2]! * 3
    const u: Vec3 = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!]
    const v: Vec3 = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!]
    const n = cross3(u, v)
    faceNormals.push(n)
    for (const k of [a, b, c]) for (let j = 0; j < 3; j++) normals[k + j] = normals[k + j]! + n[j]!
  }
  const cells = new Map<string, [Vec3, Vec3]>()
  const offer = (q: Vec3, n: Vec3) => {
    const length = Math.hypot(n[0], n[1], n[2])
    if (length === 0 || !keep(q[0], q[1], q[2])) return
    const key = `${Math.floor(q[0] / spacing)},${Math.floor(q[1] / spacing)},${Math.floor(q[2] / spacing)}`
    if (!cells.has(key)) cells.set(key, [q, [n[0] / length, n[1] / length, n[2] / length]])
  }
  for (let i = 0; i < count; i++)
    if (used[i])
      offer(
        [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!],
        [normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!],
      )
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i]! * 3
    const b = t[i + 1]! * 3
    const c = t[i + 2]! * 3
    offer(
      [
        (p[a]! + p[b]! + p[c]!) / 3,
        (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3,
        (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3,
      ],
      faceNormals[i / 3]!,
    )
  }
  const chosen = [...cells.values()]
  const points = new Float32Array(chosen.length * 3)
  const unit = new Float32Array(chosen.length * 3)
  chosen.forEach(([q, n], k) => {
    points.set(q, k * 3)
    unit.set(n, k * 3)
  })
  return { points, normals: unit }
}

/**
 * The truth's summary the measure needs: its landmarks (lifted onto its skin
 * from its front photo), a cloud of its skin for aligning skulls, its side
 * profile, its ¾ outlines and its face's width. `surface` is its skin in
 * its own frame (metres, +y up, the face towards +z).
 */
export function truthHead(
  surface: Surface,
  landmarks: readonly (Vec3 | null)[],
  {
    absoluteScale,
    bare,
    bareFace,
  }: {
    absoluteScale: boolean
    /** Per vertex, whether it is bare skin: hair modelled into a head (a cap, a ponytail, a helmet of long hair) is not skull. */
    bare?: Uint8Array
    /** The same for the face's ¾ outlines and width, where a beard and the neck count as the face (default `bare`). */
    bareFace?: Uint8Array
  },
): TruthHead {
  const only = (flags: Uint8Array | undefined): Surface => {
    if (!flags) return surface
    const kept: number[] = []
    const t = surface.triangles
    for (let i = 0; i < t.length; i += 3)
      if (flags[t[i]!] && flags[t[i + 1]!] && flags[t[i + 2]!])
        kept.push(t[i]!, t[i + 1]!, t[i + 2]!)
    return { positions: surface.positions, triangles: kept }
  }
  const face = only(bareFace ?? bare)
  const side = sideProfile(surface, landmarks)
  const frame = outlineFrame(landmarks, side)
  return {
    landmarks: landmarks.slice(),
    cloud: cloudOf(only(bare), landmarks, 0.005),
    side,
    outlines: OUTLINE_YAWS.map((yaw) => outline(face, landmarks, side, yaw, frame)),
    widths: faceWidths(face, landmarks),
    absoluteScale,
  }
}

// ---------------------------------------------------------------------------------------------
// Aligning a fit by its skull and ears

/** The fitted head's skull and ear vertices (region indices) and their weights, chosen at rest. */
export function skullVertices(model: HeadModel): { index: Uint32Array; weight: Float32Array } {
  const { rest, frame } = model
  const index: number[] = []
  const weight: number[] = []
  const eyes = frame.eyes
  for (let i = 0; i < model.vertices.length; i++) {
    if (!model.skin[i]) continue
    const x = rest[i * 3]! - eyes[0]
    const y = rest[i * 3 + 1]!
    const z = rest[i * 3 + 2]!
    const ear =
      Math.abs(x) > 0.06 &&
      y > eyes[1] - 0.055 &&
      y < eyes[1] + 0.015 &&
      z > frame.earZ - 0.04 &&
      z < frame.earZ + 0.005
    const cranium = y > eyes[1] + 0.03 && z < eyes[2] - 0.045
    const back = z < frame.earZ - 0.02 && y > eyes[1] - 0.04
    if (ear || cranium || back) {
      index.push(i)
      weight.push(ear ? 3 : 1)
    }
  }
  return { index: Uint32Array.from(index), weight: Float32Array.from(weight) }
}

type Grid = { cell: number; buckets: Map<string, number[]> }

function gridOf(points: Float32Array, cell: number): Grid {
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < points.length / 3; i++) {
    const key = `${Math.floor(points[i * 3]! / cell)},${Math.floor(points[i * 3 + 1]! / cell)},${Math.floor(points[i * 3 + 2]! / cell)}`
    let list = buckets.get(key)
    if (!list) {
      list = []
      buckets.set(key, list)
    }
    list.push(i)
  }
  return { cell, buckets }
}

function nearest(grid: Grid, points: Float32Array, p: Vec3): number {
  const cx = Math.floor(p[0] / grid.cell)
  const cy = Math.floor(p[1] / grid.cell)
  const cz = Math.floor(p[2] / grid.cell)
  let best = -1
  let bestD = Number.POSITIVE_INFINITY
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.buckets.get(`${cx + dx},${cy + dy},${cz + dz}`)
        if (!list) continue
        for (const i of list) {
          const d =
            (points[i * 3]! - p[0]) ** 2 +
            (points[i * 3 + 1]! - p[1]) ** 2 +
            (points[i * 3 + 2]! - p[2]) ** 2
          if (d < bestD) {
            bestD = d
            best = i
          }
        }
      }
  return best
}

/** The share of the skull's matches each round keeps (the closest): hair left on a truth's skull is let go. */
const KEEP = 0.7
/**
 * How far (m) a skull point's match may be: past it the truth has no skin
 * there to match (its skull is under modelled hair), and a match to the
 * nearest bare skin beyond would only drag the alignment.
 */
const MATCH_RADIUS = 0.008

/**
 * The pulls on the skull alignment's turn, shift and size towards the face's
 * (per radian², per m², per unit of log scale): as much as about thirty
 * skull points 1 mm off for a 1° turn, a 1 mm shift or a 1 % size change.
 */
const TURN_PRIOR = 30 * (0.001 / ((1 * Math.PI) / 180)) ** 2
const SHIFT_PRIOR = 30
const SCALE_PRIOR = 30 * (0.001 / 0.01) ** 2

const applyTo = (s: Similarity, p: Vec3): Vec3 => {
  const q = apply3(s.rotation, p)
  return [
    s.scale * q[0] + s.translation[0],
    s.scale * q[1] + s.translation[1],
    s.scale * q[2] + s.translation[2],
  ]
}

/**
 * The similarity carrying the fit's skull and ears onto the truth's skin:
 * point-to-plane ICP from `start`, the worst of the matches left out each
 * round (see KEEP).
 */
function alignBySkull(
  truth: TruthHead,
  positions: ArrayLike<number>,
  skull: { index: Uint32Array; weight: Float32Array },
  start: Similarity,
): { align: Similarity; residualMm: number; matched: number } {
  const { points, normals } = truth.cloud
  const grid = gridOf(points, 0.015)
  let align: Similarity = { ...start, rotation: [...start.rotation] as Mat3 }
  const n = skull.index.length
  const size = 7
  let residualMm = Number.NaN
  let matched = 0
  const centreOf = (s: Similarity) => {
    let centre: Vec3 = [0, 0, 0]
    const moved: Vec3[] = []
    for (let k = 0; k < n; k++) {
      const i = skull.index[k]!
      const p = applyTo(s, [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!])
      moved.push(p)
      centre = [centre[0] + p[0] / n, centre[1] + p[1] / n, centre[2] + p[2] / n]
    }
    return { centre, moved }
  }
  const startCentre = centreOf(align).centre
  for (let round = 0; round < 40; round++) {
    const rows: { a: Vec3; normal: Vec3; r: number; w: number }[] = []
    const { centre, moved } = centreOf(align)
    for (let k = 0; k < n; k++) {
      const p = moved[k]!
      const j = nearest(grid, points, p)
      if (j < 0) continue
      const q: Vec3 = [points[j * 3]!, points[j * 3 + 1]!, points[j * 3 + 2]!]
      if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > MATCH_RADIUS) continue
      const normal: Vec3 = [normals[j * 3]!, normals[j * 3 + 1]!, normals[j * 3 + 2]!]
      const r = normal[0] * (p[0] - q[0]) + normal[1] * (p[1] - q[1]) + normal[2] * (p[2] - q[2])
      rows.push({
        a: [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]],
        normal,
        r,
        w: skull.weight[k]!,
      })
    }
    if (rows.length < 20) break
    const sorted = rows.map((row) => Math.abs(row.r)).sort((a, b) => a - b)
    const cut = sorted[Math.floor(sorted.length * KEEP)]!
    const h = new Float64Array(size * size)
    const g = new Float64Array(size)
    let sum = 0
    let weight = 0
    for (const row of rows) {
      if (Math.abs(row.r) > cut) continue
      const j = [
        ...cross3(row.a, row.normal),
        ...row.normal,
        row.normal[0] * row.a[0] + row.normal[1] * row.a[1] + row.normal[2] * row.a[2],
      ]
      for (let x = 0; x < size; x++) {
        g[x] = g[x]! - row.w * j[x]! * row.r
        for (let y = 0; y < size; y++) h[x * size + y] = h[x * size + y]! + row.w * j[x]! * j[y]!
      }
      sum += row.w * row.r * row.r
      weight += row.w
    }
    residualMm = Math.sqrt(sum / Math.max(weight, 1e-12)) * 1000
    matched = weight
    // Weak pulls towards the face's own turn, place and size, which only tell where the skull and
    // ears say too little (hair modelled over the skull leaves little but the ears).
    const turned = rotationLog(mulMat3(align.rotation, transpose3(start.rotation)))
    for (let x = 0; x < 3; x++) {
      h[x * size + x] = h[x * size + x]! + TURN_PRIOR
      g[x] = g[x]! - TURN_PRIOR * turned[x]!
      h[(x + 3) * size + x + 3] = h[(x + 3) * size + x + 3]! + SHIFT_PRIOR
      g[x + 3] = g[x + 3]! - SHIFT_PRIOR * (centre[x]! - startCentre[x]!)
    }
    h[6 * size + 6] = h[6 * size + 6]! + SCALE_PRIOR
    g[6] = g[6]! - SCALE_PRIOR * Math.log(align.scale / start.scale)
    for (let x = 0; x < size; x++) h[x * size + x] = h[x * size + x]! * (1 + 1e-6) + 1e-12
    if (!choleskySolve(h, g, size)) break
    const turn = rotation([g[0]!, g[1]!, g[2]!])
    const grow = Math.exp(g[6]!)
    // p ↦ c + grow·turn·(p − c) + d, after the current alignment.
    const rotationNew = mulMat3(turn, align.rotation)
    const tc = apply3(turn, align.translation)
    const cc = apply3(turn, centre)
    align = {
      scale: align.scale * grow,
      rotation: rotationNew,
      translation: [
        centre[0] + grow * (tc[0] - cc[0]) + g[3]!,
        centre[1] + grow * (tc[1] - cc[1]) + g[4]!,
        centre[2] + grow * (tc[2] - cc[2]) + g[5]!,
      ],
    }
    const stepSize = Math.hypot(g[0]!, g[1]!, g[2]!) + Math.hypot(g[3]!, g[4]!, g[5]!) * 10
    if (stepSize < 1e-7) break
  }
  return { align, residualMm, matched }
}

// ---------------------------------------------------------------------------------------------
// Measuring a fit

/**
 * Where the skull alignment starts (and what it leans to where the skull
 * says little): every face landmark of the fit onto the truth's, by
 * similarity, those far off (a lifted landmark that slipped into the mouth
 * or past an eyelid) dropped and the rest fitted again.
 */
function landmarkStart(truth: TruthHead, model: HeadModel, positions: Float64Array): Similarity {
  const pairs: [Vec3, Vec3][] = []
  for (let l = 0; l < 468; l++) {
    const a = landmarkPosition(model, positions, l)
    const b = truth.landmarks[l]
    if (a && b) pairs.push([a, b])
  }
  let kept = pairs
  let align = similarity(
    kept.map((p) => p[0]),
    kept.map((p) => p[1]),
  )
  for (let round = 0; round < 3; round++) {
    const misses = pairs.map(([a, b]) => {
      const q = applyTo(align, a)
      return Math.hypot(q[0] - b[0], q[1] - b[1], q[2] - b[2])
    })
    const sorted = [...misses].sort((x, y) => x - y)
    const cut = Math.max(0.003, 2.5 * sorted[Math.floor(sorted.length / 2)]!)
    kept = pairs.filter((_, k) => misses[k]! <= cut)
    align = similarity(
      kept.map((p) => p[0]),
      kept.map((p) => p[1]),
    )
  }
  return align
}

function transformed(positions: ArrayLike<number>, s: Similarity): Float64Array {
  const out = new Float64Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    const p = applyTo(s, [positions[i]!, positions[i + 1]!, positions[i + 2]!])
    out[i] = p[0]
    out[i + 1] = p[1]
    out[i + 2] = p[2]
  }
  return out
}

/**
 * A fitted head (the region's positions of `model`) against the truth.
 * `alignment`, when given, is used in place of the skull's (the bench
 * checks the measure with it on heads that share the base's topology).
 * Throws when the truth lacks what the measure needs.
 */
export function measureFit(
  truth: TruthHead,
  model: HeadModel,
  positions: Float64Array,
  alignment?: Similarity,
): GeometryReport {
  const start = landmarkStart(truth, model, positions)
  const scaled = alignment
    ? { align: alignment, residualMm: Number.NaN, matched: 0 }
    : alignBySkull(truth, positions, skullVertices(model), start)
  const angle = (s: Similarity) => {
    const w = rotationLog(mulMat3(s.rotation, transpose3(start.rotation)))
    return (Math.hypot(w[0], w[1], w[2]) * 180) / Math.PI
  }
  const startEyes = applyTo(start, model.frame.eyes)
  const alignedEyes = applyTo(scaled.align, model.frame.eyes)

  const surface: Surface = {
    positions: transformed(positions, scaled.align),
    triangles: model.triangles,
  }
  const { side } = truth
  const box = side.box
  const fitSide = sideOf(surface, box)
  const depth = (point: { y: number; z: number }) => {
    const z = frontAt(fitSide, rowOf(box, point.y))
    return Number.isNaN(z) ? -distanceToRaster(point, side, surface) : (z - point.z) * 1000
  }
  const points = {} as GeometryReport['points']
  for (const name of PROFILE_POINTS) {
    if (name === 'menton') continue
    points[name] = depth(side.points[name])
  }
  // Under the chin, the fit's own lowest point and underside, found as the truth's were. A fit
  // whose chin runs on into its neck there has none: not measured, so not passed.
  const chinRow = rowOf(box, side.points.pogonion.y)
  const fitMenton = mentonOf(fitSide, chinRow)
  points.menton = fitMenton ? (side.points.menton.y - fitMenton.y) * 1000 : Number.NaN
  points.noseProjection = points.pronasale - points.subnasale
  {
    let sum = 0
    let count = 0
    side.submental.z.forEach((z, k) => {
      const bottom = undersideAt(fitSide, colOf(box, z), chinRow)
      if (Number.isNaN(bottom)) return
      sum += (side.submental.y[k]! - bottom) * 1000
      count++
    })
    points.submental = count * 2 >= side.submental.z.length ? sum / count : Number.NaN
  }

  // The fit's own outline line, traced the same way, from the truth's forehead height.
  const startRow = rowOf(box, side.line[1]!)
  const startCol = rasterFront(fitSide.raster, startRow)
  let fitLine: number[] = []
  if (startCol >= 0) {
    const endRow = Math.min(
      rowOf(box, side.line[side.line.length - 1]!) + 40,
      fitSide.raster.height - 2,
    )
    const traced = trace(fitSide.raster, [startCol, startRow], endRow)
    for (let i = 0; i < traced.length; i += 2)
      fitLine.push(zOfCol(box, traced[i]!), yOfRow(box, traced[i + 1]!))
    fitLine = resample(fitLine, 0.0005)
  }
  let sum = 0
  let max = 0
  let count = 0
  for (let i = 0; i < side.line.length; i += 2) {
    const d = fitLine.length ? distanceToLine(side.line[i]!, side.line[i + 1]!, fitLine) * 1000 : 99
    sum += d
    max = Math.max(max, d)
    count++
  }
  // The shift the face's front shares: the median depth difference from the forehead to the chin.
  const offsets: number[] = []
  for (
    let row = rowOf(box, side.points.glabella.y);
    row <= rowOf(box, side.points.pogonion.y);
    row++
  ) {
    const a = frontAt(fitSide, row)
    const b = frontAtLine(side, yOfRow(box, row))
    if (!Number.isNaN(a) && !Number.isNaN(b)) offsets.push((a - b) * 1000)
  }
  offsets.sort((a, b) => a - b)

  // The ¾ outlines, from the truth's frame.
  const outlineError = truth.outlines.map((o) => {
    const fit = outline(surface, truth.landmarks, side, o.yaw, { top: o.top, rows: o.rows })
    let total = 0
    let n = 0
    o.x.forEach((x, row) => {
      const f = fit.x[row]!
      if (Number.isNaN(x)) return
      total += Number.isNaN(f) ? 20 : Math.abs(f - x) * 1000
      n++
    })
    return n ? total / n : Number.NaN
  })

  // Widths in proportion (on the aligned fit), and absolute: those with the fit's own size back.
  const { widths } = truth
  const mid = need(truth.landmarks, L.tip)[0]
  const scaledWidths = widthsAt(surface, widths.plane, widths.cheekRows, widths.jawRow, mid)
  const scaleError = 1 / scaled.align.scale - 1
  const cheekScaled = scaledWidths.cheek / widths.cheek - 1
  const jawScaled = scaledWidths.jaw / widths.jaw - 1

  return {
    alignment: {
      transform: scaled.align,
      scaleError,
      residualMm: scaled.residualMm,
      skullPoints: scaled.matched,
      fromLandmarksDeg: angle(scaled.align),
      fromLandmarksMm:
        Math.hypot(
          alignedEyes[0] - startEyes[0],
          alignedEyes[1] - startEyes[1],
          alignedEyes[2] - startEyes[2],
        ) * 1000,
    },
    points,
    profile: { mean: count ? sum / count : Number.NaN, max, points: count },
    faceOffset: offsets.length ? offsets[Math.floor(offsets.length / 2)]! : Number.NaN,
    outline45: {
      left: outlineError[0]!,
      right: outlineError[1]!,
      mean: (outlineError[0]! + outlineError[1]!) / 2,
    },
    width: {
      cheek: (1 + cheekScaled) * (1 + scaleError) - 1,
      jaw: (1 + jawScaled) * (1 + scaleError) - 1,
      cheekScaled,
      jawScaled,
    },
  }
}

/** The truth line's depth at a height (the first crossing from the top, i.e. the face's front). */
function frontAtLine(side: SideProfile, y: number): number {
  const line = side.line
  for (let i = 0; i + 3 < line.length; i += 2) {
    const y0 = line[i + 1]!
    const y1 = line[i + 3]!
    if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) {
      const t = (y - y0) / (y1 - y0)
      return line[i]! + t * (line[i + 2]! - line[i]!)
    }
  }
  return Number.NaN
}

/** How far (mm) a truth point lies from the fit's side silhouette, when its row or column has none. */
function distanceToRaster(point: { y: number; z: number }, side: SideProfile, surface: Surface) {
  const r = sideRaster(surface, side.box)
  const box = side.box
  const row0 = rowOf(box, point.y)
  const col0 = colOf(box, point.z)
  let best = Number.POSITIVE_INFINITY
  const reach = Math.round(0.03 / RES)
  for (let row = Math.max(0, row0 - reach); row < Math.min(r.height, row0 + reach); row++)
    for (let col = Math.max(0, col0 - reach); col < Math.min(r.width, col0 + reach); col++)
      if (r.data[row * r.width + col])
        best = Math.min(best, Math.hypot(row - row0, col - col0) * RES)
  return Number.isFinite(best) ? best * 1000 : 30
}
