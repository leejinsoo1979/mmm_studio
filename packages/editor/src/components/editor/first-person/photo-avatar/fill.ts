import { rasterTriangle } from './silhouette'
import { linearToSrgb, srgbToLinear, type UvMesh } from './texture'

/**
 * Where no photo sees the head (the back and top under the hair, behind the
 * ears, under the jaw), its skin is carried on from where the photos end,
 * across the head itself, fading to the person's average skin; the base
 * texture's fine detail (pores, creases) is kept on top, in the person's
 * tone. Then the photos and the fill are put together at the texture's
 * full size.
 */

/** A small binary heap of (key, value) by key. */
class Heap {
  readonly keys: number[] = []
  readonly values: number[] = []

  get size() {
    return this.keys.length
  }

  push(key: number, value: number) {
    const { keys, values } = this
    let i = keys.length
    keys.push(key)
    values.push(value)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent]! <= key) break
      keys[i] = keys[parent]!
      values[i] = values[parent]!
      i = parent
    }
    keys[i] = key
    values[i] = value
  }

  pop(): [number, number] {
    const { keys, values } = this
    const top: [number, number] = [keys[0]!, values[0]!]
    const lastKey = keys.pop()!
    const lastValue = values.pop()!
    if (keys.length) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let smallest = i
        let key = lastKey
        if (l < keys.length && keys[l]! < key) {
          smallest = l
          key = keys[l]!
        }
        if (r < keys.length && keys[r]! < key) smallest = r
        if (smallest === i) break
        keys[i] = keys[smallest]!
        values[i] = values[smallest]!
        i = smallest
      }
      keys[i] = lastKey
      values[i] = lastValue
    }
    return top
  }
}

/**
 * Fill colours per vertex (linear RGB): where the photos saw a vertex well
 * (`weight` ≥ ½) its own colour; elsewhere the colour of the nearest such
 * vertex across the surface, fading towards `mean` with distance (`reach`
 * metres for 1/e), then smoothed so the patches don't show. `weld` maps
 * each vertex to one shared by every copy of it (UV seams split them).
 */
export function fillVertexColors(
  mesh: UvMesh,
  weld: Uint32Array,
  color: Float32Array,
  weight: Float32Array,
  mean: [number, number, number],
  reach = 0.035,
): Float32Array {
  const n = mesh.positions.length / 3
  // Neighbours of welded vertices.
  const neighbours = new Map<number, Set<number>>()
  const link = (a: number, b: number) => {
    let set = neighbours.get(a)
    if (!set) {
      set = new Set()
      neighbours.set(a, set)
    }
    set.add(b)
  }
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = weld[mesh.triangles[t + k]!]!
      const b = weld[mesh.triangles[t + ((k + 1) % 3)]!]!
      if (a !== b) {
        link(a, b)
        link(b, a)
      }
    }
  }
  // Each welded vertex: its copies' colours averaged by weight, its best weight, its position.
  const index = new Map<number, number>()
  for (let v = 0; v < n; v++) if (!index.has(weld[v]!)) index.set(weld[v]!, index.size)
  const keys = [...index.keys()]
  const m = keys.length
  const own = new Float32Array(m * 3)
  const total = new Float32Array(m)
  const seen = new Float32Array(m)
  const positionOf = new Float64Array(m * 3)
  for (let v = 0; v < n; v++) {
    const i = index.get(weld[v]!)!
    const w = weight[v]!
    for (let k = 0; k < 3; k++) {
      own[i * 3 + k] = own[i * 3 + k]! + w * color[v * 3 + k]!
      positionOf[i * 3 + k] = mesh.positions[v * 3 + k]!
    }
    total[i] = total[i]! + w
    seen[i] = Math.max(seen[i]!, w)
  }
  for (let i = 0; i < m; i++) {
    if (total[i]! > 0) for (let k = 0; k < 3; k++) own[i * 3 + k] = own[i * 3 + k]! / total[i]!
  }
  // Nearest well-seen vertex across the surface (Dijkstra from all of them).
  const distance = new Float64Array(m).fill(Number.POSITIVE_INFINITY)
  const source = new Int32Array(m).fill(-1)
  const heap = new Heap()
  for (let i = 0; i < m; i++) {
    if (seen[i]! >= 0.5) {
      distance[i] = 0
      source[i] = i
      heap.push(0, i)
    }
  }
  while (heap.size) {
    const [d, i] = heap.pop()
    if (d > distance[i]!) continue
    for (const key of neighbours.get(keys[i]!) ?? []) {
      const j = index.get(key)!
      const step = Math.hypot(
        positionOf[i * 3]! - positionOf[j * 3]!,
        positionOf[i * 3 + 1]! - positionOf[j * 3 + 1]!,
        positionOf[i * 3 + 2]! - positionOf[j * 3 + 2]!,
      )
      if (d + step < distance[j]!) {
        distance[j] = d + step
        source[j] = source[i]!
        heap.push(d + step, j)
      }
    }
  }
  const fill = new Float32Array(m * 3)
  for (let i = 0; i < m; i++) {
    const s = source[i]!
    const fade = s < 0 ? 0 : Math.exp(-distance[i]! / reach)
    for (let k = 0; k < 3; k++) {
      const from = s < 0 ? mean[k]! : own[s * 3 + k]!
      fill[i * 3 + k] = mean[k]! + (from - mean[k]!) * fade
    }
  }
  // Smooth what was filled (the seen vertices stay), so the nearest-vertex patches blend.
  const next = new Float32Array(fill)
  for (let round = 0; round < 30; round++) {
    for (let i = 0; i < m; i++) {
      if (seen[i]! >= 0.5) continue
      const around = neighbours.get(keys[i]!)
      if (!around?.size) continue
      let r = 0
      let g = 0
      let b = 0
      for (const key of around) {
        const j = index.get(key)!
        r += fill[j * 3]!
        g += fill[j * 3 + 1]!
        b += fill[j * 3 + 2]!
      }
      const c = around.size
      next[i * 3] = 0.5 * fill[i * 3]! + (0.5 * r) / c
      next[i * 3 + 1] = 0.5 * fill[i * 3 + 1]! + (0.5 * g) / c
      next[i * 3 + 2] = 0.5 * fill[i * 3 + 2]! + (0.5 * b) / c
    }
    fill.set(next)
  }
  const out = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) {
    const i = index.get(weld[v]!)!
    for (let k = 0; k < 3; k++) out[v * 3 + k] = fill[i * 3 + k]!
  }
  return out
}

/** Interpolates per-vertex colours across the mesh's triangles into a size × size RGB image (linear). */
export function rasterizeVertexColors(
  mesh: UvMesh,
  colors: Float32Array,
  size: number,
): Float32Array {
  const out = new Float32Array(size * size * 3)
  const { uvs, triangles } = mesh
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]!
    const b = triangles[t + 1]!
    const c = triangles[t + 2]!
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
        for (let k = 0; k < 3; k++) {
          out[pixel * 3 + k] =
            w0 * colors[a * 3 + k]! + w1 * colors[b * 3 + k]! + w2 * colors[c * 3 + k]!
        }
      },
    )
  }
  return out
}

/**
 * Fills the pixels `valid` leaves out from those it keeps (pull: average
 * down a pyramid; push: fill back up), so a texture blends cleanly across
 * its islands' edges. `channels` values per pixel, in place.
 */
export function pushPull(image: Float32Array, valid: Uint8Array, size: number, channels: number) {
  if (size <= 1) return
  const half = size >> 1
  const small = new Float32Array(half * half * channels)
  const smallValid = new Uint8Array(half * half)
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      let count = 0
      const sums = new Array(channels).fill(0)
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const i = (y * 2 + dy) * size + x * 2 + dx
        if (!valid[i]) continue
        count++
        for (let k = 0; k < channels; k++) sums[k] += image[i * channels + k]!
      }
      if (!count) continue
      const j = y * half + x
      smallValid[j] = 1
      for (let k = 0; k < channels; k++) small[j * channels + k] = sums[k] / count
    }
  }
  pushPull(small, smallValid, half, channels)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (valid[i]) continue
      const j = Math.min(half - 1, y >> 1) * half + Math.min(half - 1, x >> 1)
      for (let k = 0; k < channels; k++) image[i * channels + k] = small[j * channels + k]!
    }
  }
}

/** Bilinear lookup in a square float image with `channels` per pixel, at UV (0–1). */
function sampleUv(
  image: Float32Array,
  size: number,
  channels: number,
  u: number,
  v: number,
  k: number,
) {
  const fx = Math.min(size - 1.001, Math.max(0, u * size - 0.5))
  const fy = Math.min(size - 1.001, Math.max(0, v * size - 0.5))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const i = (y0 * size + x0) * channels + k
  const j = i + size * channels
  return (
    (image[i]! * (1 - tx) + image[i + channels]! * tx) * (1 - ty) +
    (image[j]! * (1 - tx) + image[j + channels]! * tx) * ty
  )
}

export type Composite = {
  /** The base texture (sRGB RGBA bytes), size × size. */
  base: Uint8Array | Uint8ClampedArray
  size: number
  /** Per-channel gains (linear) that put the base skin in the person's tone. */
  gains: [number, number, number]
  /** The photos' colour (linear RGB) and coverage at the working size, edges already pushed out. */
  photo: Float32Array
  coverage: Float32Array
  /** The fill (linear RGB) at the working size, edges pushed out. */
  fill: Float32Array
  working: number
  /** Texels left as the base, toned: boxes in UV (u0, v0, u1, v1), e.g. inside the mouth. */
  keep: [number, number, number, number][]
  /** How much of the base texture's fine detail goes over the fill (0–1). */
  detail?: number
}

/**
 * The finished texture (sRGB RGBA bytes): the photos where they saw the
 * skin well, the fill elsewhere carrying the base texture's fine detail —
 * its brightness over a local average — and the toned base in the boxes
 * kept.
 */
export function composite({
  base,
  size,
  gains,
  photo,
  coverage,
  fill,
  working,
  keep,
  detail = 0.7,
}: Composite): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4)
  // The base's brightness, and its local average (a box 1/64 of the texture wide) via an integral image.
  const light = new Float64Array(size * size)
  for (let i = 0; i < size * size; i++) {
    light[i] =
      0.2126 * srgbToLinear(base[i * 4]!) +
      0.7152 * srgbToLinear(base[i * 4 + 1]!) +
      0.0722 * srgbToLinear(base[i * 4 + 2]!)
  }
  const integral = new Float64Array((size + 1) * (size + 1))
  for (let y = 0; y < size; y++) {
    let row = 0
    for (let x = 0; x < size; x++) {
      row += light[y * size + x]!
      integral[(y + 1) * (size + 1) + x + 1] = integral[y * (size + 1) + x + 1]! + row
    }
  }
  const radius = Math.max(2, Math.round(size / 128))
  const boxMean = (x: number, y: number) => {
    const x0 = Math.max(0, x - radius)
    const y0 = Math.max(0, y - radius)
    const x1 = Math.min(size, x + radius + 1)
    const y1 = Math.min(size, y + radius + 1)
    const total =
      integral[y1 * (size + 1) + x1]! -
      integral[y0 * (size + 1) + x1]! -
      integral[y1 * (size + 1) + x0]! +
      integral[y0 * (size + 1) + x0]!
    return total / ((x1 - x0) * (y1 - y0))
  }
  const kept = (u: number, v: number) =>
    keep.some(([u0, v0, u1, v1]) => u >= u0 && u <= u1 && v >= v0 && v <= v1)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const toned = [0, 1, 2].map((k) => srgbToLinear(base[i * 4 + k]!) * gains[k]!)
      let rgb = toned
      if (!kept(u, v)) {
        const average = boxMean(x, y)
        const ratio = average > 1e-4 ? Math.min(1.35, Math.max(0.7, light[i]! / average)) : 1
        const texture = ratio ** detail
        const w = Math.min(1, Math.max(0, (sampleUv(coverage, working, 1, u, v, 0) - 0.05) / 0.55))
        const blend = w * w * (3 - 2 * w)
        rgb = [0, 1, 2].map((k) => {
          const filled = sampleUv(fill, working, 3, u, v, k) * texture
          const seen = sampleUv(photo, working, 3, u, v, k)
          return seen * blend + filled * (1 - blend)
        })
      }
      out[i * 4] = linearToSrgb(rgb[0]!)
      out[i * 4 + 1] = linearToSrgb(rgb[1]!)
      out[i * 4 + 2] = linearToSrgb(rgb[2]!)
      out[i * 4 + 3] = base[i * 4 + 3]!
    }
  }
  return out
}

/** Per-channel gains (linear) taking `from` (the median of a skin) to `to`. */
export function toneGains(
  from: [number, number, number],
  to: [number, number, number],
): [number, number, number] {
  return [0, 1, 2].map((k) => Math.min(4, Math.max(0.25, to[k]! / Math.max(from[k]!, 1e-4)))) as [
    number,
    number,
    number,
  ]
}
