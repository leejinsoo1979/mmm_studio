/**
 * Where a photo shows bare skin: a colour model of the person's own skin,
 * read from their cheeks in the front photo, and each pixel's likeness to
 * it. Hair over the forehead, a beard over the chin or the background
 * behind the profile are not skin — the fit then only keeps the head
 * inside them, and the texture takes no colour from them.
 *
 * Chroma (Cb, Cr) is compared, which the light changes little, and the
 * lightness only loosely (a shaded cheek is still skin; black hair is not).
 */

export type SkinModel = {
  cb: number
  cr: number
  /** Inverse covariance of (cb, cr). */
  inv: [number, number, number]
  luma: number
  /** How busy the cheeks' fine detail is (see `busyness`): hair, brows and beard are much busier. */
  busy: number
  /** The box (pixels) busyness is read over, about the face's size. */
  radius: number
}

/**
 * Fine detail against brightness at each pixel: the mean squared luma gradient over a box of
 * `radius`, square-rooted, over the luma. Skin is smooth; hair, brows and beard are strands.
 * Gradients across the person's outline (`mask`) are left out: the edge against the background
 * is no detail of the skin.
 */
function busyness(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  radius: number,
  mask: Uint8Array | null = null,
): Float32Array {
  const luma = new Float32Array(width * height)
  for (let i = 0; i < luma.length; i++) {
    luma[i] = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!
  }
  const energy = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const inside = (j: number) => !mask || mask[j]! > 127
      const gx =
        x > 0 && x < width - 1 && inside(i - 1) && inside(i + 1)
          ? (luma[i + 1]! - luma[i - 1]!) / 2
          : 0
      const gy =
        y > 0 && y < height - 1 && inside(i - width) && inside(i + width)
          ? (luma[i + width]! - luma[i - width]!) / 2
          : 0
      row += gx * gx + gy * gy
      energy[(y + 1) * (width + 1) + x + 1] = energy[y * (width + 1) + x + 1]! + row
    }
  }
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width, x + radius + 1)
      const total =
        energy[y1 * (width + 1) + x1]! -
        energy[y0 * (width + 1) + x1]! -
        energy[y1 * (width + 1) + x0]! +
        energy[y0 * (width + 1) + x0]!
      out[y * width + x] =
        Math.sqrt(total / ((x1 - x0) * (y1 - y0))) / Math.max(8, luma[y * width + x]!)
    }
  }
  return out
}

const toYcc = (r: number, g: number, b: number) => {
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  return [
    y,
    128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  ] as const
}

/** Cheek landmarks well clear of the eyes, nose, mouth and beard line. */
const CHEEKS = [50, 280, 205, 425, 101, 330, 36, 266, 187, 411, 117, 346, 118, 347, 123, 352]

/** The skin model of a face from small disks on its cheeks (MediaPipe landmarks in pixels). */
export function skinModel(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  landmarks: ArrayLike<number>,
): SkinModel | null {
  const iod = Math.hypot(
    landmarks[468 * 2]! - landmarks[473 * 2]!,
    landmarks[468 * 2 + 1]! - landmarks[473 * 2 + 1]!,
  )
  const radius = Math.max(2, Math.round(0.06 * iod))
  const busyRadius = Math.max(1, Math.round(0.03 * iod))
  const busy = busyness(rgba, width, height, busyRadius)
  const busySamples: number[] = []
  const samples: [number, number, number][] = []
  for (const l of CHEEKS) {
    const cx = Math.round(landmarks[l * 2]!)
    const cy = Math.round(landmarks[l * 2 + 1]!)
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue
        const i = (y * width + x) * 4
        samples.push(toYcc(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) as [number, number, number])
        busySamples.push(busy[y * width + x]!)
      }
    }
  }
  if (samples.length < 30) return null
  // Drop the darkest and brightest fifth (shadow, shine, freckles).
  samples.sort((a, b) => a[0] - b[0])
  const kept = samples.slice(Math.floor(samples.length * 0.2), Math.ceil(samples.length * 0.8))
  let cb = 0
  let cr = 0
  let luma = 0
  for (const [y, b, r] of kept) {
    cb += b
    cr += r
    luma += y
  }
  cb /= kept.length
  cr /= kept.length
  luma /= kept.length
  let sbb = 0
  let sbr = 0
  let srr = 0
  for (const [, b, r] of kept) {
    sbb += (b - cb) ** 2
    sbr += (b - cb) * (r - cr)
    srr += (r - cr) ** 2
  }
  // Never tighter than a few levels: one photo's cheeks don't show all of a skin's colours.
  sbb = sbb / kept.length + 9
  srr = srr / kept.length + 9
  sbr /= kept.length
  const det = sbb * srr - sbr * sbr
  busySamples.sort((a, b) => a - b)
  return {
    cb,
    cr,
    inv: [srr / det, -sbr / det, sbb / det],
    luma,
    busy: Math.max(0.01, busySamples[Math.floor(busySamples.length * 0.75)]!),
    radius: busyRadius,
  }
}

/**
 * Each pixel against `model` (0–255): how skin-like it is (its colour, lightness and smoothness),
 * and how covered — strands of hair or beard, whatever their colour (detail far busier than the
 * cheeks'). `mask` (the person) keeps their outline's edge out of the detail.
 */
export function skinMaps(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  model: SkinModel,
  mask: Uint8Array | null = null,
): { skin: Uint8Array; covered: Uint8Array } {
  const skin = new Uint8Array(width * height)
  const covered = new Uint8Array(width * height)
  const [a, b, c] = model.inv
  // The photo's own scale may differ from the front one's (a side photo nearer or further): the
  // box is the front photo's, which is close enough for telling strands from skin.
  const busy = busyness(rgba, width, height, model.radius, mask)
  for (let i = 0; i < width * height; i++) {
    const [y, cb, cr] = toYcc(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!)
    const db = cb - model.cb
    const dr = cr - model.cr
    const d2 = a * db * db + 2 * b * db * dr + c * dr * dr
    // Chroma within about three deviations; lightness from a third of the cheeks' to well above;
    // detail up to about twice the cheeks' (blond hair has skin's colour, not its smoothness).
    const chroma = Math.exp(-d2 / 18)
    const lightness = Math.min(1, Math.max(0, (y / model.luma - 0.3) / 0.25))
    const busier = busy[i]! / model.busy
    const smooth = Math.min(1, Math.max(0, (2.6 - busier) / 1.2))
    skin[i] = Math.round(255 * chroma * lightness * smooth)
    covered[i] = Math.round(255 * Math.min(1, Math.max(0, (busier - 2) / 1.2)))
  }
  return { skin, covered }
}

/**
 * The hair's colour (linear RGB, as the photo shows it), from the person's
 * pixels above the forehead that are not skin; null when too few are (a
 * shaved head, a hat).
 */
export function hairColor(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  landmarks: ArrayLike<number>,
  mask: Uint8Array | null,
  skin: Uint8Array,
): [number, number, number] | null {
  const top = landmarks[10 * 2 + 1]!
  const chin = landmarks[152 * 2 + 1]!
  const face = chin - top
  const left = landmarks[234 * 2]!
  const right = landmarks[454 * 2]!
  const reds: number[] = []
  const greens: number[] = []
  const blues: number[] = []
  for (let y = Math.max(0, Math.round(top - 0.45 * face)); y < Math.round(top); y++) {
    for (let x = Math.max(0, Math.round(left)); x < Math.min(width, Math.round(right)); x++) {
      const i = y * width + x
      if (mask && mask[i]! < 128) continue
      if (skin[i]! > 64) continue
      reds.push(rgba[i * 4]!)
      greens.push(rgba[i * 4 + 1]!)
      blues.push(rgba[i * 4 + 2]!)
    }
  }
  if (reds.length < 100 || reds.length < 0.15 * face * (right - left) * 0.45) return null
  const median = (values: number[]) => values.sort((p, q) => p - q)[Math.floor(values.length / 2)]!
  const lin = (byte: number) => {
    const c = byte / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return [lin(median(reds)), lin(median(greens)), lin(median(blues))]
}
