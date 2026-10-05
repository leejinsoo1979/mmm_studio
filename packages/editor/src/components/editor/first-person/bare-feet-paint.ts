/**
 * The paint borrowed feet (bare-feet.ts) wear: the donor's own skin, cut
 * out of its texture, toned to the wearer's (its leg's just above a weld,
 * angle by angle round it, or its hands'), or knitted over as a sock; and
 * a sock's cuff carried on up a bare leg on the body's texture. Plain
 * pixels, so it runs in the look worker and in tests.
 */

import {
  type BodyBind,
  type FootFrame,
  middleColour,
  type Ring,
  ringAngle,
  ringHeight,
  skinHued,
  toFoot,
} from './bare-feet'
import { fromLab, luminance, type Pixels, type Rgb, toLab, toneSkin } from './look-pixels'

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** Triangles with texture coordinates, in the bind pose: a piece, or some of a body's. */
export type Surface = {
  positions: ArrayLike<number>
  uvs: ArrayLike<number>
  index: ArrayLike<number>
}

/**
 * A texel a surface covers: where it is on the foot (`a`, `o`, `u`, its
 * coordinates), how far above the ring it is there (`rise`, negative below;
 * −∞ without a ring) and its angle round it, and how big a texel is there
 * (in the foot's lengths).
 */
export type Texel = {
  texel: number
  a: number
  o: number
  u: number
  rise: number
  theta: number
  size: number
}

/** How far below the ring a texel is (in the foot's lengths). */
export const depthOf = (texel: Texel) => Math.max(0, -texel.rise)

/**
 * The texels a surface's triangles cover on a `width` × `height` texture,
 * and those up to `grow` texels past their edges (so filtering at the edge
 * reads the paint too), each placed on its foot (see Texel). A texel inside
 * a triangle is placed by it, not by a neighbour it is grown from.
 */
export function texelsOf(
  width: number,
  height: number,
  surface: Surface,
  frame: FootFrame,
  ring: Ring | null,
  grow = 2,
): Texel[] {
  const { positions, uvs, index } = surface
  const out: Texel[] = []
  const taken = new Uint8Array(width * height)
  const coordinates = new Map<number, number[]>()
  const at = (i: number) => {
    let found = coordinates.get(i)
    if (!found) {
      found = toFoot(frame, positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!)
      coordinates.set(i, found)
    }
    return found
  }
  const weights = [0, 0, 0]
  for (const pass of [0, 1]) {
    for (let t = 0; t < index.length; t += 3) {
      const tri = [index[t]!, index[t + 1]!, index[t + 2]!]
      const x = tri.map((i) => uvs[i * 2]! * width - 0.5)
      const y = tri.map((i) => uvs[i * 2 + 1]! * height - 0.5)
      const area = (x[1]! - x[0]!) * (y[2]! - y[0]!) - (x[2]! - x[0]!) * (y[1]! - y[0]!)
      if (Math.abs(area) < 1e-9) continue
      const c = tri.map(at)
      const onFoot = Math.hypot(c[1]![0]! - c[0]![0]!, c[1]![1]! - c[0]![1]!, c[1]![2]! - c[0]![2]!)
      const onTexture = Math.hypot(x[1]! - x[0]!, y[1]! - y[0]!)
      const size = onTexture > 1e-6 ? onFoot / onTexture : 0.01
      const reach = pass === 0 ? 0 : grow
      const minX = Math.max(0, Math.floor(Math.min(...x) - reach))
      const maxX = Math.min(width - 1, Math.ceil(Math.max(...x) + reach))
      const minY = Math.max(0, Math.floor(Math.min(...y) - reach))
      const maxY = Math.min(height - 1, Math.ceil(Math.max(...y) + reach))
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const texel = py * width + px
          if (taken[texel]) continue
          weights[0] = ((x[1]! - px) * (y[2]! - py) - (x[2]! - px) * (y[1]! - py)) / area
          weights[1] = ((x[2]! - px) * (y[0]! - py) - (x[0]! - px) * (y[2]! - py)) / area
          weights[2] = 1 - weights[0] - weights[1]
          if (pass === 0 && Math.min(weights[0], weights[1], weights[2]) < 0) continue
          if (pass === 1) {
            // Placed at the nearest point of the triangle's edges.
            let best = Number.POSITIVE_INFINITY
            for (const [i, j] of [
              [0, 1],
              [1, 2],
              [2, 0],
            ] as const) {
              const dx = x[j]! - x[i]!
              const dy = y[j]! - y[i]!
              const s = Math.min(
                1,
                Math.max(0, ((px - x[i]!) * dx + (py - y[i]!) * dy) / (dx * dx + dy * dy || 1)),
              )
              const d = Math.hypot(x[i]! + dx * s - px, y[i]! + dy * s - py)
              if (d < best) {
                best = d
                weights.fill(0)
                weights[i] = 1 - s
                weights[j] = s
              }
            }
            if (best > grow) continue
          }
          taken[texel] = 1
          const point = [0, 1, 2].map(
            (k) => c[0]![k]! * weights[0]! + c[1]![k]! * weights[1]! + c[2]![k]! * weights[2]!,
          )
          const theta = ring ? ringAngle(ring, point) : 0
          out.push({
            texel,
            a: point[0]!,
            o: point[1]!,
            u: point[2]!,
            rise: ring ? point[2]! - ringHeight(ring, theta) : Number.NEGATIVE_INFINITY,
            theta,
            size,
          })
        }
      }
    }
  }
  return out
}

const colourOf = (pixels: Pixels, texel: number): Rgb => [
  pixels.data[texel * 4]!,
  pixels.data[texel * 4 + 1]!,
  pixels.data[texel * 4 + 2]!,
]

/** The middle colour (by lightness) of some texels, or null for none. */
export const medianColour = (pixels: Pixels, texels: readonly number[]) =>
  middleColour(texels.map((texel) => colourOf(pixels, texel)))

/** How many stretches round the ring colours are taken by. */
const BINS = 12
const binOf = (theta: number) =>
  ((Math.floor(((theta + Math.PI) / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS

/**
 * Some texels' middle colours by angle round the ring: a stretch with none
 * takes its nearest neighbour's, and each is smoothed with the two beside
 * it. Null when there are none at all.
 */
export function byAngle(pixels: Pixels, texels: readonly Texel[]): Rgb[] | null {
  const bins: number[][] = Array.from({ length: BINS }, () => [])
  for (const texel of texels) bins[binOf(texel.theta)]!.push(texel.texel)
  const middles = bins.map((bin) => medianColour(pixels, bin))
  if (middles.every((middle) => middle === null)) return null
  for (let k = 0; k < BINS; k++) {
    if (middles[k]) continue
    for (let d = 1; d < BINS; d++) {
      const found = middles[(k + d) % BINS] ?? middles[(k - d + BINS) % BINS]
      if (found) {
        middles[k] = found
        break
      }
    }
  }
  return middles.map(
    (_, k) =>
      [0, 1, 2].map(
        (c) =>
          (middles[(k + BINS - 1) % BINS]![c]! +
            2 * middles[k]![c]! +
            middles[(k + 1) % BINS]![c]!) /
          4,
      ) as Rgb,
  )
}

/** A colour by angle (see byAngle) at an angle, between its stretches' middles. */
export function angleColour(bins: readonly Rgb[], theta: number): Rgb {
  const x = ((theta + Math.PI) / (2 * Math.PI)) * BINS - 0.5
  const k = Math.floor(x)
  const t = x - k
  const a = bins[((k % BINS) + BINS) % BINS]!
  const b = bins[(((k + 1) % BINS) + BINS) % BINS]!
  return [0, 1, 2].map((c) => a[c]! + (b[c]! - a[c]!) * t) as Rgb
}

/** A colour toned as toneSkin tones a texel of it wholly under its mask. */
export function tonedColour(colour: Rgb, skin: Rgb, ref: Rgb): Rgb {
  const one: Pixels = {
    data: new Uint8ClampedArray([colour[0], colour[1], colour[2], 255]),
    width: 1,
    height: 1,
  }
  toneSkin(one, skin, ref, new Float32Array([1]))
  return colourOf(one, 0)
}

/** How far down from a weld (in the foot's lengths) the foot's colour is matched to the leg's above it. */
const MATCH_FADE = 0.45
/**
 * How far round each texel (in the foot's lengths, and at most in texels)
 * the foot's own colour is taken, to match: its broad colour, not its
 * veins and creases, nor the next texture island's.
 */
const MATCH_REACH = 0.08
const MATCH_TEXELS = 12

/**
 * A bare foot: the donor's skin under `texels` toned to `skin` (from its
 * own middle colour, so its light and shade, veins and nails stay); then,
 * where it is welded to a bare leg, its broad colour round each texel
 * pulled to the leg's just above the weld at that angle (`leg`, see
 * byAngle), fading out down the foot — the two meet without a line, and a
 * seam of the donor's own texture islands by the weld (its leg's and its
 * foot's, toned apart) goes with it.
 */
export function paintBare(
  pixels: Pixels,
  texels: readonly Texel[],
  skin: Rgb,
  leg: readonly Rgb[] | null,
) {
  const own = medianColour(
    pixels,
    texels.map((texel) => texel.texel),
  )
  if (!own) return
  const { width, height } = pixels
  const mask = new Float32Array(width * height)
  for (const texel of texels) mask[texel.texel] = 1
  toneSkin(pixels, skin, own, mask)
  if (!leg) return
  // Running sums of the toned texels (and their count) over the texture,
  // for each texel's broad colour.
  const stride = width + 1
  const sums = Array.from({ length: 4 }, () => new Float64Array(stride * (height + 1)))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const texel = y * width + x
      const at = (y + 1) * stride + x + 1
      for (let c = 0; c < 4; c++) {
        const value = mask[texel] ? (c === 3 ? 1 : pixels.data[texel * 4 + c]!) : 0
        sums[c]![at] =
          value + sums[c]![at - 1]! + sums[c]![at - stride]! - sums[c]![at - stride - 1]!
      }
    }
  }
  const broad = (texel: number, reach: number) => {
    const x = texel % width
    const y = (texel - x) / width
    const x0 = Math.max(0, x - reach)
    const y0 = Math.max(0, y - reach)
    const x1 = Math.min(width, x + reach + 1)
    const y1 = Math.min(height, y + reach + 1)
    const box = (c: number) =>
      sums[c]![y1 * stride + x1]! -
      sums[c]![y0 * stride + x1]! -
      sums[c]![y1 * stride + x0]! +
      sums[c]![y0 * stride + x0]!
    const n = box(3)
    return [0, 1, 2].map((c) => box(c) / Math.max(n, 1))
  }
  // Moved in Lab by the difference, so a dark tone's strong hue is matched
  // as well as its lightness.
  const changes: [number, number[]][] = []
  const want = [0, 0, 0]
  const have = [0, 0, 0]
  const lab = [0, 0, 0]
  for (const texel of texels) {
    const weight = 1 - smoothstep(0, MATCH_FADE, depthOf(texel))
    if (weight <= 0) continue
    const reach = Math.max(
      1,
      Math.min(MATCH_TEXELS, Math.round(MATCH_REACH / Math.max(texel.size, 1e-6))),
    )
    toLab(...angleColour(leg, texel.theta), want)
    const [r, g, b] = broad(texel.texel, reach)
    toLab(r!, g!, b!, have)
    const p = texel.texel * 4
    toLab(pixels.data[p]!, pixels.data[p + 1]!, pixels.data[p + 2]!, lab)
    const rgb = [0, 0, 0]
    fromLab(
      lab[0]! + (want[0]! - have[0]!) * weight,
      lab[1]! + (want[1]! - have[1]!) * weight,
      lab[2]! + (want[2]! - have[2]!) * weight,
      rgb,
    )
    changes.push([p, rgb])
  }
  for (const [p, rgb] of changes) pixels.data.set(rgb, p)
}

/** Socks' colour when none is chosen: a soft grey-white. */
export const DEFAULT_SOCK: Rgb = [226, 223, 216]

/**
 * How far up a bare leg (in the foot's lengths, from the ground) a sock
 * reaches — an ordinary crew sock's cuff — and how deep its ribbed top
 * band is.
 */
export const SOCK_TOP = 1.2
const CUFF_BAND = 0.12

/**
 * A sock's knit: its ribs' spacing (in the foot's lengths) and how much
 * lighter and darker they are, fading out where a texel is too big for
 * them (fewer than KNIT_TEXELS texels a rib: they would alias into stripes).
 */
const KNIT = 0.06
const KNIT_DEPTH = 0.06
const KNIT_TEXELS: readonly [number, number] = [2.5, 4.5]

/** How far (texels) the light and shade under a sock is gathered, so only its broad shading stays. */
const SHADE_RADIUS = 5

const gauss = (offset: number, width: number) => Math.exp(-((offset / width) ** 2))

/** A repeatable pseudo-random number (0–1) for a texel: a knit's fuzz. */
function grain(texel: number) {
  let h = Math.imul(texel, 2654435761) >>> 0
  h ^= h >>> 15
  return (h % 1000) / 1000
}

/**
 * A sock knitted over `texels` below `cuff` (in the foot's lengths; null,
 * all of them): its ribs running round the foot and on up round the leg,
 * running out before the toe's front at `front` (where they would all meet
 * at a point: a sock's toe is knitted across); a ribbed band under the
 * cuff; the heel and toe a shade darker; the broad light and shade of what
 * was there kept a little (a toe's gaps and nails not).
 */
export function paintSock(
  pixels: Pixels,
  texels: readonly Texel[],
  sock: Rgb,
  cuff: number | null,
  front: number,
) {
  const { width } = pixels
  const lightness = new Map<number, number>()
  for (const texel of texels) {
    const p = texel.texel * 4
    lightness.set(texel.texel, luminance(pixels.data[p]!, pixels.data[p + 1]!, pixels.data[p + 2]!))
  }
  let mean = 0
  for (const value of lightness.values()) mean += value
  mean /= Math.max(1, lightness.size)
  const broad = (texel: number) => {
    let sum = 0
    let n = 0
    const x = texel % width
    const y = (texel - x) / width
    for (let dy = -SHADE_RADIUS; dy <= SHADE_RADIUS; dy++) {
      for (let dx = -SHADE_RADIUS; dx <= SHADE_RADIUS; dx++) {
        const value = lightness.get((y + dy) * width + x + dx)
        if (value !== undefined) {
          sum += value
          n++
        }
      }
    }
    return n ? sum / n : mean
  }
  const painted = texels.map((texel) => {
    const cover = cuff === null ? 1 : 1 - smoothstep(cuff - texel.size, cuff + texel.size, texel.u)
    if (cover <= 0) return null
    const ribs =
      KNIT_DEPTH *
      smoothstep(KNIT_TEXELS[0], KNIT_TEXELS[1], KNIT / Math.max(texel.size, 1e-6)) *
      (1 - smoothstep(front - 0.3, front - 0.12, texel.a))
    const aroundFoot = Math.atan2(texel.o, texel.u - 0.16) * 0.3
    const aroundLeg = Math.atan2(texel.o, texel.a + 0.05) * 0.25
    const onLeg = smoothstep(0.35, 0.6, texel.u) * (1 - smoothstep(0.15, 0.4, texel.a))
    const knit = aroundFoot + (aroundLeg - aroundFoot) * onLeg
    const band =
      cuff === null ? 0 : smoothstep(cuff - CUFF_BAND - 0.01, cuff - CUFF_BAND + 0.01, texel.u)
    let light = 1 + ribs * (1 + band) * Math.cos((2 * Math.PI * knit) / KNIT)
    light *= 1 + 0.06 * (grain(texel.texel) - 0.5)
    const heel = (1 - smoothstep(-0.2, -0.1, texel.a)) * (1 - smoothstep(0.35, 0.45, texel.u))
    const toeCap = smoothstep(front - 0.3, front - 0.2, texel.a)
    light *= 1 - 0.06 * Math.max(heel, toeCap)
    light *= 1 - 0.1 * (1 - smoothstep(0.02, 0.05, texel.u))
    light *= 1 - 0.06 * (1 - smoothstep(0, 0.1, texel.u))
    if (cuff !== null) light *= 1 - 0.12 * gauss(cuff - texel.u, 0.015)
    const shade = Math.min(1.05, Math.max(0.85, (broad(texel.texel) / Math.max(mean, 1)) ** 0.5))
    return { texel: texel.texel, cover, light: light * shade }
  })
  for (const each of painted) {
    if (!each) continue
    const p = each.texel * 4
    for (let c = 0; c < 3; c++) {
      pixels.data[p + c] =
        pixels.data[p + c]! + (sock[c]! * each.light - pixels.data[p + c]!) * each.cover
    }
  }
}

/** How much of a point's skin is on the hands for it to count as the hands'. */
const ON_HANDS = 0.9

/** The middle colour under a body's hands (its points skinned to the hands' and fingers' bones), when it is a skin's (not a glove's). */
export function handsColour(bind: BodyBind, body: Pixels): Rgb | null {
  const onHand = bind.bones.map((name) => /_(Hand|Finger)/i.test(name.replace(/ /g, '_')))
  const texels: number[] = []
  for (let i = 0; i < bind.positions.length / 3; i++) {
    let sum = 0
    for (let k = 0; k < 4; k++) if (onHand[bind.joints[i * 4 + k]!]) sum += bind.weights[i * 4 + k]!
    if (sum <= ON_HANDS) continue
    const x = Math.min(body.width - 1, Math.floor(bind.uvs[i * 2]! * body.width))
    const y = Math.min(body.height - 1, Math.floor(bind.uvs[i * 2 + 1]! * body.height))
    texels.push(y * body.width + x)
  }
  const found = medianColour(body, texels)
  return found && skinHued(found) ? found : null
}
