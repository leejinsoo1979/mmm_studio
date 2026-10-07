import { PAINTED, READ, SCALP, type ScalpPaint, SHADED, SKIN_REF, wigFringe } from './bald-head'
import { rasterise } from './front-render'
import { cellHash, PointGrid, SKULL_CELL, smoothstep, valueNoise } from './head-skull'
import { byLightness, luminance, type Pixels, type Rgb } from './look-pixels'

/**
 * A bald head's skin round the cut its hair was taken out along (see
 * bald-head.ts), painted to the scalp's tone so it meets the bald surface
 * without a seam: the skin under the old hairline (a forehead painted
 * darker there, a nape or temples painted with hair) and any of the hair's
 * colour left on the skin. The bald surface shows the texels the hair did,
 * painted wholly, plain. Near the skin kept, both take its colour — the
 * cheek's by a cheek, the neck's down the nape — and the forehead's tone
 * further off — grained as skin is. And the body's texture, lit again
 * where the hair shaded it.
 */

/** Numbers per corner of a triangle packed for painting, and of the bald surface's. */
const PAINTED_CORNER = PAINTED / 3
const SCALP_CORNER = SCALP / 3

/** Texels round a painted triangle (px) painted with it, so no seam shows at a UV island's rim. */
const MARGIN = 1

/** Where a texel counts as hair to paint over (its hair mask), fully from the second. */
const HAIR_FROM = 0.25
const HAIR_TO = 0.6

/**
 * A texel read for the scalp's tone is the skin's: no more than HAIR_MOST
 * hair and at least SKIN_LEAST skin; LEAST_READ of them must be found.
 */
const HAIR_MOST = 0.2
const SKIN_LEAST = 0.5
const LEAST_READ = 50

/**
 * Where in the forehead's skin, darkest first, the scalp's tone is read: a
 * little under the middle, the light catching a forehead's painted shine
 * that a scalp under it doesn't.
 */
const TONE_QUANTILE = 0.4

/** A steady pseudo-random number in [0, 1) for a texel. */
function hash(x: number, y: number, seed: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * The bald surface's grain, by where it is (bind units), not by its
 * texels, which lie along the hair's strands and would streak it: a fine
 * grain SKIN_FINE_CELL across, as the forehead's skin strays texel by texel
 * from the skin round it (about 7% of its lightness, over a few
 * millimetres), and a faint mottle SKIN_MOTTLE_CELL across. Without it the
 * scalp is one flat tone beside a face that isn't: rubber, not skin.
 */
const SKIN_FINE_CELL = 0.004
const SKIN_FINE = 0.05
const SKIN_MOTTLE_CELL = 0.02
const SKIN_MOTTLE = 0.06

/** How much lighter or darker skin is at a place on the bald surface (see SKIN_FINE_CELL). */
export const skinGrain = (x: number, y: number, z: number) =>
  1 +
  SKIN_FINE * valueNoise(x, y, z, SKIN_FINE_CELL, 7) +
  SKIN_MOTTLE * valueNoise(x, y, z, SKIN_MOTTLE_CELL, 11)

/** Calls `visit` with each texel of `head` a packed triangle covers (corners' u, v at `at`, `stride` apart). */
function eachTexel(
  head: { width: number; height: number },
  packed: Float32Array,
  t: number,
  size: number,
  stride: number,
  visit: (texel: number, w0: number, w1: number, w2: number) => void,
  margin = MARGIN,
) {
  const at = t * size
  rasterise(
    packed[at]! * head.width,
    packed[at + 1]! * head.height,
    packed[at + stride]! * head.width,
    packed[at + stride + 1]! * head.height,
    packed[at + 2 * stride]! * head.width,
    packed[at + 2 * stride + 1]! * head.height,
    head.width,
    head.height,
    margin,
    visit,
  )
}

/**
 * The skin round the cut a corner's colour comes from is no darker than
 * this share of the scalp's tone: darker, it is the old hair's shadow
 * painted on it — under the occiput, behind the ears — and the bald head
 * would be stained with it.
 */
const SHADOWED = 0.88

/** How far round (px, on a 2048 texture) the skin a corner's colour comes from is read, and how much of what is there must be skin. */
const SKIN_READ = 4
const SKIN_SHARE = 0.3

/** How far (bind units) a borrowed hairline is looked for round a place: past it, it has no stubble from it. */
const WIG_REACH = 0.03

const sameValues = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.prototype.every.call(a, (value, i) => value === b[i])

/**
 * Painted skin keeps the skin's fine grain — pores, freckles, its light and
 * shade texel by texel — as each texel strays in lightness from the mean
 * of those within DETAIL_REACH texels (on a 2048 texture) round it: its
 * own, where it is skin, else a texel of the forehead's picked by it (on
 * the bald surface by where it is, in cells DETAIL_CELL across). Painted
 * one flat colour, it is rubber beside the face. No more than DETAIL_MOST
 * lighter or darker.
 */
const DETAIL_REACH = 4
const DETAIL_CELL = 0.0004
const DETAIL_MOST = 0.25

/**
 * Each painted texel's (`texels`) fine grain, from `head` as it is (see
 * DETAIL_REACH): its own where `own`, else the `pick`-th share of the way
 * through the forehead's (the first of `forehead`'s lists holding
 * LEAST_READ texels); none where there is none.
 */
function fineGrain(
  head: Pixels,
  texels: Int32Array,
  own: Uint8Array,
  picks: Float32Array,
  forehead: number[][],
): Float32Array {
  const { width, height, data } = head
  const reach = Math.max(1, Math.round((DETAIL_REACH * width) / 2048))
  const pool = forehead.find((list) => list.length >= LEAST_READ) ?? []
  // Only the texels these lie among are read.
  let [left, top, right, bottom] = [width, height, -1, -1]
  for (const list of [texels, pool]) {
    for (const texel of list) {
      const x = texel % width
      const y = (texel - x) / width
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  const grains = new Float32Array(texels.length).fill(1)
  if (right < left) return grains
  left = Math.max(0, left - reach)
  top = Math.max(0, top - reach)
  const across = Math.min(width, right + reach + 1) - left
  const down = Math.min(height, bottom + reach + 1) - top
  const lightness = new Float32Array(across * down)
  for (let y = 0; y < down; y++) {
    for (let x = 0; x < across; x++) {
      const p = ((top + y) * width + left + x) * 4
      lightness[y * across + x] = luminance(data[p]!, data[p + 1]!, data[p + 2]!)
    }
  }
  const sums = boxSums(lightness, across, down, 1, reach)
  const counts = boxSums(new Float32Array(across * down).fill(1), across, down, 1, reach)
  const strayOf = (texel: number) => {
    const x = (texel % width) - left
    const y = Math.floor(texel / width) - top
    const at = y * across + x
    const mean = sums[at]! / counts[at]!
    return Math.min(1 + DETAIL_MOST, Math.max(1 - DETAIL_MOST, lightness[at]! / Math.max(1, mean)))
  }
  const strays = Float32Array.from(pool, strayOf)
  for (let i = 0; i < texels.length; i++) {
    if (own[i]) grains[i] = strayOf(texels[i]!)
    else if (strays.length > 0) grains[i] = strays[Math.floor(picks[i]! * strays.length)]!
  }
  return grains
}

/**
 * Where the head's own hair was painted on the skin it keeps — a sideburn,
 * the nape — its stubble is as thick as the hair was within HAIRLINE_BLUR
 * texels (on a 2048 texture) round: read texel by texel, it would be
 * scratched in along each strand.
 */
const HAIRLINE_BLUR = 6

/** A mask (`width` × `height`) averaged over the box `reach` texels round each texel. */
function blurred(mask: Float32Array, width: number, height: number, reach: number) {
  const sums = boxSums(mask, width, height, 1, reach)
  return Float32Array.from(sums, (sum, i) => {
    const x = i % width
    const y = (i - x) / width
    // At the texture's edges the box holds fewer texels.
    const across = Math.min(width - 1, x + reach) - Math.max(0, x - reach) + 1
    const down = Math.min(height - 1, y + reach) - Math.max(0, y - reach) + 1
    return sum / (across * down)
  })
}

/** How many texels out from what is painted the texels on no triangle take its colour. */
const PAD = 4
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

/**
 * Each place's skin colour is the mean of those read within this (bind
 * units) of it, nearer ones more: one pore, a stubbled patch or a place too
 * little of which is skin doesn't stand out.
 */
const SKIN_BLEND = 0.02

/**
 * Stubble shows as the hair's colour through the skin, greyed (STUBBLE_GREY
 * of the way to its own lightness), a little darker and cooler — the skin
 * over it scatters blue — and more as the hair is darker than the skin:
 * over at most STUBBLE_DARK of the skin where it is thickest, at least
 * STUBBLE_FAINT of that for hair as fair as the skin. Each texel shows
 * SPECKLE more or less of it (its own hairs), never more than STUBBLE_MOST.
 * On the bald surface its hairs are STUBBLE_GRAIN (bind units) apart.
 */
const STUBBLE_GREY = 0.4
const STUBBLE_DARKER = 0.85
const STUBBLE_COOL: Rgb = [0.94, 1, 1.08]
const STUBBLE_DARK = 0.42
const STUBBLE_FAINT = 0.3
const SPECKLE = 0.4
const STUBBLE_MOST = 0.8
const STUBBLE_GRAIN = 0.0004

/** Stubble's colour over skin of the scalp's `tone`, from the hair's, and how much of it shows at its thickest. */
export function stubbleShade(hair: Rgb, tone: Rgb): [Rgb, number] {
  const grey = luminance(...hair)
  const colour = hair.map(
    (value, c) => (value + (grey - value) * STUBBLE_GREY) * STUBBLE_DARKER * STUBBLE_COOL[c]!,
  ) as unknown as Rgb
  const skin = Math.max(1, luminance(...tone))
  const contrast = Math.min(1, Math.max(0, (skin - grey) / skin))
  return [colour, STUBBLE_DARK * (STUBBLE_FAINT + (1 - STUBBLE_FAINT) * contrast)]
}

/**
 * Paints a bald head's skin round the cut and the bald surface (see
 * `ScalpPaint`), on textures `width` × `height` whose hair and skin are
 * `hair` and `skin` (per texel, how surely it is either). Which texels it
 * reads and paints, and how much of each, are worked out once: a skin
 * tone's drag paints the same head over and over in a new colour.
 */
export type ScalpPainter = {
  /**
   * The scalp's tone: a colour of the skin (see TONE_QUANTILE) under the
   * first of the paint's lists of triangles to read that shows enough of
   * it. Null where none does.
   */
  tone: (head: Pixels) => Rgb | null
  /**
   * Paints the head (in place): each texel of the paint's triangles as much
   * as its corners say, and wholly where it is the hair's colour; the bald
   * surface's wholly. Each in the colour of the skin round it where there
   * is skin near (read off `head` as it is), `tone` elsewhere; grained like
   * skin. Then, given the colour of the hair worn (`stubble`), the
   * stubble a shaved head shows where its hair grew (see `stubbleShade`)
   * — or, under another's hair (`wig`: where it shows, bind-pose points),
   * round that hair's hairline alone (see bald-head.ts's `wigFringe`).
   */
  paint: (head: Pixels, tone: Rgb, stubble?: Rgb | null, wig?: Float32Array | null) => void
}

export function scalpPainter(
  width: number,
  height: number,
  {
    paint,
    scalp,
    kept,
    taken,
    tone,
    skin: refs,
  }: Pick<ScalpPaint, 'paint' | 'scalp' | 'kept' | 'taken' | 'tone' | 'skin'>,
  hair: Float32Array | null,
  skin: Float32Array | null,
): ScalpPainter {
  const size = { width, height }
  const isSkin = (texel: number) =>
    !((hair && hair[texel]! > HAIR_MOST) || (skin && skin[texel]! < SKIN_LEAST))
  const foreheads = tone.map((list) => {
    const seen = new Uint8Array(width * height)
    const texels: number[] = []
    for (let t = 0; t < list.length / READ; t++) {
      eachTexel(size, list, t, READ, 2, (texel) => {
        if (seen[texel]) return
        seen[texel] = 1
        if (isSkin(texel)) texels.push(texel)
      })
    }
    return texels
  })

  // Each corner's skin round it and how much, the paint's triangles' first.
  const paintCount = paint.length / PAINTED
  const scalpCount = scalp.length / SCALP
  const cornerRef = new Int32Array((paintCount + scalpCount) * 3)
  const cornerShare = new Float32Array(cornerRef.length)
  for (let t = 0; t < paintCount; t++) {
    for (let k = 0; k < 3; k++) {
      cornerRef[t * 3 + k] = paint[t * PAINTED + k * PAINTED_CORNER + 3]!
      cornerShare[t * 3 + k] = paint[t * PAINTED + k * PAINTED_CORNER + 4]!
    }
  }
  for (let t = 0; t < scalpCount; t++) {
    for (let k = 0; k < 3; k++) {
      cornerRef[(paintCount + t) * 3 + k] = scalp[t * SCALP + k * SCALP_CORNER + 2]!
      cornerShare[(paintCount + t) * 3 + k] = scalp[t * SCALP + k * SCALP_CORNER + 3]!
    }
  }

  const amount = new Float32Array(width * height)
  const owner = new Int32Array(width * height).fill(-1)
  const first = new Float32Array(width * height)
  const second = new Float32Array(width * height)
  for (let t = 0; t < paintCount; t++) {
    const at = t * PAINTED
    const corner = (offset: number, w0: number, w1: number, w2: number) =>
      paint[at + offset]! * w0 +
      paint[at + PAINTED_CORNER + offset]! * w1 +
      paint[at + 2 * PAINTED_CORNER + offset]! * w2
    eachTexel(size, paint, t, PAINTED, PAINTED_CORNER, (texel, w0, w1, w2) => {
      const own = corner(2, w0, w1, w2)
      const hairy = corner(5, w0, w1, w2)
      const wanted = Math.max(own, hair ? hairy * smoothstep(HAIR_FROM, HAIR_TO, hair[texel]!) : 0)
      if (wanted > amount[texel]!) {
        amount[texel] = wanted
        owner[texel] = t
        first[texel] = w0
        second[texel] = w1
      }
    })
  }
  // The texels kept skin shows are painted only as the cut says, whatever
  // of the bald surface's lies on them too.
  const shown = new Uint8Array(width * height)
  for (let t = 0; t < kept.length / READ; t++) {
    eachTexel(
      size,
      kept,
      t,
      READ,
      2,
      (texel) => {
        shown[texel] = 1
      },
      0,
    )
  }
  for (let t = 0; t < scalpCount; t++) {
    eachTexel(size, scalp, t, SCALP, SCALP_CORNER, (texel, w0, w1) => {
      if (shown[texel] || amount[texel]! >= 1) return
      amount[texel] = 1
      owner[texel] = paintCount + t
      first[texel] = w0
      second[texel] = w1
    })
  }
  // The rest of what the hair showed the scalp's tone, and the texels
  // round it on no triangle the colour next to them: a texture's smaller
  // mipmaps blend texels across a triangle's rim.
  const used = new Uint8Array(shown)
  for (let t = 0; t < taken.length / READ; t++) {
    eachTexel(size, taken, t, READ, 2, (texel) => {
      used[texel] = 1
      if (shown[texel] || amount[texel]! > 0) return
      amount[texel] = 1
    })
  }
  const pads: number[] = []
  const padFrom: number[] = []
  {
    const done = Uint8Array.from(amount, (k) => (k >= 1 ? 1 : 0))
    let ring: number[] = []
    for (let texel = 0; texel < done.length; texel++) if (done[texel]) ring.push(texel)
    for (let round = 0; round < PAD; round++) {
      const next: number[] = []
      for (const texel of ring) {
        const x = texel % width
        const y = (texel - x) / width
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const other = ny * width + nx
          if (done[other] || used[other]) continue
          done[other] = 1
          pads.push(other)
          padFrom.push(texel)
          next.push(other)
        }
      }
      ring = next
    }
  }
  const painted: number[] = []
  for (let texel = 0; texel < amount.length; texel++) if (amount[texel]! > 0) painted.push(texel)
  const texels = Int32Array.from(painted)
  const weights = Float32Array.from(texels, (texel) => Math.min(1, amount[texel]!))
  // The bald surface mottled by where it is (its texels lie along the
  // hair's strands); its fine grain, and the kept skin's, is the skin's own
  // (see DETAIL_REACH).
  const shades = Float32Array.from(texels, (texel) => {
    const t = owner[texel]!
    if (t < paintCount) return 1
    const at = (t - paintCount) * SCALP
    const w = [first[texel]!, second[texel]!, 1 - first[texel]! - second[texel]!]
    const place = [4, 5, 6].map((c) =>
      w.reduce((sum, wk, k) => sum + wk * scalp[at + k * SCALP_CORNER + c]!, 0),
    )
    return skinGrain(place[0]!, place[1]!, place[2]!)
  })
  // How thick the stubble is on each (see bald-head.ts's STUBBLE_IN), and
  // each texel's own hairs: more or fewer of them, by texel on the kept
  // skin, by where it is on the bald surface.
  const stubbles = new Float32Array(texels.length)
  const specks = new Float32Array(texels.length)
  // The hair painted on the skin as a hairline (see HAIRLINE_BLUR), not strand by strand.
  const hairline =
    hair && blurred(hair, width, height, Math.max(1, Math.round((HAIRLINE_BLUR * width) / 2048)))
  for (let i = 0; i < texels.length; i++) {
    const texel = texels[i]!
    const t = owner[texel]!
    if (t < 0) continue
    const w = [first[texel]!, second[texel]!, 1 - first[texel]! - second[texel]!]
    const x = texel % width
    if (t < paintCount) {
      const at = t * PAINTED
      const of = (offset: number) =>
        w.reduce((sum, wk, k) => sum + wk * paint[at + k * PAINTED_CORNER + offset]!, 0)
      // Where the head's own hair was painted on the skin kept, its hairline.
      const painted = hairline ? of(5) * smoothstep(HAIR_FROM, HAIR_TO, hairline[texel]!) : 0
      stubbles[i] = Math.max(of(6), painted)
      specks[i] = hash(x, (texel - x) / width, 9)
      continue
    }
    const at = (t - paintCount) * SCALP
    const of = (offset: number) =>
      w.reduce((sum, wk, k) => sum + wk * scalp[at + k * SCALP_CORNER + offset]!, 0)
    stubbles[i] = of(7)
    specks[i] =
      0.5 + 0.5 * cellHash(of(4) / STUBBLE_GRAIN, of(5) / STUBBLE_GRAIN, of(6) / STUBBLE_GRAIN, 9)
  }
  // Whose fine grain each takes: its own where it is kept skin, else one of
  // the forehead's texels', picked by it (see DETAIL_REACH).
  const ownGrain = Uint8Array.from(texels, (texel) =>
    owner[texel]! >= 0 && owner[texel]! < paintCount && isSkin(texel) ? 1 : 0,
  )
  const picks = Float32Array.from(texels, (texel) => {
    const t = owner[texel]!
    const x = texel % width
    if (t < paintCount) return hash(x, (texel - x) / width, 13)
    const at = (t - paintCount) * SCALP
    const w = [first[texel]!, second[texel]!, 1 - first[texel]! - second[texel]!]
    const place = [4, 5, 6].map(
      (c) =>
        w.reduce((sum, wk, k) => sum + wk * scalp[at + k * SCALP_CORNER + c]!, 0) / DETAIL_CELL,
    )
    return 0.5 + 0.5 * cellHash(place[0]!, place[1]!, place[2]!, 13)
  })
  const owners = Int32Array.from(texels, (texel) => owner[texel]!)
  const firsts = Float32Array.from(texels, (texel) => first[texel]!)
  const seconds = Float32Array.from(texels, (texel) => second[texel]!)
  const reach = Math.max(1, Math.round((SKIN_READ * width) / 2048))

  // Each corner's stubble round the hairline of the hair worn over it, for
  // the last hair worn (see `wigFringe`).
  let lastWig: Float32Array | null = null
  let lastFringe: Float32Array | null = null
  const fringeOf = (wig: Float32Array) => {
    if (lastFringe && lastWig && sameValues(lastWig, wig)) return lastFringe
    const grid = new PointGrid(wig, SKULL_CELL)
    const found: number[] = []
    const distances: number[] = []
    const fringe = new Float32Array(cornerRef.length)
    for (let k = 0; k < fringe.length; k++) {
      const t = Math.floor(k / 3)
      const corner = k % 3
      const [values, at, place, grows] =
        t < paintCount
          ? [
              paint,
              t * PAINTED + corner * PAINTED_CORNER,
              7,
              paint[t * PAINTED + corner * PAINTED_CORNER + 10]!,
            ]
          : [scalp, (t - paintCount) * SCALP + corner * SCALP_CORNER, 4, 1]
      if (!grows) continue
      const x = values[at + place]!
      const y = values[at + place + 1]!
      const z = values[at + place + 2]!
      const apart =
        grid.nearest(x, y, z, 1, found, distances, WIG_REACH) > 0
          ? Math.sqrt(distances[0]!)
          : Number.POSITIVE_INFINITY
      fringe[k] = wigFringe(x, y, z, apart)
    }
    lastWig = wig
    lastFringe = fringe
    return fringe
  }

  /** The skin's colour round a place on the texture (u, v), or null where too little of it is skin. */
  const skinAt = (head: Pixels, u: number, v: number): Rgb | null => {
    const cx = Math.floor(u * width)
    const cy = Math.floor(v * height)
    const samples: Rgb[] = []
    let all = 0
    for (let y = cy - reach; y <= cy + reach; y++) {
      for (let x = cx - reach; x <= cx + reach; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        all++
        const texel = y * width + x
        if (!isSkin(texel)) continue
        const p = texel * 4
        samples.push([head.data[p]!, head.data[p + 1]!, head.data[p + 2]!])
      }
    }
    return samples.length > 0 && samples.length >= SKIN_SHARE * all
      ? byLightness(samples, 0.5)
      : null
  }

  return {
    tone: (head) => {
      for (const list of foreheads) {
        if (list.length < LEAST_READ) continue
        const samples = list.map((texel): Rgb => {
          const p = texel * 4
          return [head.data[p]!, head.data[p + 1]!, head.data[p + 2]!]
        })
        return byLightness(samples, TONE_QUANTILE)
      }
      return null
    },
    paint: (head, tone, stubble = null, wig = null) => {
      const count = refs.length / SKIN_REF
      const read = Array.from({ length: count }, (_, r) =>
        skinAt(head, refs[r * SKIN_REF]!, refs[r * SKIN_REF + 1]!),
      )
      const local = Array.from({ length: count }, (_, r): Rgb | null => {
        const sum = [0, 0, 0]
        let total = 0
        for (let o = 0; o < count; o++) {
          const colour = read[o]
          if (!colour) continue
          const apart = Math.hypot(
            refs[r * SKIN_REF + 2]! - refs[o * SKIN_REF + 2]!,
            refs[r * SKIN_REF + 3]! - refs[o * SKIN_REF + 3]!,
            refs[r * SKIN_REF + 4]! - refs[o * SKIN_REF + 4]!,
          )
          if (apart > SKIN_BLEND) continue
          const weight = 1 - apart / SKIN_BLEND
          total += weight
          for (let c = 0; c < 3; c++) sum[c]! += colour[c]! * weight
        }
        if (total <= 0) return null
        // No darker than the hair's shadow on the skin round it lets the skin be.
        const lift = Math.max(
          1,
          (SHADOWED * luminance(...tone)) /
            Math.max(1, luminance(sum[0]!, sum[1]!, sum[2]!) / total),
        )
        return [(sum[0]! / total) * lift, (sum[1]! / total) * lift, (sum[2]! / total) * lift]
      })
      const targets = new Float32Array(cornerRef.length * 3)
      for (let k = 0; k < cornerRef.length; k++) {
        const found = cornerRef[k]! >= 0 ? local[cornerRef[k]!] : null
        const share = found ? cornerShare[k]! : 0
        for (let c = 0; c < 3; c++) {
          targets[k * 3 + c] = tone[c]! + ((found?.[c] ?? tone[c]!) - tone[c]!) * share
        }
      }
      const { data } = head
      const grains = fineGrain(head, texels, ownGrain, picks, foreheads)
      for (let i = 0; i < texels.length; i++) {
        const w = weights[i]!
        const shade = shades[i]! * grains[i]!
        const corner = owners[i]! * 3
        if (corner < 0) {
          for (let c = 0; c < 3; c++) {
            const p = texels[i]! * 4 + c
            data[p] = data[p]! + (tone[c]! * shade - data[p]!) * w
          }
          continue
        }
        const w0 = firsts[i]!
        const w1 = seconds[i]!
        const w2 = 1 - w0 - w1
        for (let c = 0; c < 3; c++) {
          const target =
            (targets[corner * 3 + c]! * w0 +
              targets[(corner + 1) * 3 + c]! * w1 +
              targets[(corner + 2) * 3 + c]! * w2) *
            shade
          const p = texels[i]! * 4 + c
          data[p] = data[p]! + (target - data[p]!) * w
        }
      }
      if (stubble) {
        const [colour, most] = stubbleShade(stubble, tone)
        const fringe = wig ? fringeOf(wig) : null
        for (let i = 0; i < texels.length; i++) {
          let thick = stubbles[i]!
          if (fringe) {
            const corner = owners[i]! * 3
            if (corner < 0) continue
            const w0 = firsts[i]!
            const w1 = seconds[i]!
            thick =
              fringe[corner]! * w0 + fringe[corner + 1]! * w1 + fringe[corner + 2]! * (1 - w0 - w1)
          }
          if (thick <= 0) continue
          const a = Math.min(STUBBLE_MOST, most * thick * (1 - SPECKLE + 2 * SPECKLE * specks[i]!))
          const p = texels[i]! * 4
          for (let c = 0; c < 3; c++) data[p + c] = data[p + c]! + (colour[c]! - data[p + c]!) * a
        }
      }
      for (let i = 0; i < pads.length; i++) {
        const to = pads[i]! * 4
        const from = padFrom[i]! * 4
        data[to] = data[from]!
        data[to + 1] = data[from + 1]!
        data[to + 2] = data[from + 2]!
      }
    },
  }
}

/**
 * The light the shadow is lifted to is that of the body of its hue out of
 * it: hues in steps of 1 / HUE_STEPS of the colour (and HUE_NEAR steps
 * round, the shadow shifting a hue a little), lightness read at
 * LIGHT_QUANTILE of at least FEWEST_LIT texels (every LIT_SAMPLE-th). The
 * shadow's own is read over SHADOW_READ texels round (on a 2048 texture),
 * so the cloth's weave stays. At most LIGHT_MOST times as bright.
 */
const HUE_STEPS = 40
const HUE_NEAR = 2
const LIGHT_QUANTILE = 0.5
const FEWEST_LIT = 100
const LIT_SAMPLE = 3
const SHADOW_READ = 6
const LIGHT_MOST = 1.8

/** How far round (texels, on a 2048 texture) the lift is smoothed. */
const GAIN_BLEND = 16

/** A colour's hue bin (see HUE_STEPS). */
const hueBin = (r: number, g: number, b: number) => {
  const total = r + g + b || 1
  return Math.round((r / total) * HUE_STEPS) * (HUE_STEPS + 1) + Math.round((g / total) * HUE_STEPS)
}

/** Sums of `values` (`width` × `height`, `channels` per texel) over the box `reach` texels round each. */
function boxSums(
  values: Float32Array,
  width: number,
  height: number,
  channels: number,
  reach: number,
) {
  const across = new Float32Array(values.length)
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < channels; c++) {
      let sum = 0
      for (let x = -reach; x < width + reach; x++) {
        const add = x + reach
        if (add >= 0 && add < width) sum += values[(y * width + add) * channels + c]!
        const drop = x - reach - 1
        if (drop >= 0 && drop < width) sum -= values[(y * width + drop) * channels + c]!
        if (x >= 0 && x < width) across[(y * width + x) * channels + c] = sum
      }
    }
  }
  const out = new Float32Array(values.length)
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < channels; c++) {
      let sum = 0
      for (let y = -reach; y < height + reach; y++) {
        const add = y + reach
        if (add >= 0 && add < height) sum += across[(add * width + x) * channels + c]!
        const drop = y - reach - 1
        if (drop >= 0 && drop < height) sum -= across[(drop * width + x) * channels + c]!
        if (y >= 0 && y < height) out[(y * width + x) * channels + c] = sum
      }
    }
  }
  return out
}

/**
 * Lights the body's texture (in place) where the hair taken out of the
 * head shaded it (see `hairShadow`, packed SHADED per triangle): each
 * texel as bright as the body of its hue out of the shadow usually is (see
 * HUE_STEPS), as much as it lay in the shadow.
 */
export function relightBody(body: Pixels, shadow: Float32Array) {
  const { width, height, data } = body
  const size = width * height
  const shaded = new Float32Array(size)
  for (let t = 0; t < shadow.length / SHADED; t++) {
    const at = t * SHADED
    rasterise(
      shadow[at]! * width,
      shadow[at + 1]! * height,
      shadow[at + 3]! * width,
      shadow[at + 4]! * height,
      shadow[at + 6]! * width,
      shadow[at + 7]! * height,
      width,
      height,
      MARGIN,
      (texel, w0, w1, w2) => {
        const share = shadow[at + 2]! * w0 + shadow[at + 5]! * w1 + shadow[at + 8]! * w2
        if (share > shaded[texel]!) shaded[texel] = share
      },
    )
  }
  if (!shaded.some((share) => share > 0)) return
  // How light the body out of the shadow is, by hue.
  const lightness = new Map<number, number[]>()
  for (let i = 0; i < size; i += LIT_SAMPLE) {
    const r = data[i * 4]!
    const g = data[i * 4 + 1]!
    const b = data[i * 4 + 2]!
    if (shaded[i]! > 0 || data[i * 4 + 3] === 0 || r + g + b === 0) continue
    const bin = hueBin(r, g, b)
    const list = lightness.get(bin)
    if (list) list.push(luminance(r, g, b))
    else lightness.set(bin, [luminance(r, g, b)])
  }
  const lightOf = new Map<number, number | null>()
  const lightAt = (bin: number) => {
    let light = lightOf.get(bin)
    if (light !== undefined) return light
    const all: number[] = []
    for (let dr = -HUE_NEAR; dr <= HUE_NEAR; dr++) {
      for (let dg = -HUE_NEAR; dg <= HUE_NEAR; dg++) {
        for (const value of lightness.get(bin + dr * (HUE_STEPS + 1) + dg) ?? []) all.push(value)
      }
    }
    all.sort((a, b) => a - b)
    light = all.length >= FEWEST_LIT ? all[Math.floor(LIGHT_QUANTILE * (all.length - 1))]! : null
    lightOf.set(bin, light)
    return light
  }
  const own = new Float32Array(size * 4)
  for (let i = 0; i < size; i++) {
    own.set([data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, 1], i * 4)
  }
  const near = boxSums(own, width, height, 4, Math.max(1, Math.round((SHADOW_READ * width) / 2048)))
  // How much brighter each texel would be, smoothed: neighbouring texels
  // of hues a step apart are lifted alike.
  const gains = new Float32Array(size * 2)
  for (let i = 0; i < size; i++) {
    if (shaded[i]! <= 0) continue
    const n = near[i * 4 + 3]!
    const [r, g, b] = [near[i * 4]! / n, near[i * 4 + 1]! / n, near[i * 4 + 2]! / n]
    const light = lightAt(hueBin(r, g, b))
    if (light === null) continue
    gains[i * 2] = Math.min(LIGHT_MOST, Math.max(1, light / Math.max(1, luminance(r, g, b))))
    gains[i * 2 + 1] = 1
  }
  const smooth = boxSums(
    gains,
    width,
    height,
    2,
    Math.max(1, Math.round((GAIN_BLEND * width) / 2048)),
  )
  for (let i = 0; i < size; i++) {
    const share = shaded[i]!
    const n = smooth[i * 2 + 1]!
    if (share <= 0 || n === 0) continue
    const k = 1 + (smooth[i * 2]! / n - 1) * share
    for (let c = 0; c < 3; c++) data[i * 4 + c] = data[i * 4 + c]! * k
  }
}
