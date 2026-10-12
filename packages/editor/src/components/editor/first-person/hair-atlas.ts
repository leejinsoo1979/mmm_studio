/**
 * The strand atlas every generated hair strip is drawn with: 12 layers of
 * 256 × 1024 RGBA8, side by side in one texture (layer k fills u from
 * k/12 to (k+1)/12), with every mip. Across a layer is across the strip;
 * along it is 8 cm of strand (scaled by the head), repeating.
 *
 * - R: the strip's sub-locks (4–8 tapered bands), its only coverage. No
 *   fibre is ever in R, so nothing thinner than a few pixels decides what
 *   is drawn: fibres in coverage shimmer and vanish in motion.
 * - G: each fibre's value (the material brightens and darkens the colour by it).
 * - B: noise for the highlight's shift, per fibre.
 * - A: how deep in the fibres a texel lies (ambient occlusion between fibres).
 *
 * Fibres run the whole repeat: they are periodic along v, so a long strand
 * never thins in horizontal bands, and only the strip's tip ends them.
 * Fibres thin out toward each layer's edges, so a strip's outline breaks
 * into fibres. Each layer's mips are made from its own texels only, R's
 * scaled per mip so the share of texels above one half stays mip 0's
 * (coverage-preserving mips, after Castaño): a far strip keeps its
 * coverage instead of fading. Pure: no three.
 */

export const ATLAS_LAYERS = 12
export const ATLAS_TILE_WIDTH = 256
export const ATLAS_HEIGHT = 1024
export const ATLAS_WIDTH = ATLAS_TILE_WIDTH * ATLAS_LAYERS

/**
 * The one table of which atlas layers each kind of strip draws from: its
 * first layer and how many variants follow it. The generator picks a
 * strip's layer with `atlasLayerOf` and the material reads it back, so the
 * two can never number the layers apart.
 */
export const ATLAS_KINDS = {
  dense: { first: 0, count: 3 },
  medium: { first: 3, count: 3 },
  wispy: { first: 6, count: 2 },
  stray: { first: 8, count: 1 },
  curly: { first: 9, count: 2 },
  solid: { first: 11, count: 1 },
} as const

export type AtlasKind = keyof typeof ATLAS_KINDS

/** A strip's atlas layer: its kind's variant at `pick` (0–1, the strip's own random). */
export function atlasLayerOf(kind: AtlasKind, pick: number): number {
  const { first, count } = ATLAS_KINDS[kind]
  return first + Math.min(count - 1, Math.max(0, Math.floor(pick * count)))
}

export function atlasKindOf(layer: number): AtlasKind {
  for (const [kind, { first, count }] of Object.entries(ATLAS_KINDS) as [
    AtlasKind,
    { first: number; count: number },
  ][]) {
    if (layer >= first && layer < first + count) return kind
  }
  throw new Error(`no atlas layer ${layer}`)
}

/** A strip's layer of the hair: inner strips lie flat on the head, the rest face the camera. */
export const STRIP_LAYER = { inner: 0, mid: 1, outer: 2, stray: 3, baby: 4 } as const
export type StripLayer = (typeof STRIP_LAYER)[keyof typeof STRIP_LAYER]

/** `hairShape.z` holds the atlas layer plus this times the strip layer. */
export const LAYER_STRIDE = 16

export const packLayers = (atlasLayer: number, layer: StripLayer) =>
  atlasLayer + LAYER_STRIDE * layer

export function unpackLayers(packed: number): { atlasLayer: number; layer: number } {
  const layer = Math.floor((packed + 0.5) / LAYER_STRIDE)
  return { atlasLayer: Math.round(packed - LAYER_STRIDE * layer), layer }
}

type Spec = {
  locks: [number, number]
  half: [number, number]
  wander: number
  fibres: number
  fibreWidth: [number, number]
  curl: number
}

/**
 * Sub-locks: count and half width (share of the strip), wander along the
 * strand; fibres: count and width (texels); curl turns per repeat.
 */
const SPECS: Record<Exclude<AtlasKind, 'curly'> | 'curlyDense' | 'curlyMedium', Spec> = {
  dense: {
    locks: [7, 8],
    half: [0.07, 0.09],
    wander: 0.012,
    fibres: 96,
    fibreWidth: [1.1, 2.2],
    curl: 0,
  },
  medium: {
    locks: [5, 7],
    half: [0.055, 0.075],
    wander: 0.016,
    fibres: 76,
    fibreWidth: [1.1, 2.1],
    curl: 0,
  },
  wispy: {
    locks: [4, 6],
    half: [0.035, 0.05],
    wander: 0.02,
    fibres: 56,
    fibreWidth: [1, 1.8],
    curl: 0,
  },
  stray: {
    locks: [1, 2],
    half: [0.2, 0.26],
    wander: 0.03,
    fibres: 6,
    fibreWidth: [8, 14],
    curl: 0,
  },
  curlyDense: {
    locks: [6, 7],
    half: [0.07, 0.085],
    wander: 0.045,
    fibres: 90,
    fibreWidth: [1.1, 2.2],
    curl: 8,
  },
  curlyMedium: {
    locks: [4, 6],
    half: [0.055, 0.07],
    wander: 0.05,
    fibres: 70,
    fibreWidth: [1.1, 2],
    curl: 8,
  },
  solid: {
    locks: [1, 1],
    half: [0.47, 0.47],
    wander: 0,
    fibres: 100,
    fibreWidth: [1.1, 2.2],
    curl: 0,
  },
}

type Wave = { amp: number; turns: number; phase: number }

type SubLock = { centre: number; half: number; path: Wave[]; breathe: Wave }

type Fibre = {
  /** The sub-lock it runs in (-1: between them), and where across it (half widths from its middle). */
  lock: number
  offset: number
  centre: number
  path: Wave[]
  width: number
  value: number
  shine: Wave
  shift: number
}

type SpecName = keyof typeof SPECS

type LayerPlan = { kind: SpecName; locks: SubLock[]; fibres: Fibre[] }

function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SINE = Float64Array.from({ length: ATLAS_HEIGHT }, (_, i) =>
  Math.sin((2 * Math.PI * i) / ATLAS_HEIGHT),
)

/** Whole periods over the repeat, so row y and row y + 1024 agree exactly. */
function wave(w: Wave, y: number) {
  const i = (((w.turns * y + w.phase) % ATLAS_HEIGHT) + ATLAS_HEIGHT) % ATLAS_HEIGHT
  return w.amp * SINE[Math.floor(i)]!
}

/** The curly kind's two variants are a dense and a medium curl. */
function specOf(layer: number): SpecName {
  const kind = atlasKindOf(layer)
  if (kind !== 'curly') return kind
  return layer === ATLAS_KINDS.curly.first ? 'curlyDense' : 'curlyMedium'
}

function plan(layer: number): LayerPlan {
  const kind = specOf(layer)
  const spec = SPECS[kind]
  const next = random(0x9e3779b9 ^ Math.imul(layer + 1, 0x85ebca6b))
  const between = (lo: number, hi: number) => lo + (hi - lo) * next()
  const phase = () => Math.floor(next() * ATLAS_HEIGHT)
  const count = Math.round(between(spec.locks[0], spec.locks[1] + 0.999) - 0.5)
  const locks: SubLock[] = []
  for (let i = 0; i < count; i++) {
    const half = between(spec.half[0], spec.half[1])
    // Spread over the strip, a little uneven; the stray's one or two keep to its middle.
    const span = kind === 'stray' ? 0.36 : 0.98 - 2 * half
    const slot = count === 1 ? 0.5 : (i + 0.5) / count
    const centre =
      kind === 'solid'
        ? 0.5
        : 0.5 + (slot - 0.5) * span + (next() - 0.5) * (span / Math.max(count, 2)) * 0.35
    const path: Wave[] = []
    if (spec.wander > 0) {
      path.push({
        amp: spec.wander * between(0.5, 1),
        turns: 1 + Math.floor(next() * 3),
        phase: phase(),
      })
      path.push({
        amp: spec.wander * between(0.2, 0.5),
        turns: 3 + Math.floor(next() * 4),
        phase: phase(),
      })
    }
    if (spec.curl > 0)
      path.push({ amp: spec.wander * between(0.8, 1.2), turns: spec.curl, phase: phase() })
    locks.push({
      centre,
      half,
      path,
      breathe: {
        amp: kind === 'solid' ? 0 : 0.12,
        turns: 1 + Math.floor(next() * 3),
        phase: phase(),
      },
    })
  }
  const fibres: Fibre[] = []
  for (let i = 0; i < spec.fibres; i++) {
    const lock = next() < 0.85 ? Math.floor(next() * locks.length) : -1
    const offset = between(-1.25, 1.25)
    const centre = next()
    const across = lock < 0 ? centre : locks[lock]!.centre + offset * locks[lock]!.half
    // Fewer fibres toward the strip's edges, so its outline breaks up.
    const edge = Math.min(across, 1 - across)
    if (kind !== 'stray' && next() > smoothstep(0, 0.14, edge) + 0.15) continue
    const path: Wave[] = [
      { amp: between(0.001, 0.004), turns: 2 + Math.floor(next() * 5), phase: phase() },
    ]
    if (spec.curl > 0) path.push({ amp: between(0.002, 0.006), turns: spec.curl, phase: phase() })
    fibres.push({
      lock,
      offset,
      centre,
      path,
      width: between(spec.fibreWidth[0], spec.fibreWidth[1]),
      value: between(0.35, 1),
      shine: { amp: 0.15, turns: 1 + Math.floor(next() * 4), phase: phase() },
      shift: next(),
    })
  }
  return { kind, locks, fibres }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

function pathAt(path: readonly Wave[], y: number) {
  let sum = 0
  for (let i = 0; i < path.length; i++) sum += wave(path[i]!, y)
  return sum
}

function layerRow(
  layer: LayerPlan,
  y: number,
  out: Float32Array,
  centres: Float64Array,
  halves: Float64Array,
) {
  const W = ATLAS_TILE_WIDTH
  const curl = SPECS[layer.kind].curl
  const solid = layer.kind === 'solid'
  for (let x = 0; x < W; x++) {
    out[x * 4] = 0
    out[x * 4 + 1] = 0.18
    out[x * 4 + 2] = 0.5
    out[x * 4 + 3] = 0.55
  }
  // R: the sub-locks, a plateau falling off over half a half width either side.
  for (let i = 0; i < layer.locks.length; i++) {
    const lock = layer.locks[i]!
    const c = lock.centre + pathAt(lock.path, y)
    const h = lock.half * (1 + wave(lock.breathe, y))
    centres[i] = c
    halves[i] = h
    const reach = solid ? h + 3 / W : 1.5 * h
    const x0 = Math.max(0, Math.floor((c - reach) * W))
    const x1 = Math.min(W - 1, Math.ceil((c + reach) * W))
    for (let x = x0; x <= x1; x++) {
      const d = Math.abs((x + 0.5) / W - c)
      const r = solid ? clamp01(0.5 + ((h - d) * W) / 3) : clamp01(1.5 - d / h)
      if (r > out[x * 4]!) out[x * 4] = r
    }
  }
  const turn = ((2 * Math.PI) / ATLAS_HEIGHT) * curl * y
  for (let f = 0; f < layer.fibres.length; f++) {
    const fibre = layer.fibres[f]!
    const c =
      (fibre.lock < 0 ? fibre.centre : centres[fibre.lock]! + fibre.offset * halves[fibre.lock]!) +
      pathAt(fibre.path, y)
    let value = fibre.value * (0.85 + wave(fibre.shine, y))
    // A curl's fibres catch the light once per turn.
    if (curl > 0) value *= 0.8 + 0.2 * Math.cos(turn + fibre.offset * 2)
    const ao = 0.82 + 0.18 * fibre.value
    const px = c * W
    const x0 = Math.max(0, Math.floor(px - fibre.width))
    const x1 = Math.min(W - 1, Math.ceil(px + fibre.width))
    for (let x = x0; x <= x1; x++) {
      const t = (x + 0.5 - px) / fibre.width
      if (t * t >= 1) continue
      const p = (1 - t * t) * (1 - t * t)
      const o = x * 4
      out[o + 1] = out[o + 1]! + (value - out[o + 1]!) * p
      out[o + 2] = out[o + 2]! + (fibre.shift - out[o + 2]!) * p
      out[o + 3] = out[o + 3]! + (ao - out[o + 3]!) * p
    }
  }
  // No coverage at the strip's very edge, so a far mip's filter never reaches the next layer's.
  out[0] = 0
  out[4] = 0
  out[(W - 2) * 4] = 0
  out[(W - 1) * 4] = 0
}

const MAX_LOCKS = 8

export function atlasLayerRow(layer: number, y: number): Uint8Array {
  const row = new Float32Array(ATLAS_TILE_WIDTH * 4)
  layerRow(plan(layer), y, row, new Float64Array(MAX_LOCKS), new Float64Array(MAX_LOCKS))
  return Uint8Array.from(row, (v) => Math.round(clamp01(v) * 255))
}

export type AtlasMip = { data: Uint8Array; width: number; height: number }

/** R's share of texels at or above one half (128 of 255) over a layer's columns `[x0, x1)` of a mip. */
export function coverageShare(mip: AtlasMip, x0: number, x1: number): number {
  let above = 0
  for (let y = 0; y < mip.height; y++) {
    for (let x = x0; x < x1; x++) if (mip.data[(y * mip.width + x) * 4]! >= 128) above++
  }
  return above / ((x1 - x0) * mip.height)
}

/**
 * The whole atlas, mip 0 first, down to 1 × 1. A layer's mips come from
 * its own texels until it is a texel wide; below that the layers average
 * together (those levels only show from very far).
 */
export function strandAtlas(): AtlasMip[] {
  const W = ATLAS_TILE_WIDTH
  const H = ATLAS_HEIGHT
  const levels: AtlasMip[] = []
  const top = new Uint8Array(ATLAS_WIDTH * H * 4)
  let coverage: Float32Array[] = []
  const targets: number[] = []
  const row = new Float32Array(W * 4)
  const centres = new Float64Array(MAX_LOCKS)
  const halves = new Float64Array(MAX_LOCKS)
  for (let layer = 0; layer < ATLAS_LAYERS; layer++) {
    const p = plan(layer)
    const r = new Float32Array(W * H)
    let above = 0
    for (let y = 0; y < H; y++) {
      layerRow(p, y, row, centres, halves)
      const o = (y * ATLAS_WIDTH + layer * W) * 4
      for (let x = 0; x < W * 4; x++) {
        const v = row[x]!
        top[o + x] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
      }
      for (let x = 0; x < W; x++) {
        const byte = top[o + x * 4]!
        r[y * W + x] = byte / 255
        if (byte >= 128) above++
      }
    }
    coverage.push(r)
    targets.push(above / r.length)
  }
  levels.push({ data: top, width: ATLAS_WIDTH, height: H })
  let w = W
  let h = H
  // Every level halves both ways (a layer is always taller than it is wide).
  while (w > 1) {
    const prev = levels[levels.length - 1]!
    const nw = w >> 1
    const nh = h >> 1
    const width = nw * ATLAS_LAYERS
    const data = new Uint8Array(width * nh * 4)
    const next: Float32Array[] = []
    for (let layer = 0; layer < ATLAS_LAYERS; layer++) {
      const src = coverage[layer]!
      const r = new Float32Array(nw * nh)
      for (let y = 0; y < nh; y++) {
        const a = y * 2 * w
        const b = a + w
        const pa = (y * 2 * prev.width + layer * w) * 4
        const pb = pa + prev.width * 4
        const o = (y * width + layer * nw) * 4
        for (let x = 0; x < nw; x++) {
          const x2 = x * 2
          r[y * nw + x] = (src[a + x2]! + src[a + x2 + 1]! + src[b + x2]! + src[b + x2 + 1]!) / 4
          for (let ch = 1; ch < 4; ch++) {
            const k = x2 * 4 + ch
            const sum =
              prev.data[pa + k]! +
              prev.data[pa + k + 4]! +
              prev.data[pb + k]! +
              prev.data[pb + k + 4]!
            data[o + x * 4 + ch] = Math.round(sum / 4)
          }
        }
      }
      const scale = coverageScale(r, targets[layer]!)
      for (let y = 0; y < nh; y++) {
        const o = (y * width + layer * nw) * 4
        for (let x = 0; x < nw; x++) {
          const v = r[y * nw + x]! * scale
          data[o + x * 4] = v >= 1 ? 255 : Math.round(v * 255)
        }
      }
      next.push(r)
    }
    levels.push({ data, width, height: nh })
    coverage = next
    w = nw
    h = nh
  }
  // Below a texel per layer: plain averages of the level above, to 1 × 1.
  for (;;) {
    const prev = levels[levels.length - 1]!
    if (prev.width === 1 && prev.height === 1) break
    const width = Math.max(1, prev.width >> 1)
    const height = Math.max(1, prev.height >> 1)
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      // Every texel of the level above lands in exactly one below (an odd last row or column joins the one before).
      const y0 = y * 2
      const y1 = y === height - 1 ? prev.height : y0 + 2
      for (let x = 0; x < width; x++) {
        const x0 = x * 2
        const x1 = x === width - 1 ? prev.width : x0 + 2
        for (let ch = 0; ch < 4; ch++) {
          let sum = 0
          for (let yy = y0; yy < y1; yy++) {
            for (let xx = x0; xx < x1; xx++) sum += prev.data[(yy * prev.width + xx) * 4 + ch]!
          }
          data[(y * width + x) * 4 + ch] = Math.round(sum / ((x1 - x0) * (y1 - y0)))
        }
      }
    }
    levels.push({ data, width, height })
  }
  return levels
}

/**
 * How much to scale a filtered coverage so the share of its texels stored
 * at or above one half (a byte of 128) is `target`, as near as ties allow:
 * the scale that puts one half between the texels ranked either side of it.
 */
function coverageScale(r: Float32Array, target: number): number {
  const sorted = Float32Array.from(r).sort()
  const n = sorted.length
  const keep = Math.round(target * n)
  if (keep <= 0) return 1
  const lowest = sorted[n - keep]!
  if (lowest <= 0) return 1
  const below = keep < n ? sorted[n - keep - 1]! : 0
  // 127.5 / 255 is where a byte rounds up to 128.
  const threshold = below > 0 && below < lowest ? Math.sqrt(below * lowest) : lowest
  return Math.min(8, Math.max(0.25, 0.5 / threshold))
}
