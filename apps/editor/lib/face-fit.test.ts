import { describe, expect, test } from 'bun:test'
import { FACE_PARTS, FACE_POINT_COUNT, type FacePoint, unpackPoints } from '@pascal-app/editor'
import { pointsFromMarks } from './face-fit'

/** A character's face points: every point at the face's centre but its eyes and lips. */
function character(): number[] {
  const points: FacePoint[] = Array.from({ length: FACE_POINT_COUNT }, () => [0.5, 0.55])
  for (const i of FACE_PARTS.rightEye) points[i] = [0.4, 0.45]
  for (const i of FACE_PARTS.leftEye) points[i] = [0.6, 0.45]
  for (const i of FACE_PARTS.lips) points[i] = [0.5, 0.67]
  return points.flat()
}

const mean = (points: FacePoint[], indices: readonly number[]): FacePoint => [
  indices.reduce((sum, i) => sum + points[i]![0], 0) / indices.length,
  indices.reduce((sum, i) => sum + points[i]![1], 0) / indices.length,
]

describe('face points from marked eyes and mouth', () => {
  test('the character’s eyes and mouth land on the marks', () => {
    // A portrait (4:3 tall) face 1.25× the character's: its mouth 0.22 × 1.25 of the
    // width below the eyes, in fractions of the height.
    const aspect = 4 / 3
    const marks: [FacePoint, FacePoint, FacePoint] = [
      [0.3, 0.4],
      [0.55, 0.4],
      [0.425, 0.4 + (0.22 * 1.25) / aspect],
    ]
    const points = unpackPoints(pointsFromMarks(marks, aspect, character()))
    const [rx, ry] = mean(points, FACE_PARTS.rightEye)
    const [lx, ly] = mean(points, FACE_PARTS.leftEye)
    const [mx, my] = mean(points, FACE_PARTS.lips)
    expect(rx).toBeCloseTo(0.3, 3)
    expect(ry).toBeCloseTo(0.4, 3)
    expect(lx).toBeCloseTo(0.55, 3)
    expect(ly).toBeCloseTo(0.4, 3)
    expect(mx).toBeCloseTo(0.425, 3)
    expect(my).toBeCloseTo(marks[2][1], 3)
  })

  test('a face longer than the character’s is met halfway between its width and length', () => {
    const marks: [FacePoint, FacePoint, FacePoint] = [
      [0.4, 0.4],
      [0.6, 0.4],
      [0.5, 0.4 + 0.22 * 1.5],
    ]
    const points = unpackPoints(pointsFromMarks(marks, 1, character()))
    const spacing = mean(points, FACE_PARTS.leftEye)[0] - mean(points, FACE_PARTS.rightEye)[0]
    expect(spacing).toBeCloseTo(0.2 * Math.sqrt(1.5), 3)
  })

  test('a tilted face turns the points with it', () => {
    const marks: [FacePoint, FacePoint, FacePoint] = [
      [0.4, 0.4],
      [0.6, 0.5],
      [0.45, 0.65],
    ]
    const points = unpackPoints(pointsFromMarks(marks, 1, character()))
    const [rx, ry] = mean(points, FACE_PARTS.rightEye)
    const [lx, ly] = mean(points, FACE_PARTS.leftEye)
    expect(Math.atan2(ly - ry, lx - rx)).toBeCloseTo(Math.atan2(0.1, 0.2), 3)
  })
})
