/**
 * The head's front view as plain pixels (so it runs and tests without a
 * browser): its texture rendered onto a square front view, with each
 * pixel's depth; an edited front view baked back into the texture, onto
 * only the texels that view shows; and an eye's iris dyed.
 */

import { type HeadTriangle, luminance, type Pixels, type Rgb } from './look-pixels'

/** A front view and, per pixel, the depth (z, m) of the surface it shows: -Infinity where empty. */
export type FrontImage = { image: Pixels; depth: Float32Array }

/** How far (pixels) a front-view triangle reaches past its edges, so neighbours meet without cracks. */
const EDGE_TOLERANCE = 0.25

/** How far (texels) a bake reaches past a triangle, so filtering across a UV seam finds its rim baked too. */
const TEXEL_MARGIN = 1

/**
 * How much nearer (m) than a texel its own surface must fold to hide it in
 * the front view (a nose over the cheek, a lip over a lip): `SAME_SURFACE`,
 * plus as far as the texel's own depth moves over `SURFACE_REACH` pixels
 * (more on a steep surface), up to `HIDING_DEPTH`. Another piece in front
 * (an eyeball over its socket) hides it however close.
 */
const SAME_SURFACE = 0.0005
const SURFACE_REACH = 2
const HIDING_DEPTH = 0.004

/** Where a texel starts to take the front view, by how squarely it faces it. */
const FACING_FROM = 0.3
const FACING_TO = 0.65

/**
 * An eye's lightness is profiled ring by ring out from its pupil, each ring
 * this much of the eyeball's radius across, out to past the iris.
 */
const IRIS_RING = 0.02
const IRIS_RINGS = 30

/** Where (over the eyeball's radius) the iris is looked for, and the sclera measured beyond it. */
const IRIS_FROM = 0.24
const SCLERA_FROM = 0.46

/** How much lighter (luminance) the sclera must be than the iris for its edge to count. */
const IRIS_CONTRAST = 24

/** Where an iris ends (over its eyeball's radius) when its texture shows no clear edge. */
const IRIS_EDGE = 0.37

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/**
 * The first step along a row (one spare) from which a weight, `start`
 * moving by `step`, can be at `floor` or above.
 */
const spanStart = (start: number, step: number, floor: number) =>
  step > 0 ? Math.ceil((floor - start) / step) - 1 : 0

/**
 * The last step along a row (one spare) up to which a weight, `start`
 * moving by `step`, can be at `floor` or above.
 */
const spanEnd = (start: number, step: number, floor: number) =>
  step < 0 ? Math.floor((floor - start) / step) + 1 : Number.POSITIVE_INFINITY

/**
 * Visits the pixel centres of a `width` × `height` grid inside a triangle
 * (corners in pixels) or within `grow` pixels of it, with barycentric
 * weights clamped onto the triangle: a grown rim takes its edge's values
 * rather than extrapolating them (which runs away across a sliver).
 */
function rasterise(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
  grow: number,
  visit: (pixel: number, w0: number, w1: number, w2: number) => void,
) {
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  if (Math.abs(area) < 1e-12) return
  const inverse = 1 / area
  // A weight falls below zero by an edge's length over the area per pixel past it.
  const reach = grow / Math.abs(area)
  const floor0 = -reach * Math.hypot(cx - bx, cy - by)
  const floor1 = -reach * Math.hypot(ax - cx, ay - cy)
  const floor2 = -reach * Math.hypot(bx - ax, by - ay)
  const minX = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - grow - 0.5))
  const maxX = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx) + grow - 0.5))
  const minY = Math.max(0, Math.ceil(Math.min(ay, by, cy) - grow - 0.5))
  const maxY = Math.min(height - 1, Math.floor(Math.max(ay, by, cy) + grow - 0.5))
  // Each weight moves along a row by its own step per pixel.
  const step0 = (by - cy) * inverse
  const step1 = (cy - ay) * inverse
  const step2 = -step0 - step1
  const sx = minX + 0.5
  for (let py = minY; py <= maxY; py++) {
    const sy = py + 0.5
    // The weights at the row's first pixel, and the steps along it where
    // all of them may be above their floors.
    const start0 = ((bx - sx) * (cy - sy) - (cx - sx) * (by - sy)) * inverse
    const start1 = ((cx - sx) * (ay - sy) - (ax - sx) * (cy - sy)) * inverse
    const start2 = 1 - start0 - start1
    const from = Math.max(
      spanStart(start0, step0, floor0),
      spanStart(start1, step1, floor1),
      spanStart(start2, step2, floor2),
    )
    const to = Math.min(
      maxX - minX,
      spanEnd(start0, step0, floor0),
      spanEnd(start1, step1, floor1),
      spanEnd(start2, step2, floor2),
    )
    for (let k = from; k <= to; k++) {
      let w0 = start0 + step0 * k
      let w1 = start1 + step1 * k
      let w2 = 1 - w0 - w1
      if (w0 < floor0 || w1 < floor1 || w2 < floor2) continue
      if (w0 < 0 || w1 < 0 || w2 < 0) {
        w0 = Math.max(0, w0)
        w1 = Math.max(0, w1)
        w2 = Math.max(0, w2)
        const sum = w0 + w1 + w2
        w0 /= sum
        w1 /= sum
        w2 /= sum
      }
      visit(py * width + minX + k, w0, w1, w2)
    }
  }
}

/**
 * Walks the texels triangles cover on a texture, each once, with its
 * triangle and barycentric weights: first the texels inside a triangle,
 * then those within `TEXEL_MARGIN` of one (a texel visited twice would be
 * mixed twice, drawing the triangles' edges into the texture). Only the
 * `active` triangles are walked; the rest keep the texels inside them from
 * the margins, but give way to an active triangle sharing their texels.
 */
export function forEachTexel(
  texture: Pixels,
  triangles: readonly HeadTriangle[],
  active: (tri: HeadTriangle) => boolean,
  visit: (texel: number, tri: HeadTriangle, w0: number, w1: number, w2: number) => void,
) {
  const { width, height } = texture
  const seen = new Uint8Array(width * height)
  const cover = (
    tri: HeadTriangle,
    grow: number,
    each: (texel: number, w0: number, w1: number, w2: number) => void,
  ) =>
    rasterise(
      tri.u[0]! * width,
      tri.v[0]! * height,
      tri.u[1]! * width,
      tri.v[1]! * height,
      tri.u[2]! * width,
      tri.v[2]! * height,
      width,
      height,
      grow,
      each,
    )
  const walk = (tri: HeadTriangle) => (texel: number, w0: number, w1: number, w2: number) => {
    if (seen[texel]) return
    seen[texel] = 1
    visit(texel, tri, w0, w1, w2)
  }
  const claim = (texel: number) => {
    seen[texel] = 1
  }
  const walked: HeadTriangle[] = []
  const rest: HeadTriangle[] = []
  for (const tri of triangles) (active(tri) ? walked : rest).push(tri)
  for (const tri of walked) cover(tri, 0, walk(tri))
  for (const tri of rest) cover(tri, 0, claim)
  for (const tri of walked) cover(tri, TEXEL_MARGIN, walk(tri))
}

/** A bilinear sample of an image's colour at pixel-centre coordinates (clamped to it), into `out` at `at`. */
function sampleColor(image: Pixels, px: number, py: number, out: Uint8ClampedArray, at: number) {
  const { data, width, height } = image
  const x = Math.min(width - 1, Math.max(0, px))
  const y = Math.min(height - 1, Math.max(0, py))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const p00 = (y0 * width + x0) * 4
  const p01 = (y0 * width + Math.min(width - 1, x0 + 1)) * 4
  const p10 = (Math.min(height - 1, y0 + 1) * width + x0) * 4
  const p11 = (Math.min(height - 1, y0 + 1) * width + Math.min(width - 1, x0 + 1)) * 4
  for (let c = 0; c < 3; c++) {
    const top = data[p00 + c]! + (data[p01 + c]! - data[p00 + c]!) * fx
    const bottom = data[p10 + c]! + (data[p11 + c]! - data[p10 + c]!) * fx
    out[at + c] = top + (bottom - top) * fy
  }
}

/** A bilinear sample of a `size` × `size` grid of values at pixel-centre coordinates (clamped to it). */
function sampleGrid(grid: Float32Array, size: number, px: number, py: number) {
  const x = Math.min(size - 1, Math.max(0, px))
  const y = Math.min(size - 1, Math.max(0, py))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(size - 1, x0 + 1)
  const y1 = Math.min(size - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const top = grid[y0 * size + x0]! + (grid[y0 * size + x1]! - grid[y0 * size + x0]!) * fx
  const bottom = grid[y1 * size + x0]! + (grid[y1 * size + x1]! - grid[y1 * size + x0]!) * fx
  return top + (bottom - top) * fy
}

/**
 * How far (m) from a triangle's depth the front view may be, a pixel or two
 * away, and still show its surface: further on a steep one.
 */
function surfaceTolerance(tri: HeadTriangle, size: number) {
  const x1 = tri.x[1]! - tri.x[0]!
  const y1 = tri.y[1]! - tri.y[0]!
  const z1 = tri.z[1]! - tri.z[0]!
  const x2 = tri.x[2]! - tri.x[0]!
  const y2 = tri.y[2]! - tri.y[0]!
  const z2 = tri.z[2]! - tri.z[0]!
  // The depth's gradient over the front view, per pixel.
  const slope =
    Math.hypot(z1 * y2 - z2 * y1, x1 * z2 - x2 * z1) / Math.abs(x1 * y2 - x2 * y1) / size
  const tolerance = SAME_SURFACE + slope * SURFACE_REACH
  return tolerance < HIDING_DEPTH ? tolerance : HIDING_DEPTH
}

/**
 * A front view's colour at pixel-centre coordinates on a surface `z` deep,
 * bilinear over only the neighbouring pixels showing that surface — the
 * baked triangles' own (`own`, their depth), within `tolerance` of `z`: not
 * another piece, nor a nearer fold, nor one behind past its silhouette — so
 * no other surface's colour bleeds onto it. False when none shows it.
 */
function sampleSurface(
  front: FrontImage,
  own: Float32Array,
  px: number,
  py: number,
  z: number,
  tolerance: number,
  out: Float64Array,
) {
  const { data, width, height } = front.image
  const x = Math.min(width - 1, Math.max(0, px))
  const y = Math.min(height - 1, Math.max(0, py))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  out.fill(0)
  let total = 0
  for (let corner = 0; corner < 4; corner++) {
    const right = corner & 1
    const below = corner >> 1
    const i = Math.min(height - 1, y0 + below) * width + Math.min(width - 1, x0 + right)
    const w = (right ? fx : 1 - fx) * (below ? fy : 1 - fy)
    if (w <= 0 || front.depth[i]! > own[i]! || !(Math.abs(own[i]! - z) <= tolerance)) continue
    for (let c = 0; c < 3; c++) out[c]! += data[i * 4 + c]! * w
    total += w
  }
  if (total <= 0) return false
  for (let c = 0; c < 3; c++) out[c]! /= total
  return true
}

/**
 * Draws a triangle facing the front onto a `size` × `size` front view's
 * `depth` where it is the nearest surface, calling `drawn` with each pixel
 * it takes and its barycentric weights.
 */
function drawFront(
  tri: HeadTriangle,
  size: number,
  depth: Float32Array,
  drawn?: (pixel: number, w0: number, w1: number, w2: number) => void,
) {
  if (tri.n[0]! + tri.n[1]! + tri.n[2]! <= 0) return
  const [z0, z1, z2] = tri.z as [number, number, number]
  rasterise(
    tri.x[0]! * size,
    tri.y[0]! * size,
    tri.x[1]! * size,
    tri.y[1]! * size,
    tri.x[2]! * size,
    tri.y[2]! * size,
    size,
    size,
    EDGE_TOLERANCE,
    (pixel, w0, w1, w2) => {
      const z = z0 * w0 + z1 * w1 + z2 * w2
      if (z <= depth[pixel]!) return
      depth[pixel] = z
      drawn?.(pixel, w0, w1, w2)
    },
  )
}

/**
 * The head seen from the front, into a `size` × `size` image (a point
 * `x`, `y` of the front view at pixel `x·size`, `y·size`): each triangle
 * facing the front draws its texture where it is the nearest surface.
 */
export function renderFront(
  texture: Pixels,
  triangles: readonly HeadTriangle[],
  size: number,
): FrontImage {
  const data = new Uint8ClampedArray(size * size * 4)
  const depth = new Float32Array(size * size).fill(Number.NEGATIVE_INFINITY)
  const { width, height } = texture
  for (const tri of triangles) {
    const [u0, u1, u2] = tri.u as [number, number, number]
    const [v0, v1, v2] = tri.v as [number, number, number]
    drawFront(tri, size, depth, (pixel, w0, w1, w2) => {
      const u = (u0 * w0 + u1 * w1 + u2 * w2) * width - 0.5
      const v = (v0 * w0 + v1 * w1 + v2 * w2) * height - 0.5
      sampleColor(texture, u, v, data, pixel * 4)
      data[pixel * 4 + 3] = 255
    })
  }
  return { image: { data, width: size, height: size }, depth }
}

/**
 * A front-view box (fractions of the view) around every point where a
 * bilinear sample of a `size` × `size` grid finds a value above 0: `[left,
 * top, right, bottom]`, or null when there is none.
 */
function positiveBounds(grid: Float32Array, size: number): [number, number, number, number] | null {
  let left = size
  let top = size
  let right = -1
  let bottom = -1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!(grid[y * size + x]! > 0)) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = y
    }
  }
  if (right < 0) return null
  // A sample reaches a pixel from a pixel either side of its centre, and
  // reads the depths a pixel further out (drawn by triangles reaching there).
  return [(left - 1.5) / size, (top - 1.5) / size, (right + 2.5) / size, (bottom + 2.5) / size]
}

/**
 * Bakes a front view back into the head's texture (in place): each texel
 * takes the front view's colour where it shows, by `weight` (0–1 on the
 * front view's pixels) and by how squarely it faces the front. Texels a
 * nearer surface hides in the front view — under the nose, inside the
 * lips, in the folds of the eyelids, behind the eyeballs — keep their own.
 */
export function bakeFront(
  texture: Pixels,
  triangles: readonly HeadTriangle[],
  front: FrontImage,
  weight: Float32Array,
) {
  const { data } = texture
  const size = front.image.width
  const bounds = positiveBounds(weight, size)
  if (!bounds) return
  const [left, top, right, bottom] = bounds
  const overWeight = (tri: HeadTriangle) =>
    Math.max(tri.x[0]!, tri.x[1]!, tri.x[2]!) >= left &&
    Math.min(tri.x[0]!, tri.x[1]!, tri.x[2]!) <= right &&
    Math.max(tri.y[0]!, tri.y[1]!, tri.y[2]!) >= top &&
    Math.min(tri.y[0]!, tri.y[1]!, tri.y[2]!) <= bottom
  // These triangles' own front view: where the whole view is nearer, another piece hides them.
  const own = new Float32Array(size * size).fill(Number.NEGATIVE_INFINITY)
  for (const tri of triangles) if (overWeight(tri)) drawFront(tri, size, own)

  const color = new Float64Array(3)
  let current: HeadTriangle | null = null
  let tolerance = 0
  // Only a triangle facing the front, over some weight, can take anything.
  const active = (tri: HeadTriangle) =>
    Math.max(tri.n[0]!, tri.n[1]!, tri.n[2]!) > FACING_FROM && overWeight(tri)
  forEachTexel(texture, triangles, active, (texel, tri, w0, w1, w2) => {
    const facing = smoothstep(
      FACING_FROM,
      FACING_TO,
      tri.n[0]! * w0 + tri.n[1]! * w1 + tri.n[2]! * w2,
    )
    if (facing <= 0) return
    const fx = (tri.x[0]! * w0 + tri.x[1]! * w1 + tri.x[2]! * w2) * size
    const fy = (tri.y[0]! * w0 + tri.y[1]! * w1 + tri.y[2]! * w2) * size
    if (!(fx >= 0 && fy >= 0 && fx < size && fy < size)) return
    if (tri !== current) {
      current = tri
      tolerance = surfaceTolerance(tri, size)
    }
    const z = tri.z[0]! * w0 + tri.z[1]! * w1 + tri.z[2]! * w2
    // Hidden: another piece in front of it, or its own surface folded nearer.
    const pixel = Math.floor(fy) * size + Math.floor(fx)
    const shown = front.depth[pixel]!
    if ((shown > own[pixel]! && shown > z) || own[pixel]! - z > tolerance) return
    const w = sampleGrid(weight, size, fx - 0.5, fy - 0.5) * facing
    if (w <= 0 || !sampleSurface(front, own, fx - 0.5, fy - 0.5, z, tolerance, color)) return
    const p = texel * 4
    for (let c = 0; c < 3; c++) data[p + c] = data[p + c]! + (color[c]! - data[p + c]!) * w
  })
}

/**
 * Where an iris ends (over its eyeball's radius), from the eye's lightness
 * ring by ring out from the pupil (`light` over `weight` per ring): past
 * the iris's darkest ring, halfway from it to the sclera.
 */
function irisEdge(light: Float64Array, weight: Float64Array) {
  const mean = (ring: number) => light[ring]! / weight[ring]!
  const scleraFrom = Math.round(SCLERA_FROM / IRIS_RING)
  let sclera = 0
  let scleraWeight = 0
  for (let ring = scleraFrom; ring < IRIS_RINGS; ring++) {
    sclera += light[ring]!
    scleraWeight += weight[ring]!
  }
  let darkest = -1
  for (let ring = Math.round(IRIS_FROM / IRIS_RING); ring < scleraFrom; ring++) {
    if (weight[ring]! > 0 && (darkest < 0 || mean(ring) < mean(darkest))) darkest = ring
  }
  if (darkest < 0 || !(sclera / scleraWeight - mean(darkest) >= IRIS_CONTRAST)) return IRIS_EDGE
  const half = (mean(darkest) + sclera / scleraWeight) / 2
  let inside = darkest
  for (let ring = darkest + 1; ring < IRIS_RINGS; ring++) {
    if (!(weight[ring]! > 0)) continue
    if (mean(ring) >= half) {
      const t = (half - mean(inside)) / (mean(ring) - mean(inside))
      return (inside + t * (ring - inside) + 0.5) * IRIS_RING
    }
    inside = ring
  }
  return IRIS_EDGE
}

/**
 * Dyes one eyeball's iris `color` (in place), by `amount` (0–1). The iris
 * is found on the eye's texture, seen on the front view: centred on its
 * pupil (the darkest of the eye facing the front — not always the
 * eyeball's apex, as an eye can be turned aside) and out to where the
 * sclera starts. Each texel keeps its lightness relative to the iris's as a
 * whole, so the fibres show and the pupil stays dark. An eye showing no
 * pupil is left alone.
 */
export function tintIris(texture: Pixels, eye: readonly HeadTriangle[], color: Rgb, amount = 1) {
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  for (const tri of eye) {
    if (tri.n[0]! + tri.n[1]! + tri.n[2]! <= 0) continue
    left = Math.min(left, tri.x[0]!, tri.x[1]!, tri.x[2]!)
    right = Math.max(right, tri.x[0]!, tri.x[1]!, tri.x[2]!)
  }
  const radius = (right - left) / 2
  if (!(radius > 0)) return

  // The eye's texels facing the front: where each shows, how squarely, how light.
  const { data } = texture
  const texels: number[] = []
  const xs: number[] = []
  const ys: number[] = []
  const facings: number[] = []
  const lightnesses: number[] = []
  const squarely = new Uint32Array(256)
  forEachTexel(
    texture,
    eye,
    (tri) => Math.max(tri.n[0]!, tri.n[1]!, tri.n[2]!) > 0.2,
    (texel, tri, w0, w1, w2) => {
      const facing = smoothstep(0.2, 0.5, tri.n[0]! * w0 + tri.n[1]! * w1 + tri.n[2]! * w2)
      if (facing <= 0) return
      const p = texel * 4
      const lightness = luminance(data[p]!, data[p + 1]!, data[p + 2]!)
      texels.push(texel)
      xs.push(tri.x[0]! * w0 + tri.x[1]! * w1 + tri.x[2]! * w2)
      ys.push(tri.y[0]! * w0 + tri.y[1]! * w1 + tri.y[2]! * w2)
      facings.push(facing)
      lightnesses.push(lightness)
      if (facing === 1) squarely[Math.min(255, Math.floor(lightness))]!++
    },
  )

  // The pupil: the darkest hundredth of the texels facing squarely, when
  // those are much darker than the rest (the eye's white and iris).
  let count = 0
  for (const n of squarely) count += n
  const quantile = (fraction: number) => {
    let bin = 0
    for (let below = squarely[0]!; below < count * fraction; below += squarely[++bin]!);
    return bin
  }
  const darkest = quantile(0.01)
  if (!(darkest < quantile(0.5) / 3)) return
  let centreX = 0
  let centreY = 0
  let dark = 0
  for (let i = 0; i < texels.length; i++) {
    if (facings[i] !== 1 || lightnesses[i]! >= darkest + 1) continue
    centreX += xs[i]!
    centreY += ys[i]!
    dark++
  }
  centreX /= dark
  centreY /= dark

  const distances = new Float32Array(texels.length)
  const ringLight = new Float64Array(IRIS_RINGS)
  const ringWeight = new Float64Array(IRIS_RINGS)
  for (let i = 0; i < texels.length; i++) {
    const d = Math.hypot(xs[i]! - centreX, ys[i]! - centreY) / radius
    distances[i] = d
    const ring = Math.floor(d / IRIS_RING)
    if (ring >= IRIS_RINGS) continue
    ringLight[ring]! += lightnesses[i]! * facings[i]!
    ringWeight[ring]! += facings[i]!
  }
  const edge = irisEdge(ringLight, ringWeight)

  // Faded out across the iris's rim, gone just past its edge: a texel
  // there, part sclera, would dye brighter than the iris. Its lightness is
  // the iris's own, out past the pupil, so the iris comes out the colour
  // asked for on average (the pupil's black would have lifted it).
  const weights = new Float32Array(texels.length)
  let lightness = 0
  let total = 0
  for (let i = 0; i < texels.length; i++) {
    const w = (1 - smoothstep(edge - 0.025, edge + 0.015, distances[i]!)) * facings[i]!
    weights[i] = w
    const band = w * smoothstep(0.4 * edge, 0.55 * edge, distances[i]!)
    lightness += lightnesses[i]! * band
    total += band
  }
  if (total === 0) return
  const irisLightness = Math.max(1, lightness / total)
  for (let i = 0; i < texels.length; i++) {
    const w = weights[i]! * amount
    if (w <= 0) continue
    const p = texels[i]! * 4
    const ratio = lightnesses[i]! / irisLightness
    for (let c = 0; c < 3; c++) {
      const dyed = Math.min(255, color[c]! * ratio)
      data[p + c] = data[p + c]! + (dyed - data[p + c]!) * w
    }
  }
}
