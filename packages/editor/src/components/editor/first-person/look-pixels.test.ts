import { describe, expect, test } from 'bun:test'
import { dye, hairMask, luminance, type Pixels, similarityMask, toneSkin } from './look-pixels'

function image(width: number, height: number, fill: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fill(x, y)
      data.set([r!, g!, b!, a], (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

const at = (pixels: Pixels, x: number, y: number) => {
  const p = (y * pixels.width + x) * 4
  return [...pixels.data.slice(p, p + 3)]
}

describe('dyeing', () => {
  test('takes the new colour and keeps the shading', () => {
    // Brown hair: a dark strand and a light one.
    const hair = image(2, 1, (x) => (x === 0 ? [40, 28, 20] : [90, 64, 46]))
    const before = [luminance(40, 28, 20), luminance(90, 64, 46)]
    dye(hair, [140, 30, 50], (before[0]! + before[1]!) / 2)
    const [dark, light] = [at(hair, 0, 0), at(hair, 1, 0)]
    // Red now: red well above green and blue in both.
    for (const strand of [dark, light]) expect(strand[0]!).toBeGreaterThan(strand[1]! * 2)
    // The light strand stays lighter, by about as much as before.
    const ratio =
      luminance(...(light as [number, number, number])) /
      luminance(...(dark as [number, number, number]))
    expect(ratio).toBeCloseTo(before[1]! / before[0]!, 0)
  })

  test('evens out a dark texture’s contrast the more a dye lightens it', () => {
    // Dark skin with pores at half its lightness.
    const skin = () => image(2, 1, (x) => (x === 0 ? [80, 55, 42] : [40, 28, 21]))
    const ref = luminance(80, 55, 42)
    const contrast = (pixels: Pixels) =>
      luminance(...(at(pixels, 0, 0) as [number, number, number])) /
      luminance(...(at(pixels, 1, 0) as [number, number, number]))
    const slightly = skin()
    dye(slightly, [100, 70, 55], ref)
    const much = skin()
    dye(much, [210, 160, 135], ref)
    expect(contrast(slightly)).toBeGreaterThan(1.7)
    expect(contrast(much)).toBeLessThan(contrast(slightly))
    expect(contrast(much)).toBeGreaterThan(1.2)
  })

  test('leaves what the mask leaves out, and see-through pixels', () => {
    const pixels = image(2, 1, (x) => (x === 0 ? [200, 150, 120] : [200, 150, 120, 0]))
    dye(pixels, [50, 50, 200], 150, new Float32Array([0, 1]))
    expect(at(pixels, 0, 0)).toEqual([200, 150, 120])
  })
})

describe('masks', () => {
  const skin: [number, number, number] = [210, 160, 130]
  const hair: [number, number, number] = [60, 40, 28]

  test('skin in shadow is still skin; a blue shirt is not', () => {
    const pixels = image(3, 1, (x) => [skin, [120, 90, 74], [40, 60, 160]][x]!)
    const mask = similarityMask(pixels, skin)
    expect(mask[0]).toBeCloseTo(1, 1)
    expect(mask[1]!).toBeGreaterThan(0.5)
    expect(mask[2]!).toBeLessThan(0.1)
  })

  test('hair on the scalp is told from the skin beside it', () => {
    const pixels = image(3, 1, (x) => [hair, skin, [0, 0, 0]][x]!)
    const mask = hairMask(pixels, hair, skin)
    expect(mask[0]).toBeCloseTo(1, 2)
    expect(mask[1]).toBeCloseTo(0, 2)
    // UV padding.
    expect(mask[2]).toBe(0)
  })
})

describe('toning skin', () => {
  const SKIN = [150, 110, 85]
  const LIPS = [170, 90, 95]
  const SHADOW = [90, 60, 45]
  const face = () => image(4, 1, (x) => [SKIN, LIPS, SHADOW, SKIN][x]!)
  const at = (pixels: Pixels, x: number) => [...pixels.data.slice(x * 4, x * 4 + 3)]
  const redness = ([r, g]: number[]) => r! - g!

  test('the skin’s usual colour becomes the tone; the lips stay redder and the shadow darker', () => {
    const toned = face()
    toneSkin(
      toned,
      [234, 195, 166],
      SKIN as [number, number, number],
      new Float32Array([1, 1, 1, 0]),
    )
    for (const [i, c] of at(toned, 0).entries()) {
      expect(Math.abs(c - [234, 195, 166][i]!)).toBeLessThanOrEqual(1)
    }
    expect(redness(at(toned, 1))).toBeGreaterThan(redness(at(toned, 0)) + 10)
    expect(luminance(...(at(toned, 2) as [number, number, number]))).toBeLessThan(
      luminance(...(at(toned, 0) as [number, number, number])) - 30,
    )
    // Outside the mask, nothing changes.
    expect(at(toned, 3)).toEqual(SKIN)
  })

  test('a much lighter tone keeps some shading but no chalk: the shadow keeps its warmth', () => {
    const toned = face()
    toneSkin(
      toned,
      [243, 217, 200],
      SKIN as [number, number, number],
      new Float32Array([1, 1, 1, 1]),
    )
    const [r, , b] = at(toned, 2)
    expect(r! - b!).toBeGreaterThan(15)
  })
})
