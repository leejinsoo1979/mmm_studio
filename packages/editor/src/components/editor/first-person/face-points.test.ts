import { describe, expect, test } from 'bun:test'
import {
  FACE_PARTS,
  FACE_POINT_COUNT,
  FACE_POINT_INDICES,
  faceRegion,
  featureRegions,
  isFacePoints,
  marginRing,
  type Point,
  packPoints,
  unpackPoints,
} from './face-points'

/** A face-like set of points: an outline ring, brows, eyes and lips at their usual heights. */
function face(): Point[] {
  const points: Point[] = Array.from({ length: FACE_POINT_COUNT }, () => [0.5, 0.6])
  FACE_PARTS.oval.forEach((i, k) => {
    const angle = (k / FACE_PARTS.oval.length) * Math.PI * 2 - Math.PI / 2
    points[i] = [0.5 + Math.cos(angle) * 0.25, 0.55 + Math.sin(angle) * 0.35]
  })
  for (const i of FACE_PARTS.brows) points[i] = [0.5, 0.42]
  for (const i of [...FACE_PARTS.leftEye, ...FACE_PARTS.rightEye]) points[i] = [0.5, 0.48]
  for (const i of FACE_PARTS.lips) points[i] = [0.5, 0.7]
  return points
}

describe('face points', () => {
  test('are distinct MediaPipe landmarks, and every part names some of them', () => {
    expect(new Set(FACE_POINT_INDICES).size).toBe(FACE_POINT_COUNT)
    expect(FACE_POINT_INDICES.every((i) => i >= 0 && i < 478)).toBe(true)
    for (const part of Object.values(FACE_PARTS)) {
      expect(part.length).toBeGreaterThan(0)
      expect(part.every((i) => i >= 0 && i < FACE_POINT_COUNT)).toBe(true)
    }
    expect(FACE_PARTS.oval).toHaveLength(36)
    // The warp leaves the irises (468–477) out.
    expect(FACE_PARTS.warp.every((i) => FACE_POINT_INDICES[i]! < 468)).toBe(true)
  })

  test('pack and unpack round trip (to 1/10000)', () => {
    const points = face()
    const packed = packPoints(points)
    expect(isFacePoints(packed)).toBe(true)
    const back = unpackPoints(packed)
    back.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(points[i]![0], 4)
      expect(y).toBeCloseTo(points[i]![1], 4)
    })
    expect(isFacePoints(packed.slice(1))).toBe(false)
    expect(isFacePoints([...packed.slice(2), Number.NaN, 0])).toBe(false)
  })

  test('the swapped region cuts the forehead down towards the brows, and keeps the chin', () => {
    const points = face()
    const region = faceRegion(points)
    expect(region).toHaveLength(36)
    const top = Math.min(...region.map(([, y]) => y))
    const outlineTop = Math.min(...FACE_PARTS.oval.map((i) => points[i]![1]))
    expect(top).toBeGreaterThan(outlineTop)
    // Brows at 0.42, eyes at 0.48: the region keeps a little forehead above the brows.
    expect(top).toBeLessThan(0.42)
    const chin = Math.max(...region.map(([, y]) => y))
    expect(chin).toBeCloseTo(Math.max(...FACE_PARTS.oval.map((i) => points[i]![1])), 6)
  })

  test('the margin ring lies outside the outline', () => {
    const points = face()
    const ring = marginRing(points)
    FACE_PARTS.oval.forEach((i, k) => {
      const [x, y] = points[i]!
      const [rx, ry] = ring[k]!
      expect(Math.hypot(rx - 0.5, ry - 0.55)).toBeGreaterThan(Math.hypot(x - 0.5, y - 0.55))
    })
  })

  test('outlines each feature, grown past its points, clear of the cheeks', () => {
    const points: Point[] = face()
    const place = (indices: readonly number[], cx: number, cy: number, rx: number, ry: number) =>
      indices.forEach((i, k) => {
        const angle = (k / indices.length) * Math.PI * 2
        points[i] = [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
      })
    const half = FACE_PARTS.brows.length / 2
    place(FACE_PARTS.brows.slice(0, half), 0.6, 0.42, 0.06, 0.01)
    place(FACE_PARTS.brows.slice(half), 0.4, 0.42, 0.06, 0.01)
    place(FACE_PARTS.leftEye, 0.6, 0.48, 0.04, 0.015)
    place(FACE_PARTS.rightEye, 0.4, 0.48, 0.04, 0.015)
    place(FACE_PARTS.nose, 0.5, 0.56, 0.03, 0.05)
    place(FACE_PARTS.lips, 0.5, 0.7, 0.07, 0.02)
    const outlines = featureRegions(points)
    expect(outlines).toHaveLength(6)
    const inside = (outline: Point[], [x, y]: Point) => {
      let crossings = 0
      for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const [xi, yi] = outline[i]!
        const [xj, yj] = outline[j]!
        if (yi > y !== yj > y && x < xi + ((xj - xi) * (y - yi)) / (yj - yi)) crossings++
      }
      return crossings % 2 === 1
    }
    const parts = [
      FACE_PARTS.brows.slice(0, half),
      FACE_PARTS.brows.slice(half),
      FACE_PARTS.rightEye,
      FACE_PARTS.leftEye,
      FACE_PARTS.nose,
      FACE_PARTS.lips,
    ]
    parts.forEach((part, k) => {
      for (const i of part) expect(inside(outlines[k]!, points[i]!)).toBe(true)
    })
    // Grown: a little above the brow's top edge is inside; a cheek is in none.
    expect(inside(outlines[0]!, [0.6, 0.405])).toBe(true)
    expect(outlines.some((outline) => inside(outline, [0.34, 0.6]))).toBe(false)
  })
})
