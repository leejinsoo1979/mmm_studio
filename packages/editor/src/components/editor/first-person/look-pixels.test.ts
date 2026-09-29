import { describe, expect, test } from 'bun:test'
import {
  bakeFace,
  dye,
  FACE_OVAL,
  type HeadTriangle,
  hairMask,
  luminance,
  type Pixels,
  similarityMask,
} from './look-pixels'

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

describe('laying a face photo over the head', () => {
  // One square of face, head-on, filling the texture and the front view.
  const square: HeadTriangle[] = [
    { u: [0, 1, 0], v: [0, 0, 1], x: [0, 1, 0], y: [0, 0, 1], z: [0, 0, 0], n: [1, 1, 1] },
    { u: [1, 1, 0], v: [0, 1, 1], x: [1, 1, 0], y: [0, 1, 1], z: [0, 0, 0], n: [1, 1, 1] },
  ]

  test('the photo lands where it was placed, inside the face', () => {
    const texture = image(64, 64, () => [200, 160, 130])
    // A photo whose left half is blue and right half red.
    const photo = image(32, 32, (x) => (x < 16 ? [0, 0, 255] : [255, 0, 0]))
    bakeFace(texture, square, photo, { x: 0.5, y: FACE_OVAL.y, scale: 0.8, rotation: 0 }, 0)
    const y = Math.round(FACE_OVAL.y * 64)
    const left = at(texture, Math.round((FACE_OVAL.x - 0.1) * 64), y)
    const right = at(texture, Math.round((FACE_OVAL.x + 0.1) * 64), y)
    expect(left[2]!).toBeGreaterThan(200)
    expect(right[0]!).toBeGreaterThan(200)
    // Outside the face oval the skin is untouched.
    expect(at(texture, 2, 2)).toEqual([200, 160, 130])
  })

  test('turned sideways, the head keeps its own skin', () => {
    const texture = image(16, 16, () => [200, 160, 130])
    const photo = image(8, 8, () => [0, 0, 255])
    const sideways = square.map((tri) => ({ ...tri, n: [0.1, 0.1, 0.1] }))
    bakeFace(texture, sideways, photo, { x: 0.5, y: 0.5, scale: 1, rotation: 0 }, 0)
    expect(at(texture, 8, 8)).toEqual([200, 160, 130])
  })

  test('full skin matching moves the photo’s colours to the skin’s', () => {
    const texture = image(64, 64, () => [200, 160, 130])
    const photo = image(32, 32, (x, y) => [100 + ((x + y) % 2) * 20, 60, 50])
    bakeFace(texture, square, photo, { x: 0.5, y: FACE_OVAL.y, scale: 1, rotation: 0 }, 1)
    const centre = at(texture, Math.round(FACE_OVAL.x * 64), Math.round(FACE_OVAL.y * 64))
    expect(Math.abs(centre[1]! - 160)).toBeLessThan(12)
  })
})
