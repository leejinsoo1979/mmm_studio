import { bleedHair } from './hair-bleed'
import { smoothstep } from './head-skull'
import {
  byLightness,
  colorDistance,
  hairMask,
  luminance,
  maskedLuminance,
  meanColor,
  type Pixels,
  type Rgb,
} from './look-pixels'

/**
 * A borrowed hairstyle's pictures (see avatar-hair.ts): its cap's cut out
 * of the donor's head texture as a matte of its hair over its skin, and
 * the colours a dye and a bald head's stubble read off them. Pure pixel
 * work, a second or so for a 1024² head: run in a worker as a hairstyle
 * loads (see hair-cap-worker.ts), so walking never stops for it.
 */

/** A triangle with less area (texels²) than this on its texture covers none of it. */
const FLAT = 1e-12

/**
 * Fills a triangle's texels on a `width` × `height` texture (corners in
 * 0–1 UVs), calling `visit` with each texel whose centre is inside and its
 * barycentric weights.
 */
function fillTexels(
  width: number,
  height: number,
  u: readonly number[],
  v: readonly number[],
  visit: (texel: number, w0: number, w1: number, w2: number) => void,
) {
  const ax = u[0]! * width
  const ay = v[0]! * height
  const bx = u[1]! * width
  const by = v[1]! * height
  const cx = u[2]! * width
  const cy = v[2]! * height
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  if (Math.abs(area) < FLAT) return
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const x = px + 0.5
      const y = py + 0.5
      const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area
      const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area
      const w2 = 1 - w0 - w1
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) visit(py * width + px, w0, w1, w2)
    }
  }
}

/**
 * In the donor's sculpted shell (see `CapTriangle`), a texel this unlike
 * its skin (see `colorDistance`) starts to be hair, and this unlike is
 * wholly: a highlight can come near the skin's colour, but not to it.
 */
const SKIN_NEAR = 0.1
const SKIN_FAR = 0.2

/**
 * How much of a texel is hair is where its colour lies between the skin's
 * (the donor's cheeks') and the hair's round it: the colour of the texels
 * plainly hair (KNOWN_HAIR of the hair mask) averaged within LOCAL_REACH
 * texels (on a 1024 texture), or LOCAL_FAR where none are that near. Hair
 * and skin less apart than CONTRAST (in each channel's 0–255, together)
 * are told apart by the mask alone. (The skin between short hair's strands
 * is no skin to read: its own colour would leave the stubble no hair.)
 */
const KNOWN_HAIR = 0.9
const LOCAL_REACH = 8
const LOCAL_FAR = 32
const CONTRAST = 40

/**
 * A texel at least STRAND hair, joined (through texels at least that) to
 * one at least ROOTED hair, is hair; the rest of the donor's skin is cut
 * away, and patches of hair of fewer than SPECK texels (on a 1024
 * texture: a mole, a pore). The cap is opaque where a texel is OPAQUE
 * hair, fading to clear at STRAND: a hairline thins out into the skin as
 * the donor's was painted. Each texel's share is the mean of those SMOOTH
 * texels round it, so no single texel stands out of the edge.
 */
/** How many texels (on a 1024 texture) round a UV island's rim take its texels' colour and opacity. */
const RIM_PAD = 2

const STRAND = 0.32
const ROOTED = 0.6
const OPAQUE = 0.85
const SPECK = 120
const SMOOTH = 1

/**
 * A texel part hair, part the donor's skin, shows the hair's part of it:
 * the hair's hue, as light as the texel is with the skin's share taken
 * out. The less of it is hair, the less sure that is: from UNMIXED[1] down
 * to UNMIXED[0] it turns to the lightness of the hair round it. Left
 * mixed, the donor's skin would stay in the hairline as a ruddy fringe
 * over the wearer's.
 */
const UNMIXED: readonly [number, number] = [0.3, 0.7]

/** A texel this much hair (PURE[1]) is plainly hair: it keeps its own colour, from PURE[0] up. */
const PURE: readonly [number, number] = [0.75, 0.95]

/** How much lighter or darker than the hair round it a texel of it is let be (its strands, its shine). */
const LIGHTER: readonly [number, number] = [0.6, 1.25]

/**
 * A triangle of the cap on its texture (corners in 0–1 UVs): `solid` on the
 * hair's sculpted shell; `fade`, per corner, how far it is from the cap's
 * rim (0 on it, 1 clear of it: see `hairAssetOf`), where it fades out;
 * `lying`, per corner, how much it lies on the skin of the head (1) rather
 * than standing free of it or over an ear (0), where it is hair or not.
 */
export type CapTriangle = {
  u: number[]
  v: number[]
  solid: boolean
  fade?: number[]
  lying?: number[]
}

/**
 * The cap's texture: the donor's head texture as a matte of its hair over
 * its skin, so the wig's edge is the donor's own hairline — thinning out
 * into the skin strand by strand, short hair's stubble see-through — not a
 * cut-out. Each texel is as opaque as it is hair: where its colour lies
 * between the skin's round it and the hair's (see LOCAL_REACH), on the
 * sculpted shell (`solid`) at least as much as it isn't plainly skin; cut
 * away where it is no part of the hair (see STRAND) and faded out towards
 * the cap's rim (`fade`). Its colour is the hair's round it where it is
 * clear: what shows through is the wearer's skin, never the donor's.
 */
export function capPixels(
  head: Pixels,
  hair: Rgb,
  skin: Rgb,
  triangles: readonly CapTriangle[],
): Pixels {
  const { width, height, data } = head
  const count = width * height
  const scale = width / 1024
  const mask = hairMask(head, hair, skin)
  const skinLum = luminance(...skin)
  const covered = new Uint8Array(count)
  const solid = new Uint8Array(count)
  const fade = new Float32Array(count)
  // Texels two triangles share (a texture mirrored left and right) are
  // hair or not if either says so.
  const lying = new Float32Array(count).fill(1)
  const at = (values: number[] | undefined, w0: number, w1: number, w2: number) =>
    values ? values[0]! * w0 + values[1]! * w1 + values[2]! * w2 : 1
  for (const tri of triangles) {
    fillTexels(width, height, tri.u, tri.v, (texel, w0, w1, w2) => {
      covered[texel] = 1
      if (tri.solid) solid[texel] = 1
      fade[texel] = Math.max(fade[texel]!, at(tri.fade, w0, w1, w2))
      lying[texel] = Math.min(lying[texel]!, at(tri.lying, w0, w1, w2))
    })
  }
  const colours = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) colours[i * 3 + c] = data[i * 4 + c]!
  }
  const near = Math.max(1, Math.round(LOCAL_REACH * scale))
  const far = Math.max(near + 1, Math.round(LOCAL_FAR * scale))
  const hairRound = meanWhere(
    colours,
    width,
    height,
    (i) => covered[i] === 1 && mask[i]! >= KNOWN_HAIR,
    [near, far],
    hair,
  )
  const raw = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    if (!covered[i]) continue
    let apart = 0
    let along = 0
    for (let c = 0; c < 3; c++) {
      const span = hairRound[i * 3 + c]! - skin[c]!
      apart += span * span
      along += (colours[i * 3 + c]! - skin[c]!) * span
    }
    let hairy = apart >= CONTRAST * CONTRAST ? Math.min(1, Math.max(0, along / apart)) : mask[i]!
    if (solid[i]) {
      const r = data[i * 4]!
      const g = data[i * 4 + 1]!
      const b = data[i * 4 + 2]!
      hairy = Math.max(
        hairy,
        smoothstep(SKIN_NEAR, SKIN_FAR, colorDistance(r, g, b, skin, skinLum)),
      )
    }
    raw[i] = hairy
  }
  const share = smoothed(raw, covered, width, height, Math.max(1, Math.round(SMOOTH * scale)))
  const hairy = joinedHair(share, covered, width, height, Math.round(SPECK * scale * scale))
  const out: Pixels = { data: new Uint8ClampedArray(data), width, height }
  for (let i = 0; i < count; i++) {
    const amount = hairy[i] ? share[i]! : 0
    // Standing free of the head, or over an ear, the cap may have nothing
    // behind it but the cap itself, drawn in no order, or the world: a
    // see-through texel there is a pale smear in the hair. There it is hair
    // or not, to its rim; on the skin, its hairline thins out and fades.
    const soft = smoothstep(STRAND, OPAQUE, amount) * fade[i]!
    const hard = amount >= (STRAND + OPAQUE) / 2 ? 1 : 0
    out.data[i * 4 + 3] = Math.round(255 * (hard + (soft - hard) * lying[i]!))
    // Of the colour unmixed, its lightness alone: the donor's skin is
    // shaded unlike its cheeks, so its hue would come out ruddy.
    const own = smoothstep(UNMIXED[0], UNMIXED[1], amount)
    const unmixed = [0, 1, 2].map((c) =>
      Math.max(0, skin[c]! + (colours[i * 3 + c]! - skin[c]!) / Math.max(amount, UNMIXED[0])),
    )
    // The hair's own colour: at its edge even the texels plainly hair
    // round it are tinged with the skin, lighter and ruddier.
    const round = hair
    const lighter = Math.min(
      LIGHTER[1],
      Math.max(
        LIGHTER[0],
        luminance(unmixed[0]!, unmixed[1]!, unmixed[2]!) /
          Math.max(1, luminance(round[0]!, round[1]!, round[2]!)),
      ),
    )
    const pure = smoothstep(PURE[0], PURE[1], amount)
    for (let c = 0; c < 3; c++) {
      const part = round[c]! * (1 + (lighter - 1) * own)
      out.data[i * 4 + c] = part + (colours[i * 3 + c]! - part) * pure
    }
  }
  // Texels off the cap's triangles round a UV island's rim as the island's
  // next to them: filtered, the rim would take in their clear and show a
  // seam through the hair.
  let ring: number[] = []
  const done = Uint8Array.from(covered)
  for (let i = 0; i < count; i++) if (covered[i]) ring.push(i)
  for (let round = 0; round < Math.max(1, Math.round(RIM_PAD * scale)); round++) {
    const next: number[] = []
    for (const texel of ring) {
      const x = texel % width
      for (const other of [
        x > 0 ? texel - 1 : -1,
        x < width - 1 ? texel + 1 : -1,
        texel >= width ? texel - width : -1,
        texel < count - width ? texel + width : -1,
      ]) {
        if (other < 0 || done[other]) continue
        done[other] = 1
        out.data.copyWithin(other * 4, texel * 4, texel * 4 + 4)
        next.push(other)
      }
    }
    ring = next
  }
  return out
}

/**
 * Per texel (`width` × `height`), the mean colour (`colours`, 3 per texel)
 * of the texels `known` round it — within the first of `reaches` (texels,
 * each way) that holds any — or `fallback`.
 */
function meanWhere(
  colours: Float32Array,
  width: number,
  height: number,
  known: (texel: number) => boolean,
  reaches: readonly number[],
  fallback: Rgb,
): Float32Array {
  const count = width * height
  const values = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    if (!known(i)) continue
    values.set([colours[i * 3]!, colours[i * 3 + 1]!, colours[i * 3 + 2]!, 1], i * 4)
  }
  const out = new Float32Array(count * 3)
  const done = new Uint8Array(count)
  for (const reach of reaches) {
    const sums = boxSums(values, width, height, 4, reach)
    for (let i = 0; i < count; i++) {
      const n = sums[i * 4 + 3]!
      if (done[i] || n <= 0) continue
      done[i] = 1
      for (let c = 0; c < 3; c++) out[i * 3 + c] = sums[i * 4 + c]! / n
    }
  }
  for (let i = 0; i < count; i++) if (!done[i]) out.set(fallback, i * 3)
  return out
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
        if (add < width) sum += values[(y * width + add) * channels + c]!
        const drop = x - reach - 1
        if (drop >= 0) sum -= values[(y * width + drop) * channels + c]!
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
        if (add < height) sum += across[(add * width + x) * channels + c]!
        const drop = y - reach - 1
        if (drop >= 0) sum -= across[(drop * width + x) * channels + c]!
        if (y >= 0 && y < height) out[(y * width + x) * channels + c] = sum
      }
    }
  }
  return out
}

/** A field (per texel) averaged over each texel and those within `reach` round it that `covered` holds: only texels it holds change. */
function smoothed(
  field: Float32Array,
  covered: Uint8Array,
  width: number,
  height: number,
  reach: number,
): Float32Array {
  const out = Float32Array.from(field)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!covered[y * width + x]) continue
      let sum = 0
      let n = 0
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !covered[ny * width + nx]) continue
          sum += field[ny * width + nx]!
          n++
        }
      }
      out[y * width + x] = sum / n
    }
  }
  return out
}

/**
 * Which texels are hair (1): at least STRAND of it, joined (4-connected,
 * over texels at least that) to one at least ROOTED, in patches of at
 * least `fewest` texels.
 */
function joinedHair(
  share: Float32Array,
  covered: Uint8Array,
  width: number,
  height: number,
  fewest: number,
): Uint8Array {
  const out = new Uint8Array(share.length)
  const seen = new Uint8Array(share.length)
  const patch: number[] = []
  for (let start = 0; start < share.length; start++) {
    if (seen[start] || !covered[start] || share[start]! < STRAND) continue
    patch.length = 0
    patch.push(start)
    seen[start] = 1
    let rooted = false
    for (let k = 0; k < patch.length; k++) {
      const texel = patch[k]!
      if (share[texel]! >= ROOTED) rooted = true
      const x = texel % width
      for (const other of [
        x > 0 ? texel - 1 : -1,
        x < width - 1 ? texel + 1 : -1,
        texel >= width ? texel - width : -1,
        texel < width * (height - 1) ? texel + width : -1,
      ]) {
        if (other < 0 || seen[other] || !covered[other] || share[other]! < STRAND) continue
        seen[other] = 1
        patch.push(other)
      }
    }
    if (rooted && patch.length >= fewest) for (const texel of patch) out[texel] = 1
  }
  return out
}

/**
 * The colour of a donor's hair as its head is painted with it: the median
 * (by lightness) of the texels of its sculpted shell (`solid` triangles).
 * Short hair painted onto the scalp is nearer it than the cards' colour,
 * which strands lit through and edge on make lighter. Null for none.
 */
function paintedHair(head: Pixels, triangles: readonly CapTriangle[]): Rgb | null {
  const samples: Rgb[] = []
  for (const tri of triangles) {
    if (!tri.solid) continue
    fillTexels(head.width, head.height, tri.u, tri.v, (texel) => {
      if (texel % PAINTED_SAMPLE !== 0) return
      const p = texel * 4
      samples.push([head.data[p]!, head.data[p + 1]!, head.data[p + 2]!])
    })
  }
  if (samples.length === 0) return null
  return byLightness(samples, 0.5)
}

/** One texel in this many is read for a donor's painted hair colour: enough for a median. */
const PAINTED_SAMPLE = 7

/**
 * What a hairstyle's pictures are cut by, worked out from its shape (see
 * avatar-hair.ts's `hairAssetOf`): the cap's triangles on the donor's head
 * texture, and where on it the donor's skin is read (u, v pairs).
 */
export type CapPlan = { triangles: CapTriangle[]; skin: Float32Array }

/**
 * A hairstyle's pictures: the cap's (its texture, which of its texels a
 * dye takes and their usual lightness; null with no cap, or no colours to
 * cut it by), the cards' colour and the hair's (the cap's painted hair, else
 * the cards').
 */
export type HairPicture = {
  cap: { pixels: Pixels; dyeMask: Float32Array; lum: number } | null
  cards: Rgb | null
  color: Rgb | null
}

/** The median colour (by lightness) of a texture's texels at some places (u, v pairs); null for none. */
function colourAt(pixels: Pixels, uvs: ArrayLike<number>): Rgb | null {
  const samples: Rgb[] = []
  for (let k = 0; k < uvs.length; k += 2) {
    const x = Math.min(pixels.width - 1, Math.max(0, Math.floor(uvs[k]! * pixels.width)))
    const y = Math.min(pixels.height - 1, Math.max(0, Math.floor(uvs[k + 1]! * pixels.height)))
    const p = (y * pixels.width + x) * 4
    samples.push([pixels.data[p]!, pixels.data[p + 1]!, pixels.data[p + 2]!])
  }
  return samples.length > 0 ? byLightness(samples, 0.5) : null
}

/** A hairstyle's pictures (see `HairPicture`) from the donor's head and cards textures, as `plan` cuts them. */
export function capPicture(head: Pixels, opacity: Pixels | null, plan: CapPlan): HairPicture {
  const cards = opacity ? meanColor(opacity) : null
  const skin = colourAt(head, plan.skin)
  if (!(cards && skin && plan.triangles.length > 0)) return { cap: null, cards, color: cards }
  const color = paintedHair(head, plan.triangles) ?? cards
  const pixels = capPixels(head, color, skin, plan.triangles)
  // What shows of it is hair's colour all through: dyed wholly.
  const dyeMask = Float32Array.from({ length: pixels.width * pixels.height }, (_, i) =>
    pixels.data[i * 4 + 3]! > 0 ? 1 : 0,
  )
  return { cap: { pixels, dyeMask, lum: maskedLuminance(pixels, dyeMask) }, cards, color }
}

/**
 * A hairstyle's pictures for the worker to cut: its donor's head texture's
 * picture (read at `size`) and its cards' (as they are), the cut, and how
 * each is bled (see `bleedHair`).
 */
export type CapMessage = {
  ticket: number
  head: ImageBitmap
  opacity: ImageBitmap | null
  size: number
  plan: CapPlan
  bleed: { cap: number; cards: number }
}

/** A hairstyle's pictures cut (see `capPicture`), and its cards' texture, both bled. */
export type CapCut = { picture: HairPicture; opacity: Pixels | null }

/** The worker's answer: the pictures, or why it failed. */
export type CapReply = { ticket: number; cut?: CapCut; error?: string }

/** A picture's pixels, read at `size` (its own size without). */
function read(bitmap: ImageBitmap, size?: number): Pixels {
  const width = size ?? bitmap.width
  const height = size ?? bitmap.height
  const context = new OffscreenCanvas(width, height).getContext('2d', {
    willReadFrequently: true,
  })!
  context.drawImage(bitmap, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}

/** A hairstyle's pictures cut and bled (see `CapMessage`), wherever this runs. */
export function cutPictures({
  head,
  opacity,
  size,
  plan,
  bleed,
}: Omit<CapMessage, 'ticket'>): CapCut {
  const headPixels = read(head, size)
  const opacityPixels = opacity ? read(opacity) : null
  const picture = capPicture(headPixels, opacityPixels, plan)
  if (picture.cap) bleedHair(picture.cap.pixels, bleed.cap)
  if (opacityPixels) bleedHair(opacityPixels, bleed.cards)
  return { picture, opacity: opacityPixels }
}

type Request = {
  message: CapMessage
  resolve: (cut: CapCut) => void
  reject: (error: unknown) => void
}

let worker: Worker | null | undefined
let tickets = 0
const requests = new Map<number, Request>()

const cutHere = ({ message, resolve, reject }: Request) => {
  try {
    resolve(cutPictures(message))
  } catch (error) {
    reject(error)
  }
}

/** The cap worker, started on first use; null where there are no workers, or it failed to start. */
function capWorker(): Worker | null {
  if (worker !== undefined) return worker
  worker = null
  if (typeof Worker === 'undefined') return null
  try {
    const started = new Worker(new URL('./hair-cap-worker.ts', import.meta.url), {
      type: 'module',
    })
    started.onmessage = (event: MessageEvent<CapReply>) => {
      const { ticket, cut, error } = event.data
      const request = requests.get(ticket)
      if (!request) return
      requests.delete(ticket)
      if (cut) request.resolve(cut)
      else request.reject(new Error(error))
    }
    // It didn't load: what it was asked, and all that comes later, is cut here.
    started.onerror = (event) => {
      event.preventDefault()
      started.terminate()
      worker = null
      for (const request of requests.values()) cutHere(request)
      requests.clear()
    }
    worker = started
  } catch {
    worker = null
  }
  return worker
}

/**
 * A hairstyle's pictures cut and bled (see `cutPictures`), in the cap
 * worker where there is one: a second or so of the page's time otherwise,
 * walking stopped as a hairstyle loads. The worker gets copies of the
 * pictures; they are the caller's to close once this settles.
 */
export function cutHairPictures(message: Omit<CapMessage, 'ticket'>): Promise<CapCut> {
  return new Promise((resolve, reject) => {
    const request: Request = { message: { ...message, ticket: ++tickets }, resolve, reject }
    const to = capWorker()
    if (!to) {
      cutHere(request)
      return
    }
    requests.set(request.message.ticket, request)
    to.postMessage(request.message)
  })
}
