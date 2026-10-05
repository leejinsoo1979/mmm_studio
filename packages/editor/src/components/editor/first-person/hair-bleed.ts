import type { Texture } from 'three'
import type { Pixels } from './look-pixels'

/**
 * Hair cards' colour under their see-through texels. Rocketbox paints the
 * strands over black where the cards are transparent (with the WebP's
 * lossy junk round them), and a texture read through a canvas — as a
 * look's dye reads it — comes back black under every transparent texel.
 * Drawn cut out, the strands' edges are filtered with that black, between
 * texels and down the mipmaps, and the hair goes dark in streaks and
 * patches. Bled, those texels carry the strands' own colour instead; their
 * alpha, and every texel that shows as it is, stay.
 */

/**
 * Texels less opaque than this are cut away by every card material (0.3 at
 * the lowest, under alpha to coverage): only filtering reaches them. Those
 * at least this opaque show as painted — strands' soft edges, and gear's
 * see-through visors.
 */
export const BLEED_BELOW = 77

/**
 * How many texels out from what shows its colours are carried, a ring at a
 * time (as far as a 16th-size mipmap's texel reaches); further out, their
 * mean colour.
 */
const BLEED_REACH = 16

/**
 * Bleeds hair cards' colour under their see-through texels, in place: each
 * texel less opaque than `below` (0–255) takes the mean colour of its
 * neighbours (of the eight round it) that show or were bled a ring before
 * it, out to BLEED_REACH rings; the rest the mean colour of all that show.
 * Only the colour changes, never alpha.
 */
export function bleedHair(pixels: Pixels, below = BLEED_BELOW) {
  const { data, width, height } = pixels
  const count = width * height
  // The ring each texel is settled in (1 for those that show, 0 for none
  // yet), and the texels in the order they are: ring by ring.
  const ring = new Uint8Array(count)
  const order = new Int32Array(count)
  let queued = 0
  const mean = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    if (data[i * 4 + 3]! < below) continue
    ring[i] = 1
    order[queued++] = i
    for (let c = 0; c < 3; c++) mean[c]! += data[i * 4 + c]!
  }
  const shown = queued
  if (shown === 0 || shown === count) return
  for (let next = 0; next < queued; next++) {
    const i = order[next]!
    const own = ring[i]!
    const x = i % width
    const y = (i - x) / width
    const left = x > 0 ? -1 : 0
    const right = x < width - 1 ? 1 : 0
    const up = y > 0 ? -1 : 0
    const down = y < height - 1 ? 1 : 0
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let dy = up; dy <= down; dy++) {
      for (let dx = left; dx <= right; dx++) {
        const j = i + dy * width + dx
        const theirs = ring[j]!
        if (theirs === 0) {
          // Next ring's, unless that is out of reach.
          if (own <= BLEED_REACH) {
            ring[j] = own + 1
            order[queued++] = j
          }
        } else if (theirs < own) {
          r += data[j * 4]!
          g += data[j * 4 + 1]!
          b += data[j * 4 + 2]!
          n++
        }
      }
    }
    if (own === 1) continue
    data[i * 4] = r / n
    data[i * 4 + 1] = g / n
    data[i * 4 + 2] = b / n
  }
  for (let i = 0; i < count; i++) {
    if (ring[i]) continue
    for (let c = 0; c < 3; c++) data[i * 4 + c] = mean[c]! / shown
  }
}

/** A texture's picture as pixels, at `size` × `size` when given. */
export function texturePixels(texture: Texture, size?: number): Pixels {
  const image = texture.image as CanvasImageSource & { width: number; height: number }
  const width = size ?? image.width
  const height = size ?? image.height
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}

/**
 * Pixels as a texture's picture, their colours as they are: a canvas, or a
 * bitmap made from one, holds them premultiplied by alpha, so it would
 * darken every see-through texel and lose the colour bled under the cut
 * away ones.
 */
export const pictureOf = (pixels: Pixels) => new ImageData(pixels.data, pixels.width, pixels.height)

const bled = new WeakSet<Texture['source']>()

/**
 * Bleeds a hair cards' texture (see `bleedHair`) where it is, once: its
 * picture, shared with every copy of it, becomes the bled pixels.
 */
export function bleedTexture(texture: Texture) {
  const { source } = texture
  const image = source.data as { width?: number } | null
  if (bled.has(source) || !image?.width || typeof OffscreenCanvas === 'undefined') return
  bled.add(source)
  const pixels = texturePixels(texture)
  bleedHair(pixels)
  source.data = pictureOf(pixels)
  texture.needsUpdate = true
}
