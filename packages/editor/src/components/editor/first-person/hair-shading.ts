/**
 * The values generated hair's materials read, worked out without a
 * renderer (hair-material.ts puts them on the meshes), and the
 * back-to-front order of the studio's soft pass. Pure: no three.
 */

import { HAIRLINE_STEPS, unitHash, type WOBBLE_OCTAVES } from './hair-scalp'

export type Rgb = [number, number, number]

export const DEFAULT_HAIR = '#4f3426'

const HEX = /^#[0-9a-f]{6}$/i

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** A #rrggbb colour in linear light (what the shader mixes); `fallback` for anything else. */
export function linearOf(hex: string | null | undefined, fallback = DEFAULT_HAIR): Rgb {
  const value = hex && HEX.test(hex) ? hex : fallback
  const n = Number.parseInt(value.slice(1), 16)
  return [
    toLinear(((n >> 16) & 255) / 255),
    toLinear(((n >> 8) & 255) / 255),
    toLinear((n & 255) / 255),
  ]
}

const scaled = (c: Rgb, k: number): Rgb => [
  Math.min(1, c[0] * k),
  Math.min(1, c[1] * k),
  Math.min(1, c[2] * k),
]

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** How much darker a strand's root is than its length, and how much lighter its tip with no tip colour. */
export const ROOT_SHADE = 0.72
export const TIP_LIFT = 1.08

export type HairLookValues = {
  base: Rgb
  root: Rgb
  tip: Rgb
  skin: Rgb
  /** The primary (R) and secondary (TRT) highlights' exponents, and R's strength. */
  expR: number
  expTRT: number
  kR: number
}

/**
 * A look's values: the root a shade darker than the hair, the tip its own
 * colour or else a touch lighter, and the shine (0 dull, 1 glossy) as the
 * highlights' sharpness and strength.
 */
export function hairLookValues(look: {
  base: string
  tip: string | null
  shine: number
  skin: string
}): HairLookValues {
  const base = linearOf(look.base)
  const shine = clamp01(Number.isFinite(look.shine) ? look.shine : 0.5)
  return {
    base,
    root: scaled(base, ROOT_SHADE),
    tip: look.tip && HEX.test(look.tip) ? linearOf(look.tip) : scaled(base, TIP_LIFT),
    skin: linearOf(look.skin, '#c8987a'),
    expR: mix(30, 120, shine),
    expTRT: mix(16, 48, shine),
    kR: mix(0.12, 0.3, shine),
  }
}

/** How much wider strips are drawn when only `detail` (0–1) of them are, so coverage holds (`HairValues.width`). */
export const lodWidthScale = (detail: number) => Math.max(0.05, detail) ** -0.8

export type RootsStyleValues = {
  /** Hairline elevation at 33 even steps of |a| over [0, π]. */
  hairline: Float32Array
  /**
   * The part (template units): its x at the front, the −z over which it
   * eases back to the middle, and the z behind which the crown has none.
   */
  part: [x: number, fadeFrom: number, fadeTo: number, crown: number]
  /** The undercut's line (elevation; far below the head for none) and its three shells' coverages. */
  undercut: [number, number, number, number]
}

/** No undercut: a line no part of the scalp lies below. */
export const NO_UNDERCUT = -10

export function rootsStyleValues(build: {
  hairline: Float32Array
  part: { x: number; fade: readonly [number, number]; crown: number }
  undercut: { line: number; shells: [number, number, number] } | null
}): RootsStyleValues {
  const hairline = new Float32Array(HAIRLINE_STEPS)
  hairline.set(build.hairline.subarray(0, HAIRLINE_STEPS))
  const u = build.undercut
  return {
    hairline,
    part: [build.part.x, build.part.fade[0], build.part.fade[1], build.part.crown],
    undercut: u ? [u.line, u.shells[0], u.shells[1], u.shells[2]] : [NO_UNDERCUT, 0, 0, 0],
  }
}

/**
 * An octave's value-noise corners over a ∈ [−π, π]: `values[i − first]` is
 * the noise at whole cell i (hair-scalp.ts's `noise1`). The shader reads
 * these, so it needs no integer hash of its own.
 */
export function wobbleCorners(octave: (typeof WOBBLE_OCTAVES)[number]) {
  const first = Math.floor(-Math.PI * octave.freq)
  const last = Math.floor(Math.PI * octave.freq) + 1
  const values = Float32Array.from(
    { length: last - first + 1 },
    (_, k) => unitHash(octave.seed, first + k) * 2 - 1,
  )
  return { first, values }
}

export type StripRanges = { start: Uint32Array; count: Uint32Array; centre: Float32Array }

/**
 * Splits an index into its strips: a strip's triangles are consecutive
 * and its vertices share a strand id (`hairData.w`).
 */
export function stripRanges(
  index: Uint32Array,
  position: Float32Array,
  hairData: Float32Array,
): StripRanges {
  const starts: number[] = []
  let last = Number.NaN
  for (let t = 0; t < index.length; t += 3) {
    const id = hairData[index[t]! * 4 + 3]!
    if (id !== last) {
      starts.push(t)
      last = id
    }
  }
  const n = starts.length
  const start = Uint32Array.from(starts)
  const count = new Uint32Array(n)
  const centre = new Float32Array(n * 3)
  for (let s = 0; s < n; s++) {
    const end = s + 1 < n ? starts[s + 1]! : index.length
    count[s] = end - start[s]!
    let x = 0
    let y = 0
    let z = 0
    for (let k = start[s]!; k < end; k++) {
      const v = index[k]! * 3
      x += position[v]!
      y += position[v + 1]!
      z += position[v + 2]!
    }
    const m = end - start[s]!
    centre[s * 3] = x / m
    centre[s * 3 + 1] = y / m
    centre[s * 3 + 2] = z / m
  }
  return { start, count, centre }
}

/**
 * Each strip's sort key toward the camera: its middle along `toCamera`
 * (the object-space direction from the hair to the camera). Smaller is
 * farther.
 */
export function stripKeys(
  ranges: StripRanges,
  toCamera: readonly [number, number, number],
): Float32Array {
  const n = ranges.start.length
  const keys = new Float32Array(n)
  for (let s = 0; s < n; s++) {
    keys[s] =
      ranges.centre[s * 3]! * toCamera[0] +
      ranges.centre[s * 3 + 1]! * toCamera[1] +
      ranges.centre[s * 3 + 2]! * toCamera[2]
  }
  return keys
}

/** The index with its strips drawn back to front for a camera in direction `toCamera` (see stripKeys). */
export function sortedIndex(
  index: Uint32Array,
  ranges: StripRanges,
  toCamera: readonly [number, number, number],
  out: Uint32Array = new Uint32Array(index.length),
): Uint32Array {
  const keys = stripKeys(ranges, toCamera)
  const order = Uint32Array.from({ length: keys.length }, (_, i) => i).sort(
    (a, b) => keys[a]! - keys[b]! || a - b,
  )
  let o = 0
  for (const s of order) {
    const from = ranges.start[s]!
    out.set(index.subarray(from, from + ranges.count[s]!), o)
    o += ranges.count[s]!
  }
  return out
}

/** Whether the view has turned far enough (degrees) since the last sort to sort again. */
export function turnedSince(
  last: readonly [number, number, number] | null,
  now: readonly [number, number, number],
  degrees = 8,
): boolean {
  if (!last) return true
  const dot = last[0] * now[0] + last[1] * now[1] + last[2] * now[2]
  const ln =
    Math.sqrt(last[0] ** 2 + last[1] ** 2 + last[2] ** 2) *
    Math.sqrt(now[0] ** 2 + now[1] ** 2 + now[2] ** 2)
  return dot < Math.cos((degrees * Math.PI) / 180) * ln
}
