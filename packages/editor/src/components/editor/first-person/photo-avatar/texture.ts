import type { Camera } from './camera'
import { choleskySolve } from './linalg'
import { rasterTriangle } from './silhouette'

/**
 * The photos laid onto the fitted head's texture: every texel of the head
 * is found on the head (where it is, which way it faces), looked up in each
 * photo that sees it, and the photos are blended by how squarely each sees
 * it — the front photo gives the face, the side ones the cheeks, jaw and
 * ears. Each photo's lighting is taken out first (a smooth light fitted
 * over its skin), so the photos agree with each other and the head can be
 * lit again in the game.
 *
 * Colours here are linear RGB, 0–1.
 */

/** A triangle mesh with UVs (glTF: u right, v down the image) and its fitted positions (body space, metres). */
export type UvMesh = {
  positions: Float32Array | Float64Array
  normals: Float32Array | Float64Array
  uvs: Float32Array | Float64Array
  triangles: Uint32Array
}

/** Every texel of a mesh's texture (size × size) found on the mesh: its triangle, place and normal. */
export type Texels = {
  size: number
  /** The triangle covering each texel's centre, −1 where none does. */
  triangle: Int32Array
  position: Float32Array
  normal: Float32Array
}

export function rasterizeUv(mesh: UvMesh, size: number): Texels {
  const count = size * size
  const triangle = new Int32Array(count).fill(-1)
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const { positions, normals, uvs, triangles } = mesh
  for (let t = 0; t < triangles.length / 3; t++) {
    const a = triangles[t * 3]!
    const b = triangles[t * 3 + 1]!
    const c = triangles[t * 3 + 2]!
    rasterTriangle(
      uvs[a * 2]! * size,
      uvs[a * 2 + 1]! * size,
      uvs[b * 2]! * size,
      uvs[b * 2 + 1]! * size,
      uvs[c * 2]! * size,
      uvs[c * 2 + 1]! * size,
      size,
      size,
      (pixel, w0, w1, w2) => {
        triangle[pixel] = t
        for (let k = 0; k < 3; k++) {
          position[pixel * 3 + k] =
            w0 * positions[a * 3 + k]! + w1 * positions[b * 3 + k]! + w2 * positions[c * 3 + k]!
          normal[pixel * 3 + k] =
            w0 * normals[a * 3 + k]! + w1 * normals[b * 3 + k]! + w2 * normals[c * 3 + k]!
        }
        const length = Math.hypot(
          normal[pixel * 3]!,
          normal[pixel * 3 + 1]!,
          normal[pixel * 3 + 2]!,
        )
        if (length > 0)
          for (let k = 0; k < 3; k++) normal[pixel * 3 + k] = normal[pixel * 3 + k]! / length
      },
    )
  }
  return { size, triangle, position, normal }
}

/** A photo: linear RGB (3 per pixel), and where it shows the person and their skin (0–255), when known. */
export type PhotoImage = {
  width: number
  height: number
  rgb: Float32Array
  mask?: Uint8Array | null
  skin?: Uint8Array | null
}

const SRGB_TO_LINEAR = (() => {
  const table = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    table[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return table
})()

export const srgbToLinear = (byte: number) => SRGB_TO_LINEAR[byte]!

export function linearToSrgb(value: number): number {
  const c = Math.min(1, Math.max(0, value))
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255)
}

/** RGBA bytes (sRGB) as linear RGB. */
export function linearRgb(data: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    out[i * 3] = SRGB_TO_LINEAR[data[i * 4]!]!
    out[i * 3 + 1] = SRGB_TO_LINEAR[data[i * 4 + 1]!]!
    out[i * 3 + 2] = SRGB_TO_LINEAR[data[i * 4 + 2]!]!
  }
  return out
}

/** The depth (camera z, metres) of the nearest surface at each pixel of a view, +∞ where there is none. */
export function depthBuffer(mesh: UvMesh, camera: Camera): Float32Array {
  const { width, height } = camera
  const depth = new Float32Array(width * height).fill(Number.POSITIVE_INFINITY)
  const n = mesh.positions.length / 3
  const xy = new Float64Array(n * 2)
  const z = new Float64Array(n)
  const r = camera.rotation
  const t = camera.translation
  for (let i = 0; i < n; i++) {
    const x = mesh.positions[i * 3]!
    const y = mesh.positions[i * 3 + 1]!
    const w = mesh.positions[i * 3 + 2]!
    const qx = r[0] * x + r[1] * y + r[2] * w + t[0]
    const qy = r[3] * x + r[4] * y + r[5] * w + t[1]
    const qz = r[6] * x + r[7] * y + r[8] * w + t[2]
    xy[i * 2] = (camera.focal * qx) / qz + camera.cx
    xy[i * 2 + 1] = (camera.focal * qy) / qz + camera.cy
    z[i] = qz
  }
  const { triangles } = mesh
  for (let k = 0; k < triangles.length; k += 3) {
    const a = triangles[k]!
    const b = triangles[k + 1]!
    const c = triangles[k + 2]!
    const za = z[a]!
    const zb = z[b]!
    const zc = z[c]!
    if (za <= 0 || zb <= 0 || zc <= 0) continue
    rasterTriangle(
      xy[a * 2]!,
      xy[a * 2 + 1]!,
      xy[b * 2]!,
      xy[b * 2 + 1]!,
      xy[c * 2]!,
      xy[c * 2 + 1]!,
      width,
      height,
      (pixel, w0, w1, w2) => {
        // Perspective-correct depth: interpolate 1/z.
        const d = 1 / (w0 / za + w1 / zb + w2 / zc)
        if (d < depth[pixel]!) depth[pixel] = d
      },
    )
  }
  return depth
}

/** What a texel is, for laying photos on: skin, or a feature drawn from the photos whatever their colour. */
export const TEXEL_SKIN = 0
/** The eye's opening: the eyeball shows there, not the photo. */
export const TEXEL_EYE = 1
/** Lips and brows: kept from the photos though they are not skin-coloured. */
export const TEXEL_FEATURE = 2

/** One photo's view of the head's texels. */
export type ProjectedView = {
  /** Linear RGB per texel as the photo shows it. */
  color: Float32Array
  /** How much to trust it (0–1). */
  weight: Float32Array
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Bilinear lookup in an RGB float image. */
function sampleRgb(image: PhotoImage, x: number, y: number, out: Float32Array, at: number) {
  const fx = Math.min(image.width - 1.001, Math.max(0, x - 0.5))
  const fy = Math.min(image.height - 1.001, Math.max(0, y - 0.5))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const i = (y0 * image.width + x0) * 3
  const j = i + image.width * 3
  for (let k = 0; k < 3; k++) {
    const top = image.rgb[i + k]! * (1 - tx) + image.rgb[i + 3 + k]! * tx
    const bottom = image.rgb[j + k]! * (1 - tx) + image.rgb[j + 3 + k]! * tx
    out[at + k] = top * (1 - ty) + bottom * ty
  }
}

function sampleByte(data: Uint8Array, width: number, height: number, x: number, y: number) {
  const px = Math.min(width - 1, Math.max(0, Math.floor(x)))
  const py = Math.min(height - 1, Math.max(0, Math.floor(y)))
  return data[py * width + px]! / 255
}

/**
 * One photo's colours on the texels that it sees: visible from its camera
 * (not behind another part of the head), facing it (counting less as they
 * turn away), inside the person and on skin (hair, background or a hand in
 * front is not the face's colour) — except features, which count wherever
 * the person is — and never in the eyes' openings.
 */
export function projectView(
  texels: Texels,
  kind: Uint8Array,
  photo: PhotoImage,
  camera: Camera,
  depth: Float32Array,
): ProjectedView {
  const count = texels.size * texels.size
  const color = new Float32Array(count * 3)
  const weight = new Float32Array(count)
  const r = camera.rotation
  const t = camera.translation
  const { width, height } = camera
  // Camera centre in body space, for which way a texel faces.
  const cx = -(r[0] * t[0] + r[3] * t[1] + r[6] * t[2])
  const cy = -(r[1] * t[0] + r[4] * t[1] + r[7] * t[2])
  const cz = -(r[2] * t[0] + r[5] * t[1] + r[8] * t[2])
  const margin = Math.min(width, height) * 0.02
  for (let i = 0; i < count; i++) {
    if (texels.triangle[i]! < 0 || kind[i] === TEXEL_EYE) continue
    const x = texels.position[i * 3]!
    const y = texels.position[i * 3 + 1]!
    const z = texels.position[i * 3 + 2]!
    const dx = cx - x
    const dy = cy - y
    const dz = cz - z
    const distance = Math.hypot(dx, dy, dz)
    const facing =
      (texels.normal[i * 3]! * dx +
        texels.normal[i * 3 + 1]! * dy +
        texels.normal[i * 3 + 2]! * dz) /
      distance
    if (facing <= 0.12) continue
    const qx = r[0] * x + r[1] * y + r[2] * z + t[0]
    const qy = r[3] * x + r[4] * y + r[5] * z + t[1]
    const qz = r[6] * x + r[7] * y + r[8] * z + t[2]
    const u = (camera.focal * qx) / qz + camera.cx
    const v = (camera.focal * qy) / qz + camera.cy
    if (u < 0 || v < 0 || u >= width || v >= height) continue
    const px = Math.floor(u)
    const py = Math.floor(v)
    // Hidden behind nearer skin (the nose, the cheek seen past): 3 mm of grace.
    if (qz > depth[py * width + px]! + 0.003) continue
    let w = smooth(0.12, 0.5, facing)
    w *= smooth(0, margin, Math.min(u, v, width - u, height - v))
    if (photo.mask) w *= smooth(0.5, 0.95, sampleByte(photo.mask, width, height, u, v))
    if (kind[i] === TEXEL_SKIN && photo.skin)
      w *= smooth(0.3, 0.8, sampleByte(photo.skin, width, height, u, v))
    if (w <= 0.001) continue
    weight[i] = w
    sampleRgb(photo, u, v, color, i * 3)
  }
  return { color, weight }
}

/** Second-order spherical harmonics at a unit normal. */
function harmonics(nx: number, ny: number, nz: number, out: Float64Array) {
  out[0] = 1
  out[1] = ny
  out[2] = nz
  out[3] = nx
  out[4] = nx * ny
  out[5] = ny * nz
  out[6] = 3 * nz * nz - 1
  out[7] = nx * nz
  out[8] = nx * nx - ny * ny
}

/** The light taken out of a view: how much it brightened each texel (1 = as bright as the skin on average). */
export type Delit = { shading: Float32Array; fit: number }

/** Most a texel is brightened, and darkened, by taking the light out. */
const MAX_LIFT = 1 / 0.6
const MAX_DIM = 1 / 1.25

/**
 * Takes a view's lighting out of its colours (in place): a smooth light
 * (second-order spherical harmonics over the normal, in camera space)
 * fitted to the brightness of its plain skin as if the skin were all one
 * colour, then divided out. A glint (brighter than the light allows) is
 * flattened to it. Returns the shading divided out and how well the light
 * explained the skin (r²).
 */
export function delight(
  view: ProjectedView,
  texels: Texels,
  kind: Uint8Array,
  camera: Camera,
): Delit {
  const count = texels.size * texels.size
  const h = new Float64Array(81)
  const g = new Float64Array(9)
  const basis = new Float64Array(9)
  const r = camera.rotation
  let sum = 0
  let sum2 = 0
  let total = 0
  const luminance = (i: number) =>
    0.2126 * view.color[i * 3]! + 0.7152 * view.color[i * 3 + 1]! + 0.0722 * view.color[i * 3 + 2]!
  const cameraNormal = (i: number) => {
    const nx = texels.normal[i * 3]!
    const ny = texels.normal[i * 3 + 1]!
    const nz = texels.normal[i * 3 + 2]!
    // Camera space, flipped so +z faces the camera and +y is up.
    return [
      r[0] * nx + r[1] * ny + r[2] * nz,
      -(r[3] * nx + r[4] * ny + r[5] * nz),
      -(r[6] * nx + r[7] * ny + r[8] * nz),
    ] as const
  }
  for (let i = 0; i < count; i++) {
    const w = view.weight[i]!
    if (w < 0.5 || kind[i] !== TEXEL_SKIN) continue
    const [nx, ny, nz] = cameraNormal(i)
    harmonics(nx, ny, nz, basis)
    const y = luminance(i)
    for (let a = 0; a < 9; a++) {
      g[a] = g[a]! + w * basis[a]! * y
      for (let b = 0; b < 9; b++) h[a * 9 + b] = h[a * 9 + b]! + w * basis[a]! * basis[b]!
    }
    sum += w * y
    sum2 += w * y * y
    total += w
  }
  const shading = new Float32Array(count).fill(1)
  if (total < 50) return { shading, fit: 0 }
  // A little ridge keeps an unseen side's light from running wild.
  for (let a = 1; a < 9; a++) h[a * 9 + a] = h[a * 9 + a]! + total * 1e-3
  const coefficients = Float64Array.from(g)
  if (!choleskySolve(Float64Array.from(h), coefficients, 9)) return { shading, fit: 0 }
  const mean = sum / total
  let residual = 0
  for (let i = 0; i < count; i++) {
    const w = view.weight[i]!
    if (w <= 0) continue
    const [nx, ny, nz] = cameraNormal(i)
    harmonics(nx, ny, nz, basis)
    let light = 0
    for (let a = 0; a < 9; a++) light += coefficients[a]! * basis[a]!
    if (w >= 0.5 && kind[i] === TEXEL_SKIN) residual += w * (luminance(i) - light) ** 2
    const s = Math.min(1 / MAX_DIM, Math.max(1 / MAX_LIFT, light / mean))
    shading[i] = s
    let scale = 1 / s
    // A glint: far brighter than the light gives the skin.
    const y = luminance(i)
    if (y > 1.12 * light && kind[i] === TEXEL_SKIN) scale *= (1.12 * light) / y
    for (let k = 0; k < 3; k++) view.color[i * 3 + k] = view.color[i * 3 + k]! * scale
  }
  const variance = sum2 / total - mean * mean
  return { shading, fit: variance > 0 ? 1 - residual / total / variance : 0 }
}

/**
 * Scales a view's colours (in place) so that, where it and `reference` both
 * see the skin well, they agree (the median ratio, per channel): photos
 * taken a moment apart can differ in exposure and white balance.
 */
export function matchExposure(view: ProjectedView, reference: ProjectedView, kind: Uint8Array) {
  const ratios: number[][] = [[], [], []]
  for (let i = 0; i < view.weight.length; i++) {
    if (kind[i] !== TEXEL_SKIN || view.weight[i]! < 0.4 || reference.weight[i]! < 0.4) continue
    for (let k = 0; k < 3; k++) {
      const a = view.color[i * 3 + k]!
      const b = reference.color[i * 3 + k]!
      if (a > 1e-4 && b > 1e-4) ratios[k]!.push(b / a)
    }
  }
  if (ratios[0]!.length < 200) return
  const gains = ratios.map((list) => median(list))
  for (let i = 0; i < view.weight.length; i++) {
    for (let k = 0; k < 3; k++) view.color[i * 3 + k] = view.color[i * 3 + k]! * gains[k]!
  }
}

export function median(values: number[]): number {
  if (!values.length) return 1
  const sorted = Float64Array.from(values).sort()
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * The views blended: per texel, each counts by its weight to the fourth
 * power (the squarest view dominates, so a slightly misplaced side photo
 * doesn't blur the face), and the coverage is the best weight.
 */
export function blendViews(views: ProjectedView[], count: number): ProjectedView {
  const color = new Float32Array(count * 3)
  const weight = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    let total = 0
    let best = 0
    let r = 0
    let g = 0
    let b = 0
    for (const view of views) {
      const w = view.weight[i]!
      if (w <= 0) continue
      const p = w * w * w * w
      total += p
      r += p * view.color[i * 3]!
      g += p * view.color[i * 3 + 1]!
      b += p * view.color[i * 3 + 2]!
      if (w > best) best = w
    }
    if (total <= 0) continue
    color[i * 3] = r / total
    color[i * 3 + 1] = g / total
    color[i * 3 + 2] = b / total
    weight[i] = best
  }
  return { color, weight }
}
