import { describe, expect, test } from 'bun:test'
import type { Pixels, Rgb } from './look-pixels'
import { paintScalp, scalpTone } from './scalp-paint'

const SIZE = 16

function image(fill: (x: number, y: number) => Rgb): Pixels {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) data.set([...fill(x, y), 255], (y * SIZE + x) * 4)
  }
  return { data, width: SIZE, height: SIZE }
}

const at = (pixels: Pixels, x: number, y: number) => [
  ...pixels.data.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3),
]

/** The left half of the texture (x < 0.5) as two triangles, packed for painting with an amount per corner (top, then bottom). */
const leftHalf = (top: number, bottom: number) =>
  Float32Array.from([
    0,
    0,
    top,
    0.5,
    0,
    top,
    0.5,
    1,
    bottom,
    0,
    0,
    top,
    0.5,
    1,
    bottom,
    0,
    1,
    bottom,
  ])

const SKIN: Rgb = [200, 150, 120]
const HAIR: Rgb = [60, 40, 30]
const TONE: Rgb = [180, 130, 100]

describe('painting a bald head’s skin round the cut', () => {
  test('paints each texel as much as its corners say, grained, and leaves the rest', () => {
    const head = image(() => SKIN)
    paintScalp(head, { paint: leftHalf(1, 0), swatch: [0.9, 0.9] }, TONE, null)
    // Fully at the top of the painted half, within the grain.
    const top = at(head, 3, 0)
    top.forEach((value, c) => {
      expect(Math.abs(value - TONE[c]!)).toBeLessThan(TONE[c]! * 0.1)
    })
    // Hardly at its bottom, and not at all past it.
    const bottom = at(head, 3, SIZE - 1)
    expect(Math.abs(bottom[0]! - SKIN[0])).toBeLessThan(5)
    expect(at(head, 12, 4)).toEqual(SKIN)
  })

  test('paints the hair’s colour over wholly, wherever the triangles reach', () => {
    const head = image((x) => (x === 2 ? HAIR : SKIN))
    const hair = Float32Array.from({ length: SIZE * SIZE }, (_, i) => (i % SIZE === 2 ? 1 : 0))
    paintScalp(head, { paint: leftHalf(0, 0), swatch: [0.9, 0.9] }, TONE, hair)
    expect(Math.abs(at(head, 2, 8)[0]! - TONE[0])).toBeLessThan(TONE[0] * 0.1)
    expect(at(head, 4, 8)).toEqual(SKIN)
  })

  test('paints the swatch the tone itself, ungrained', () => {
    const head = image(() => HAIR)
    paintScalp(head, { paint: new Float32Array(), swatch: [0.75, 0.75] }, TONE, null)
    expect(at(head, 12, 12)).toEqual(TONE)
    expect(at(head, 2, 2)).toEqual(HAIR)
  })
})

describe('the scalp’s tone', () => {
  const whole = Float32Array.from([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])
  const left = Float32Array.from([0, 0, 0.5, 0, 0.5, 1, 0, 0, 0.5, 1, 0, 1])

  test('is the median of the skin the triangles cover, not its hair nor what isn’t skin', () => {
    // Skin in a few shades, hair down one column, a blue strap down another.
    const head = image((x, y) =>
      x === 3 ? HAIR : x === 5 ? [40, 60, 200] : [190 + (y % 3) * 10, 140, 110],
    )
    const hair = Float32Array.from({ length: SIZE * SIZE }, (_, i) => (i % SIZE === 3 ? 1 : 0))
    const skin = Float32Array.from({ length: SIZE * SIZE }, (_, i) => (i % SIZE === 5 ? 0 : 1))
    expect(scalpTone(head, [whole], hair, skin)).toEqual([200, 140, 110])
  })

  test('falls back to the next triangles where the first show too little skin, else none', () => {
    const head = image((x) => (x < 8 ? HAIR : SKIN))
    const hair = Float32Array.from({ length: SIZE * SIZE }, (_, i) => (i % SIZE < 8 ? 1 : 0))
    expect(scalpTone(head, [left, whole], hair, null)).toEqual(SKIN)
    expect(scalpTone(head, [left], hair, null)).toBeNull()
  })
})
