import { describe, expect, test } from 'bun:test'
import { distanceTo, faceOpenings, featherMask } from './features'
import { LIPS_INNER } from './landmark-sets'

describe('soft feature masks', () => {
  test('the distance to a region is the exact Euclidean one', () => {
    const width = 40
    const height = 30
    const inside = new Uint8Array(width * height)
    let seed = 5
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const marked: [number, number][] = []
    for (let k = 0; k < 12; k++) {
      const x = Math.floor(random() * width)
      const y = Math.floor(random() * height)
      inside[y * width + x] = 1
      marked.push([x, y])
    }
    const distance = distanceTo(inside, width, height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const exact = Math.min(...marked.map(([mx, my]) => Math.hypot(mx - x, my - y)))
        expect(distance[y * width + x]!).toBeCloseTo(exact, 5)
      }
    }
  })

  test('a feathered region is whole inside, gone outside and half on its edge, with no step', () => {
    const size = 64
    const inside = new Uint8Array(size * size)
    for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) inside[y * size + x] = 1
    const mask = featherMask(inside, size, size, 4)
    expect(mask[32 * size + 32]).toBe(1)
    expect(mask[2 * size + 2]).toBe(0)
    // Across the left edge (between x 15 and 16) it rises smoothly through ½.
    const row = Array.from({ length: 16 }, (_, k) => mask[32 * size + 8 + k]!)
    for (let k = 1; k < row.length; k++) {
      expect(row[k]!).toBeGreaterThanOrEqual(row[k - 1]!)
      expect(row[k]! - row[k - 1]!).toBeLessThan(0.3)
    }
    expect(mask[32 * size + 15]! + mask[32 * size + 16]!).toBeCloseTo(1, 1)
  })

  test('the inside of an open mouth is masked in the photo, nothing without landmarks', () => {
    expect(faceOpenings(null, 100, 100)).toBeNull()
    const landmarks = new Float32Array(478 * 2)
    // The inner lips round an ellipse about (50, 60), the corners (61, 291) on the outer lips.
    LIPS_INNER.forEach((l, k) => {
      const a = (2 * Math.PI * k) / LIPS_INNER.length
      landmarks[l * 2] = 50 + 15 * Math.cos(a)
      landmarks[l * 2 + 1] = 60 + 6 * Math.sin(a)
    })
    landmarks.set([30, 60], 61 * 2)
    landmarks.set([70, 60], 291 * 2)
    const mouth = faceOpenings(landmarks, 100, 100)!
    expect(mouth[60 * 100 + 50]).toBeGreaterThan(0.99)
    expect(mouth[40 * 100 + 50]).toBe(0)
    expect(mouth[60 * 100 + 10]).toBe(0)
  })
})
