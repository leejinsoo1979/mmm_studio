import { PAINTED, READ, SCALP, type ScalpPaint, SHADED, SHADOW_REFS, SKIN_REF } from './bald-head'
import { rasterise } from './front-render'
import { byLightness, luminance, type Pixels, type Rgb } from './look-pixels'

/**
 * A bald head's skin round the cut its hair was taken out along (see
 * bald-head.ts), painted to the scalp's tone so it meets the bald surface
 * without a seam: the skin under the old hairline (a forehead painted
 * darker there, a nape or temples painted with hair) and any of the hair's
 * colour left on the skin. The bald surface shows the texels the hair did,
 * painted wholly the scalp's; the nape takes the neck's tone instead, so it
 * meets the neck's skin as well.
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

/** How far round (px, on a 2048 texture) the skin a corner's colour comes from is read, and how much of what is there must be skin. */
const SKIN_READ = 4
const SKIN_SHARE = 0.3

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
   * skin.
   */
  paint: (head: Pixels, tone: Rgb) => void
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
  const read = tone.map((list) => {
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
      cornerRef[t * 3 + k] = paint[t * PAINTED + k * 6 + 3]!
      cornerShare[t * 3 + k] = paint[t * PAINTED + k * 6 + 4]!
    }
  }
  for (let t = 0; t < scalpCount; t++) {
    for (let k = 0; k < 3; k++) {
      cornerRef[(paintCount + t) * 3 + k] = scalp[t * SCALP + k * 4 + 2]!
      cornerShare[(paintCount + t) * 3 + k] = scalp[t * SCALP + k * 4 + 3]!
    }
  }

  const amount = new Float32Array(width * height)
  const owner = new Int32Array(width * height).fill(-1)
  const first = new Float32Array(width * height)
  const second = new Float32Array(width * height)
  for (let t = 0; t < paintCount; t++) {
    const at = t * PAINTED
    eachTexel(size, paint, t, PAINTED, 6, (texel, w0, w1, w2) => {
      const own = paint[at + 2]! * w0 + paint[at + 8]! * w1 + paint[at + 14]! * w2
      const hairy = paint[at + 5]! * w0 + paint[at + 11]! * w1 + paint[at + 17]! * w2
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
    eachTexel(size, scalp, t, SCALP, 4, (texel, w0, w1) => {
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
  const shades = Float32Array.from(texels, (texel) => {
    const x = texel % width
    return grain(x, (texel - x) / width)
  })
  const owners = Int32Array.from(texels, (texel) => owner[texel]!)
  const firsts = Float32Array.from(texels, (texel) => first[texel]!)
  const seconds = Float32Array.from(texels, (texel) => second[texel]!)
  const reach = Math.max(1, Math.round((SKIN_READ * width) / 2048))

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
      for (const list of read) {
        if (list.length < LEAST_READ) continue
        const samples = list.map((texel): Rgb => {
          const p = texel * 4
          return [head.data[p]!, head.data[p + 1]!, head.data[p + 2]!]
        })
        return byLightness(samples, TONE_QUANTILE)
      }
      return null
    },
    paint: (head, tone) => {
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
        return total > 0 ? [sum[0]! / total, sum[1]! / total, sum[2]! / total] : null
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
      for (let i = 0; i < texels.length; i++) {
        const w = weights[i]!
        const shade = shades[i]!
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

/** How far round (px, on a 2048 texture) a body texture's light is read, and how much brighter at most the shadow is lit. */
const LIGHT_READ = 4
const LIGHT_MOST = 2

/**
 * Of the places a shaded corner's light is read from, those this unlike it
 * in hue (its colour over its lightness) are another cloth or skin, and
 * left out.
 */
const SAME_HUE = 0.12

/**
 * Lights the body's texture (in place) where the hair taken out of the
 * head shaded it (see `hairShadow`, packed SHADED per triangle): each
 * corner as bright as the body round it out of the shadow of its own hue,
 * as much as it lay in the shadow.
 */
export function relightBody(body: Pixels, shadow: Float32Array) {
  const { width, height, data } = body
  const reach = Math.max(1, Math.round((LIGHT_READ * width) / 2048))
  /** Mean colour round a place (u, v). */
  const around = (u: number, v: number): Rgb => {
    const cx = Math.floor(u * width)
    const cy = Math.floor(v * height)
    const sum = [0, 0, 0]
    let n = 0
    for (let y = Math.max(0, cy - reach); y <= Math.min(height - 1, cy + reach); y++) {
      for (let x = Math.max(0, cx - reach); x <= Math.min(width - 1, cx + reach); x++) {
        const p = (y * width + x) * 4
        sum[0]! += data[p]!
        sum[1]! += data[p + 1]!
        sum[2]! += data[p + 2]!
        n++
      }
    }
    return [sum[0]! / (n || 1), sum[1]! / (n || 1), sum[2]! / (n || 1)]
  }
  const hue = (c: Rgb) => {
    const total = c[0] + c[1] + c[2] || 1
    return [c[0] / total, c[1] / total, c[2] / total]
  }
  const per = 3 + 2 * SHADOW_REFS
  const count = shadow.length / SHADED
  const gains = new Float32Array(count * 3)
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const at = t * SHADED + k * per
      const own = around(shadow[at]!, shadow[at + 1]!)
      const ownHue = hue(own)
      const lights: number[] = []
      for (let r = 0; r < SHADOW_REFS; r++) {
        const ref = around(shadow[at + 3 + r * 2]!, shadow[at + 4 + r * 2]!)
        const refHue = hue(ref)
        const apart = Math.hypot(
          refHue[0]! - ownHue[0]!,
          refHue[1]! - ownHue[1]!,
          refHue[2]! - ownHue[2]!,
        )
        if (apart <= SAME_HUE) lights.push(luminance(...ref))
      }
      lights.sort((a, b) => a - b)
      const light = lights[lights.length >> 1]
      const gain =
        light === undefined
          ? 1
          : Math.min(LIGHT_MOST, Math.max(1, light / Math.max(1, luminance(...own))))
      gains[t * 3 + k] = 1 + (gain - 1) * shadow[at + 2]!
    }
  }
  const done = new Uint8Array(width * height)
  for (let t = 0; t < count; t++) {
    const at = t * SHADED
    rasterise(
      shadow[at]! * width,
      shadow[at + 1]! * height,
      shadow[at + per]! * width,
      shadow[at + per + 1]! * height,
      shadow[at + 2 * per]! * width,
      shadow[at + 2 * per + 1]! * height,
      width,
      height,
      MARGIN,
      (texel, w0, w1, w2) => {
        if (done[texel]) return
        done[texel] = 1
        const gain = gains[t * 3]! * w0 + gains[t * 3 + 1]! * w1 + gains[t * 3 + 2]! * w2
        for (let c = 0; c < 3; c++) data[texel * 4 + c] = data[texel * 4 + c]! * gain
      },
    )
  }
}
