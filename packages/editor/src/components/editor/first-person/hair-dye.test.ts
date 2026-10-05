import { describe, expect, test } from 'bun:test'
import { dyedPixels, dyeHair } from './hair-dye'
import type { Pixels } from './look-pixels'

const hair = (): Pixels => {
  const data = new Uint8ClampedArray(8 * 8 * 4)
  for (let i = 0; i < 64; i++) data.set([60 + i, 40 + (i % 7), 30, i % 3 === 0 ? 0 : 255], i * 4)
  return { data, width: 8, height: 8 }
}

describe('dyeing a borrowed hairstyle', () => {
  test('dyes every texel, those cut away too, and keeps the alpha', () => {
    const pixels = hair()
    const dyed = dyedPixels(pixels, 80, '#c04020')
    for (let i = 0; i < 64; i++) {
      expect(dyed.data[i * 4 + 3]).toBe(pixels.data[i * 4 + 3]!)
      // Redder than the brown it was, whether it shows or not.
      expect(dyed.data[i * 4]! - dyed.data[i * 4 + 2]!).toBeGreaterThan(
        pixels.data[i * 4]! - pixels.data[i * 4 + 2]!,
      )
    }
    expect(pixels.data).toEqual(hair().data)
  })

  test('off the main thread or not, the same pixels', async () => {
    const pixels = hair()
    const dyed = await dyeHair(pixels, 80, '#c04020')
    expect(dyed.data).toEqual(dyedPixels(pixels, 80, '#c04020').data)
  })
})
