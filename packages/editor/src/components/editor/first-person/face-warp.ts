/**
 * The pixel work of a face swap, on plain RGBA buffers (so it runs and tests
 * without a browser): triangulating face points, warping a photo triangle by
 * triangle so its points land on a character's, masking the face, evening
 * out the photo's lighting and blending it into the character's own skin in
 * the gradient domain, so no seam shows where the two meet.
 */

import type { Point } from './face-points'
import { luminance, type Pixels } from './look-pixels'

const smoothstep = (t: number) => {
  const s = Math.min(1, Math.max(0, t))
  return s * s * (3 - 2 * s)
}

/** Points nearer than this (a fraction of the points' extent) are one point. */
const MERGE = 1e-7
/**
 * Points snap to a grid this fine across their extent (finer than MERGE, so
 * distinct points stay apart). On it orientation tests are exact in doubles
 * (their products stay under 2⁵³) and circle tests can be made exact, so the
 * mesh can't fold where points lie in line or on one circle.
 */
const GRID = 2 ** 24
/** Twice a triangle's area, as a fraction of the points' extent squared, below which it is flat. */
const FLAT = 1e-12
/** The vertex at infinity: each hull edge and it make a "ghost" triangle, closing the mesh. */
const GHOST = -1

/**
 * The Delaunay triangulation of `points` (Bowyer–Watson), as index triples.
 * Each triangle runs counter-clockwise on the image (x right, y down), so
 * `(bx − ax)(cy − ay) − (by − ay)(cx − ax)` is negative. Points nearer than
 * a ten-millionth of the points' extent are one (a closed mouth's lips meet)
 * and triangles use the first of them; collinear points make no triangle.
 */
export function delaunay(points: readonly Point[]): [number, number, number][] {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const size = Math.max(maxX - minX, maxY - minY)
  if (!(size > 0)) return []

  // Scaled into the unit square, so the tolerances hold at any scale.
  const xs: number[] = []
  const ys: number[] = []
  const firstOf: number[] = []
  points.forEach(([px, py], i) => {
    const x = (px - minX) / size
    const y = (py - minY) / size
    for (let j = 0; j < xs.length; j++) {
      if ((xs[j]! - x) ** 2 + (ys[j]! - y) ** 2 < MERGE * MERGE) return
    }
    xs.push(x)
    ys.push(y)
    firstOf.push(i)
  })
  const count = xs.length
  const X = xs.map((x) => Math.round(x * GRID))
  const Y = ys.map((y) => Math.round(y * GRID))
  const orient = (a: number, b: number, c: number) =>
    (X[b]! - X[a]!) * (Y[c]! - Y[a]!) - (Y[b]! - Y[a]!) * (X[c]! - X[a]!)

  // Start from a wide triangle: the first point, the farthest from it, and
  // the farthest from the line through both.
  let second = 0
  for (let i = 1; i < count; i++) {
    if (
      (X[i]! - X[0]!) ** 2 + (Y[i]! - Y[0]!) ** 2 >
      (X[second]! - X[0]!) ** 2 + (Y[second]! - Y[0]!) ** 2
    ) {
      second = i
    }
  }
  let third = -1
  let widest = 0
  for (let i = 1; i < count; i++) {
    const area = Math.abs(orient(0, second, i))
    if (area > widest) {
      widest = area
      third = i
    }
  }
  if (third < 0) return []

  // Triangles wind with a positive `orient` inside; a ghost triangle
  // (a, b, GHOST) stands for the outside beyond the hull edge b→a.
  const corners: number[] = []
  const alive: boolean[] = []
  // The point whose cavity last took each triangle: membership without clearing.
  const lastCavity: number[] = []
  // Each directed edge → the triangle on its left.
  const edges = new Map<number, number>()
  const key = (a: number, b: number) => (a + 1) * (count + 1) + b + 1
  const add = (a: number, b: number, c: number) => {
    if (a === GHOST) [a, b, c] = [b, c, a]
    else if (b === GHOST) [a, b, c] = [c, a, b]
    const t = alive.length
    corners.push(a, b, c)
    alive.push(true)
    lastCavity.push(-1)
    edges.set(key(a, b), t)
    edges.set(key(b, c), t)
    edges.set(key(c, a), t)
  }
  const remove = (t: number) => {
    const [a, b, c] = [corners[t * 3]!, corners[t * 3 + 1]!, corners[t * 3 + 2]!]
    alive[t] = false
    edges.delete(key(a, b))
    edges.delete(key(b, c))
    edges.delete(key(c, a))
  }

  /**
   * Whether `p` lies strictly inside the triangle's circumcircle; for a
   * ghost, beyond its hull edge or on the edge itself.
   */
  const encloses = (t: number, p: number) => {
    const a = corners[t * 3]!
    const b = corners[t * 3 + 1]!
    const c = corners[t * 3 + 2]!
    if (c === GHOST) {
      const side = orient(a, b, p)
      if (side !== 0) return side > 0
      const dx = X[b]! - X[a]!
      const dy = Y[b]! - Y[a]!
      return (
        (X[p]! - X[a]!) * dx + (Y[p]! - Y[a]!) * dy > 0 &&
        (X[b]! - X[p]!) * dx + (Y[b]! - Y[p]!) * dy > 0
      )
    }
    const adx = X[a]! - X[p]!
    const ady = Y[a]! - Y[p]!
    const bdx = X[b]! - X[p]!
    const bdy = Y[b]! - Y[p]!
    const cdx = X[c]! - X[p]!
    const cdy = Y[c]! - Y[p]!
    const aLift = adx * adx + ady * ady
    const bLift = bdx * bdx + bdy * bdy
    const cLift = cdx * cdx + cdy * cdy
    const det =
      aLift * (bdx * cdy - cdx * bdy) +
      bLift * (cdx * ady - adx * cdy) +
      cLift * (adx * bdy - bdx * ady)
    // Only the last products round; where they could flip the sign, redo it exactly.
    const bound =
      1e-14 *
      (aLift * (Math.abs(bdx * cdy) + Math.abs(cdx * bdy)) +
        bLift * (Math.abs(cdx * ady) + Math.abs(adx * cdy)) +
        cLift * (Math.abs(adx * bdy) + Math.abs(bdx * ady)))
    if (Math.abs(det) > bound) return det > 0
    const Adx = BigInt(adx)
    const Ady = BigInt(ady)
    const Bdx = BigInt(bdx)
    const Bdy = BigInt(bdy)
    const Cdx = BigInt(cdx)
    const Cdy = BigInt(cdy)
    return (
      (Adx * Adx + Ady * Ady) * (Bdx * Cdy - Cdx * Bdy) +
        (Bdx * Bdx + Bdy * Bdy) * (Cdx * Ady - Adx * Cdy) +
        (Cdx * Cdx + Cdy * Cdy) * (Adx * Bdy - Bdx * Ady) >
      0n
    )
  }

  /** The triangle holding `p`, or (outside the hull) a ghost it lies beyond. */
  const locate = (p: number) => {
    let beyond = -1
    for (let t = 0; t < alive.length; t++) {
      if (!alive[t]) continue
      const a = corners[t * 3]!
      const b = corners[t * 3 + 1]!
      const c = corners[t * 3 + 2]!
      if (c === GHOST) {
        if (beyond < 0 && orient(a, b, p) > 0) beyond = t
      } else if (orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0) {
        return t
      }
    }
    return beyond
  }

  const [b0, c0] = orient(0, second, third) > 0 ? [second, third] : [third, second]
  add(0, b0, c0)
  add(b0, 0, GHOST)
  add(c0, b0, GHOST)
  add(0, c0, GHOST)

  const rim: number[] = []
  for (let p = 1; p < count; p++) {
    if (p === second || p === third) continue
    // The cavity: the connected triangles whose circumcircles hold `p`. With
    // exact tests `p` sees all of its rim from inside, so fanning out from
    // `p` to the rim remeshes it.
    const seed = locate(p)
    const cavity = [seed]
    lastCavity[seed] = p
    rim.length = 0
    for (let k = 0; k < cavity.length; k++) {
      const t = cavity[k]!
      for (let e = 0; e < 3; e++) {
        const other = edges.get(key(corners[t * 3 + ((e + 1) % 3)]!, corners[t * 3 + e]!))!
        if (lastCavity[other] !== p && encloses(other, p)) {
          lastCavity[other] = p
          cavity.push(other)
        }
      }
    }
    for (const t of cavity) {
      for (let e = 0; e < 3; e++) {
        const a = corners[t * 3 + e]!
        const b = corners[t * 3 + ((e + 1) % 3)]!
        if (lastCavity[edges.get(key(b, a))!] !== p) rim.push(a, b)
      }
    }
    for (const t of cavity) remove(t)
    for (let e = 0; e < rim.length; e += 2) add(rim[e]!, rim[e + 1]!, p)
  }

  const triangles: [number, number, number][] = []
  for (let t = 0; t < alive.length; t++) {
    const a = corners[t * 3]!
    const b = corners[t * 3 + 1]!
    const c = corners[t * 3 + 2]!
    if (!alive[t] || c === GHOST) continue
    // Snapping can leave a sliver between points nearly in line: flat, or
    // even turned over, in the points as given.
    if ((xs[b]! - xs[a]!) * (ys[c]! - ys[a]!) - (ys[b]! - ys[a]!) * (xs[c]! - xs[a]!) <= FLAT) {
      continue
    }
    // Reversed: a positive `orient` runs clockwise on a y-down image.
    triangles.push([firstOf[a]!, firstOf[c]!, firstOf[b]!])
  }
  return triangles
}

/** How far (px) outside a triangle a pixel centre may lie and still count, so shared edges leave no gaps. */
const EDGE = 1e-4
/** Twice a triangle's area (px²) below which it is flat. */
const FLAT_PIXELS = 1e-6

/**
 * A piecewise-affine warp of `source` onto a `width` × `height` image: each
 * triangle of `to` (pixels of the result) shows the same triangle of `from`
 * (pixels of `source`), sampled bilinearly. Pixels no triangle covers are
 * left transparent. A triangle flat in `to` covers nothing and is skipped
 * (as is one with a corner that isn't finite); one flat in `from` (a closed
 * mouth mapped onto an open one) still fills its pixels, smeared along the
 * line it collapses to.
 */
export function warpTriangles(
  source: Pixels,
  from: readonly Point[],
  to: readonly Point[],
  triangles: readonly [number, number, number][],
  width: number,
  height: number,
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  const src = source.data
  const sw = source.width
  const sh = source.height
  for (const [i, j, k] of triangles) {
    const [ax, ay] = to[i]!
    const [bx, by] = to[j]!
    const [cx, cy] = to[k]!
    const [fax, fay] = from[i]!
    const [fbx, fby] = from[j]!
    const [fcx, fcy] = from[k]!
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    const fromArea = (fbx - fax) * (fcy - fay) - (fcx - fax) * (fby - fay)
    // A NaN or infinite corner on either side would paint the whole image.
    if (!(Math.abs(area) >= FLAT_PIXELS) || !Number.isFinite(area + fromArea)) continue
    // Barycentric weights of a and b as linear functions of the pixel centre.
    const aX = (by - cy) / area
    const aY = (cx - bx) / area
    const a0 = (bx * cy - cx * by) / area
    const bX = (cy - ay) / area
    const bY = (ax - cx) / area
    const b0 = (cx * ay - ax * cy) / area
    // A weight is a distance from the opposite edge over the corner's height.
    const size = Math.abs(area)
    const aTol = (-EDGE * Math.hypot(cx - bx, cy - by)) / size
    const bTol = (-EDGE * Math.hypot(ax - cx, ay - cy)) / size
    const cTol = (-EDGE * Math.hypot(bx - ax, by - ay)) / size
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        const wa = aX * px + aY * py + a0
        if (wa < aTol) continue
        const wb = bX * px + bY * py + b0
        if (wb < bTol || 1 - wa - wb < cTol) continue
        // Source pixel centres sit at +0.5, so shift to sample between them.
        const sx = Math.min(sw - 1, Math.max(0, fcx + wa * (fax - fcx) + wb * (fbx - fcx) - 0.5))
        const sy = Math.min(sh - 1, Math.max(0, fcy + wa * (fay - fcy) + wb * (fby - fcy) - 0.5))
        const x0 = Math.floor(sx)
        const y0 = Math.floor(sy)
        const tx = sx - x0
        const ty = sy - y0
        const x1 = Math.min(x0 + 1, sw - 1)
        const y1 = Math.min(y0 + 1, sh - 1)
        const p00 = (y0 * sw + x0) * 4
        const p10 = (y0 * sw + x1) * 4
        const p01 = (y1 * sw + x0) * 4
        const p11 = (y1 * sw + x1) * 4
        const o = (y * width + x) * 4
        for (let c = 0; c < 3; c++) {
          const top = src[p00 + c]! + (src[p10 + c]! - src[p00 + c]!) * tx
          const bottom = src[p01 + c]! + (src[p11 + c]! - src[p01 + c]!) * tx
          data[o + c] = top + (bottom - top) * ty
        }
        data[o + 3] = 255
      }
    }
  }
  return { data, width, height }
}

/**
 * A mask of the closed `polygon` (pixel coordinates, even–odd filled at
 * pixel centres): 0 outside, rising smoothly from 0 at its edge to 1 at
 * `feather` pixels in.
 */
export function polygonMask(
  polygon: readonly Point[],
  width: number,
  height: number,
  feather: number,
): Float32Array {
  const mask = new Float32Array(width * height)
  const count = polygon.length
  if (count < 3) return mask
  const ax = new Float64Array(count)
  const ay = new Float64Array(count)
  const dx = new Float64Array(count)
  const dy = new Float64Array(count)
  const inverseLength = new Float64Array(count)
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let e = 0; e < count; e++) {
    const [x0, y0] = polygon[e]!
    const [x1, y1] = polygon[(e + 1) % count]!
    ax[e] = x0
    ay[e] = y0
    dx[e] = x1 - x0
    dy[e] = y1 - y0
    const length = dx[e]! ** 2 + dy[e]! ** 2
    inverseLength[e] = length > 0 ? 1 / length : 0
    minY = Math.min(minY, y0)
    maxY = Math.max(maxY, y0)
  }
  const crossings = new Float64Array(count)
  const near = new Int32Array(count)
  const reach = Math.max(0, feather)
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(height - 1, Math.ceil(maxY)); y++) {
    const py = y + 0.5
    let crossed = 0
    let nearby = 0
    for (let e = 0; e < count; e++) {
      const ey = ay[e]!
      const fy = ey + dy[e]!
      if (ey <= py !== fy <= py) crossings[crossed++] = ax[e]! + ((py - ey) * dx[e]!) / dy[e]!
      // Only edges within `feather` of the row can dim it.
      if (Math.min(ey, fy) - reach <= py && py <= Math.max(ey, fy) + reach) near[nearby++] = e
    }
    const row = crossings.subarray(0, crossed).sort()
    for (let k = 0; k + 1 < crossed; k += 2) {
      const from = Math.max(0, Math.ceil(row[k]! - 0.5))
      const to = Math.min(width - 1, Math.ceil(row[k + 1]! - 0.5) - 1)
      for (let x = from; x <= to; x++) {
        let value = 1
        if (reach > 0) {
          const px = x + 0.5
          let nearest = reach * reach
          for (let n = 0; n < nearby; n++) {
            const e = near[n]!
            const ox = px - ax[e]!
            const oy = py - ay[e]!
            const t = Math.min(1, Math.max(0, (ox * dx[e]! + oy * dy[e]!) * inverseLength[e]!))
            const distance = (ox - t * dx[e]!) ** 2 + (oy - t * dy[e]!) ** 2
            if (distance < nearest) nearest = distance
          }
          value = smoothstep(Math.sqrt(nearest) / reach)
        }
        mask[y * width + x] = value
      }
    }
  }
  return mask
}

/**
 * A box blur (zeros beyond the image), rows then columns, in place.
 * Three of them come close to a Gaussian.
 */
function boxBlur(
  values: Float32Array,
  width: number,
  height: number,
  radius: number,
  scratch: Float32Array,
) {
  const scale = 1 / (2 * radius + 1)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += values[row + x]!
    for (let x = 0; x < width; x++) {
      scratch[row + x] = sum * scale
      if (x + radius + 1 < width) sum += values[row + x + radius + 1]!
      if (x - radius >= 0) sum -= values[row + x - radius]!
    }
  }
  // Columns a row at a time, to walk memory in order.
  const sums = new Float64Array(width)
  for (let y = 0; y <= Math.min(radius, height - 1); y++) {
    for (let x = 0; x < width; x++) sums[x]! += scratch[y * width + x]!
  }
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) values[row + x] = sums[x]! * scale
    if (y + radius + 1 < height) {
      const entering = (y + radius + 1) * width
      for (let x = 0; x < width; x++) sums[x]! += scratch[entering + x]!
    }
    if (y - radius >= 0) {
      const leaving = (y - radius) * width
      for (let x = 0; x < width; x++) sums[x]! -= scratch[leaving + x]!
    }
  }
}

/**
 * Evens out large-scale shading under `mask` (in place) — a photo's side
 * light, a shadow down one side of the nose — while keeping small features:
 * each pixel is scaled by how much darker or lighter its surroundings (a
 * mask-weighted blur reaching about `radius` px) are than the masked area's
 * mean.
 * `strength` 0 leaves the image, 1 flattens the shading fully.
 */
export function flattenLighting(
  image: Pixels,
  mask: Float32Array,
  strength: number,
  radius: number,
) {
  if (strength === 0) return
  const { data, width, height } = image
  const size = width * height
  const lit = new Float32Array(size)
  const weight = new Float32Array(size)
  let sum = 0
  let total = 0
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    const m = mask[i]!
    if (m <= 0) continue
    const l = luminance(data[p]!, data[p + 1]!, data[p + 2]!) * m
    lit[i] = l
    weight[i] = m
    sum += l
    total += m
  }
  if (total === 0) return
  const mean = sum / total
  const r = Math.max(0, Math.round(radius))
  if (r > 0) {
    const scratch = new Float32Array(size)
    for (let pass = 0; pass < 3; pass++) {
      boxBlur(lit, width, height, r, scratch)
      boxBlur(weight, width, height, r, scratch)
    }
  }
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    const m = mask[i]!
    if (m <= 0) continue
    // blur(L·m) / blur(m): the surroundings' lightness, counting only the mask.
    const local = weight[i]! > 0 ? lit[i]! / weight[i]! : mean
    const factor = (mean / Math.max(local, 1)) ** strength
    for (let c = 0; c < 3; c++) {
      const value = data[p + c]!
      data[p + c] = value + (Math.min(255, value * factor) - value) * m
    }
  }
}

/**
 * One grid of the multigrid pyramid. A coarse cell covers 2×2 cells of the
 * grid above and is an unknown only when all of them are, so every grid
 * keeps a boundary wherever the one above has one.
 */
type Grid = {
  width: number
  height: number
  /** 0: fixed (outside the region); 1: unknown; 2: unknown on the image's rim (fewer neighbours). */
  kind: Uint8Array
  /** The unknowns, split by the parity of x + y: each half's neighbours all lie in the other. */
  unknowns: [Int32Array, Int32Array]
  /** The unknowns within BAND cells of a fixed one, split the same way. */
  band: [Int32Array, Int32Array]
  /** RGB per cell: the solution at unknowns, the boundary values at fixed cells. */
  u: Float32Array
  /** RGB per cell: the right-hand side at unknowns. */
  f: Float32Array
}

/** The coarsest grid is solved exactly; it is at most this wide and high. */
const COARSEST = 32
/** Gauss–Seidel sweeps before and after each coarse correction. */
const SMOOTHING = 1
/**
 * Coarse grids shrink the region by up to a cell each, so they fit its edge
 * worst and leave their error there: a band this deep along the edge gets
 * this many extra (cheap, it is thin) sweeps around each correction.
 */
const BAND = 6
const BAND_SWEEPS = 6
/**
 * Once full multigrid reaches the full-size grid, V-cycles run there until
 * one corrects it by less than this (in colour levels), or MAX_CYCLES have.
 */
const TOLERANCE = 0.25
const MAX_CYCLES = 8

/** Red–black order: the cells with x + y even, then odd. */
function byParity(cells: readonly number[], width: number): [Int32Array, Int32Array] {
  const even = cells.filter((i) => (((i % width) + Math.floor(i / width)) & 1) === 0)
  const odd = cells.filter((i) => (((i % width) + Math.floor(i / width)) & 1) === 1)
  return [Int32Array.from(even), Int32Array.from(odd)]
}

function makeGrid(width: number, height: number, kind: Uint8Array): Grid {
  const size = width * height
  const counts = [0, 0]
  // Depth into the region (1: touching a fixed cell), out to BAND.
  const depth = new Uint8Array(size)
  const band: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!kind[i]) continue
      counts[(x + y) & 1]!++
      if (
        (x > 0 && !kind[i - 1]) ||
        (x < width - 1 && !kind[i + 1]) ||
        (y > 0 && !kind[i - width]) ||
        (y < height - 1 && !kind[i + width])
      ) {
        depth[i] = 1
        band.push(i)
      }
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) kind[i] = 2
    }
  }
  const even = new Int32Array(counts[0]!)
  const odd = new Int32Array(counts[1]!)
  counts.fill(0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!kind[i]) continue
      if ((x + y) & 1) odd[counts[1]!++] = i
      else even[counts[0]!++] = i
    }
  }
  let next = 0
  const reach = (j: number) => {
    if (kind[j] && !depth[j]) {
      depth[j] = next
      band.push(j)
    }
  }
  for (let k = 0; k < band.length; k++) {
    const i = band[k]!
    if (depth[i]! >= BAND) continue
    next = depth[i]! + 1
    const x = i % width
    if (x > 0) reach(i - 1)
    if (x < width - 1) reach(i + 1)
    if (i >= width) reach(i - width)
    if (i + width < size) reach(i + width)
  }
  return {
    width,
    height,
    kind,
    unknowns: [even, odd],
    band: byParity(band, width),
    u: new Float32Array(size * 3),
    f: new Float32Array(size * 3),
  }
}

/** The next grid down, its fixed cells holding the mean of their fixed children's values. */
function coarsen(fine: Grid): Grid {
  const width = (fine.width + 1) >> 1
  const height = (fine.height + 1) >> 1
  const kind = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let unknown = 1
      for (let cy = y * 2; cy < Math.min(y * 2 + 2, fine.height); cy++) {
        for (let cx = x * 2; cx < Math.min(x * 2 + 2, fine.width); cx++) {
          if (!fine.kind[cy * fine.width + cx]) unknown = 0
        }
      }
      kind[y * width + x] = unknown
    }
  }
  const coarse = makeGrid(width, height, kind)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (kind[i]) continue
      let n = 0
      for (let cy = y * 2; cy < Math.min(y * 2 + 2, fine.height); cy++) {
        for (let cx = x * 2; cx < Math.min(x * 2 + 2, fine.width); cx++) {
          const child = cy * fine.width + cx
          if (fine.kind[child]) continue
          n++
          for (let c = 0; c < 3; c++) coarse.u[i * 3 + c]! += fine.u[child * 3 + c]!
        }
      }
      for (let c = 0; c < 3; c++) coarse.u[i * 3 + c]! /= n
    }
  }
  return coarse
}

/**
 * One Gauss–Seidel pass over `cells` towards the discrete Poisson equation:
 * at each unknown, its neighbours minus it, summed, equal −f. Neighbours
 * off the image don't count (nothing flows across its rim).
 */
function relax(grid: Grid, cells: Int32Array) {
  const { u, f, kind, width, height } = grid
  const row = width * 3
  for (let n = 0; n < cells.length; n++) {
    const i = cells[n]!
    const p = i * 3
    if (kind[i] === 1) {
      const l = p - 3
      const r = p + 3
      const t = p - row
      const b = p + row
      u[p] = (f[p]! + u[l]! + u[r]! + u[t]! + u[b]!) * 0.25
      u[p + 1] = (f[p + 1]! + u[l + 1]! + u[r + 1]! + u[t + 1]! + u[b + 1]!) * 0.25
      u[p + 2] = (f[p + 2]! + u[l + 2]! + u[r + 2]! + u[t + 2]! + u[b + 2]!) * 0.25
      continue
    }
    const x = i % width
    const y = (i - x) / width
    const neighbours =
      (x > 0 ? 1 : 0) + (x < width - 1 ? 1 : 0) + (y > 0 ? 1 : 0) + (y < height - 1 ? 1 : 0)
    if (neighbours === 0) continue
    for (let q = p; q < p + 3; q++) {
      let sum = f[q]!
      if (x > 0) sum += u[q - 3]!
      if (x < width - 1) sum += u[q + 3]!
      if (y > 0) sum += u[q - row]!
      if (y < height - 1) sum += u[q + row]!
      u[q] = sum / neighbours
    }
  }
}

function sweep(grid: Grid, cells: [Int32Array, Int32Array], times: number) {
  for (let s = 0; s < times; s++) {
    relax(grid, cells[0])
    relax(grid, cells[1])
  }
}

/**
 * Hands the fine grid's residual (f − A·u) down as the coarse grid's
 * right-hand side, summed over each 2×2 block (the coarse grid's cells are
 * twice as wide), with a zero start and zero boundary for the correction
 * solved there. A coarse unknown's children are all unknowns.
 */
function restrict(fine: Grid, coarse: Grid) {
  coarse.u.fill(0)
  coarse.f.fill(0)
  const into = coarse.f
  const { u, f, kind, width, height } = fine
  const row = width * 3
  for (let y = 0; y < height; y++) {
    const parents = (y >> 1) * coarse.width
    for (let x = 0; x < width; x++) {
      const parent = parents + (x >> 1)
      if (!coarse.kind[parent]) continue
      const i = y * width + x
      const p = i * 3
      const q = parent * 3
      if (kind[i] === 1) {
        into[q]! += f[p]! + u[p - 3]! + u[p + 3]! + u[p - row]! + u[p + row]! - 4 * u[p]!
        into[q + 1]! +=
          f[p + 1]! + u[p - 2]! + u[p + 4]! + u[p + 1 - row]! + u[p + 1 + row]! - 4 * u[p + 1]!
        into[q + 2]! +=
          f[p + 2]! + u[p - 1]! + u[p + 5]! + u[p + 2 - row]! + u[p + 2 + row]! - 4 * u[p + 2]!
        continue
      }
      for (let c = 0; c < 3; c++) {
        const at = p + c
        let r = f[at]!
        if (x > 0) r += u[at - 3]! - u[at]!
        if (x < width - 1) r += u[at + 3]! - u[at]!
        if (y > 0) r += u[at - row]! - u[at]!
        if (y < height - 1) r += u[at + row]! - u[at]!
        into[q + c]! += r
      }
    }
  }
}

/**
 * Bilinearly interpolates the coarse grid's values onto the fine grid's
 * unknowns: `keep` 0 sets them (a first guess), 1 adds to them (a
 * correction). Returns the largest value it interpolated.
 */
function prolong(coarse: Grid, fine: Grid, keep: number) {
  const cw = coarse.width
  const ch = coarse.height
  const cu = coarse.u
  const { width, height, kind, u } = fine
  let largest = 0
  for (let y = 0; y < height; y++) {
    // A fine cell's centre lies a quarter of a coarse cell from its parent's.
    const odd = y & 1
    const y0 = odd ? y >> 1 : Math.max((y >> 1) - 1, 0)
    const y1 = odd ? Math.min((y >> 1) + 1, ch - 1) : y >> 1
    const wy = odd ? 0.75 : 0.25
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!kind[i]) continue
      const oddX = x & 1
      const x0 = oddX ? x >> 1 : Math.max((x >> 1) - 1, 0)
      const x1 = oddX ? Math.min((x >> 1) + 1, cw - 1) : x >> 1
      const wx = oddX ? 0.75 : 0.25
      const p00 = (y0 * cw + x0) * 3
      const p10 = (y0 * cw + x1) * 3
      const p01 = (y1 * cw + x0) * 3
      const p11 = (y1 * cw + x1) * 3
      const w00 = wx * wy
      const w10 = (1 - wx) * wy
      const w01 = wx * (1 - wy)
      const w11 = (1 - wx) * (1 - wy)
      for (let c = 0; c < 3; c++) {
        const value =
          w00 * cu[p00 + c]! + w10 * cu[p10 + c]! + w01 * cu[p01 + c]! + w11 * cu[p11 + c]!
        u[i * 3 + c] = keep * u[i * 3 + c]! + value
        if (value > largest) largest = value
        else if (-value > largest) largest = -value
      }
    }
  }
  return largest
}

/**
 * The coarsest grid's equations, factored (banded Cholesky) so every solve
 * there is exact: relaxation crawls where little of the region's edge is
 * boundary (where it runs off the image, say). Numbered row by row, an
 * unknown is coupled only to unknowns at most a row away.
 */
type Coarsest = {
  grid: Grid
  /** The unknowns' cells, in order. */
  cells: Int32Array
  /** How far apart in that order two coupled unknowns can be. */
  bandwidth: number
  /** The factor L, a row per unknown: L[k][j] at `k * (bandwidth + 1) + k − j`. */
  lower: Float64Array
  /** One channel's right-hand side, then solution. */
  values: Float64Array
}

function factorise(grid: Grid): Coarsest {
  const { width, height, kind } = grid
  const order = new Int32Array(kind.length)
  const list: number[] = []
  for (let i = 0; i < kind.length; i++) {
    if (!kind[i]) continue
    order[i] = list.length
    list.push(i)
  }
  const cells = Int32Array.from(list)
  const count = cells.length
  let bandwidth = 1
  for (let k = 0; k < count; k++) {
    const below = cells[k]! + width
    if (below < kind.length && kind[below]) bandwidth = Math.max(bandwidth, order[below]! - k)
  }
  const stride = bandwidth + 1
  const lower = new Float64Array(count * stride)
  for (let k = 0; k < count; k++) {
    const i = cells[k]!
    const x = i % width
    const y = (i - x) / width
    const row = k * stride
    lower[row] =
      (x > 0 ? 1 : 0) + (x < width - 1 ? 1 : 0) + (y > 0 ? 1 : 0) + (y < height - 1 ? 1 : 0)
    if (x > 0 && kind[i - 1]) lower[row + 1] = -1
    if (y > 0 && kind[i - width]) lower[row + k - order[i - width]!] = -1
  }
  for (let k = 0; k < count; k++) {
    const row = k * stride
    const first = Math.max(0, k - bandwidth)
    for (let j = first; j <= k; j++) {
      const other = j * stride
      let sum = lower[row + k - j]!
      for (let m = first; m < j; m++) sum -= lower[row + k - m]! * lower[other + j - m]!
      lower[row + k - j] = j === k ? Math.sqrt(sum) : sum / lower[other]!
    }
  }
  return { grid, cells, bandwidth, lower, values: new Float64Array(count) }
}

/** Solves the coarsest grid's equations exactly, its fixed cells' values as the boundary. */
function solveExactly({ grid, cells, bandwidth, lower, values }: Coarsest) {
  const { u, f, kind, width } = grid
  const stride = bandwidth + 1
  const count = cells.length
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < count; k++) {
      const i = cells[k]!
      const x = i % width
      let sum = f[i * 3 + c]!
      if (x > 0 && !kind[i - 1]) sum += u[(i - 1) * 3 + c]!
      if (x < width - 1 && !kind[i + 1]) sum += u[(i + 1) * 3 + c]!
      if (i >= width && !kind[i - width]) sum += u[(i - width) * 3 + c]!
      if (i + width < kind.length && !kind[i + width]) sum += u[(i + width) * 3 + c]!
      const row = k * stride
      for (let j = Math.max(0, k - bandwidth); j < k; j++) sum -= lower[row + k - j]! * values[j]!
      values[k] = sum / lower[row]!
    }
    for (let k = count - 1; k >= 0; k--) {
      let sum = values[k]!
      const last = Math.min(count - 1, k + bandwidth)
      for (let j = k + 1; j <= last; j++) sum -= lower[j * stride + j - k]! * values[j]!
      values[k] = sum / lower[k * stride]!
      u[cells[k]! * 3 + c] = values[k]!
    }
  }
}

/**
 * One V-cycle on `grids[level]`'s equation, the grids below solving for its
 * correction. Returns the largest correction they made.
 */
function vCycle(grids: Grid[], level: number, coarsest: Coarsest): number {
  const grid = grids[level]!
  const coarse = grids[level + 1]
  if (!coarse) {
    solveExactly(coarsest)
    return 0
  }
  sweep(grid, grid.band, BAND_SWEEPS)
  sweep(grid, grid.unknowns, SMOOTHING)
  restrict(grid, coarse)
  vCycle(grids, level + 1, coarsest)
  const correction = prolong(coarse, grid, 1)
  sweep(grid, grid.band, BAND_SWEEPS)
  sweep(grid, grid.unknowns, SMOOTHING)
  return correction
}

/**
 * Blends `source` into `target` in the gradient domain (Poisson image
 * editing): inside `region` (> 0.5) the result keeps the source's detail but
 * meets the target seamlessly at the region's edge. It is `source + strength·D`
 * there, where D is the smooth (harmonic) fill of the difference
 * `target − source` found just outside the region; elsewhere it is `target`.
 *
 * D solves Laplace's equation with that difference as its boundary, by full
 * multigrid: the region and its boundary are carried down a pyramid of
 * half-size grids, the smallest solved exactly, and each finer grid starts
 * from the one below's answer, then is corrected by V-cycles (Gauss–Seidel
 * sweeps smoothing the fine error, the rest solved for on the grids below)
 * until they barely change it. The work grows linearly with the pixels,
 * where plain relaxation needs thousands of sweeps for smooth fills across
 * a whole face.
 */
export function seamlessClone(
  source: Pixels,
  target: Pixels,
  region: Float32Array,
  strength: number,
): Pixels {
  const { width, height } = target
  const src = source.data
  const dst = target.data
  const data = new Uint8ClampedArray(dst)
  for (let p = 3; p < data.length; p += 4) data[p] = 255

  // Solve only over the region's bounds and the ring of boundary around them.
  let left = width
  let right = -1
  let top = height
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (region[y * width + x]! <= 0.5) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) return { data, width, height }
  left = Math.max(0, left - 1)
  top = Math.max(0, top - 1)
  const w = Math.min(width - 1, right + 1) - left + 1
  const h = Math.min(height - 1, bottom + 1) - top + 1
  const kind = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      kind[y * w + x] = region[(top + y) * width + left + x]! > 0.5 ? 1 : 0
    }
  }
  const fine = makeGrid(w, h, kind)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (kind[i]) continue
      const p = ((top + y) * width + left + x) * 4
      for (let c = 0; c < 3; c++) fine.u[i * 3 + c] = dst[p + c]! - src[p + c]!
    }
  }
  // With no boundary at all (the region covers the image) D is 0.
  if (fine.unknowns[0].length + fine.unknowns[1].length < w * h) {
    const grids = [fine]
    for (let grid = fine; Math.max(grid.width, grid.height) > COARSEST; ) {
      grid = coarsen(grid)
      grids.push(grid)
    }
    const coarsest = factorise(grids[grids.length - 1]!)
    solveExactly(coarsest)
    let correction = 0
    for (let level = grids.length - 2; level >= 0; level--) {
      prolong(grids[level + 1]!, grids[level]!, 0)
      correction = vCycle(grids, level, coarsest)
    }
    for (let cycle = 0; correction > TOLERANCE && cycle < MAX_CYCLES; cycle++) {
      correction = vCycle(grids, 0, coarsest)
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!kind[i]) continue
      const p = ((top + y) * width + left + x) * 4
      for (let c = 0; c < 3; c++) data[p + c] = src[p + c]! + strength * fine.u[i * 3 + c]!
    }
  }
  return { data, width, height }
}
