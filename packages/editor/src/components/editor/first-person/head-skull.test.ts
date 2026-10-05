import { describe, expect, test } from 'bun:test'
import type { SkullData } from './hair-styles'
import {
  type AxisFit,
  composeFits,
  faceFit,
  fitAxes,
  invertFit,
  PointGrid,
  pushOut,
  type Surface,
} from './head-skull'

/** Points spread evenly over a sphere (a Fibonacci lattice), with their outward normals. */
function sphere(radius: number, count: number, centre = [0, 0, 0]) {
  const points: number[] = []
  const normals: number[] = []
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count
    const ring = Math.sqrt(1 - y * y)
    const turn = i * Math.PI * (3 - Math.sqrt(5))
    const n = [Math.cos(turn) * ring, y, Math.sin(turn) * ring]
    normals.push(...n)
    points.push(...n.map((value, axis) => centre[axis]! + value * radius))
  }
  return { points: Float32Array.from(points), normals: Float32Array.from(normals) }
}

const surfaceOf = (points: Float32Array, normals: Float32Array): Surface => ({
  points,
  normals,
  grid: new PointGrid(points, 0.02),
})

describe('the point grid', () => {
  test('finds the nearest points as a search of them all would, nearest first', () => {
    const { points } = sphere(0.1, 300)
    const grid = new PointGrid(points, 0.02)
    const found: number[] = []
    const distances: number[] = []
    for (const query of [
      [0, 0, 0],
      [0.05, 0.12, -0.03],
      [0.4, -0.3, 0.2],
    ]) {
      const all = Array.from({ length: points.length / 3 }, (_, i) =>
        Math.hypot(
          points[i * 3]! - query[0]!,
          points[i * 3 + 1]! - query[1]!,
          points[i * 3 + 2]! - query[2]!,
        ),
      )
      const best = [...all.keys()].sort((a, b) => all[a]! - all[b]!).slice(0, 4)
      expect(grid.nearest(query[0]!, query[1]!, query[2]!, 4, found, distances)).toBe(4)
      expect(found.slice(0, 4)).toEqual(best)
      expect(Math.sqrt(distances[0]!)).toBeCloseTo(all[best[0]!]!, 6)
    }
  })

  test('finds none in an empty grid, and as many as there are in a small one', () => {
    const found: number[] = []
    const distances: number[] = []
    expect(new PointGrid([], 0.02).nearest(0, 0, 0, 4, found, distances)).toBe(0)
    expect(new PointGrid([0, 0, 0, 1, 1, 1], 0.02).nearest(0, 0, 0, 4, found, distances)).toBe(2)
  })
})

describe('fitting axis by axis', () => {
  test('finds the scale and shift that took points somewhere', () => {
    const from = [0, 0, 0, 1, 2, 3, -1, 4, 2, 2, -1, 1]
    const to = from.map((value, i) => value * [1.1, 0.9, 1.2][i % 3]! + [0.5, -0.2, 0.1][i % 3]!)
    const fit = fitAxes(from, to)
    expect(fit.scale.map((value) => value.toFixed(9))).toEqual([
      '1.100000000',
      '0.900000000',
      '1.200000000',
    ])
    expect(fit.shift.map((value) => value.toFixed(9))).toEqual([
      '0.500000000',
      '-0.200000000',
      '0.100000000',
    ])
  })

  test('undoes itself, and composes one fit after another', () => {
    const fit: AxisFit = { scale: [2, 0.5, 1.5], shift: [1, -1, 0.25] }
    const round = composeFits(invertFit(fit), fit)
    for (const value of round.scale) expect(value).toBeCloseTo(1, 12)
    for (const value of round.shift) expect(value).toBeCloseTo(0, 12)
    const twice = composeFits(fit, fit)
    // x: 2·(2x + 1) + 1 = 4x + 3
    expect(twice.scale[0]).toBe(4)
    expect(twice.shift[0]).toBe(3)
  })

  test('fits the skull by the face bones a character has, and only with enough of them', () => {
    const names = Array.from({ length: 10 }, (_, i) => `Bip01_Face${i}`)
    const bones = Object.fromEntries(
      names.map((name, i) => [name, [i * 0.01, (i % 3) * 0.02, (i % 4) * 0.015]]),
    ) as SkullData['bones']
    const skull: SkullData = {
      bones,
      points: new Float32Array(),
      normals: new Float32Array(),
      zone: new Float32Array(),
      triangles: new Uint32Array(),
    }
    const moved = new Map(
      Object.entries(bones).map(([name, place]) => [
        name,
        [place[0] * 0.98 + 0.01, place[1] * 0.98 + 0.7, place[2] * 0.98 - 0.02],
      ]),
    )
    const fit = faceFit(skull, moved)!
    expect(fit.scale[1]).toBeCloseTo(0.98, 9)
    expect(fit.shift[1]).toBeCloseTo(0.7, 9)
    expect(faceFit(skull, new Map([...moved].slice(0, 3)))).toBeNull()
  })
})

describe('keeping hair off the wearer', () => {
  const head = sphere(0.1, 800)
  const surface = surfaceOf(head.points, head.normals)

  test('lifts points inside, or too near, out to the clearance along the normal', () => {
    const points = Float32Array.from([0, 0.095, 0, 0.1005, 0, 0, 0, 0, 0.15])
    pushOut(points, surface, 0.003, 0.03)
    expect(Math.hypot(points[0]!, points[1]!, points[2]!)).toBeCloseTo(0.103, 3)
    expect(Math.hypot(points[3]!, points[4]!, points[5]!)).toBeCloseTo(0.103, 3)
    // Well clear already: left be.
    expect([...points.slice(6)]).toEqual([0, 0, 0.15].map(Math.fround))
  })

  test('leaves a point deeper in than its reach be', () => {
    const points = Float32Array.from([0, 0.05, 0])
    pushOut(points, surface, 0.003, 0.03)
    expect(points[1]).toBeCloseTo(0.05, 6)
  })
})
