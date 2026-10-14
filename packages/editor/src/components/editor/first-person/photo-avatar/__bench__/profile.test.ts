import { describe, expect, test } from 'bun:test'
import type { Vec3 } from '../linalg'
import { type HeadSurface, profileCurve, profileError } from './profile'

/** Where the landmarks the measure reads sit on a made-up face (x, y in metres). */
const LANDMARK_XY: Record<number, [number, number]> = {
  33: [-0.045, 0],
  133: [-0.015, 0],
  362: [0.015, 0],
  263: [0.045, 0],
  61: [-0.025, -0.06],
  291: [0.025, -0.06],
  10: [0, 0.07],
  151: [0, 0.05],
  9: [0, 0.02],
  6: [0, -0.002],
  2: [0, -0.04],
  17: [0, -0.065],
  152: [0, -0.1],
}

/** A face as a height field z(x, y) on a 1 mm grid, with its landmarks on it. */
function face(z: (x: number, y: number) => number): HeadSurface {
  const step = 0.001
  const nx = 121
  const ny = 201
  const positions: number[] = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = -0.06 + i * step
      const y = -0.12 + j * step
      positions.push(x, y, z(x, y))
    }
  }
  const triangles: number[] = []
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      triangles.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx)
    }
  }
  const landmarks = new Map<number, Vec3>()
  for (const [l, [x, y]] of Object.entries(LANDMARK_XY)) landmarks.set(Number(l), [x, y, z(x, y)])
  return { positions, triangles, landmarks }
}

const bump = (x: number, y: number, cy: number, sx: number, sy: number) =>
  Math.exp(-((x / sx) ** 2) - ((y - cy) / sy) ** 2)

const truthZ = (x: number, y: number) =>
  -(x * x) / 0.1 + 0.012 * bump(x, y, -0.02, 0.008, 0.012) + 0.006 * bump(x, y, -0.09, 0.03, 0.01)

describe('profileCurve', () => {
  test('is the frontmost z at each height', () => {
    const { positions, triangles } = face(truthZ)
    const curve = profileCurve(positions, triangles, -0.1, 0.0005, 10)
    // At y = −0.1 the chin's bump: 6 mm × e^(−1).
    expect(curve[0]! * 1000).toBeCloseTo(6 * Math.exp(-1), 1)
  })
})

describe('profileError', () => {
  test('is zero for the truth itself', () => {
    const truth = face(truthZ)
    const e = profileError(truth, truth)
    for (const v of [
      e.forehead,
      e.bridge,
      e.noseTip,
      e.noseProjection,
      e.chin,
      e.lineMean,
      e.lineMax,
    ]) {
      expect(Math.abs(v)).toBeLessThan(1e-6)
    }
  })

  test('finds a flat nose in profile, though the front matches', () => {
    // The same face from the front (x, y unchanged) with a nose standing out 4 mm less.
    const flat = face((x, y) => truthZ(x, y) - 0.004 * bump(x, y, -0.02, 0.008, 0.012))
    const e = profileError(flat, face(truthZ))
    expect(e.noseTip).toBeCloseTo(-4, 1)
    expect(e.noseProjection).toBeCloseTo(-4, 1)
    expect(Math.abs(e.forehead)).toBeLessThan(0.05)
    expect(Math.abs(e.chin)).toBeLessThan(0.05)
    expect(e.shape.noseTip).toBeCloseTo(-4, 1)
    expect(e.lineMax).toBeGreaterThan(3)
  })

  test('tells a profile only moved in depth from one of the wrong shape', () => {
    // The whole midline 2 mm forward, the eyes' and mouth's corners where they were.
    const moved = face((x, y) => truthZ(x, y) + 0.002 * Math.exp(-((x / 0.004) ** 2)))
    const e = profileError(moved, face(truthZ))
    expect(e.noseTip).toBeCloseTo(2, 1)
    expect(e.chin).toBeCloseTo(2, 1)
    expect(Math.abs(e.noseProjection)).toBeLessThan(0.1)
    expect(Math.abs(e.shape.noseTip)).toBeLessThan(0.1)
    expect(Math.abs(e.shape.chin)).toBeLessThan(0.1)
  })
})
