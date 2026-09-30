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

/** sRGB channel (0–255) to linear light (0–1), looked up. */
const LINEAR = Float32Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

const toSrgb = (linear: number) => {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, c * 255))
}

const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
const labInverse = (f: number) => (f ** 3 > 216 / 24389 ? f ** 3 : (116 * f - 16) / (24389 / 27))

/** D65 white, the reference of sRGB. */
const WHITE = [0.95047, 1, 1.08883] as const

/** An sRGB colour (0–255 channels, not necessarily whole) in CIELAB, written into `out`. */
function toLab(r: number, g: number, b: number, out: number[]) {
  const lr = LINEAR[Math.round(r)]!
  const lg = LINEAR[Math.round(g)]!
  const lb = LINEAR[Math.round(b)]!
  const x = labF((0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / WHITE[0])
  const y = labF(0.2126 * lr + 0.7152 * lg + 0.0722 * lb)
  const z = labF((0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / WHITE[2])
  out[0] = 116 * y - 16
  out[1] = 500 * (x - y)
  out[2] = 200 * (y - z)
}

/** A CIELAB colour back in sRGB (0–255, clamped), written into `out`. */
function fromLab(l: number, a: number, b: number, out: number[]) {
  const fy = (l + 16) / 116
  const x = labInverse(fy + a / 500) * WHITE[0]
  const y = labInverse(fy)
  const z = labInverse(fy - b / 200) * WHITE[2]
  out[0] = toSrgb(3.2406 * x - 1.5372 * y - 0.4986 * z)
  out[1] = toSrgb(-0.9689 * x + 1.8758 * y + 0.0415 * z)
  out[2] = toSrgb(0.0557 * x - 0.204 * y + 1.057 * z)
}

/**
 * How much of the skin's own light and shade a new tone keeps, by how much
 * lighter it is: as much when darkening, a little less when lightening a
 * lot (shading lifted whole off a dark skin reads as grime), never below
 * this share.
 */
const LEAST_SHADE = 0.6

/**
 * The least chroma a skin's usual colour is taken to have (a nearly grey
 * reference would scale colour differences up without bound), and the
 * most a tone scales them either way.
 */
const LEAST_CHROMA = 6
const CHROMA_SCALE: readonly [number, number] = [0.7, 1.4]

/**
 * Tones skin to `target` in CIELAB: the skin's usual colour (`ref`) goes to
 * the target and every pixel keeps where it stands against it — its
 * lightness difference, and its colour difference turned to the target's
 * hue and scaled halfway (geometrically) to the target's colourfulness — so
 * the cheeks' flush, the lips' red, pores and shadows stay what they were
 * on the new skin instead of all being painted the one colour (which turns
 * lips skin-coloured and a lightened face into a chalk mask). `mask` (0–1
 * per pixel) sets how much of the tone takes.
 */
export function toneSkin(pixels: Pixels, target: Rgb, ref: Rgb, mask: Float32Array) {
  const { data } = pixels
  const from = [0, 0, 0]
  const to = [0, 0, 0]
  toLab(...ref, from)
  toLab(...target, to)
  const shade = Math.max(LEAST_SHADE, Math.min(1, (100 - to[0]!) / Math.max(1, 100 - from[0]!)))
  const ratio = Math.hypot(to[1]!, to[2]!) / Math.max(LEAST_CHROMA, Math.hypot(from[1]!, from[2]!))
  const scale = Math.min(CHROMA_SCALE[1], Math.max(CHROMA_SCALE[0], Math.sqrt(ratio)))
  const turn = Math.atan2(to[2]!, to[1]!) - Math.atan2(from[2]!, from[1]!)
  // Lightened a long way, a skin's colour differences even out with its
  // shading: kept whole they read as blotches on fair skin.
  const cos = Math.cos(turn) * scale * shade
  const sin = Math.sin(turn) * scale * shade
  const lab = [0, 0, 0]
  const rgb = [0, 0, 0]
  for (let i = 0, p = 0; p < data.length; i++, p += 4) {
    const w = mask[i]!
    if (w <= 0) continue
    toLab(data[p]!, data[p + 1]!, data[p + 2]!, lab)
    const a = lab[1]! - from[1]!
    const b = lab[2]! - from[2]!
    fromLab(
      Math.min(100, Math.max(0, to[0]! + (lab[0]! - from[0]!) * shade)),
      to[1]! + a * cos - b * sin,
      to[2]! + a * sin + b * cos,
      rgb,
    )
    for (let c = 0; c < 3; c++) data[p + c] = data[p + c]! + (rgb[c]! - data[p + c]!) * w
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

/** Numbers per triangle when packed: u, v, x, y, z and n for each of its three corners. */
const PACKED = 18

/** Triangles as one flat array, cheap to send to a worker (unpacked there by `unpackTriangles`). */
export function packTriangles(triangles: readonly HeadTriangle[]): Float32Array {
  const packed = new Float32Array(triangles.length * PACKED)
  triangles.forEach((tri, t) => {
    const fields = [tri.u, tri.v, tri.x, tri.y, tri.z, tri.n]
    fields.forEach((values, f) => {
      for (let c = 0; c < 3; c++) packed[t * PACKED + f * 3 + c] = values[c]!
    })
  })
  return packed
}

export function unpackTriangles(packed: Float32Array): HeadTriangle[] {
  const triangles: HeadTriangle[] = []
  for (let t = 0; t + PACKED <= packed.length; t += PACKED) {
    const field = (f: number) => [
      packed[t + f * 3]!,
      packed[t + f * 3 + 1]!,
      packed[t + f * 3 + 2]!,
    ]
    triangles.push({ u: field(0), v: field(1), x: field(2), y: field(3), z: field(4), n: field(5) })
  }
  return triangles
}
