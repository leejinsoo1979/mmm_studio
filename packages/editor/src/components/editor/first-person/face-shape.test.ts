import { describe, expect, test } from 'bun:test'
import { FACE_PARTS, FACE_POINT_COUNT, facePointOf, type Point, packPoints } from './face-points'
import { faceShapeField, hasSliders, photoResiduals, readFaceShape } from './face-shape'

/**
 * A face's points, mirror-symmetric across x = 0.5: the outline, features
 * and irises where a face has them, the rest spread over it in mirrored
 * pairs (the middle ones on the middle).
 */
function facePoints(): Point[] {
  const points: Point[] = Array.from({ length: FACE_POINT_COUNT }, () => [0.5, 0.6] as Point)
  const ring = (indices: readonly number[], cx: number, cy: number, rx: number, ry: number) =>
    indices.forEach((i, k) => {
      const angle = (k / indices.length) * Math.PI * 2 - Math.PI / 2
      points[i] = [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
    })
  const placed = new Set<number>()
  const place = (indices: readonly number[], cx: number, cy: number, rx: number, ry: number) => {
    ring(indices, cx, cy, rx, ry)
    for (const i of indices) placed.add(i)
  }
  place(FACE_PARTS.oval, 0.5, 0.58, 0.34, 0.4)
  place(FACE_PARTS.rightIris, 0.38, 0.46, 0.012, 0.012)
  place(FACE_PARTS.leftIris, 0.62, 0.46, 0.012, 0.012)
  points[FACE_PARTS.rightIris[0]!] = [0.38, 0.46]
  points[FACE_PARTS.leftIris[0]!] = [0.62, 0.46]
  // Everything else: pairs mirrored across the middle, spread down the face.
  const rest = points.map((_, i) => i).filter((i) => !placed.has(i))
  rest.forEach((i, k) => {
    const row = Math.floor(k / 2)
    const x = 0.08 + ((row * 7) % 23) / 100
    const y = 0.32 + ((row * 11) % 50) / 100
    points[i] = [k % 2 ? 0.5 + x : 0.5 - x, y]
  })
  return points
}

const target = packPoints(facePoints())

/** The points moved, turned and scaled as a whole (a photo of the same face, framed otherwise). */
function framed(points: Point[], scale: number, angle: number, shift: Point): Point[] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return points.map(([x, y]) => [
    0.5 + scale * ((x - 0.5) * cos - (y - 0.5) * sin) + shift[0],
    0.5 + scale * ((x - 0.5) * sin + (y - 0.5) * cos) + shift[1],
  ])
}

describe('a face shape as saved', () => {
  test('keeps known sliders in range, drops the rest', () => {
    const shape = readFaceShape({
      fit: 3,
      sliders: { eyeSize: 2, noseWidth: -0.4, wings: 1, jawWidth: 'x' },
    })
    expect(shape).toEqual({ fit: 1, sliders: { eyeSize: 1, noseWidth: -0.4 } })
    expect(readFaceShape(null)).toEqual({ fit: 1, sliders: {} })
    expect(hasSliders(shape)).toBe(true)
    expect(hasSliders(readFaceShape({ sliders: { eyeSize: 0 } }))).toBe(false)
  })
})

describe('a photo’s face against the character’s', () => {
  test('the same face, framed otherwise, differs in nothing', () => {
    const photo = packPoints(framed(facePoints(), 1.7, 0.12, [0.03, -0.05]))
    for (const offset of photoResiduals(photo, target)) {
      if (!offset) continue
      expect(Math.abs(offset[0])).toBeLessThan(1e-3)
      expect(Math.abs(offset[1])).toBeLessThan(1e-3)
    }
  })

  test('a narrower jaw comes through, the same on both sides', () => {
    const points = facePoints()
    const jaw = [172, 397].map(facePointOf)
    for (const i of jaw) points[i] = [0.5 + (points[i]![0] - 0.5) * 0.8, points[i]![1]]
    const offsets = photoResiduals(packPoints(points), target)
    const [right, left] = jaw.map((i) => offsets[i]!)
    // The image's left jaw moves right, the other left, by as much.
    expect(right![0]).toBeGreaterThan(0.01)
    expect(left![0]).toBeCloseTo(-right![0], 6)
    expect(right![1]).toBeCloseTo(left![1], 6)
  })

  test('the irises (they follow the gaze) and the hairline say nothing', () => {
    const offsets = photoResiduals(target, target)
    expect(offsets[FACE_PARTS.rightIris[0]!]).toBeNull()
    expect(offsets[facePointOf(10)]).toBeNull()
  })
})

describe('the shape’s field', () => {
  test('nothing to do: no field', () => {
    expect(faceShapeField(target, { fit: 1, sliders: {} }, null)).toBeNull()
    expect(faceShapeField(target, { fit: 0, sliders: {} }, target)).toBeNull()
  })

  test('the eyes set wider apart move out, each its own way, and the chin stays', () => {
    const field = faceShapeField(target, { fit: 1, sliders: { eyeSpacing: 1 } }, null)!
    const out = [0, 0, 0]
    field(0.38, 0.46, out)
    expect(out[0]).toBeLessThan(0)
    field(0.62, 0.46, out)
    expect(out[0]).toBeGreaterThan(0)
    field(0.5, 0.97, out)
    expect(out).toEqual([0, 0, 0])
  })

  test('a higher nose comes out of the face; far from the face nothing moves', () => {
    const field = faceShapeField(target, { fit: 1, sliders: { noseHeight: 1 } }, null)!
    // Down the bridge, from its top to the tip.
    const [top, tip] = [6, 4].map((landmark) => facePoints()[facePointOf(landmark)]!)
    const out = [0, 0, 0]
    field((top![0] + tip![0]) / 2, (top![1] + tip![1]) / 2, out)
    expect(out[2]).toBeGreaterThan(0)
    field(0.02, 0.02, out)
    expect(out).toEqual([0, 0, 0])
  })

  test('a photo’s narrower jaw pulls the character’s in', () => {
    const points = facePoints()
    const jaw = facePointOf(172)
    points[jaw] = [0.5 + (points[jaw]![0] - 0.5) * 0.8, points[jaw]![1]]
    const field = faceShapeField(target, { fit: 1, sliders: {} }, packPoints(points))!
    const at = facePoints()[jaw]!
    const out = [0, 0, 0]
    field(at[0], at[1], out)
    // The image's left jaw, pulled towards the middle.
    expect(out[0]).toBeGreaterThan(0)
  })
})
