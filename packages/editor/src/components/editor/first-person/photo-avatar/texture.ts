import type { Camera } from './camera'
import type { TexelFeatures } from './features'
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

/**
 * A photo: linear RGB (3 per pixel), and, when known (0–255 per pixel),
 * where it shows the person, their bare skin and their hair; and how much
 * of each pixel is an opening of the face: the mouth, the eyes (0–1).
 */
export type PhotoImage = {
  width: number
  height: number
  rgb: Float32Array
  mask?: Uint8Array | null
  skin?: Uint8Array | null
  hair?: Uint8Array | null
  openings?: Float32Array | null
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

/** Steps of the linear → sRGB table: fine enough that no byte differs from the exact curve by more than one. */
const LINEAR_STEPS = 16384
const LINEAR_TO_SRGB = (() => {
  const table = new Uint8Array(LINEAR_STEPS + 1)
  for (let i = 0; i <= LINEAR_STEPS; i++) {
    const c = i / LINEAR_STEPS
    table[i] = Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255)
  }
  return table
})()

export function linearToSrgb(value: number): number {
  const c = Math.min(1, Math.max(0, value))
  return LINEAR_TO_SRGB[Math.round(c * LINEAR_STEPS)]!
}

/** Where three's Neutral tone mapping starts to compress highlights, and how much it then desaturates. */
const NEUTRAL_START = 0.8 - 0.04
const NEUTRAL_DESATURATION = 0.15

/**
 * A displayed colour (linear, 0–1) back to the light that three's Neutral
 * tone mapping turned into it (in place). The studio shows the avatar
 * through that mapping, so a photo's pixel is taken for what the screen
 * would show: undoing it gives the light the avatar's skin must reflect
 * for the screen to show the photo's colour again. Its toe takes up to
 * 0.04 off every channel, which darkens and saturates dark skin most.
 */
export function untoneNeutral(rgb: Float32Array, at = 0) {
  let r = rgb[at]!
  let g = rgb[at + 1]!
  let b = rgb[at + 2]!
  // A clipped highlight says only that it was bright: past this the inverse runs away.
  const peak = Math.min(0.97, Math.max(r, g, b))
  if (peak >= NEUTRAL_START) {
    const d = 1 - NEUTRAL_START
    const before = (d * d) / (1 - peak) - d + NEUTRAL_START
    const mixed = 1 - 1 / (NEUTRAL_DESATURATION * (before - peak) + 1)
    const scale = before / peak / (1 - mixed)
    r = (r - mixed * peak) * scale
    g = (g - mixed * peak) * scale
    b = (b - mixed * peak) * scale
  }
  const low = Math.max(0, Math.min(r, g, b))
  const offset = low >= 0.04 ? 0.04 : 0.4 * Math.sqrt(low) - low
  rgb[at] = Math.max(0, r) + offset
  rgb[at + 1] = Math.max(0, g) + offset
  rgb[at + 2] = Math.max(0, b) + offset
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

/** RGBA bytes (sRGB, as displayed) as the scene's light: linear, Neutral tone mapping undone (`untoneNeutral`). */
export function sceneRgb(data: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = linearRgb(data, width, height)
  for (let i = 0; i < width * height; i++) untoneNeutral(out, i * 3)
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

/** One photo's view of the head's texels. */
export type ProjectedView = {
  /** Linear RGB per texel as the photo shows it. */
  color: Float32Array
  /** How much to trust it (0–1). */
  weight: Float32Array
}

export const smooth = (a: number, b: number, x: number) => {
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

/** Hair this sure (the segmenter's confidence) is not the skin under it, nor a brow. */
const HAIR_FROM = 0.15
const HAIR_TO = 0.3

/**
 * One photo's colours on the texels that it sees: visible from its camera
 * (not behind another part of the head), facing it (counting less as they
 * turn away), inside the person, never where the photo shows hair or the
 * inside of the mouth or the eyes, and on skin (background or a hand in front is not
 * the face's colour) — except the lips and brows, which count whatever
 * their colour — and never in the eyes' openings.
 */
export function projectView(
  texels: Texels,
  features: TexelFeatures,
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
    if (texels.triangle[i]! < 0) continue
    const open = 1 - features.eye[i]!
    if (open <= 0.001) continue
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
    let w = smooth(0.12, 0.5, facing) * open
    w *= smooth(0, margin, Math.min(u, v, width - u, height - v))
    if (photo.mask) w *= smooth(0.5, 0.95, sampleByte(photo.mask, width, height, u, v))
    if (photo.hair) w *= 1 - smooth(HAIR_FROM, HAIR_TO, sampleByte(photo.hair, width, height, u, v))
    if (photo.openings) w *= 1 - photo.openings[py * width + px]!
    if (photo.skin) {
      const skin = smooth(0.3, 0.8, sampleByte(photo.skin, width, height, u, v))
      const feature = features.feature[i]!
      w *= skin + (1 - skin) * feature
    }
    if (w <= 0.001) continue
    weight[i] = w
    sampleRgb(photo, u, v, color, i * 3)
  }
  return { color, weight }
}

/** A box average (`radius` texels out) of a size × size image. */
function boxAverage(image: Float32Array, size: number, radius: number): Float32Array {
  const row = new Float32Array(size * size)
  const box = new Float32Array(size * size)
  const span = 2 * radius + 1
  for (let y = 0; y < size; y++) {
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += x >= 0 && x < size ? image[y * size + x]! : 0
    for (let x = 0; x < size; x++) {
      row[y * size + x] = sum / span
      const out = x - radius
      const into = x + radius + 1
      if (out >= 0) sum -= image[y * size + out]!
      if (into < size) sum += image[y * size + into]!
    }
  }
  for (let x = 0; x < size; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += y >= 0 && y < size ? row[y * size + x]! : 0
    for (let y = 0; y < size; y++) {
      box[y * size + x] = sum / span
      const out = y - radius
      const into = y + radius + 1
      if (out >= 0) sum -= row[out * size + x]!
      if (into < size) sum += row[into * size + x]!
    }
  }
  return box
}

/**
 * A view's weights eased in from every edge they have (in place): each is
 * kept no higher than its neighbourhood's average over the texture's own
 * texels (a box `radius` texels out; the gutter between islands not
 * counted), so where a photo stops — at hair, the mouth, the nose's
 * shadow — the next photo takes over gradually, not along a line.
 */
export function featherWeights(weight: Float32Array, texels: Texels, radius: number) {
  const { size } = texels
  const inside = new Float32Array(size * size)
  for (let i = 0; i < inside.length; i++) inside[i] = texels.triangle[i]! >= 0 ? 1 : 0
  const area = boxAverage(inside, size, radius)
  const box = boxAverage(weight, size, radius)
  for (let i = 0; i < weight.length; i++) {
    if (!inside[i]) continue
    const average = box[i]! / Math.max(area[i]!, 1e-6)
    if (weight[i]! > average) weight[i] = average
  }
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

/**
 * The light taken out of a view: the shading divided out of each texel (1 =
 * as lit as the skin on average, before any limit), how well the light
 * explained the skin (r²), and the light itself in the camera's frame (+z
 * towards the camera, +y up), scaled so that 1 is the skin's average: nine
 * second-order spherical harmonics, then a key light's strength and
 * direction (see `lightAt`).
 */
export type Delit = { shading: Float32Array; fit: number; light: Float64Array }

/** Most a texel is brightened when the light is a poor fit, and when a good one (r² past ½ and 0.8). */
const LIFT_UNSURE = 1 / 0.6
const LIFT_SURE = 3
/** Most a texel is darkened. */
const DIM_UNSURE = 1.25
const DIM_SURE = 2.5
/** A glint: this much brighter, its light taken out, than the view's typical skin (more than skin itself varies). */
const GLINT = 1.4
/** How far (as a share of the light) a texel may stray from the light before it counts less: a shadow cast, a mole, stubble. */
const ROBUST = 0.3
/** The key light is kept only where it explains this much more of the skin than the smooth light alone. */
const KEY_GAIN = 0.85
/** How many texels the key light's direction is searched with, and over how many directions. */
const KEY_SAMPLES = 12000
const KEY_DIRECTIONS = 300

/** A texel's normal in a camera's frame (+z towards the camera, +y up). */
export function cameraNormal(
  texels: Texels,
  camera: Camera,
  i: number,
): readonly [number, number, number] {
  const r = camera.rotation
  const nx = texels.normal[i * 3]!
  const ny = texels.normal[i * 3 + 1]!
  const nz = texels.normal[i * 3 + 2]!
  return [
    r[0] * nx + r[1] * ny + r[2] * nz,
    -(r[3] * nx + r[4] * ny + r[5] * nz),
    -(r[6] * nx + r[7] * ny + r[8] * nz),
  ] as const
}

/**
 * The light's terms at a normal: the nine harmonics, then the key light's
 * clamped cosine (a sharp edge between lit and unlit that the smooth
 * harmonics round off) along `key`, 0 without one.
 */
function lightTerms(
  nx: number,
  ny: number,
  nz: number,
  key: ArrayLike<number> | null,
  out: Float64Array,
) {
  harmonics(nx, ny, nz, out)
  out[9] = key ? Math.max(0, nx * key[0]! + ny * key[1]! + nz * key[2]!) : 0
}

/** The light (`Delit.light`) at a normal in the camera's frame. */
export function lightAt(light: Float64Array, nx: number, ny: number, nz: number): number {
  const terms = new Float64Array(10)
  lightTerms(nx, ny, nz, light.subarray(10, 13), terms)
  let sum = 0
  for (let a = 0; a < 10; a++) sum += light[a]! * terms[a]!
  return sum
}

const luminanceAt = (color: Float32Array, i: number) =>
  0.2126 * color[i * 3]! + 0.7152 * color[i * 3 + 1]! + 0.0722 * color[i * 3 + 2]!

/** Plain skin's brightness as light samples: normals in their camera's frame, from one view or several. */
type LightSamples = {
  normals: Float64Array
  values: Float64Array
  weights: Float64Array
  /** The view each sample came from. */
  view: Uint16Array
}

/**
 * Weighted least squares of a light (with a key along `key`, or none) to the
 * samples, each view's brightness first divided by its `gains` (its
 * exposure): the light's terms and the mean squared residual.
 */
function solveLight(
  samples: LightSamples,
  robust: Float64Array,
  gains: Float64Array,
  key: ArrayLike<number> | null,
): { coefficients: Float64Array; residual: number } | null {
  const terms = key ? 10 : 9
  const h = new Float64Array(terms * terms)
  const g = new Float64Array(terms)
  const basis = new Float64Array(10)
  const { normals, values, weights, view } = samples
  let total = 0
  // In the photo's own units the residual is gain × (value / gain − light): weighted by gain².
  const visit = (k: number) => {
    const gain = gains[view[k]!]!
    const w = weights[k]! * robust[k]! * gain * gain
    if (w <= 0) return
    lightTerms(normals[k * 3]!, normals[k * 3 + 1]!, normals[k * 3 + 2]!, key, basis)
    const y = values[k]! / gain
    for (let a = 0; a < terms; a++) {
      g[a] = g[a]! + w * basis[a]! * y
      for (let b = 0; b <= a; b++) h[a * terms + b] = h[a * terms + b]! + w * basis[a]! * basis[b]!
    }
    total += w
  }
  for (let k = 0; k < values.length; k++) visit(k)
  if (total < 20) return null
  for (let a = 0; a < terms; a++)
    for (let b = a + 1; b < terms; b++) h[a * terms + b] = h[b * terms + a]!
  // A little ridge keeps an unseen side's light from running wild.
  for (let a = 1; a < terms; a++) h[a * terms + a] = h[a * terms + a]! + total * 1e-3
  const coefficients = Float64Array.from(g)
  if (!choleskySolve(h, coefficients, terms)) return null
  let residual = 0
  const add = (k: number) => {
    const gain = gains[view[k]!]!
    const w = weights[k]! * robust[k]!
    if (w <= 0) return
    lightTerms(normals[k * 3]!, normals[k * 3 + 1]!, normals[k * 3 + 2]!, key, basis)
    let predicted = 0
    for (let a = 0; a < terms; a++) predicted += coefficients[a]! * basis[a]!
    residual += w * (values[k]! - gain * predicted) ** 2
  }
  for (let k = 0; k < values.length; k++) add(k)
  return { coefficients, residual: residual / total }
}

/**
 * `solveLight` on the `pick`ed samples, made quick for trying many key
 * directions: the harmonics' part of the normal equations is summed once,
 * each direction adds only the key's row, and the residual follows from
 * the equations without another pass over the samples.
 */
function keyFits(samples: LightSamples, robust: Float64Array, gains: Float64Array, pick: number[]) {
  const n = pick.length
  const basis = new Float64Array(n * 9)
  const fitWeight = new Float64Array(n)
  const target = new Float64Array(n)
  const smoothH = new Float64Array(81)
  const smoothG = new Float64Array(9)
  const terms = new Float64Array(10)
  let total = 0
  let squares = 0
  pick.forEach((k, s) => {
    const gain = gains[samples.view[k]!]!
    const w = samples.weights[k]! * robust[k]! * gain * gain
    if (w <= 0) return
    harmonics(
      samples.normals[k * 3]!,
      samples.normals[k * 3 + 1]!,
      samples.normals[k * 3 + 2]!,
      terms,
    )
    const y = samples.values[k]! / gain
    fitWeight[s] = w
    target[s] = y
    for (let a = 0; a < 9; a++) {
      basis[s * 9 + a] = terms[a]!
      smoothG[a] = smoothG[a]! + w * terms[a]! * y
      for (let b = 0; b <= a; b++)
        smoothH[a * 9 + b] = smoothH[a * 9 + b]! + w * terms[a]! * terms[b]!
    }
    total += w
    squares += w * y * y
  })
  return (
    key: ArrayLike<number> | null,
  ): { coefficients: Float64Array; residual: number } | null => {
    if (total < 20) return null
    const size = key ? 10 : 9
    const h = new Float64Array(size * size)
    const g = new Float64Array(size)
    for (let a = 0; a < 9; a++) {
      g[a] = smoothG[a]!
      for (let b = 0; b <= a; b++) h[a * size + b] = smoothH[a * 9 + b]!
    }
    if (key) {
      for (let s = 0; s < n; s++) {
        const w = fitWeight[s]!
        const k = pick[s]!
        const lit = Math.max(
          0,
          samples.normals[k * 3]! * key[0]! +
            samples.normals[k * 3 + 1]! * key[1]! +
            samples.normals[k * 3 + 2]! * key[2]!,
        )
        if (w <= 0 || lit <= 0) continue
        for (let a = 0; a < 9; a++) h[9 * size + a] = h[9 * size + a]! + w * basis[s * 9 + a]! * lit
        h[99] = h[99]! + w * lit * lit
        g[9] = g[9]! + w * lit * target[s]!
      }
    }
    for (let a = 0; a < size; a++)
      for (let b = a + 1; b < size; b++) h[a * size + b] = h[b * size + a]!
    const plain = Float64Array.from(h)
    for (let a = 1; a < size; a++) h[a * size + a] = h[a * size + a]! + total * 1e-3
    const coefficients = Float64Array.from(g)
    if (!choleskySolve(h, coefficients, size)) return null
    // Σ w (y − c·t)² = Σ w y² − 2 c·g + cᵀ H c.
    let residual = squares
    for (let a = 0; a < size; a++) {
      residual -= 2 * coefficients[a]! * g[a]!
      for (let b = 0; b < size; b++)
        residual += coefficients[a]! * plain[a * size + b]! * coefficients[b]!
    }
    return { coefficients, residual: Math.max(0, residual) / total }
  }
}

/** Evenly spread unit directions (a Fibonacci lattice), those facing well away from the camera left out. */
function keyDirections(count: number): Float64Array[] {
  const out: Float64Array[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const z = 1 - (2 * (i + 0.5)) / count
    const r = Math.sqrt(1 - z * z)
    if (z < -0.5) continue
    out.push(Float64Array.of(r * Math.cos(golden * i), r * Math.sin(golden * i), z))
  }
  return out
}

/**
 * Takes a view's lighting out of its colours (in place): a light fitted to
 * the brightness of its plain skin as if the skin were all one colour —
 * smooth (second-order spherical harmonics over the normal, in camera
 * space), with a key light's sharp edge between lit and shadowed added
 * where one shows (a window, a lamp to the side) — again with the texels
 * the light explains worst counting less, so a cast shadow or a mole does
 * not bend it; then divided out. How far a texel may be brightened or
 * darkened grows with how well the light fits: a well explained shadow is
 * lifted up to 3×. A glint (its light out, brighter than the view's typical
 * skin by more than skin varies) is flattened to that.
 */
export function delight(
  view: ProjectedView,
  texels: Texels,
  features: TexelFeatures,
  camera: Camera,
): Delit {
  return delightTogether([view], texels, features, [camera])[0]!
}

/**
 * Takes the lighting out of several views of one head at once (in place,
 * see `delight`), as a person turning before a camera with the lamps
 * standing still is photographed: one light in the camera's frame for all
 * of them, each view with its own exposure. A side of the face that only a
 * profile photo saw — in shadow there, the light hard to read from it
 * alone — is lit as every photo together says it was. The `reference`
 * view sets the scale (its plain skin averages 1 in shading).
 */
export function delightTogether(
  views: ProjectedView[],
  texels: Texels,
  features: TexelFeatures,
  cameras: Camera[],
  reference = 0,
): Delit[] {
  const count = texels.size * texels.size
  const used: number[][] = views.map((view) => {
    const list: number[] = []
    for (let i = 0; i < count; i++) {
      if (view.weight[i]! <= 0) continue
      const plain = 1 - Math.max(features.feature[i]!, features.eye[i]!)
      if (view.weight[i]! * plain >= 0.5) list.push(i)
    }
    return list
  })
  const unlit = () =>
    views.map(() => ({
      shading: new Float32Array(count).fill(1),
      fit: 0,
      light: new Float64Array(13),
    }))
  const total = used.reduce((sum, list) => sum + list.length, 0)
  if (used[reference]!.length < 50) return unlit()
  const samples: LightSamples = {
    normals: new Float64Array(total * 3),
    values: new Float64Array(total),
    weights: new Float64Array(total),
    view: new Uint16Array(total),
  }
  const means = new Float64Array(views.length)
  let at = 0
  views.forEach((view, v) => {
    let sum = 0
    let weight = 0
    for (const i of used[v]!) {
      samples.normals.set(cameraNormal(texels, cameras[v]!, i), at * 3)
      samples.values[at] = luminanceAt(view.color, i)
      samples.weights[at] = view.weight[i]!
      samples.view[at] = v
      sum += samples.weights[at]! * samples.values[at]!
      weight += samples.weights[at]!
      at++
    }
    means[v] = weight > 0 ? sum / weight : 0
  })
  let mean = 0
  for (let k = 0; k < total; k++) mean += samples.values[k]! / total
  const gains = new Float64Array(views.length).fill(1)
  const robust = new Float64Array(total).fill(1)
  const basis = new Float64Array(10)
  const predict = (coefficients: Float64Array, key: ArrayLike<number> | null, k: number) => {
    lightTerms(
      samples.normals[k * 3]!,
      samples.normals[k * 3 + 1]!,
      samples.normals[k * 3 + 2]!,
      key,
      basis,
    )
    let predicted = 0
    for (let a = 0; a < coefficients.length; a++) predicted += coefficients[a]! * basis[a]!
    return gains[samples.view[k]!]! * predicted
  }
  const reweigh = (coefficients: Float64Array, key: ArrayLike<number> | null) => {
    for (let k = 0; k < total; k++) {
      const predicted = predict(coefficients, key, k)
      const off = (samples.values[k]! - predicted) / Math.max(predicted, 0.05 * mean)
      // Tukey's biweight.
      const u = off / (2 * ROBUST)
      robust[k] = Math.abs(u) >= 1 ? 0 : (1 - u * u) ** 2
    }
  }
  // Each view's exposure: the gain that best takes the light to its own skin, the reference's 1.
  const regain = (coefficients: Float64Array, key: ArrayLike<number> | null) => {
    const num = new Float64Array(views.length)
    const den = new Float64Array(views.length)
    for (let k = 0; k < total; k++) {
      const v = samples.view[k]!
      const lit = predict(coefficients, key, k) / gains[v]!
      const w = samples.weights[k]! * robust[k]!
      num[v] = num[v]! + w * samples.values[k]! * lit
      den[v] = den[v]! + w * lit * lit
    }
    for (let v = 0; v < views.length; v++)
      if (den[v]! > 0 && num[v]! > 0) gains[v] = num[v]! / den[v]!
    const own = gains[reference]!
    for (let v = 0; v < views.length; v++) gains[v] = gains[v]! / own
  }
  let key: Float64Array | null = null
  let solved = solveLight(samples, robust, gains, null)
  if (!solved) return unlit()
  for (let round = 0; round < 3; round++) {
    reweigh(solved.coefficients, null)
    if (views.length > 1) regain(solved.coefficients, null)
    solved = solveLight(samples, robust, gains, null) ?? solved
  }
  // A key light's direction, searched on a sample of the texels.
  const stride = Math.max(1, Math.floor(total / KEY_SAMPLES))
  const pick: number[] = []
  for (let k = 0; k < total; k += stride) pick.push(k)
  const fitPicked = keyFits(samples, robust, gains, pick)
  const smoothOnly = fitPicked(null)
  const best = { key: null as Float64Array | null, residual: Number.POSITIVE_INFINITY }
  const tryKey = (direction: Float64Array) => {
    const tried = fitPicked(direction)
    if (!tried || tried.coefficients[9]! <= 0 || tried.residual >= best.residual) return
    best.key = direction
    best.residual = tried.residual
  }
  for (const direction of keyDirections(KEY_DIRECTIONS)) tryKey(direction)
  // Then finer about the best, the step halving (the lattice's points are about 0.2 rad apart).
  for (let step = 0.1; step > 0.01 && best.key; step /= 2) {
    const [x, y, z] = best.key as unknown as [number, number, number]
    const across = Math.abs(z) < 0.9 ? [y, -x, 0] : [0, z, -y]
    const length = Math.hypot(across[0]!, across[1]!, across[2]!)
    const a = across.map((c) => c / length)
    const b = [y * a[2]! - z * a[1]!, z * a[0]! - x * a[2]!, x * a[1]! - y * a[0]!]
    for (const [p, q] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const d = [x, y, z].map((c, k) => c + step * (p * a[k]! + q * b[k]!))
      const norm = Math.hypot(d[0]!, d[1]!, d[2]!)
      tryKey(Float64Array.of(d[0]! / norm, d[1]! / norm, d[2]! / norm))
    }
  }
  if (best.key && smoothOnly && best.residual < KEY_GAIN * smoothOnly.residual) {
    const withKey = solveLight(samples, robust, gains, best.key)
    if (withKey && withKey.coefficients[9]! > 0) {
      key = best.key
      solved = withKey
      for (let round = 0; round < 2; round++) {
        reweigh(solved.coefficients, key)
        if (views.length > 1) regain(solved.coefficients, key)
        solved = solveLight(samples, robust, gains, key) ?? solved
      }
    }
  }
  const coefficients = solved.coefficients
  return views.map((view, v) => {
    const shading = new Float32Array(count).fill(1)
    // How well the light explains this view's skin (r², by its plain skin's own weights).
    let residual = 0
    let spread = 0
    for (let k = 0; k < total; k++) {
      if (samples.view[k] !== v) continue
      const w = samples.weights[k]!
      residual += w * (samples.values[k]! - predict(coefficients, key, k)) ** 2
      spread += w * (samples.values[k]! - means[v]!) ** 2
    }
    const fit = spread > 0 ? Math.max(0, 1 - residual / spread) : 0
    const light = new Float64Array(13)
    for (let a = 0; a < coefficients.length; a++)
      light[a] = (gains[v]! * coefficients[a]!) / Math.max(means[reference]!, 1e-6)
    if (key) light.set(key, 10)
    if (used[v]!.length < 50) return { shading, fit: 0, light }
    const sure = smooth(0.5, 0.8, fit)
    const lift = LIFT_UNSURE + (LIFT_SURE - LIFT_UNSURE) * sure
    const dim = DIM_UNSURE + (DIM_SURE - DIM_UNSURE) * sure
    const scales = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      if (view.weight[i]! <= 0) continue
      const [nx, ny, nz] = cameraNormal(texels, cameras[v]!, i)
      const s = lightAt(light, nx, ny, nz)
      shading[i] = s
      scales[i] = 1 / Math.min(dim, Math.max(1 / lift, s))
    }
    const ceiling = GLINT * median(used[v]!.map((i) => luminanceAt(view.color, i) * scales[i]!))
    for (let i = 0; i < count; i++) {
      if (view.weight[i]! <= 0) continue
      let scale = scales[i]!
      const y = luminanceAt(view.color, i) * scale
      if (y > ceiling && features.feature[i]! < 0.5) scale *= ceiling / y
      for (let k = 0; k < 3; k++) view.color[i * 3 + k] = view.color[i * 3 + k]! * scale
    }
    return { shading, fit, light }
  })
}

/** How lit a texel was in a view, as trust in its colour: deep shadow is mostly noise once lifted. */
export const litTrust = (shading: number) => 0.15 + 0.85 * smooth(0.15, 0.75, shading)

/**
 * Scales a view's colours (in place) so that, where it and `reference` both
 * see the plain skin well and lit, they agree (the median ratio, per
 * channel): photos taken a moment apart can differ in exposure and white
 * balance.
 */
export function matchExposure(
  view: ProjectedView,
  reference: ProjectedView,
  features: TexelFeatures,
  shading?: { view: Float32Array; reference: Float32Array },
) {
  const ratios: number[][] = [[], [], []]
  for (let i = 0; i < view.weight.length; i++) {
    if (view.weight[i]! < 0.4 || reference.weight[i]! < 0.4) continue
    if (features.feature[i]! > 0.2 || features.eye[i]! > 0.2) continue
    if (shading && (shading.view[i]! < 0.5 || shading.reference[i]! < 0.5)) continue
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

/** How far (natural log of brightness) a view's colour may stray from the others' before it counts less. */
const AGREE = 0.18

/**
 * The views blended: per texel, each counts by its weight to the fourth
 * power (the squarest view dominates, so a slightly misplaced side photo
 * doesn't blur the face) and by how lit it saw the texel (`shadings`, from
 * `delight`: a shadow lifted is noisier than light); then again, with a
 * view that strays from what the views agree on (a shadow the light could
 * not explain, a misplaced edge) counting less. The coverage is the best weight, less
 * where every view saw the texel only in shadow.
 */
export function blendViews(
  views: ProjectedView[],
  count: number,
  shadings?: Float32Array[],
): ProjectedView {
  const color = new Float32Array(count * 3)
  const weight = new Float32Array(count)
  const p = new Float64Array(views.length)
  const order = new Float64Array(views.length)
  const votes = new Float64Array(views.length)
  for (let i = 0; i < count; i++) {
    let total = 0
    let best = 0
    let r = 0
    let g = 0
    let b = 0
    views.forEach((view, k) => {
      const w = view.weight[i]!
      p[k] = 0
      if (w <= 0) return
      const lit = shadings ? litTrust(shadings[k]![i]!) : 1
      p[k] = w * w * w * w * lit * lit
      total += p[k]!
      r += p[k]! * view.color[i * 3]!
      g += p[k]! * view.color[i * 3 + 1]!
      b += p[k]! * view.color[i * 3 + 2]!
      best = Math.max(best, w * (0.4 + 0.6 * lit))
    })
    if (total <= 0) continue
    // What the views agree on: their median brightness, each counted by its own weight. Their
    // blend would be the squarest view's alone, which then never disagrees with itself: a profile
    // seeing past a brow's hairs to the skin under them outvoted every front view of the brow.
    let used = 0
    let half = 0
    views.forEach((view, k) => {
      if (!(p[k]! > 0)) return
      order[used] = Math.log(Math.max(1e-5, luminanceAt(view.color, i)))
      votes[used] = view.weight[i]!
      half += votes[used]! / 2
      used++
    })
    for (let a = 1; a < used; a++)
      for (let b2 = a; b2 > 0 && order[b2 - 1]! > order[b2]!; b2--) {
        ;[order[b2 - 1], order[b2]] = [order[b2]!, order[b2 - 1]!]
        ;[votes[b2 - 1], votes[b2]] = [votes[b2]!, votes[b2 - 1]!]
      }
    let first = order[0]!
    for (let a = 0, seen = 0; a < used; a++) {
      seen += votes[a]!
      first = order[a]!
      if (seen >= half) break
    }
    let again = 0
    let r2 = 0
    let g2 = 0
    let b2 = 0
    views.forEach((view, k) => {
      if (!(p[k]! > 0)) return
      const off = Math.log(Math.max(1e-5, luminanceAt(view.color, i))) - first
      const q = p[k]! * Math.exp(-0.5 * (off / AGREE) ** 2)
      again += q
      r2 += q * view.color[i * 3]!
      g2 += q * view.color[i * 3 + 1]!
      b2 += q * view.color[i * 3 + 2]!
    })
    if (again > 1e-3 * total) {
      color[i * 3] = r2 / again
      color[i * 3 + 1] = g2 / again
      color[i * 3 + 2] = b2 / again
    } else {
      color[i * 3] = r / total
      color[i * 3 + 1] = g / total
      color[i * 3 + 2] = b / total
    }
    weight[i] = best
  }
  return { color, weight }
}
