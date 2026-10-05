import { PAINTED, READ, type ScalpPaint } from './bald-head'
import { rasterise } from './front-render'
import { luminance, type Pixels, type Rgb } from './look-pixels'

/**
 * A bald head's skin round the cut its hair was taken out along (see
 * bald-head.ts), painted to the scalp's tone so it meets the bald surface
 * without a seam: the skin under the old hairline (a forehead painted
 * darker there, a nape or temples painted with hair) and any of the hair's
 * colour left over the skull's hair zone. The bald surface itself takes
 * its colour from one texel, the swatch, painted wholly the scalp's.
 */

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

/** The scalp's grain: how much a texel's lightness strays, alone and with the texels round it. */
const GRAIN_FINE = 0.05
const GRAIN_COARSE = 0.03
const GRAIN_CELL = 4

/** The swatch's radius (px): bilinear sampling and a texture's own rounding stay inside it. */
const SWATCH = 4

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** A steady pseudo-random number in [0, 1) for a texel. */
function hash(x: number, y: number, seed: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return s - Math.floor(s)
}

const grain = (x: number, y: number) =>
  1 +
  GRAIN_FINE * (2 * hash(x, y, 3) - 1) +
  GRAIN_COARSE * (2 * hash(Math.floor(x / GRAIN_CELL), Math.floor(y / GRAIN_CELL), 5) - 1)

/** Calls `visit` with each texel of `head` a packed triangle covers (corners' u, v at `at`, `stride` apart). */
function eachTexel(
  head: Pixels,
  packed: Float32Array,
  t: number,
  size: number,
  stride: number,
  visit: (texel: number, w0: number, w1: number, w2: number) => void,
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
    MARGIN,
    visit,
  )
}

/**
 * The scalp's tone: a colour of the skin (see TONE_QUANTILE) under the
 * first of `tone`'s lists of triangles (see ScalpPaint) that shows enough
 * of it — `hair` and `skin` say, per texel, how surely it is either. Null
 * where none does.
 */
export function scalpTone(
  head: Pixels,
  tone: readonly Float32Array[],
  hair: Float32Array | null,
  skin: Float32Array | null,
): Rgb | null {
  for (const list of tone) {
    const seen = new Uint8Array(head.width * head.height)
    const samples: Rgb[] = []
    for (let t = 0; t < list.length / READ; t++) {
      eachTexel(head, list, t, READ, 2, (texel) => {
        if (seen[texel]) return
        seen[texel] = 1
        if ((hair && hair[texel]! > HAIR_MOST) || (skin && skin[texel]! < SKIN_LEAST)) return
        const p = texel * 4
        samples.push([head.data[p]!, head.data[p + 1]!, head.data[p + 2]!])
      })
    }
    if (samples.length < LEAST_READ) continue
    samples.sort((a, b) => luminance(...a) - luminance(...b))
    return samples[Math.floor(samples.length * TONE_QUANTILE)]!
  }
  return null
}

/**
 * Paints a bald head's skin round the cut to the scalp's `tone` (in
 * place): each texel of the paint's triangles as much as its corners say,
 * and wholly where it is the hair's colour (`hair`, its mask); and the
 * swatch, wholly. Grained like skin.
 */
export function paintScalp(
  head: Pixels,
  { paint, swatch }: Pick<ScalpPaint, 'paint' | 'swatch'>,
  tone: Rgb,
  hair: Float32Array | null,
) {
  const { data, width, height } = head
  const amount = new Float32Array(width * height)
  for (let t = 0; t < paint.length / PAINTED; t++) {
    const at = t * PAINTED
    eachTexel(head, paint, t, PAINTED, 3, (texel, w0, w1, w2) => {
      const own = paint[at + 2]! * w0 + paint[at + 5]! * w1 + paint[at + 8]! * w2
      const painted = Math.max(own, hair ? smoothstep(HAIR_FROM, HAIR_TO, hair[texel]!) : 0)
      if (painted > amount[texel]!) amount[texel] = painted
    })
  }
  const sx = swatch[0] * width
  const sy = swatch[1] * height
  for (let y = Math.floor(sy - SWATCH); y <= Math.ceil(sy + SWATCH); y++) {
    for (let x = Math.floor(sx - SWATCH); x <= Math.ceil(sx + SWATCH); x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      if (Math.hypot(x + 0.5 - sx, y + 0.5 - sy) <= SWATCH) amount[y * width + x] = 2
    }
  }
  for (let texel = 0; texel < amount.length; texel++) {
    const k = amount[texel]!
    if (k <= 0) continue
    const x = texel % width
    // The swatch is the tone itself: the bald surface shows it unshaded by grain.
    const shade = k > 1 ? 1 : grain(x, (texel - x) / width)
    const w = Math.min(1, k)
    for (let c = 0; c < 3; c++) {
      const p = texel * 4 + c
      data[p] = data[p]! + (tone[c]! * shade - data[p]!) * w
    }
  }
}
