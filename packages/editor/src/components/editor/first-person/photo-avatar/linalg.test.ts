import { describe, expect, test } from 'bun:test'
import {
  applySimilarity,
  boxQuadratic,
  choleskySolve,
  determinant3,
  type Mat3,
  mulMat3,
  nearestRotation,
  rotation,
  rotationLog,
  similarity,
  symmetricEigen3,
  transpose3,
  type Vec3,
} from './linalg'

const close = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 9) => {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) expect(a[i]!).toBeCloseTo(b[i]!, digits)
}

describe('choleskySolve', () => {
  test('solves a symmetric positive definite system', () => {
    const a = Float64Array.from([4, 2, 0.6, 2, 5, 1, 0.6, 1, 3])
    const x = [0.5, -1, 2]
    const b = Float64Array.from(
      [0, 1, 2].map((i) => a[i * 3]! * x[0]! + a[i * 3 + 1]! * x[1]! + a[i * 3 + 2]! * x[2]!),
    )
    expect(choleskySolve(Float64Array.from(a), b, 3)).toBe(true)
    close(b, x)
  })

  test('refuses a matrix that is not positive definite', () => {
    expect(choleskySolve(Float64Array.from([1, 2, 2, 1]), Float64Array.from([1, 1]), 2)).toBe(false)
  })
})

describe('boxQuadratic', () => {
  const h = Float64Array.from([3, 1, 1, 2])

  test('finds the unconstrained minimum when it lies inside the box', () => {
    // H x = g at x = (0.2, 0.3).
    const g = Float64Array.from([0.9, 0.8])
    const x = new Float64Array(2)
    boxQuadratic(h, g, x, Float64Array.from([-1, -1]), Float64Array.from([1, 1]), 2, 200)
    close(x, [0.2, 0.3], 6)
  })

  test('stops at the box and minimises the rest', () => {
    // Unconstrained (2, -0.5); x0 held at 1, then x1 = (g1 - 1) / 2.
    const g = Float64Array.from([5.5, 1])
    const x = new Float64Array(2)
    boxQuadratic(h, g, x, Float64Array.from([0, 0]), Float64Array.from([1, 1]), 2, 200)
    expect(x[0]).toBeCloseTo(1, 9)
    expect(x[1]).toBeCloseTo(0, 9)
  })
})

describe('rotations', () => {
  test('rotationLog undoes rotation', () => {
    for (const w of [
      [0.1, -0.2, 0.3],
      [0, 1.4, 0],
      [-2.5, 0.4, 0.9],
    ] as Vec3[]) {
      close(rotationLog(rotation(w)), w, 9)
    }
  })

  test('a rotation is orthonormal with determinant 1', () => {
    const r = rotation([0.3, -0.7, 1.1])
    close(mulMat3(r, transpose3(r)), [1, 0, 0, 0, 1, 0, 0, 0, 1], 12)
    expect(determinant3(r)).toBeCloseTo(1, 12)
  })

  test('nearestRotation recovers a rotation from a scaled, noisy one', () => {
    const r = rotation([0.4, 0.2, -0.5])
    const noisy = r.map((v, i) => 2 * v + (i === 4 ? 1e-3 : 0)) as Mat3
    close(nearestRotation(noisy), r, 3)
  })

  test('symmetricEigen3 diagonalises a symmetric matrix', () => {
    const r = rotation([0.3, 0.5, -0.2])
    const d: Mat3 = [3, 0, 0, 0, 1, 0, 0, 0, 0.5]
    const m = mulMat3(r, mulMat3(d, transpose3(r)))
    const { values } = symmetricEigen3(m)
    close(
      [...values].sort((a, b) => a - b),
      [0.5, 1, 3],
      9,
    )
  })
})

describe('similarity', () => {
  test('recovers scale, rotation and translation', () => {
    const r = rotation([0.2, -0.4, 0.1])
    const truth = { scale: 1.3, rotation: r, translation: [0.1, -0.2, 0.05] as Vec3 }
    const from: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.3, -0.7, 0.2],
    ]
    const to = from.map((p) => applySimilarity(truth, p))
    const found = similarity(from, to)
    expect(found.scale).toBeCloseTo(1.3, 9)
    close(found.rotation, r, 9)
    close(found.translation, truth.translation, 9)
  })

  test('keeps the scale at 1 when asked', () => {
    const from: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]
    const to = from.map(([x, y, z]) => [2 * x, 2 * y, 2 * z] as Vec3)
    expect(similarity(from, to, undefined, false).scale).toBe(1)
  })
})
