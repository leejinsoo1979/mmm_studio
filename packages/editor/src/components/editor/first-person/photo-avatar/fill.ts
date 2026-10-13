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
 * A mesh's vertices welded across its UV seams (`weld` maps each to the
 * vertex every copy of it shares) and joined by their triangles' edges.
 */
export type SurfaceGraph = {
  /** Each mesh vertex's welded vertex. */
  local: Int32Array
  /** Each welded vertex's `weld` key. */
  keys: Uint32Array
  /** Neighbours of each welded vertex (CSR). */
  start: Uint32Array
  next: Uint32Array
  /** Each welded vertex's place (of its first copy). */
  positions: Float64Array
}

export function surfaceGraph(mesh: UvMesh, weld: Uint32Array): SurfaceGraph {
  const n = mesh.positions.length / 3
  const index = new Map<number, number>()
  const local = new Int32Array(n)
  const positions: number[] = []
  for (let v = 0; v < n; v++) {
    let at = index.get(weld[v]!)
    if (at === undefined) {
      at = index.size
      index.set(weld[v]!, at)
      positions.push(mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!)
    }
    local[v] = at
  }
  const m = index.size
  const keys = new Uint32Array(m)
  for (const [key, at] of index) keys[at] = key
  const links = Array.from({ length: m }, () => new Set<number>())
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = local[mesh.triangles[t + k]!]!
      const b = local[mesh.triangles[t + ((k + 1) % 3)]!]!
      if (a === b) continue
      links[a]!.add(b)
      links[b]!.add(a)
    }
  }
  const start = new Uint32Array(m + 1)
  for (let i = 0; i < m; i++) start[i + 1] = start[i]! + links[i]!.size
  const next = new Uint32Array(start[m]!)
  links.forEach((set, i) => {
    let at = start[i]!
    for (const j of set) next[at++] = j
  })
  return { local, keys, start, next, positions: Float64Array.from(positions) }
}

/** For each welded vertex, the nearest `seed` across the surface (Dijkstra) and how far it is (m); −1 / ∞ where none reaches. */
export function nearestSeed(
  graph: SurfaceGraph,
  seeds: (i: number) => boolean,
): { source: Int32Array; distance: Float64Array } {
  const m = graph.keys.length
  const { positions, start, next } = graph
  const distance = new Float64Array(m).fill(Number.POSITIVE_INFINITY)
  const source = new Int32Array(m).fill(-1)
  const heap = new Heap()
  for (let i = 0; i < m; i++) {
    if (!seeds(i)) continue
    distance[i] = 0
    source[i] = i
    heap.push(0, i)
  }
  while (heap.size) {
    const [d, i] = heap.pop()
    if (d > distance[i]!) continue
    for (let e = start[i]!; e < start[i + 1]!; e++) {
      const j = next[e]!
      const step = Math.hypot(
        positions[i * 3]! - positions[j * 3]!,
        positions[i * 3 + 1]! - positions[j * 3 + 1]!,
        positions[i * 3 + 2]! - positions[j * 3 + 2]!,
      )
      if (d + step < distance[j]!) {
        distance[j] = d + step
        source[j] = source[i]!
        heap.push(d + step, j)
      }
    }
  }
  return { source, distance }
}

/** Values per welded vertex (`width` each) averaged with their neighbours `rounds` times, those `fixed` picks staying. */
export function smoothOnGraph(
  graph: SurfaceGraph,
  values: Float32Array | Float64Array,
  width: number,
  rounds: number,
  fixed?: (i: number) => boolean,
) {
  const m = graph.keys.length
  const out = values.slice()
  const sums = new Float64Array(width)
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < m; i++) {
      const count = graph.start[i + 1]! - graph.start[i]!
      if (!count || fixed?.(i)) continue
      sums.fill(0)
      for (let e = graph.start[i]!; e < graph.start[i + 1]!; e++) {
        const j = graph.next[e]!
        for (let k = 0; k < width; k++) sums[k] = sums[k]! + values[j * width + k]!
      }
      for (let k = 0; k < width; k++)
        out[i * width + k] = 0.5 * values[i * width + k]! + (0.5 * sums[k]!) / count
    }
    values.set(out)
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
  const graph = surfaceGraph(mesh, weld)
  const m = graph.keys.length
  // Each welded vertex: its copies' colours averaged by weight, and its best weight.
  const own = new Float32Array(m * 3)
  const total = new Float32Array(m)
  const seen = new Float32Array(m)
  for (let v = 0; v < n; v++) {
    const i = graph.local[v]!
    const w = weight[v]!
    for (let k = 0; k < 3; k++) own[i * 3 + k] = own[i * 3 + k]! + w * color[v * 3 + k]!
    total[i] = total[i]! + w
    seen[i] = Math.max(seen[i]!, w)
  }
  for (let i = 0; i < m; i++) {
    if (total[i]! > 0) for (let k = 0; k < 3; k++) own[i * 3 + k] = own[i * 3 + k]! / total[i]!
  }
  const { source, distance } = nearestSeed(graph, (i) => seen[i]! >= 0.5)
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
  smoothOnGraph(graph, fill, 3, 30, (i) => seen[i]! >= 0.5)
  const out = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) {
    const i = graph.local[v]!
    for (let k = 0; k < 3; k++) out[v * 3 + k] = fill[i * 3 + k]!
  }
  return out
}

/**
 * The colour of the skin the photos saw at the edge of what they saw (the
 * median of the welded vertices seen well, `weight` ≥ ½, beside one that
 * was not): the forehead under the hair, the temples, the jaw — the skin
 * the unseen skin carries on from, as the face's middle (redder cheeks, a
 * shinier nose) is not. Null where none is.
 */
export function edgeColour(
  graph: SurfaceGraph,
  color: Float32Array,
  weight: Float32Array,
): [number, number, number] | null {
  const m = graph.keys.length
  const seen = new Float32Array(m)
  const own = new Float32Array(m * 3)
  for (let v = 0; v < graph.local.length; v++) {
    const i = graph.local[v]!
    if (weight[v]! <= seen[i]!) continue
    seen[i] = weight[v]!
    for (let k = 0; k < 3; k++) own[i * 3 + k] = color[v * 3 + k]!
  }
  const channels: number[][] = [[], [], []]
  for (let i = 0; i < m; i++) {
    if (seen[i]! < 0.5) continue
    let edge = false
    for (let e = graph.start[i]!; e < graph.start[i + 1]! && !edge; e++)
      edge = seen[graph.next[e]!]! < 0.5
    if (edge) for (let k = 0; k < 3; k++) channels[k]!.push(own[i * 3 + k]!)
  }
  if (channels[0]!.length < 20) return null
  return channels.map((list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)]!) as [
    number,
    number,
    number,
  ]
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
 * down a pyramid; push: fill back up, each level read smoothly — between
 * its pixels, not as blocks of them). `channels` values per pixel, in place.
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
    const fy = Math.min(half - 1, Math.max(0, (y + 0.5) / 2 - 0.5))
    const y0 = Math.min(half - 2, Math.floor(fy))
    const ty = half > 1 ? fy - Math.max(0, y0) : 0
    const r0 = Math.max(0, y0) * half
    const r1 = Math.min(half - 1, Math.max(0, y0) + 1) * half
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (valid[i]) continue
      const fx = Math.min(half - 1, Math.max(0, (x + 0.5) / 2 - 0.5))
      const x0 = Math.max(0, Math.min(half - 2, Math.floor(fx)))
      const x1 = Math.min(half - 1, x0 + 1)
      const tx = half > 1 ? fx - x0 : 0
      for (let k = 0; k < channels; k++) {
        const top =
          small[(r0 + x0) * channels + k]! * (1 - tx) + small[(r0 + x1) * channels + k]! * tx
        const bottom =
          small[(r1 + x0) * channels + k]! * (1 - tx) + small[(r1 + x1) * channels + k]! * tx
        image[i * channels + k] = top * (1 - ty) + bottom * ty
      }
    }
  }
}

/**
 * Carries the pixels `valid` keeps outwards, `rounds` pixels (each new one
 * the mean of its kept neighbours), then fills the rest by push-pull: an
 * island's own edge colour runs on past its edge, so the texture's
 * filtering and mipmaps never pull another island's colour, or a block of
 * the pyramid's, across it. In place.
 */
export function bleed(
  image: Float32Array,
  valid: Uint8Array,
  size: number,
  channels: number,
  rounds: number,
) {
  const grown = Uint8Array.from(valid)
  const sums = new Float64Array(channels)
  const queued = new Uint8Array(size * size)
  // The pixels next to what is kept: the first round's.
  let frontier: number[] = []
  const neighboursOf = (i: number, visit: (j: number) => void) => {
    const x = i % size
    const y = (i - x) / size
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= size) continue
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= size || (dx === 0 && dy === 0)) continue
        visit(ny * size + nx)
      }
    }
  }
  for (let i = 0; i < grown.length; i++) {
    if (!grown[i]) continue
    neighboursOf(i, (j) => {
      if (grown[j] || queued[j]) return
      queued[j] = 1
      frontier.push(j)
    })
  }
  for (let round = 0; round < rounds && frontier.length; round++) {
    for (const i of frontier) {
      let count = 0
      sums.fill(0)
      neighboursOf(i, (j) => {
        if (grown[j] !== 1) return
        count++
        for (let k = 0; k < channels; k++) sums[k] = sums[k]! + image[j * channels + k]!
      })
      for (let k = 0; k < channels; k++) image[i * channels + k] = sums[k]! / Math.max(1, count)
    }
    // Marked after the round, so each round grows by one pixel all round.
    for (const i of frontier) grown[i] = 1
    const next: number[] = []
    for (const i of frontier) {
      neighboursOf(i, (j) => {
        if (grown[j] || queued[j]) return
        queued[j] = 1
        next.push(j)
      })
    }
    frontier = next
  }
  pushPull(image, grown, size, channels)
}

/**
 * For each of `size` pixel centres along an axis of the texture, the pixel
 * of a `working`-size image just before it and how far it lies towards the
 * next (bilinear, clamped at the edges): the same for every row and column.
 */
function axisTaps(size: number, working: number) {
  const first = new Int32Array(size)
  const toward = new Float32Array(size)
  for (let x = 0; x < size; x++) {
    const f = Math.min(working - 1.001, Math.max(0, ((x + 0.5) / size) * working - 0.5))
    first[x] = Math.floor(f)
    toward[x] = f - first[x]!
  }
  return { first, toward }
}

/** Bilinear lookup in a square float image (`size` wide, `channels` per pixel) from pixel `at` towards the next by `tx`, `ty`. */
function bilinear(
  image: Float32Array,
  size: number,
  channels: number,
  at: number,
  tx: number,
  ty: number,
  k: number,
) {
  const i = at * channels + k
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
  /** The photos' colour (linear RGB) and coverage at the working size, edges already bled out. */
  photo: Float32Array
  coverage: Float32Array
  /** The fill (linear RGB) at the working size, edges bled out. */
  fill: Float32Array
  working: number
  /** How much each texel (working size) is the base, toned: inside the mouth and the eye sockets. */
  inner: Float32Array | null
  /** How much each texel (working size) is plain skin, which takes the base's pores over the photo. */
  plain: Float32Array | null
  /** How much each texel (working size) leaves the base's detail off the fill (the inside of the lips, whose base shows teeth). */
  flat?: Float32Array | null
  /** Which of the texture's pixels its islands cover (1), the gutter between them left out of local averages. */
  islands?: Uint8Array | null
  /** How much of the base texture's detail goes over the fill (0–1), and its finest over the photos. */
  detail?: number
  fineDetail?: number
}

/**
 * The finished texture (sRGB RGBA bytes): the photos where they saw the
 * skin well, carrying the base texture's finest detail (pores) where the
 * skin is plain; the fill elsewhere carrying the base's detail —
 * its brightness over a local average — and the toned base inside the
 * mouth and the eye sockets.
 */
export function composite({
  base,
  size,
  gains,
  photo,
  coverage,
  fill,
  working,
  inner,
  plain,
  flat = null,
  islands = null,
  detail = 0.7,
  fineDetail = 0.6,
}: Composite): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4)
  // The base's brightness, and its local averages (boxes 1/64 and 1/512 of the texture wide) over
  // its islands alone (`islands`; the gutter between them would pull an edge's average to its flat
  // colour), via integral images.
  const light = new Float64Array(size * size)
  for (let i = 0; i < size * size; i++) {
    if (islands && !islands[i]) continue
    light[i] =
      0.2126 * srgbToLinear(base[i * 4]!) +
      0.7152 * srgbToLinear(base[i * 4 + 1]!) +
      0.0722 * srgbToLinear(base[i * 4 + 2]!)
  }
  const integral = new Float64Array((size + 1) * (size + 1))
  const counted = new Float64Array((size + 1) * (size + 1))
  for (let y = 0; y < size; y++) {
    let row = 0
    let rowCount = 0
    for (let x = 0; x < size; x++) {
      row += light[y * size + x]!
      rowCount += islands ? islands[y * size + x]! : 1
      integral[(y + 1) * (size + 1) + x + 1] = integral[y * (size + 1) + x + 1]! + row
      counted[(y + 1) * (size + 1) + x + 1] = counted[y * (size + 1) + x + 1]! + rowCount
    }
  }
  const boxSum = (table: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    table[y1 * (size + 1) + x1]! -
    table[y0 * (size + 1) + x1]! -
    table[y1 * (size + 1) + x0]! +
    table[y0 * (size + 1) + x0]!
  const boxMean = (x: number, y: number, radius: number) => {
    const x0 = Math.max(0, x - radius)
    const y0 = Math.max(0, y - radius)
    const x1 = Math.min(size, x + radius + 1)
    const y1 = Math.min(size, y + radius + 1)
    const count = boxSum(counted, x0, y0, x1, y1)
    return count > 0 ? boxSum(integral, x0, y0, x1, y1) / count : 0
  }
  const coarse = Math.max(2, Math.round(size / 128))
  const fine = Math.max(1, Math.round(size / 512))
  const rgb = [0, 0, 0]
  const taps = axisTaps(size, working)
  for (let y = 0; y < size; y++) {
    const row = taps.first[y]! * working
    const ty = taps.toward[y]!
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const at = row + taps.first[x]!
      const tx = taps.toward[x]!
      const own = light[i]!
      // The gutter between islands has no detail of its own: it carries the islands' edges on.
      const gutter = islands !== null && !islands[i]
      const around = gutter ? 0 : boxMean(x, y, coarse)
      const bare = flat ? bilinear(flat, working, 1, at, tx, ty, 0) : 0
      const texture =
        (around > 1e-4 ? Math.min(1.35, Math.max(0.7, own / around)) : 1) ** (detail * (1 - bare))
      const near = gutter ? 0 : boxMean(x, y, fine)
      const pores = plain ? bilinear(plain, working, 1, at, tx, ty, 0) * fineDetail : 0
      const grain = (near > 1e-4 ? Math.min(1.18, Math.max(0.85, own / near)) : 1) ** pores
      const w = Math.min(
        1,
        Math.max(0, (bilinear(coverage, working, 1, at, tx, ty, 0) - 0.05) / 0.55),
      )
      const blend = w * w * (3 - 2 * w)
      const kept = inner ? bilinear(inner, working, 1, at, tx, ty, 0) : 0
      for (let k = 0; k < 3; k++) {
        const filled = bilinear(fill, working, 3, at, tx, ty, k) * texture
        const seen = bilinear(photo, working, 3, at, tx, ty, k) * grain
        const laid = seen * blend + filled * (1 - blend)
        const toned = srgbToLinear(base[i * 4 + k]!) * gains[k]!
        rgb[k] = laid * (1 - kept) + toned * kept
      }
      out[i * 4] = linearToSrgb(rgb[0]!)
      out[i * 4 + 1] = linearToSrgb(rgb[1]!)
      out[i * 4 + 2] = linearToSrgb(rgb[2]!)
      out[i * 4 + 3] = base[i * 4 + 3]!
    }
  }
  return out
}

/** Per-channel gains (linear) taking `from` (the median of a skin) to `to`, each within `limit` either way. */
export function toneGains(
  from: [number, number, number],
  to: [number, number, number],
  limit = 4,
): [number, number, number] {
  return [0, 1, 2].map((k) =>
    Math.min(limit, Math.max(1 / limit, to[k]! / Math.max(from[k]!, 1e-4))),
  ) as [number, number, number]
}
