import { describe, expect, test } from 'bun:test'
import { connectedFrom, dilate, erode, fillFrom } from './face-fill'
import type { Pixels } from './look-pixels'

function image(width: number, height: number, fill: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([...fill(x, y), 255], (y * width + x) * 4)
  }
  return { data, width, height }
}

const at = (pixels: Pixels, x: number, y: number) => [
  ...pixels.data.slice((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 3),
]

const mask = (width: number, height: number, on: (x: number, y: number) => boolean) =>
  Float32Array.from({ length: width * height }, (_, i) =>
    on(i % width, Math.floor(i / width)) ? 1 : 0,
  )

describe('filling in', () => {
  test('keeps what it knows and fills the rest from the nearest of it', () => {
    // Red known on the left, blue known on the right, a gap between; odd sizes.
    const width = 41
    const height = 13
    const source = image(width, height, (x) =>
      x < 10 ? [200, 0, 0] : x > 30 ? [0, 0, 200] : [0, 255, 0],
    )
    const known = mask(width, height, (x) => x < 10 || x > 30)
    const filled = fillFrom(source, known)
    expect(at(filled, 3, 6)).toEqual([200, 0, 0])
    expect(at(filled, 37, 6)).toEqual([0, 0, 200])
    // No trace of the unknown green; red near the red, blue near the blue.
    for (let x = 10; x <= 30; x++) expect(at(filled, x, 6)[1]).toBe(0)
    expect(at(filled, 11, 6)[0]!).toBeGreaterThan(at(filled, 11, 6)[2]!)
    expect(at(filled, 29, 6)[2]!).toBeGreaterThan(at(filled, 29, 6)[0]!)
    // Opaque everywhere.
    for (let p = 3; p < filled.data.length; p += 4) expect(filled.data[p]).toBe(255)
  })

  test('mixes a partly known pixel with the fill', () => {
    const source = image(8, 8, (x, y) => (x === 4 && y === 4 ? [0, 0, 0] : [100, 100, 100]))
    const known = new Float32Array(64).fill(1)
    known[4 * 8 + 4] = 0.5
    expect(at(fillFrom(source, known), 4, 4)[0]).toBeCloseTo(50, -1)
  })

  test('is black with nothing known', () => {
    const filled = fillFrom(
      image(5, 7, () => [90, 90, 90]),
      new Float32Array(35),
    )
    expect(at(filled, 2, 3)).toEqual([0, 0, 0])
  })
})

describe('mask morphology', () => {
  const square = () => mask(20, 20, (x, y) => x >= 6 && x < 14 && y >= 6 && y < 14)
  const count = (values: Float32Array) => values.reduce((sum, v) => sum + v, 0)

  test('erodes and dilates by whole pixels', () => {
    expect(count(erode(square(), 20, 20, 2))).toBe(4 * 4)
    expect(count(dilate(square(), 20, 20, 2))).toBe(12 * 12)
    expect(count(erode(square(), 20, 20, 0))).toBe(8 * 8)
  })

  test('keeps only what is connected to the seeds', () => {
    // A band along the top reaching down, and a separate blob.
    const shapes = mask(
      20,
      20,
      (x, y) => y < 3 || (x === 5 && y < 8) || (x >= 12 && x < 15 && y >= 10 && y < 13),
    )
    const seeds = mask(20, 20, (_, y) => y < 1)
    const kept = connectedFrom(shapes, seeds, 20, 20, 0.5)
    expect(kept[7 * 20 + 5]).toBe(1)
    expect(kept[11 * 20 + 13]).toBe(0)
    expect(count(kept)).toBe(60 + 5)
  })
})
