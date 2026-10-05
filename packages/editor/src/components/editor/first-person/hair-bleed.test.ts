import { describe, expect, test } from 'bun:test'
import { BLEED_BELOW, bleedHair } from './hair-bleed'
import type { Pixels, Rgb } from './look-pixels'

/** A texture, black and transparent, `width` × `height`. */
function blank(width: number, height = 1): Pixels {
  return { data: new Uint8ClampedArray(width * height * 4), width, height }
}

const put = (pixels: Pixels, x: number, y: number, [r, g, b]: Rgb, alpha: number) =>
  pixels.data.set([r, g, b, alpha], (y * pixels.width + x) * 4)

const at = (pixels: Pixels, x: number, y = 0) => {
  const p = (y * pixels.width + x) * 4
  return [...pixels.data.slice(p, p + 4)]
}

const BROWN: Rgb = [120, 80, 50]
const GOLD: Rgb = [200, 160, 60]

describe('bleeding hair cards’ colour', () => {
  test('carries a strand’s colour under the see-through texels beside it, alpha untouched', () => {
    const pixels = blank(9, 3)
    for (let y = 0; y < 3; y++) put(pixels, 4, y, BROWN, 255)
    bleedHair(pixels)
    for (let y = 0; y < 3; y++) {
      expect(at(pixels, 3, y)).toEqual([...BROWN, 0])
      expect(at(pixels, 5, y)).toEqual([...BROWN, 0])
      expect(at(pixels, 0, y)).toEqual([...BROWN, 0])
      expect(at(pixels, 4, y)).toEqual([...BROWN, 255])
    }
  })

  test('leaves what shows as it is: a strand’s soft edge, a see-through visor', () => {
    const pixels = blank(4)
    put(pixels, 0, 0, BROWN, 255)
    put(pixels, 1, 0, [90, 60, 40], 150)
    put(pixels, 2, 0, [230, 230, 240], BLEED_BELOW)
    put(pixels, 3, 0, [0, 0, 0], BLEED_BELOW - 1)
    bleedHair(pixels)
    expect(at(pixels, 1)).toEqual([90, 60, 40, 150])
    expect(at(pixels, 2)).toEqual([230, 230, 240, BLEED_BELOW])
    // The faint one is cut away: it takes its neighbour's colour.
    expect(at(pixels, 3)).toEqual([230, 230, 240, BLEED_BELOW - 1])
  })

  test('meets midway between two strands, each ring from the one before', () => {
    const pixels = blank(7)
    put(pixels, 0, 0, BROWN, 255)
    put(pixels, 6, 0, GOLD, 255)
    bleedHair(pixels)
    expect(at(pixels, 1).slice(0, 3)).toEqual(BROWN)
    expect(at(pixels, 2).slice(0, 3)).toEqual(BROWN)
    // Between two texels bled in the same ring, from either side.
    expect(at(pixels, 3).slice(0, 3)).toEqual([160, 120, 55])
    expect(at(pixels, 5).slice(0, 3)).toEqual(GOLD)
  })

  test('fills what is out of reach with the mean colour of what shows', () => {
    const pixels = blank(40)
    put(pixels, 0, 0, BROWN, 255)
    put(pixels, 1, 0, GOLD, 255)
    bleedHair(pixels)
    expect(at(pixels, 39)).toEqual([160, 120, 55, 0])
    // Within reach, the nearer strand's own.
    expect(at(pixels, 10).slice(0, 3)).toEqual(GOLD)
  })

  test('filters to the strand’s colour, never darker, at its edge and down the mipmaps', () => {
    const pixels = blank(8, 8)
    for (let y = 0; y < 8; y++) put(pixels, 3, y, BROWN, 255)
    bleedHair(pixels)
    // A 2×2 mipmap texel over the strand and its see-through side.
    const mip = [0, 1, 2].map(
      (c) =>
        (pixels.data[(0 * 8 + 2) * 4 + c]! +
          pixels.data[(0 * 8 + 3) * 4 + c]! +
          pixels.data[(1 * 8 + 2) * 4 + c]! +
          pixels.data[(1 * 8 + 3) * 4 + c]!) /
        4,
    )
    expect(mip).toEqual(BROWN)
  })

  test('cuts at the threshold it is given (a cap cut out at half)', () => {
    const pixels = blank(3)
    put(pixels, 0, 0, BROWN, 255)
    put(pixels, 1, 0, [200, 150, 120], 100)
    bleedHair(pixels, 128)
    expect(at(pixels, 1)).toEqual([...BROWN, 100])
  })

  test('leaves a texture with nothing showing, or nothing see-through, be', () => {
    const empty = blank(3)
    put(empty, 1, 0, [10, 20, 30], 10)
    bleedHair(empty)
    expect(at(empty, 1)).toEqual([10, 20, 30, 10])
    expect(at(empty, 0)).toEqual([0, 0, 0, 0])
    const solid = blank(2)
    put(solid, 0, 0, BROWN, 255)
    put(solid, 1, 0, GOLD, 200)
    bleedHair(solid)
    expect(at(solid, 1)).toEqual([...GOLD, 200])
  })
})
