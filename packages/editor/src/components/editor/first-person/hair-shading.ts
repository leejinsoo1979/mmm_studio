/**
 * The numbers generated hair's materials read, worked out without a
 * renderer: a character's colours and shine as the shader takes them, how
 * a strip's layer is packed into its vertices, the root layer's style, the
 * highlight's anti-aliasing, and the back-to-front order of the studio's
 * soft pass. Pure: no three (hair-material.ts puts these on the meshes).
 */

export type Rgb = [number, number, number]

/** Hair's colour when neither the look nor the avatar gives one. */
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

/** A character's hair as the strands' and roots' shaders take it (colours linear). */
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
    expR: mix(60, 260, shine),
    expTRT: mix(16, 48, shine),
    kR: mix(0.12, 0.3, shine),
  }
}

/**
 * A strip's layer: inner strips lie flat on the head; the rest turn to
 * face the camera (see hair-material.ts).
 */
export const STRIP_LAYER = { inner: 0, mid: 1, outer: 2, stray: 3, baby: 4 } as const
export type StripLayer = (typeof STRIP_LAYER)[keyof typeof STRIP_LAYER]

/** `hairShape.z`: the atlas layer and the strip's layer in one float (atlas layer + 16 × strip layer). */
export const packLayers = (atlasLayer: number, layer: StripLayer) => atlasLayer + 16 * layer

export function unpackLayers(packed: number): { atlasLayer: number; layer: number } {
  const layer = Math.floor((packed + 0.5) / 16)
  return { atlasLayer: Math.round(packed - 16 * layer), layer }
}

/**
 * How a highlight's exponent eases off on a strip only a few pixels wide
 * (the shader's own sum): toward 16 as the strip narrows under 6 pixels,
 * and halved at the lowest detail (`detail` 0–1, the share of strips drawn).
 */
export function highlightExponent(exponent: number, stripPixels: number, detail: number): number {
  const narrow = clamp01(1 - stripPixels / 6)
  return mix(exponent, 16, narrow) * mix(0.5, 1, clamp01(detail))
}

/** How much wider strips are drawn when only `detail` (0–1) of them are, so coverage holds. */
export const lodWidthScale = (detail: number) => Math.max(0.05, detail) ** -0.8

/** The root layer's per-character values as its shader reads them. */
export type RootsStyleValues = {
  /** Hairline elevation at 33 even steps of |a| over [0, π]. */
  hairline: Float32Array
  /** The part's x (template units) and the forward reach (z of the scalp direction) where it has faded out. */
  part: [number, number]
  /** The undercut's line (elevation; far below the head for none) and its three shells' coverages. */
  undercut: [number, number, number, number]
}

/** No undercut: a line no part of the scalp lies below. */
export const NO_UNDERCUT = -10

export const HAIRLINE_STEPS = 33

/** A build's hairline, part and undercut as the root layer reads them. */
export function rootsStyleValues(build: {
  hairline: Float32Array
  part: { x: number; fade: number }
  undercut: { line: number; shells: [number, number, number] } | null
}): RootsStyleValues {
  const hairline = new Float32Array(HAIRLINE_STEPS)
  hairline.set(build.hairline.subarray(0, HAIRLINE_STEPS))
  const u = build.undercut
  return {
    hairline,
    part: [build.part.x, build.part.fade],
    undercut: u ? [u.line, u.shells[0], u.shells[1], u.shells[2]] : [NO_UNDERCUT, 0, 0, 0],
  }
}

/** The hairline at |a| (radians), read from its 33 steps as the root shader reads them (linear between). */
export function hairlineAt(table: ArrayLike<number>, a: number): number {
  const x = (Math.min(Math.PI, Math.abs(a)) / Math.PI) * (HAIRLINE_STEPS - 1)
  const i = Math.min(HAIRLINE_STEPS - 2, Math.floor(x))
  return mix(table[i]!, table[i + 1]!, x - i)
}

/** The root layer's hairline wobble: amplitude (radians of elevation) and frequency (per bind unit), per octave. */
export const ROOT_WOBBLE = [
  { amp: 0.035, freq: 9 },
  { amp: 0.015, freq: 31 },
] as const

/** Each strip's span of a geometry's index (in triangles' order) and its middle, for sorting. */
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
