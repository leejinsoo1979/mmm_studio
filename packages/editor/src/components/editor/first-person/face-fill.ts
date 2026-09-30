import type { Pixels } from './look-pixels'

/**
 * `image` with the pixels it doesn't know filled in smoothly from those it
 * does (`known`, 0–1 per pixel: how much of each pixel to keep), by
 * push–pull: the known colours are averaged down a pyramid of half-size
 * levels until every cell has some, then each level fills its gaps from the
 * one below, upsampled bilinearly. Alpha comes out opaque; with nothing
 * known the image comes back black.
 */
export function fillFrom(image: Pixels, known: Float32Array): Pixels {
  const { width, height } = image
  // Each level: premultiplied colour and weight (≤ 1), per cell.
  const levels: { w: number; h: number; color: Float32Array; weight: Float32Array }[] = []
  let color = new Float32Array(width * height * 3)
  let weight = new Float32Array(width * height)
  for (let i = 0, p = 0; i < weight.length; i++, p += 4) {
    const k = Math.min(1, Math.max(0, known[i]!))
    weight[i] = k
    for (let c = 0; c < 3; c++) color[i * 3 + c] = image.data[p + c]! * k
  }
  levels.push({ w: width, h: height, color, weight })
  for (let w = width, h = height; w > 1 || h > 1; ) {
    const cw = Math.ceil(w / 2)
    const ch = Math.ceil(h / 2)
    const coarseColor = new Float32Array(cw * ch * 3)
    const coarseWeight = new Float32Array(cw * ch)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const j = (y >> 1) * cw + (x >> 1)
        coarseWeight[j]! += weight[i]!
        for (let c = 0; c < 3; c++) coarseColor[j * 3 + c]! += color[i * 3 + c]!
      }
    }
    for (let j = 0; j < coarseWeight.length; j++) {
      const total = coarseWeight[j]!
      if (total <= 1) continue
      coarseWeight[j] = 1
      for (let c = 0; c < 3; c++) coarseColor[j * 3 + c]! /= total
    }
    color = coarseColor
    weight = coarseWeight
    w = cw
    h = ch
    levels.push({ w, h, color, weight })
  }

  // Pull: the coarsest level is its own average; each finer one keeps what
  // it knows and takes the rest from the level below.
  const top = levels[levels.length - 1]!
  let filled = new Float32Array(3)
  if (top.weight[0]! > 0) for (let c = 0; c < 3; c++) filled[c] = top.color[c]! / top.weight[0]!
  for (let l = levels.length - 2; l >= 0; l--) {
    const { w, h, color, weight } = levels[l]!
    const below = levels[l + 1]!
    const next = new Float32Array(w * h * 3)
    for (let y = 0; y < h; y++) {
      // A fine cell's centre, in the coarse level's cells (centres at +0.5).
      const sy = Math.min(below.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5))
      const y0 = Math.floor(sy)
      const y1 = Math.min(y0 + 1, below.h - 1)
      const ty = sy - y0
      for (let x = 0; x < w; x++) {
        const sx = Math.min(below.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5))
        const x0 = Math.floor(sx)
        const x1 = Math.min(x0 + 1, below.w - 1)
        const tx = sx - x0
        const i = y * w + x
        const rest = 1 - weight[i]!
        for (let c = 0; c < 3; c++) {
          const a = filled[(y0 * below.w + x0) * 3 + c]!
          const b = filled[(y0 * below.w + x1) * 3 + c]!
          const d = filled[(y1 * below.w + x0) * 3 + c]!
          const e = filled[(y1 * below.w + x1) * 3 + c]!
          const up = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty
          next[i * 3 + c] = color[i * 3 + c]! + rest * up
        }
      }
    }
    filled = next
  }

  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    data[p] = filled[i * 3]!
    data[p + 1] = filled[i * 3 + 1]!
    data[p + 2] = filled[i * 3 + 2]!
    data[p + 3] = 255
  }
  return { data, width, height }
}

/** A mask shrunk by `radius` pixels: each value the least within that square around it. */
export function erode(
  mask: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return mask.slice()
  const rows = new Float32Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let least = 1
      for (let k = Math.max(0, x - r); k <= Math.min(width - 1, x + r); k++) {
        least = Math.min(least, mask[y * width + k]!)
      }
      rows[y * width + x] = least
    }
  }
  const out = new Float32Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let least = 1
      for (let k = Math.max(0, y - r); k <= Math.min(height - 1, y + r); k++) {
        least = Math.min(least, rows[k * width + x]!)
      }
      out[y * width + x] = least
    }
  }
  return out
}

/** A mask grown by `radius` pixels: each value the most within that square around it. */
export function dilate(
  mask: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const inverse = mask.map((value) => 1 - value)
  return erode(inverse, width, height, radius).map((value) => 1 - value)
}

/**
 * The part of a mask connected to where `seeds` is set: its pixels above
 * `threshold` reachable (side by side) from one that is also a seed, with
 * their values; the rest 0.
 */
export function connectedFrom(
  mask: Float32Array,
  seeds: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Float32Array {
  const out = new Float32Array(mask.length)
  const queue = new Int32Array(mask.length)
  let head = 0
  let tail = 0
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]! > threshold && seeds[i]! > 0.5) {
      out[i] = mask[i]!
      queue[tail++] = i
    }
  }
  while (head < tail) {
    const i = queue[head++]!
    const x = i % width
    const y = (i - x) / width
    const visit = (j: number) => {
      if (out[j]! > 0 || mask[j]! <= threshold) return
      out[j] = mask[j]!
      queue[tail++] = j
    }
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (y > 0) visit(i - width)
    if (y < height - 1) visit(i + width)
  }
  return out
}
