/**
 * Pixel work behind a character's look, on plain RGBA buffers (so it runs and
 * tests without a browser): dyeing hair and skin while keeping their shading,
 * and laying a face photo over the head's texture.
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
function colorDistance(r: number, g: number, b: number, ref: Rgb, refLum: number) {
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
 * strands, pores and shading stay. A lighter dye over dark originals evens
 * the contrast out a little (dark textures hold little detail to lift).
 * `mask` (0–1 per pixel, or everything) sets how much of the dye takes.
 */
export function dye(pixels: Pixels, target: Rgb, refLum: number, mask?: Float32Array | null) {
  const { data } = pixels
  const targetLum = luminance(...target)
  const flatten = targetLum > refLum * 1.6 ? 0.7 : 1
  const ref = Math.max(refLum, 1)
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

/** Where a face photo sits on the front view (see AvatarFace). */
export type FacePlacement = { x: number; y: number; scale: number; rotation: number }

/** The face on the front view: the photo shows within it, feathered at its rim. */
export const FACE_OVAL = { x: 0.5, y: 0.56, rx: 0.25, ry: 0.32 } as const

/** How much of the photo shows at a front-view point facing the front by `n`. */
export function faceWeight(x: number, y: number, n: number) {
  const d = Math.hypot((x - FACE_OVAL.x) / FACE_OVAL.rx, (y - FACE_OVAL.y) / FACE_OVAL.ry)
  return smoothstep(0.25, 0.6, n) * (1 - smoothstep(0.72, 1, d))
}

/** A bilinear sample of an RGBA image at pixel coordinates; null off the image. */
function sample(image: Pixels, px: number, py: number, out: number[]): boolean {
  if (px < 0 || py < 0 || px > image.width - 1 || py > image.height - 1) return false
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const x1 = Math.min(image.width - 1, x0 + 1)
  const y1 = Math.min(image.height - 1, y0 + 1)
  const fx = px - x0
  const fy = py - y0
  const { data, width } = image
  for (let c = 0; c < 3; c++) {
    const top = data[(y0 * width + x0) * 4 + c]! * (1 - fx) + data[(y0 * width + x1) * 4 + c]! * fx
    const bottom =
      data[(y1 * width + x0) * 4 + c]! * (1 - fx) + data[(y1 * width + x1) * 4 + c]! * fx
    out[c] = top * (1 - fy) + bottom * fy
  }
  return true
}

/** Maps a front-view point to the photo's pixels, by the photo's placement. */
function photoPoint(photo: Pixels, place: FacePlacement, x: number, y: number) {
  const cos = Math.cos(-place.rotation)
  const sin = Math.sin(-place.rotation)
  const dx = x - place.x
  const dy = y - place.y
  const lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  const width = place.scale
  const height = (place.scale * photo.height) / photo.width
  return [(lx / width + 0.5) * photo.width, (ly / height + 0.5) * photo.height] as const
}

/**
 * Walks the texels each head triangle covers (in texture space), with its
 * front-view point, forward-facing and photo weight.
 */
function forEachFaceTexel(
  texture: Pixels,
  triangles: readonly HeadTriangle[],
  visit: (texel: number, x: number, y: number, weight: number) => void,
) {
  const { width, height } = texture
  for (const tri of triangles) {
    // Only the front of the head can show the photo.
    if (tri.n[0]! < 0.2 && tri.n[1]! < 0.2 && tri.n[2]! < 0.2) continue
    const ax = tri.u[0]! * width
    const ay = tri.v[0]! * height
    const bx = tri.u[1]! * width
    const by = tri.v[1]! * height
    const cx = tri.u[2]! * width
    const cy = tri.v[2]! * height
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (Math.abs(area) < 1e-9) continue
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const sx = px + 0.5
        const sy = py + 0.5
        const w0 = ((bx - sx) * (cy - sy) - (cx - sx) * (by - sy)) / area
        const w1 = ((cx - sx) * (ay - sy) - (ax - sx) * (cy - sy)) / area
        const w2 = 1 - w0 - w1
        // A hair's margin outside keeps texels on shared edges from gaps.
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue
        const x = tri.x[0]! * w0 + tri.x[1]! * w1 + tri.x[2]! * w2
        const y = tri.y[0]! * w0 + tri.y[1]! * w1 + tri.y[2]! * w2
        const n = tri.n[0]! * w0 + tri.n[1]! * w1 + tri.n[2]! * w2
        const weight = faceWeight(x, y, n)
        if (weight > 0) visit(py * width + px, x, y, weight)
      }
    }
  }
}

/**
 * Lays a face photo over a head texture (in place): each texel of the face
 * takes the photo's colour where the photo, placed on the front view, covers
 * it, feathered at the face's rim and where the head turns away. `tone`
 * (0–1) moves the photo's colours to the skin's (their mean and spread), so
 * a photo lit differently still meets the skin around it without a seam.
 */
export function bakeFace(
  texture: Pixels,
  triangles: readonly HeadTriangle[],
  photo: Pixels,
  place: FacePlacement,
  tone: number,
) {
  const { data } = texture
  const color = [0, 0, 0]
  const texels: number[] = []
  const weights: number[] = []
  const colors: number[] = []
  const photoSum = [0, 0, 0]
  const photoSq = [0, 0, 0]
  const skinSum = [0, 0, 0]
  const skinSq = [0, 0, 0]
  let total = 0
  forEachFaceTexel(texture, triangles, (texel, x, y, weight) => {
    const [px, py] = photoPoint(photo, place, x, y)
    if (!sample(photo, px, py, color)) return
    texels.push(texel)
    weights.push(weight)
    colors.push(color[0]!, color[1]!, color[2]!)
    for (let c = 0; c < 3; c++) {
      const skin = data[texel * 4 + c]!
      photoSum[c]! += color[c]! * weight
      photoSq[c]! += color[c]! * color[c]! * weight
      skinSum[c]! += skin * weight
      skinSq[c]! += skin * skin * weight
    }
    total += weight
  })
  if (total === 0) return
  const scale = [0, 0, 0]
  const shift = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const photoMean = photoSum[c]! / total
    const skinMean = skinSum[c]! / total
    const photoSpread = Math.sqrt(Math.max(1, photoSq[c]! / total - photoMean * photoMean))
    const skinSpread = Math.sqrt(Math.max(1, skinSq[c]! / total - skinMean * skinMean))
    // Photos are contrastier than a baked skin: keep half their own spread.
    const k = (photoSpread + (skinSpread - photoSpread) * 0.5) / photoSpread
    // mix(p, (p - photoMean)·k + skinMean, tone), as a scale and a shift.
    scale[c] = 1 + (k - 1) * tone
    shift[c] = (skinMean - photoMean * k) * tone
  }
  for (let i = 0; i < texels.length; i++) {
    const p = texels[i]! * 4
    const w = weights[i]!
    for (let c = 0; c < 3; c++) {
      const matched = Math.min(255, Math.max(0, colors[i * 3 + c]! * scale[c]! + shift[c]!))
      data[p + c] = data[p + c]! + (matched - data[p + c]!) * w
    }
  }
}
