/**
 * Socks and bare feet painted on a body's texture (plain pixels, so it runs
 * in the look worker and tests without a browser): the shoes' texels, found
 * by rasterising their triangles in the texture and placed by where each
 * texel ends up on the foot the shaper (feet.ts) makes of the shoe — shoes
 * are laid out differently on every character's texture, but a toe is
 * always at the front of the foot.
 */

import {
  footTop,
  HEEL_BACK,
  halfWidth,
  smoothstep,
  TOE_ROOT_INSIDE,
  TOE_ROOT_OUTSIDE,
  TOE_TIP,
} from './bare-foot'
import type { AvatarFeet } from './footwear'
import {
  colorDistance,
  deltaE,
  hexToRgb,
  lab,
  luminance,
  type Pixels,
  type Rgb,
} from './look-pixels'

/** One of a body's feet: its triangles are told apart by it. */
export type FootSide = 'left' | 'right'

/**
 * Where a foot stands in the bind pose: its ankle (the foot bone), the back
 * of its heel and its toes' tip, on the ground below them; its axes (unit
 * vectors: `forward` along the ground towards the toes, `outward` across it
 * away from the other foot, `up`); and `length`, the ankle's distance to
 * the ball of the foot along the ground, which the foot's coordinates are
 * measured in (see bare-foot.ts); and how high (in the foot's lengths) its
 * knee is, up to which its leg's triangles are given.
 */
export type FootFrame = {
  side: FootSide
  ankle: [number, number, number]
  heel: [number, number, number]
  toe: [number, number, number]
  forward: [number, number, number]
  outward: [number, number, number]
  up: [number, number, number]
  length: number
  knee: number
}

/**
 * What of a body's triangles a foot's paint needs: `shoe` those of what it
 * wears on its feet, `leg` those of the leg just above (skin, a trouser's
 * hem), which socks reach up over where it is bare.
 */
export type FootPart = 'shoe' | 'leg'

/**
 * One triangle of a foot: where it lies on the texture (`u`, `v`, 0–1) and,
 * at each corner, where it ends up on the foot the shoe is taken in to, in
 * the foot's coordinates (see bare-foot.ts): `along` it and `up`, and `out`
 * across it from its middle line (where its shoe's sole was centred).
 */
export type FootTriangle = {
  side: FootSide
  part: FootPart
  u: number[]
  v: number[]
  along: number[]
  out: number[]
  up: number[]
}

/** A body's feet, packed (see `packFeet`) to cross to the look worker cheaply. */
export type FootGeometry = { triangles: Float32Array; frames: FootFrame[] }

/** Numbers per packed triangle: its side and part, then u, v, along, out and up for each corner. */
const PACKED = 17

const SIDES: readonly FootSide[] = ['left', 'right']
const PARTS: readonly FootPart[] = ['shoe', 'leg']

export function packFeet(triangles: readonly FootTriangle[], frames: FootFrame[]): FootGeometry {
  const packed = new Float32Array(triangles.length * PACKED)
  triangles.forEach((tri, t) => {
    const at = t * PACKED
    packed[at] = SIDES.indexOf(tri.side)
    packed[at + 1] = PARTS.indexOf(tri.part)
    const fields = [tri.u, tri.v, tri.along, tri.out, tri.up]
    fields.forEach((values, f) => {
      for (let c = 0; c < 3; c++) packed[at + 2 + f * 3 + c] = values[c]!
    })
  })
  return { triangles: packed, frames }
}

export function unpackFeet(geometry: FootGeometry): FootTriangle[] {
  const { triangles: packed } = geometry
  const triangles: FootTriangle[] = []
  for (let at = 0; at + PACKED <= packed.length; at += PACKED) {
    const field = (f: number) => [
      packed[at + 2 + f * 3]!,
      packed[at + 3 + f * 3]!,
      packed[at + 4 + f * 3]!,
    ]
    triangles.push({
      side: SIDES[packed[at]!]!,
      part: PARTS[packed[at + 1]!]!,
      u: field(0),
      v: field(1),
      along: field(2),
      out: field(3),
      up: field(4),
    })
  }
  return triangles
}

/**
 * Bare feet's colour where neither the leg nor `skin` shows any (a face
 * behind a balaclava, gloved hands): a light, warm skin tone.
 */
const DEFAULT_SKIN: Rgb = [222, 170, 138]

/** Whether a colour could be skin at all: warm (red over green over blue) and not near black. */
const warm = ([r, g, b]: Rgb) => r >= g && g >= b && r > b && luminance(r, g, b) > 30

/**
 * Whether a texel's colour looks like skin's hue: warm, and with its blue
 * well under its red (tan leather and khaki are warm, but greyer).
 */
const skinHued = (color: Rgb) => warm(color) && color[0] - color[2] > color[0] * 0.2

/** Socks' colour when none is chosen: a soft grey-white. */
export const DEFAULT_SOCK: Rgb = [226, 223, 216]

/**
 * How far up a bare leg (in the foot's lengths, from the ground) a sock
 * reaches — an ordinary crew sock's cuff (see OVER_EDGE) — and how deep its
 * ribbed top band is.
 */
const SOCK_TOP = 1.2
const CUFF_BAND = 0.12

/** How far up (in the foot's lengths) the sole's paler skin, or a sock's greyer sole, wraps. */
const SOLE_UP = 0.035

/**
 * The toes, told apart across the foot by `t`: how far across it a point is
 * as a share of the foot's half-width at the toes' roots (−1 its inside
 * edge, the big toe's; 1 its outside). The gaps between them, and each
 * toe's tip along the foot (as measured off Rocketbox's bare feet, the big
 * toe's the foot's front) and its nail's length.
 */
const TOE_GAPS = [-0.3, 0.1, 0.42, 0.7] as const
const TOES = [
  { tip: TOE_TIP, nail: 0.12 },
  { tip: 1.44, nail: 0.065 },
  { tip: 1.41, nail: 0.06 },
  { tip: 1.37, nail: 0.052 },
  { tip: 1.32, nail: 0.045 },
] as const

/** Half the width (in the foot's lengths) of the dark line between two toes. */
const TOE_GAP = 0.008
/** How much of a toe's width its nail takes, and how far back of its tip the nail's free edge ends. */
const NAIL_WIDTH = 0.62
const NAIL_EDGE = 0.012
/** How much lighter (per channel) the sole's skin is, a little yellower. */
const SOLE_TINT: Rgb = [0.1, 0.08, 0.04]
/** A nail's colour mixed into the skin's, and how much. */
const NAIL: Rgb = [240, 206, 196]
const NAIL_SHARE = 0.35

/**
 * A shoe whose texels are nearly all no further than this from the colour
 * of the leg's skin (see colorDistance) is already a bare foot (see
 * ALREADY_BARE).
 */
const SKIN_NEAR = 0.14
/** Fewer of the leg's skin texels than this, and the feet take the skin's colour as given. */
const LEAST_LEG_SKIN = 24
/** A shoe this much the skin's colour already is a bare foot (Sports_Male_01's): its own skin is kept. */
const ALREADY_BARE = 0.85

/**
 * How far (texels) the original's light and shade is gathered round a texel
 * to keep only its folds and seams under a sock, and how much of that it
 * keeps (a power on its ratio to its surroundings) within what bounds.
 */
const SHADE_RADIUS = 3
const SHADE_POWER = 0.2
const SHADE_RANGE: readonly [number, number] = [0.95, 1.04]

/**
 * A sock's knit: its ribs' spacing (in the foot's lengths) and how much
 * lighter and darker they are, fading out where a texel is too big for
 * them (fewer than KNIT_TEXELS texels a rib: they would alias into stripes).
 */
const KNIT = 0.06
const KNIT_DEPTH = 0.06
const KNIT_TEXELS: readonly [number, number] = [2.5, 4.5]

/** A texel painted: where it is on the foot and how big it is there (in the foot's lengths). */
type Texel = {
  texel: number
  side: FootSide
  part: FootPart
  along: number
  out: number
  up: number
  size: number
}

/**
 * Visits the texel centres a triangle (corners in texels) covers, or comes
 * within `grow` texels of, with barycentric weights clamped onto it (a
 * grown rim takes its edge's values rather than running on past it); but
 * none already `taken`.
 */
function rasterise(
  x: readonly number[],
  y: readonly number[],
  width: number,
  height: number,
  grow: number,
  taken: Uint8Array,
  visit: (texel: number, w0: number, w1: number, w2: number) => void,
) {
  const area = (x[1]! - x[0]!) * (y[2]! - y[0]!) - (x[2]! - x[0]!) * (y[1]! - y[0]!)
  if (Math.abs(area) < 1e-12) return
  // A corner's weight falls below zero by its opposite edge's length over
  // the area per texel past that edge: further past any, and it's out.
  const floor = [
    (-grow * Math.hypot(x[2]! - x[1]!, y[2]! - y[1]!)) / Math.abs(area),
    (-grow * Math.hypot(x[0]! - x[2]!, y[0]! - y[2]!)) / Math.abs(area),
    (-grow * Math.hypot(x[1]! - x[0]!, y[1]! - y[0]!)) / Math.abs(area),
  ]
  const minX = Math.max(0, Math.ceil(Math.min(x[0]!, x[1]!, x[2]!) - grow - 0.5))
  const maxX = Math.min(width - 1, Math.floor(Math.max(x[0]!, x[1]!, x[2]!) + grow - 0.5))
  const minY = Math.max(0, Math.ceil(Math.min(y[0]!, y[1]!, y[2]!) - grow - 0.5))
  const maxY = Math.min(height - 1, Math.floor(Math.max(y[0]!, y[1]!, y[2]!) + grow - 0.5))
  const weights = [0, 0, 0]
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const texel = py * width + px
      if (taken[texel]) continue
      const cx = px + 0.5
      const cy = py + 0.5
      weights[0] = ((x[1]! - cx) * (y[2]! - cy) - (x[2]! - cx) * (y[1]! - cy)) / area
      weights[1] = ((x[2]! - cx) * (y[0]! - cy) - (x[0]! - cx) * (y[2]! - cy)) / area
      weights[2] = 1 - weights[0] - weights[1]
      if (weights[0] < floor[0]! || weights[1] < floor[1]! || weights[2] < floor[2]!) continue
      if (weights[0] < 0 || weights[1] < 0 || weights[2] < 0) {
        // Just outside: the nearest point on the triangle's edges, if near enough.
        let best = Number.POSITIVE_INFINITY
        let [n0, n1, n2] = [0, 0, 0]
        for (let a = 0; a < 3; a++) {
          const b = (a + 1) % 3
          const ex = x[b]! - x[a]!
          const ey = y[b]! - y[a]!
          const along = ((cx - x[a]!) * ex + (cy - y[a]!) * ey) / (ex * ex + ey * ey || 1)
          const t = Math.min(1, Math.max(0, along))
          const distance = Math.hypot(x[a]! + ex * t - cx, y[a]! + ey * t - cy)
          if (distance < best) {
            best = distance
            n0 = a === 0 ? 1 - t : b === 0 ? t : 0
            n1 = a === 1 ? 1 - t : b === 1 ? t : 0
            n2 = a === 2 ? 1 - t : b === 2 ? t : 0
          }
        }
        if (best > grow) continue
        visit(texel, n0, n1, n2)
        continue
      }
      visit(texel, weights[0], weights[1], weights[2])
    }
  }
}

/**
 * The texels of the feet's triangles, each once: first those inside one,
 * then those within a texel of one (so filtering across a texture seam
 * finds the seam's rim painted too), but never one inside another.
 */
function texelsOf(texture: Pixels, triangles: readonly FootTriangle[]): Texel[] {
  const { width, height } = texture
  const seen = new Uint8Array(width * height)
  const texels: Texel[] = []
  const cover = (tri: FootTriangle, grow: number) => {
    const x = tri.u.map((u) => u * width)
    const y = tri.v.map((v) => v * height)
    // How big a texel is on the foot: the triangle's area there over its texels'.
    const e1 = [tri.along[1]! - tri.along[0]!, tri.out[1]! - tri.out[0]!, tri.up[1]! - tri.up[0]!]
    const e2 = [tri.along[2]! - tri.along[0]!, tri.out[2]! - tri.out[0]!, tri.up[2]! - tri.up[0]!]
    const onFoot = Math.hypot(
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    )
    const inTexels = Math.abs((x[1]! - x[0]!) * (y[2]! - y[0]!) - (x[2]! - x[0]!) * (y[1]! - y[0]!))
    const size = Math.sqrt(onFoot / Math.max(inTexels, 1e-9))
    const { along, out, up } = tri
    rasterise(x, y, width, height, grow, seen, (texel, w0, w1, w2) => {
      seen[texel] = 1
      texels.push({
        texel,
        side: tri.side,
        part: tri.part,
        along: along[0]! * w0 + along[1]! * w1 + along[2]! * w2,
        out: out[0]! * w0 + out[1]! * w1 + out[2]! * w2,
        up: up[0]! * w0 + up[1]! * w1 + up[2]! * w2,
        size,
      })
    })
  }
  for (const tri of triangles) cover(tri, 0)
  for (const tri of triangles) cover(tri, 1)
  return texels
}

/**
 * One foot as painted: where its toes' roots are across it (its half-width
 * there, inside and out, as the shaper left it), how far forward its big toe
 * reaches, and the top of the foot along it.
 */
type FootShape = { inside: number; outside: number; front: number; top: (along: number) => number }

/** Stretches along the foot its top is measured over. */
const TOP_STEP = 0.05

function footShape(triangles: readonly FootTriangle[], side: FootSide): FootShape {
  let inside = 0
  let outside = 0
  let front = Number.NEGATIVE_INFINITY
  const tops = new Map<number, number>()
  for (const tri of triangles) {
    if (tri.side !== side || tri.part !== 'shoe') continue
    for (let c = 0; c < 3; c++) {
      const [along, out, up] = [tri.along[c]!, tri.out[c]!, tri.up[c]!]
      front = Math.max(front, along)
      if (along > 0.95 && along < 1.2) {
        inside = Math.max(inside, -out)
        outside = Math.max(outside, out)
      }
      const step = Math.round(along / TOP_STEP)
      tops.set(step, Math.max(tops.get(step) ?? 0, up))
    }
  }
  const template = (inner: boolean) =>
    halfWidth((TOE_ROOT_INSIDE + TOE_ROOT_OUTSIDE) / 2, 0.1, inner)
  const top = (along: number) => {
    const step = along / TOP_STEP
    const [a, b] = [tops.get(Math.floor(step)), tops.get(Math.ceil(step))]
    const found =
      a !== undefined && b !== undefined ? a + (b - a) * (step - Math.floor(step)) : (a ?? b)
    return found !== undefined && found > 0.02 ? found : footTop(along)
  }
  return {
    inside: inside > 0.05 ? inside : template(true),
    outside: outside > 0.05 ? outside : template(false),
    front: Number.isFinite(front) ? Math.min(front, TOE_TIP) : TOE_TIP,
    top,
  }
}

/** A repeatable pseudo-random number (0–1) for a texel, for skin's pores and a knit's fuzz. */
function grain(texel: number) {
  let h = Math.imul(texel ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const gauss = (offset: number, width: number) => Math.exp(-((offset / width) ** 2))

/** Where a texel falls among the toes: which toe, how far across it (−1–1), and how near a gap between toes it is. */
function toeAt(t: number) {
  let toe = 0
  while (toe < TOE_GAPS.length && t > TOE_GAPS[toe]!) toe++
  const from = toe === 0 ? -1.05 : TOE_GAPS[toe - 1]!
  const to = toe === TOE_GAPS.length ? 1.05 : TOE_GAPS[toe]!
  const across = ((t - from) / (to - from)) * 2 - 1
  let gap = Number.POSITIVE_INFINITY
  for (const each of TOE_GAPS) gap = Math.min(gap, Math.abs(t - each))
  return { toe, across, gap, width: to - from }
}

/** The toes' roots along the foot at `t` across it: a line slanting back from the big toe's to the little toe's. */
const toeRoot = (t: number) =>
  TOE_ROOT_INSIDE + ((TOE_ROOT_OUTSIDE - TOE_ROOT_INSIDE) * (t + 1)) / 2

/**
 * A bare foot's texel, as a shade of the skin (its lightness, and how much
 * of a nail's colour it takes): the toes rounded, the gaps between them
 * dark, their knuckles creased and their roots shadowed; the nails on the
 * top of their tips; the sole paler.
 */
function bareTexel(
  texel: Texel,
  shape: FootShape,
  out: { light: number; nail: number; sole: number },
) {
  const { along, up, size } = texel
  const { t, half } = acrossToes(texel, shape)
  const high = up / Math.max(shape.top(along), 0.05)
  const shift = shape.front - TOE_TIP
  let light = 1
  let nail = 0
  const sole = 1 - smoothstep(SOLE_UP * 0.5, SOLE_UP * 1.5, up)
  const root = toeRoot(t) + shift
  if (along > root - 0.06) {
    const toes = smoothstep(root - 0.06, root + 0.02, along)
    const { toe, across, gap, width } = toeAt(t)
    const { tip: nominal, nail: length } = TOES[toe]!
    const tip = nominal + shift
    // Rounded toes, darker into the gaps, which open a little way forward
    // of the toes' roots (the web between them).
    const parted = smoothstep(root + 0.02, root + 0.1, along)
    light *= 1 - 0.16 * toes * across * across
    light *= 1 - 0.26 * parted * gauss(gap * half, Math.max(TOE_GAP * 2, size * 1.2))
    // Where the toes meet the foot: softly shadowed on top, creased underneath.
    light *= 1 - 0.07 * gauss(along - root, 0.035) * smoothstep(0.3, 0.6, high)
    light *= 1 - 0.18 * sole * gauss(along - root, Math.max(TOE_GAP, size))
    // A knuckle's faint crease across each toe, on top.
    const knuckle = root + (tip - root) * (toe === 0 ? 0.5 : 0.42)
    light *= 1 - 0.07 * gauss(along - knuckle, Math.max(0.012, size)) * smoothstep(0.45, 0.7, high)
    // The nail, a rounded oblong on the top of the tip.
    const middle = tip - NAIL_EDGE - length / 2
    const u = across / NAIL_WIDTH
    const v = (along - middle) / (length / 2)
    const inside = 1 - u * u - v ** 4
    const edge = (2 * size) / Math.max(length, width * half * NAIL_WIDTH)
    nail = smoothstep(-edge, edge, inside) * smoothstep(0.45, 0.65, high)
    // A soft line at the nail's root, and its free edge a little lighter.
    light *= 1 - 0.1 * nail * gauss(v + 0.8, 0.3)
    light *= 1 + 0.05 * nail * smoothstep(0.5, 0.95, v)
  }
  // A soft shadow where the foot meets the ground, and the Achilles tendon
  // a little lighter.
  light *= 1 - 0.06 * (1 - smoothstep(0, 0.06, up)) * (1 - sole)
  light *= 1 + 0.04 * gauss(along - (HEEL_BACK + 0.12), 0.08) * smoothstep(0.35, 0.7, up)
  out.light = light
  out.nail = nail
  out.sole = sole
}

/**
 * How far across the toes a texel is, as a share of the foot's half-width
 * at their roots on its side (see TOE_GAPS): the two sides' widths blend
 * across the foot's middle, so the gaps don't jump there.
 */
function acrossToes(texel: Texel, shape: FootShape) {
  const half = shape.inside + (shape.outside - shape.inside) * smoothstep(-0.05, 0.05, texel.out)
  return { t: texel.out / Math.max(half, 1e-3), half }
}

/**
 * Where the foot's knit runs: along it (its ribs across the foot and round
 * its sides), and up the ankle and the leg (its ribs round the leg); how
 * far a texel is along its rib pattern.
 */
function knitAt(texel: Texel, shape: FootShape) {
  const { along, out, up } = texel
  const middle = shape.top(along) * 0.4
  const aroundFoot = Math.atan2(out, up - middle) * 0.3
  const aroundLeg = Math.atan2(out, along + 0.05) * 0.25
  const leg = smoothstep(0.35, 0.6, up) * (1 - smoothstep(0.15, 0.4, along))
  return aroundFoot + (aroundLeg - aroundFoot) * leg
}

/**
 * A sock's texel, as a shade of its colour: its knit's ribs (fading where a
 * texel is too big to show them), its heel and toe knitted denser and so a
 * little darker, its sole greyer, the toes faintly through it, and a
 * shadow near the ground; and on the leg, its ribbed top band under `cuff`
 * (null on the foot).
 */
function sockTexel(texel: Texel, shape: FootShape, cuff: number | null) {
  const { along, up, size } = texel
  const ribs = KNIT_DEPTH * smoothstep(KNIT_TEXELS[0], KNIT_TEXELS[1], KNIT / Math.max(size, 1e-6))
  let light = 1
  const band = cuff === null ? 0 : smoothstep(cuff - CUFF_BAND - 0.01, cuff - CUFF_BAND + 0.01, up)
  light *= 1 + ribs * (1 + band) * Math.cos((2 * Math.PI * knitAt(texel, shape)) / KNIT)
  light *= 1 + 0.06 * (grain(texel.texel) - 0.5)
  const heel = 1 - smoothstep(-0.2, -0.1, along)
  const toeCap = smoothstep(shape.front - 0.28, shape.front - 0.2, along)
  light *= 1 - 0.06 * Math.max(heel * (1 - smoothstep(0.35, 0.45, up)), toeCap)
  light *= 1 - 0.1 * (1 - smoothstep(SOLE_UP * 0.5, SOLE_UP * 1.5, up))
  light *= 1 - 0.06 * (1 - smoothstep(0, 0.1, up))
  const { t, half } = acrossToes(texel, shape)
  const root = toeRoot(t) + shape.front - TOE_TIP
  const parted = smoothstep(root + 0.02, root + 0.1, along)
  light *= 1 - 0.1 * parted * gauss(toeAt(t).gap * half, Math.max(TOE_GAP * 2, size * 1.2))
  // The band's top edge, a little shadowed where it grips the leg.
  if (cuff !== null) light *= 1 - 0.12 * gauss(cuff - up, 0.015)
  return light
}

/** The original texture's lightness, and its lightness gathered round each texel (see SHADE_RADIUS), over the texels painted. */
function shadeOf(texture: Pixels, texels: readonly Texel[]) {
  const { data, width, height } = texture
  let [minX, minY, maxX, maxY] = [width, height, -1, -1]
  for (const { texel } of texels) {
    const x = texel % width
    const y = (texel - x) / width
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const lit = new Float32Array(w * h)
  const weight = new Float32Array(w * h)
  for (const { texel } of texels) {
    const x = (texel % width) - minX
    const y = Math.floor(texel / width) - minY
    const p = texel * 4
    lit[y * w + x] = luminance(data[p]!, data[p + 1]!, data[p + 2]!)
    weight[y * w + x] = 1
  }
  const own = lit.slice()
  for (const values of [lit, weight]) {
    boxBlur(values, w, h, SHADE_RADIUS, 1)
    boxBlur(values, w, h, SHADE_RADIUS, w)
  }
  return (texel: number) => {
    const at = (Math.floor(texel / width) - minY) * w + (texel % width) - minX
    const around = lit[at]! / Math.max(weight[at]!, 1e-6)
    return own[at]! / Math.max(around, 1)
  }
}

/** A running box blur along rows (`stride` 1) or columns (`stride` the row's width), in place. */
function boxBlur(
  values: Float32Array,
  width: number,
  height: number,
  radius: number,
  stride: number,
) {
  const [lines, length, step] = stride === 1 ? [height, width, width] : [width, height, 1]
  const copy = new Float32Array(length)
  for (let l = 0; l < lines; l++) {
    const start = l * step
    for (let i = 0; i < length; i++) copy[i] = values[start + i * stride]!
    let sum = 0
    for (let i = -radius; i <= radius; i++) sum += copy[Math.min(length - 1, Math.max(0, i))]!
    for (let i = 0; i < length; i++) {
      values[start + i * stride] = sum / (2 * radius + 1)
      sum += copy[Math.min(length - 1, i + radius + 1)]! - copy[Math.max(0, i - radius)]!
    }
  }
}

/** The median colour (by lightness) of some texels, or null for none. */
function medianColor(texture: Pixels, texels: readonly number[]): Rgb | null {
  if (texels.length === 0) return null
  const { data } = texture
  const lights = Float32Array.from(texels, (texel) =>
    luminance(data[texel * 4]!, data[texel * 4 + 1]!, data[texel * 4 + 2]!),
  )
  const order = Uint32Array.from(texels, (_, i) => i).sort((a, b) => lights[a]! - lights[b]!)
  return colorAt(texture, texels[order[order.length >> 1]!]!)
}

/** How far above its top edge (in the foot's lengths) the leg's colour is taken, and how far below it the foot eases into it. */
const EDGE_BAND = 0.1

/**
 * How high each foot's shoe meets the bare leg (the middle of the heights
 * where their triangles' corners meet), or null where it meets none.
 */
function edgeHeights(triangles: readonly FootTriangle[]): Record<FootSide, number | null> {
  const key = (tri: FootTriangle, c: number) =>
    `${tri.side}|${tri.along[c]!.toFixed(4)}|${tri.out[c]!.toFixed(4)}|${tri.up[c]!.toFixed(4)}`
  const leg = new Set<string>()
  for (const tri of triangles)
    if (tri.part === 'leg') for (let c = 0; c < 3; c++) leg.add(key(tri, c))
  const heights: Record<FootSide, number[]> = { left: [], right: [] }
  for (const tri of triangles) {
    if (tri.part !== 'shoe') continue
    for (let c = 0; c < 3; c++) if (leg.has(key(tri, c))) heights[tri.side].push(tri.up[c]!)
  }
  const middle = (values: number[]) =>
    values.length === 0 ? null : values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!
  return { left: middle(heights.left), right: middle(heights.right) }
}

/**
 * A knee-high boot's shaft is painted on the leg's own texture, over the
 * shoe's: the leg is the boot's in bands this tall up from the shoe's top
 * edge while each looks much like the one under it (SHAFT_STEP, as
 * deltaE) and not far off the shoe's top (SHAFT_DRIFT) — a boot's own
 * shading drifts slowly; its top against skin, a skirt or tucked-in jeans
 * is a step. One that carries on unchanged to the knee is a trouser leg
 * over a shoe of its colour, not a boot. (A step so slight it is lost in a
 * dark boot's own shading, as a black slouch boot's into dark jeans, goes
 * unseen: the boot's shaft is then left as it is.)
 */
const SHAFT_BAND = 0.15
const SHAFT_STEP = 12
const SHAFT_DRIFT = 25
/** How far down the shoe from its top edge its colour is taken. */
const SHAFT_FROM = 0.3
/** Fewer of the leg's texels than this in a band, and it tells nothing. */
const LEAST_BAND = 8
/**
 * The shortest shaft (in the foot's lengths) taken for one: less is a
 * boot's top carrying on a little way under a trouser leg bloused over it.
 * One reaching nearer the knee than KNEE_GAP is a trouser leg's.
 */
const LEAST_SHAFT = 0.4
const KNEE_GAP = 0.35
/**
 * The widest a shaft is round (its width and depth together, in the foot's
 * lengths): a boot's hugs the calf (even a wellington's comes to under
 * two), a trouser leg hanging over the boot is wider.
 */
const SHAFT_GIRTH = 2
/**
 * Texels no lighter than this (their brightest channel) are left out of the
 * shoe's colour: Rocketbox fills a texture's hidden parts (inside a shoe,
 * under a trouser leg) with black.
 */
const HIDDEN = 6

/**
 * Over a boot's shaft the leg shows bare skin (a knee) where at least
 * KNEE_SHARE of it is warm (see skinHued) and looks no further from the
 * skin than KNEE_SKIN (deltaE): trousers tucked into the boot can share
 * the skin's hue (khaki) or, dark, its lightness (camouflage).
 */
const KNEE_SKIN = 25
const KNEE_SHARE = 0.6

/**
 * The leg by the foot is bare skin (up from a low shoe, or the foot's own
 * top in a pump) when at least this share of it looks it (as over a
 * shaft): khaki trousers, or a firefighter's brown ones on darker skin,
 * can pass for skin in most of their texels, but not in nearly all.
 */
const BARE_LEG = 0.9

/**
 * How far over the shoe's top edge (in the foot's lengths) a sock reaches
 * at least, where the shoe comes further up the leg than a crew sock's
 * cuff (a sandal's ankle strap).
 */
const OVER_EDGE = 0.25

/** A boot's shaft on the leg: its top (in the foot's lengths) and its colour there. */
type Shaft = { top: number; color: Rgb }

/** Whether a colour looks like the skin's: warm, and near it (see KNEE_SKIN). */
function looksLike(skin: Rgb) {
  const [l, a, b] = lab(...skin, [0, 0, 0])
  const own = [0, 0, 0]
  return (color: Rgb) => {
    if (!skinHued(color)) return false
    lab(color[0], color[1], color[2], own)
    return Math.hypot(own[0]! - l!, own[1]! - a!, own[2]! - b!) < KNEE_SKIN
  }
}

/**
 * A foot's boot's shaft, from its texels (the shoe's and the leg's), the
 * height of the shoe's top edge and of the knee; none where the shoe's top
 * is the skin's colour (bare skin by the ankle carries on up the leg).
 */
function shaftOf(
  body: Pixels,
  texels: readonly Texel[],
  edge: number,
  knee: number,
  skin: Rgb,
): Shaft | null {
  const shoe = texels.filter((t) => {
    if (!(t.part === 'shoe' && t.up > edge - SHAFT_FROM && t.up <= edge)) return false
    const p = t.texel * 4
    return Math.max(body.data[p]!, body.data[p + 1]!, body.data[p + 2]!) > HIDDEN
  })
  const start = medianColor(
    body,
    shoe.map((t) => t.texel),
  )
  if (!start || looksLike(skin)(start)) return null
  const bands: Texel[][] = Array.from({ length: Math.ceil((knee - edge) / SHAFT_BAND) }, () => [])
  for (const t of texels) {
    if (t.part === 'leg' && t.up >= edge && t.up < knee) {
      bands[Math.floor((t.up - edge) / SHAFT_BAND)]!.push(t)
    }
  }
  let top = edge
  let previous = start
  const girths: number[] = []
  for (const band of bands) {
    if (band.length < LEAST_BAND) break
    const color = medianColor(
      body,
      band.map((t) => t.texel),
    )!
    if (deltaE(color, previous) > SHAFT_STEP || deltaE(color, start) > SHAFT_DRIFT) break
    top += SHAFT_BAND
    previous = color
    girths.push(spread(band.map((t) => t.out)) + spread(band.map((t) => t.along)))
  }
  if (top < edge + LEAST_SHAFT || top > knee - KNEE_GAP) return null
  if (girths.sort((a, b) => a - b)[girths.length >> 1]! > SHAFT_GIRTH) return null
  return { top, color: previous }
}

/** How widely some values spread: between their twentieth and their twentieth-from-last. */
function spread(values: number[]) {
  values.sort((a, b) => a - b)
  const cut = Math.floor(values.length / 20)
  return values[values.length - 1 - cut]! - values[cut]!
}

/** How far a texel's colour is from `ref` (of lightness `refLum`; see colorDistance). */
const nearColor = (body: Pixels, texel: number, ref: Rgb, refLum: number) =>
  colorDistance(
    body.data[texel * 4]!,
    body.data[texel * 4 + 1]!,
    body.data[texel * 4 + 2]!,
    ref,
    refLum,
  )

const colorAt = (body: Pixels, texel: number): Rgb => {
  const p = texel * 4
  return [body.data[p]!, body.data[p + 1]!, body.data[p + 2]!]
}

/**
 * One foot's texels as its paint sorts them: its shoe's; its boot's shaft
 * on the leg (all of the leg below the shaft's top, and in the band over it
 * what still looks like it); the leg's bare skin where it shows — by the
 * foot up to the socks' cuff, where nearly all of the leg there looks like
 * skin (see BARE_LEG; the rest, a tattoo or a crease's shadow, socks cover
 * too), or over the shaft (a knee), the texels that look like skin; and
 * where socks end on the leg.
 */
function sortTexels(
  body: Pixels,
  texels: readonly Texel[],
  frame: FootFrame,
  edge: number | null,
  skin: Rgb,
) {
  const shoe = texels.filter((t) => t.part === 'shoe')
  const close = looksLike(skin)
  const shaft = edge === null ? null : shaftOf(body, texels, edge, frame.knee, skin)
  const onShaft = (t: Texel) =>
    shaft !== null &&
    t.part === 'leg' &&
    (t.up < shaft.top ||
      (t.up < shaft.top + SHAFT_BAND &&
        deltaE(colorAt(body, t.texel), shaft.color) < SHAFT_STEP * 1.5))
  const skinClose = (t: Texel) => close(colorAt(body, t.texel))
  const cuff = shaft?.top ?? Math.max(SOCK_TOP, (edge ?? 0) + OVER_EDGE)
  let bareLeg: Texel[] = []
  if (shaft) {
    const above = texels.filter(
      (t) =>
        t.part === 'leg' && t.up >= shaft.top + SHAFT_BAND && t.up < shaft.top + 4 * SHAFT_BAND,
    )
    const knee = above.filter(skinClose)
    if (knee.length >= above.length * KNEE_SHARE) bareLeg = knee
  } else {
    const low = texels.filter((t) => t.part === 'leg' && t.up < cuff)
    if (low.length > 0 && low.filter(skinClose).length >= low.length * BARE_LEG) {
      bareLeg = low
    }
  }
  return { shoe, shaft, shafted: texels.filter(onShaft), bareLeg, cuff }
}

/**
 * Paints a body's shoes (on its texture, in place) as `feet` has them:
 * socks in their colour (DEFAULT_SOCK without one) with the knit, the
 * original's folds kept as light and shade, and up a bare leg to a crew
 * sock's cuff (or up a knee-high boot's shaft, to its top); or bare skin,
 * in the colour of the leg's own skin where it shows (`skin` elsewhere: the
 * skin tone chosen, or the character's own), with toes, nails and a paler
 * sole. Shoes, it leaves be; so it does a foot already bare going bare.
 * `geometry` is the body's from `footGeometry` (feet.ts).
 */
export function paintFeet(body: Pixels, geometry: FootGeometry, feet: AvatarFeet, skin: Rgb) {
  if (feet.wear === 'shoes') return
  const triangles = unpackFeet(geometry)
  if (triangles.length === 0) return
  const texels = texelsOf(body, triangles)
  const edges = edgeHeights(triangles)
  for (const frame of geometry.frames) {
    const own = texels.filter((t) => t.side === frame.side)
    const edge = edges[frame.side]
    const sorted = sortTexels(body, own, frame, edge, skin)
    const shape = footShape(triangles, frame.side)
    if (feet.wear === 'bare') paintBare(body, sorted, shape, edge, skin)
    else paintSocks(body, sorted, shape, feet.color ? hexToRgb(feet.color) : DEFAULT_SOCK)
  }
}

/**
 * A foot bare: its shoe (and a boot's shaft) as skin in the leg's own
 * colour, taking the colour of the leg just above the shoe's top edge by it
 * (often shaded there, under the shoe's collar) so the two meet unseen.
 */
function paintBare(
  body: Pixels,
  { shoe, shafted, bareLeg }: ReturnType<typeof sortTexels>,
  shape: FootShape,
  edge: number | null,
  skin: Rgb,
) {
  const own =
    bareLeg.length >= LEAST_LEG_SKIN
      ? medianColor(
          body,
          bareLeg.map((t) => t.texel),
        )
      : null
  const base = own ?? (warm(skin) ? skin : DEFAULT_SKIN)
  const baseLum = luminance(...base)
  const alreadyBare = shoe.filter((t) => nearColor(body, t.texel, base, baseLum) < SKIN_NEAR)
  if (shafted.length === 0 && alreadyBare.length >= shoe.length * ALREADY_BARE) return
  const near = edge === null ? [] : bareLeg.filter((t) => t.up >= edge && t.up < edge + EDGE_BAND)
  const byEdge =
    (near.length >= LEAST_LEG_SKIN / 4 &&
      medianColor(
        body,
        near.map((t) => t.texel),
      )) ||
    base
  const { data } = body
  const paint = { light: 1, nail: 0, sole: 0 }
  const color = [0, 0, 0]
  for (const texel of shoe) {
    bareTexel(texel, shape, paint)
    const toEdge = edge === null ? 0 : smoothstep(edge - EDGE_BAND * 1.5, edge, texel.up)
    const pores = 1 + 0.05 * (grain(texel.texel) - 0.5)
    const p = texel.texel * 4
    for (let c = 0; c < 3; c++) {
      color[c] = base[c]! + (byEdge[c]! - base[c]!) * toEdge
      color[c]! *= 1 + SOLE_TINT[c]! * paint.sole
      color[c]! += (NAIL[c]! - color[c]!) * paint.nail * NAIL_SHARE
      data[p + c] = color[c]! * paint.light * pores
    }
  }
  for (const texel of shafted) {
    const pores = 1 + 0.05 * (grain(texel.texel) - 0.5)
    const p = texel.texel * 4
    for (let c = 0; c < 3; c++) data[p + c] = base[c]! * pores
  }
}

/** A foot in socks: over its shoe, up the bare leg to a crew sock's cuff, or up a boot's shaft to its top. */
function paintSocks(
  body: Pixels,
  { shoe, shaft, shafted, bareLeg, cuff }: ReturnType<typeof sortTexels>,
  shape: FootShape,
  sock: Rgb,
) {
  const covered = [...shoe, ...(shaft ? shafted : bareLeg)]
  if (covered.length === 0) return
  const shade = shadeOf(body, covered)
  const { data } = body
  for (const texel of covered) {
    const kept = Math.min(
      SHADE_RANGE[1],
      Math.max(SHADE_RANGE[0], shade(texel.texel) ** SHADE_POWER),
    )
    const light = sockTexel(texel, shape, texel.part === 'shoe' ? null : cuff) * kept
    const p = texel.texel * 4
    for (let c = 0; c < 3; c++) data[p + c] = sock[c]! * light
  }
}
