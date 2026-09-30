/**
 * Pixel work behind a character's look, on plain RGBA buffers (so it runs and
 * tests without a browser): dyeing hair and skin while keeping their shading.
 */

export type Rgb = [number, number, number]

/** An RGBA image: `ImageData` or anything shaped like it. */
export type Pixels = { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }

export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = match ? Number.parseInt(match[1]!, 16) : 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** The mean colour of the pixels, weighted by `weights` (or by alpha when none). */
export function meanColor(pixels: Pixels, weights?: Float32Array | null): Rgb {
  const { data } = pixels
  let r = 0
  let g = 0
  let b = 0
  let total = 0
  for (let i = 0, p = 0; p < data.length; i++, p += 4) {
    const w = weights ? weights[i]! : data[p + 3]! / 255
    if (w <= 0) continue
    r += data[p]! * w
    g += data[p + 1]! * w
    b += data[p + 2]! * w
    total += w
  }
  return total > 0 ? [r / total, g / total, b / total] : [0, 0, 0]
}

/**
 * How unlike a colour is to a reference: its hue and saturation first (skin
 * in shadow is still skin), its lightness a little.
 */
export function colorDistance(r: number, g: number, b: number, ref: Rgb, refLum: number) {
  const lum = luminance(r, g, b)
  const a1 = (r - g) / (lum + 12)
  const b1 = (g - b) / (lum + 12)
  const a2 = (ref[0] - ref[1]) / (refLum + 12)
  const b2 = (ref[1] - ref[2]) / (refLum + 12)
  const light = Math.log((lum + 8) / (refLum + 8))
  return Math.hypot(a1 - a2, b1 - b2, light * 0.35)
}

/** 1 where a pixel is the reference colour, fading to 0 by `far`. */
export function similarityMask(pixels: Pixels, ref: Rgb, near = 0.12, far = 0.3): Float32Array {
  const { data } = pixels
  const mask = new Float32Array(data.length / 4)
  const refLum = luminance(...ref)
  for (let i = 0, p = 0; p < data.length; i++, p += 4) {
    if (data[p + 3] === 0) continue
    mask[i] =
      1 - smoothstep(near, far, colorDistance(data[p]!, data[p + 1]!, data[p + 2]!, ref, refLum))
  }
  return mask
}

/**
 * Where a head texture shows hair rather than skin: nearer the hair's
 * colour than the skin's. Black padding between the UV islands stays out.
 */
export function hairMask(pixels: Pixels, hair: Rgb, skin: Rgb): Float32Array {
  const { data } = pixels
  const mask = new Float32Array(data.length / 4)
  const hairLum = luminance(...hair)
  const skinLum = luminance(...skin)
  for (let i = 0, p = 0; p < data.length; i++, p += 4) {
    const r = data[p]!
    const g = data[p + 1]!
    const b = data[p + 2]!
    if (r + g + b < 6) continue
    const toHair = colorDistance(r, g, b, hair, hairLum)
    const toSkin = colorDistance(r, g, b, skin, skinLum)
    mask[i] = smoothstep(-0.04, 0.08, toSkin - toHair)
  }
  return mask
}

/**
 * Dyes pixels to `target`, as hair dye or a skin tone does: each keeps its
 * lightness relative to `refLum` (the dyed area's usual lightness), so
 * strands, pores and shading stay. The lighter a dye is than the originals,
 * the more their contrast is evened out (a dark texture's pores, lifted
 * several times over, would read as grime).
 * `mask` (0–1 per pixel, or everything) sets how much of the dye takes.
 */
export function dye(pixels: Pixels, target: Rgb, refLum: number, mask?: Float32Array | null) {
  const { data } = pixels
  const targetLum = luminance(...target)
  const ref = Math.max(refLum, 1)
  const flatten = 1 / (1 + Math.max(0, Math.log(targetLum / ref)))
  for (let i = 0, p = 0; p < data.length; i++, p += 4) {
    const w = mask ? mask[i]! : data[p + 3]! > 0 ? 1 : 0
    if (w <= 0) continue
    const lum = luminance(data[p]!, data[p + 1]!, data[p + 2]!)
    const ratio = (lum / ref) ** flatten
    for (let c = 0; c < 3; c++) {
      const dyed = Math.min(255, target[c]! * ratio)
      data[p + c] = data[p + c]! + (dyed - data[p + c]!) * w
    }
  }
}

/** The mean lightness of the pixels under a mask. */
export function maskedLuminance(pixels: Pixels, mask: Float32Array | null): number {
  return luminance(...meanColor(pixels, mask))
}

/**
 * One triangle of the head's mesh in two views: where it lies on the
 * texture (`u`, `v`, 0–1) and on the character's front view (`x`, `y`, 0–1
 * across the view, y down; `z` towards the viewer, m), with how squarely
 * each corner faces the front (`n`, the normal's forward part: 1 head-on,
 * 0 edge-on).
 */
export type HeadTriangle = {
  u: number[]
  v: number[]
  x: number[]
  y: number[]
  z: number[]
  n: number[]
}
