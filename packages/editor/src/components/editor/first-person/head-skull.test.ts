import { describe, expect, test } from 'bun:test'
import type { SkullData } from './hair-styles'
import {
  type AxisFit,
  composeFits,
  craniumFit,
  faceFit,
  fitAxes,
  fitBald,
  invertFit,
  keepStandoff,
  ontoSurface,
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
      bald: new Float32Array(),
      baldNormals: new Float32Array(),
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

/** A ball as the shared skull, all of it cranium, its bald cranium a smaller ball. */
function skullData(radius = 0.1, bald = 0.09): SkullData {
  const skull = sphere(radius, 1200)
  const cranium = sphere(bald, 1200)
  return {
    bones: {},
    points: skull.points,
    normals: skull.normals,
    zone: new Float32Array(1200).fill(1),
    triangles: new Uint32Array(),
    bald: cranium.points,
    baldNormals: cranium.normals,
  }
}

const SAME: AxisFit = { scale: [1, 1, 1], shift: [0, 0, 0] }
/** The eyes at the front of the ball: their middle x, level y, front z. */
const EYES: [number, number, number] = [0, 0, 0.1]

describe('fitting the bald cranium to a head', () => {
  test('puts the bald cranium, not the skull, where the fit says', () => {
    const fitted = fitBald(skullData(), { scale: [2, 2, 2], shift: [0, 1, 0] })
    expect(Math.hypot(fitted.points[0]!, fitted.points[1]! - 1, fitted.points[2]!)).toBeCloseTo(
      0.18,
      5,
    )
  })

  test('takes a bald head’s scalp, smaller or larger, as its cranium', () => {
    const data = skullData(0.1, 0.1)
    for (const size of [0.095, 0.104]) {
      const fit = craniumFit(data, SAME, sphere(size, 2000).points, EYES)
      // Out to the sides from the eyes' middle: the scalp's own size.
      expect(fit.scale[0]).toBeCloseTo(size / 0.1, 2)
    }
  })

  test('keeps the face where it is', () => {
    const fit = craniumFit(skullData(0.1, 0.1), SAME, sphere(0.095, 2000).points, EYES)
    for (let axis = 0; axis < 3; axis++) {
      expect(EYES[axis]! * fit.scale[axis]! + fit.shift[axis]!).toBeCloseTo(EYES[axis]!, 9)
    }
  })

  test('under hair, is no bigger than the hair lying flattest allows, and never grows', () => {
    const data = skullData(0.1, 0.1)
    // Hair from flat on the scalp to 2 cm off it: the cranium stays.
    const thick = sphere(0.1, 2000).points.map((value, j) => value * (1 + (j % 7) * 0.03))
    expect(craniumFit(data, SAME, thick, EYES).scale[0]).toBeCloseTo(1, 6)
    // A third of it 5 mm inside the cranium: the cranium is smaller.
    const inside = sphere(0.1, 2000).points.map((value, j) =>
      Math.floor(j / 3) % 3 === 0 ? value * 0.95 : value * (1 + (j % 7) * 0.03),
    )
    expect(craniumFit(data, SAME, inside, EYES).scale[0]).toBeCloseTo(0.95, 2)
  })

  test('without enough of the head over the cranium, leaves the fit be', () => {
    expect(craniumFit(skullData(), SAME, [0, 0, 0.5], EYES)).toEqual(SAME)
  })
})

describe('carrying shapes onto heads', () => {
  const ball = sphere(0.1, 1200)
  const surface = surfaceOf(ball.points, ball.normals)

  test('moves points onto a surface facing as they do, within reach', () => {
    const out = ontoSurface(
      [0, 0.105, 0, 0, 0, 0.15, 0.104, 0, 0],
      [0, 1, 0, 0, 0, 1, -1, 0, 0],
      surface,
      0.02,
      0.9,
    )
    expect(out[1]).toBeCloseTo(0.1, 3)
    // Too far off, or facing the other way (another shape's fold): left be.
    expect(out[5]).toBeCloseTo(0.15, 6)
    expect(out[6]).toBeCloseTo(0.104, 6)
  })

  test('puts hair back as far over the wearer as it stood over the donor, near the head', () => {
    const points = Float32Array.from([0, 0.1, 0, 0.13, 0, 0, 0, 0, 0.098])
    keepStandoff(points, [0.004, 0.05, 0.003], surface, 0.01, 0.03, 0.015)
    expect(points[1]).toBeCloseTo(0.104, 3)
    // Hair hanging free stays where it was carried.
    expect(points[3]).toBeCloseTo(0.13, 6)
    // Hair sunk into a larger head comes back out to its height.
    expect(points[8]).toBeCloseTo(0.103, 3)
  })
})
