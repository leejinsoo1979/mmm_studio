/**
 * Silhouettes: a person's outline in a photo as a signed distance field,
 * and a mesh's outline as the camera sees it (its occluding contour). The
 * fit pulls the head's outline onto the photo's: in a side view, that is
 * the profile — forehead, nose, lips and chin — which no front photo shows.
 *
 * Images are row-major, pixel (x, y) covering [x, x+1) × [y, y+1); points
 * are in pixels on the same scale.
 */

const INF = 1e20

/** Squared distances along one line to the nearest "on" sample (Felzenszwalb–Huttenlocher). */
function distanceLine(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    const dq = q - v[k]!
    d[q] = dq * dq + f[v[k]!]!
  }
}

/** Squared Euclidean distance (pixels²) from every pixel to the nearest pixel where `on` holds. */
export function squaredDistance(on: (i: number) => boolean, width: number, height: number) {
  const out = new Float64Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = on(i) ? 0 : INF
  const longest = Math.max(width, height)
  const f = new Float64Array(longest)
  const d = new Float64Array(longest)
  const v = new Int32Array(longest)
  const z = new Float64Array(longest + 1)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = out[y * width + x]!
    distanceLine(f, height, d, v, z)
    for (let y = 0; y < height; y++) out[y * width + x] = d[y]!
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = out[y * width + x]!
    distanceLine(f, width, d, v, z)
    for (let x = 0; x < width; x++) out[y * width + x] = d[x]!
  }
  return out
}

/**
 * The signed distance (pixels) to a mask's edge, at each pixel's centre:
 * positive outside the mask, negative inside, about ±½ next to the edge.
 * `mask` holds coverage (0–1) or 0/255 bytes; above half is inside.
 */
export function signedDistanceField(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  half = 0.5,
): Float32Array {
  const inside = (i: number) => mask[i]! > half
  const toInside = squaredDistance(inside, width, height)
  const toOutside = squaredDistance((i) => !inside(i), width, height)
  const out = new Float32Array(width * height)
  for (let i = 0; i < out.length; i++) {
    out[i] = inside(i) ? 0.5 - Math.sqrt(toOutside[i]!) : Math.sqrt(toInside[i]!) - 0.5
  }
  return out
}

/** A field's value at a point (bilinear between pixel centres) and its gradient. */
export function sampleField(
  field: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number] {
  const fx = Math.min(width - 1.001, Math.max(0, x - 0.5))
  const fy = Math.min(height - 1.001, Math.max(0, y - 0.5))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const i = y0 * width + x0
  const a = field[i]!
  const b = field[i + 1]!
  const c = field[i + width]!
  const d = field[i + width + 1]!
  const value = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  const gx = (b - a) * (1 - ty) + (d - c) * ty
  const gy = (c - a) * (1 - tx) + (d - b) * tx
  // Past the image the field goes on growing away from it.
  const outside = Math.max(0, -x, x - width) + Math.max(0, -y, y - height)
  return [value + outside, gx, gy]
}

/**
 * Fills the triangles (2D points, `xy` two numbers per vertex) into `out`
 * (one byte per pixel, set to `value` where a pixel's centre is covered).
 */
export function fillTriangles(
  xy: ArrayLike<number>,
  triangles: ArrayLike<number>,
  width: number,
  height: number,
  out: Uint8Array,
  value = 255,
  keep?: (triangle: number) => boolean,
) {
  for (let t = 0; t < triangles.length; t += 3) {
    if (keep && !keep(t / 3)) continue
    const a = triangles[t]! * 2
    const b = triangles[t + 1]! * 2
    const c = triangles[t + 2]! * 2
    rasterTriangle(
      xy[a]!,
      xy[a + 1]!,
      xy[b]!,
      xy[b + 1]!,
      xy[c]!,
      xy[c + 1]!,
      width,
      height,
      (i) => {
        out[i] = value
      },
    )
  }
}

/**
 * Calls `visit(pixel, w0, w1, w2)` for every pixel whose centre the
 * triangle covers, with that centre's barycentric weights.
 */
export function rasterTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
  visit: (pixel: number, w0: number, w1: number, w2: number) => void,
) {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  if (!(Math.abs(area) > 1e-12)) return
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
  const inv = 1 / area
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5
      const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv
      const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv
      const w2 = 1 - w0 - w1
      if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue
      visit(y * width + x, w0, w1, w2)
    }
  }
}

/** Each edge of a triangle mesh with its two triangles (−1 for a border edge). */
export type EdgeList = { a: Uint32Array; b: Uint32Array; left: Int32Array; right: Int32Array }

export function edgeList(triangles: ArrayLike<number>): EdgeList {
  const found = new Map<number, number>()
  const a: number[] = []
  const b: number[] = []
  const left: number[] = []
  const right: number[] = []
  for (let t = 0; t < triangles.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const p = triangles[t * 3 + k]!
      const q = triangles[t * 3 + ((k + 1) % 3)]!
      const lo = Math.min(p, q)
      const hi = Math.max(p, q)
      const key = lo * 4_194_304 + hi
      const at = found.get(key)
      if (at === undefined) {
        found.set(key, a.length)
        a.push(lo)
        b.push(hi)
        left.push(t)
        right.push(-1)
      } else if (right[at] === -1) {
        right[at] = t
      }
    }
  }
  return {
    a: Uint32Array.from(a),
    b: Uint32Array.from(b),
    left: Int32Array.from(left),
    right: Int32Array.from(right),
  }
}

/** A point of a mesh's outline as a camera sees it. */
export type ContourPoint = {
  /** The edge's two vertices; the point is their midpoint. */
  a: number
  b: number
  /** Where it lands (pixels), and the outline's outward normal there (unit, image space). */
  x: number
  y: number
  nx: number
  ny: number
}

/**
 * The mesh's occluding contour from a camera: edges between a triangle
 * facing it and one facing away, kept where they are the mesh's outer
 * outline (just outside them along the normal, the mesh doesn't cover the
 * image). `positions` are body space (xyz per vertex), `xy` their
 * projections, `centre` the camera's centre in body space.
 */
export function outerContour(
  positions: ArrayLike<number>,
  xy: ArrayLike<number>,
  triangles: ArrayLike<number>,
  edges: EdgeList,
  centre: readonly [number, number, number],
  width: number,
  height: number,
  keepEdge?: (a: number, b: number) => boolean,
): { points: ContourPoint[]; coverage: Uint8Array } {
  const count = triangles.length / 3
  const facing = new Int8Array(count)
  for (let t = 0; t < count; t++) {
    const i = triangles[t * 3]! * 3
    const j = triangles[t * 3 + 1]! * 3
    const k = triangles[t * 3 + 2]! * 3
    const ux = positions[j]! - positions[i]!
    const uy = positions[j + 1]! - positions[i + 1]!
    const uz = positions[j + 2]! - positions[i + 2]!
    const vx = positions[k]! - positions[i]!
    const vy = positions[k + 1]! - positions[i + 1]!
    const vz = positions[k + 2]! - positions[i + 2]!
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const s =
      nx * (centre[0] - positions[i]!) +
      ny * (centre[1] - positions[i + 1]!) +
      nz * (centre[2] - positions[i + 2]!)
    facing[t] = s > 0 ? 1 : -1
  }
  const coverage = new Uint8Array(width * height)
  fillTriangles(xy, triangles, width, height, coverage)
  const covered = (x: number, y: number) => {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || py < 0 || px >= width || py >= height) return false
    return coverage[py * width + px]! > 0
  }
  const points: ContourPoint[] = []
  for (let e = 0; e < edges.a.length; e++) {
    const l = edges.left[e]!
    const r = edges.right[e]!
    if (r < 0 || facing[l] === facing[r]) continue
    const a = edges.a[e]!
    const b = edges.b[e]!
    if (keepEdge && !keepEdge(a, b)) continue
    const ax = xy[a * 2]!
    const ay = xy[a * 2 + 1]!
    const bx = xy[b * 2]!
    const by = xy[b * 2 + 1]!
    const x = (ax + bx) / 2
    const y = (ay + by) / 2
    let nx = -(by - ay)
    let ny = bx - ax
    const length = Math.hypot(nx, ny)
    if (length < 1e-9) continue
    nx /= length
    ny /= length
    // Away from the facing triangle's third vertex.
    const front = facing[l]! > 0 ? l : r
    let third = triangles[front * 3]!
    for (let k = 0; k < 3; k++) {
      const v = triangles[front * 3 + k]!
      if (v !== a && v !== b) third = v
    }
    if ((xy[third * 2]! - x) * nx + (xy[third * 2 + 1]! - y) * ny > 0) {
      nx = -nx
      ny = -ny
    }
    if (covered(x + 1.5 * nx, y + 1.5 * ny) || !covered(x - 1.5 * nx, y - 1.5 * ny)) continue
    points.push({ a, b, x, y, nx, ny })
  }
  return { points, coverage }
}
