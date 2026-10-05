import { describe, expect, test } from 'bun:test'
import { findPath } from './astar'
import { buildNavGrid } from './grid'
import { hasLineOfSight, measurePath, samplePathAt, smoothPath } from './smooth'
import type { NavGrid, NavGridInput, NavPoint } from './types'

function rect(minX: number, minZ: number, maxX: number, maxZ: number): NavPoint[] {
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ]
}

function roomGrid(partial: Partial<NavGridInput> = {}) {
  return buildNavGrid({
    areas: [{ polygon: rect(0, 0, 6, 4), holes: [], height: 0.05 }],
    walls: [],
    obstacles: [],
    ...partial,
  })
}

function gridFromRows(lines: string[]): NavGrid {
  const cols = lines[0]!.length
  const walkable = new Uint8Array(cols * lines.length)
  lines.forEach((line, row) => {
    for (let col = 0; col < cols; col++) walkable[row * cols + col] = line[col] === '.' ? 1 : 0
  })
  return {
    version: 'ascii',
    cellSize: 1,
    originX: 0,
    originZ: 0,
    cols,
    rows: lines.length,
    walkable,
    height: new Float32Array(walkable.length),
    region: Int32Array.from(walkable, (open) => (open ? 0 : -1)),
    regionCount: 1,
  }
}

describe('hasLineOfSight', () => {
  const walled = roomGrid({
    walls: [
      { a: [3.05, 0], b: [3.05, 4], halfWidth: 0.05, openings: [{ along: 2, halfWidth: 0.45 }] },
    ],
  })

  test('sees across open floor and is blocked by a wall', () => {
    expect(hasLineOfSight(roomGrid(), [0.5, 0.5], [5.5, 3.5])).toBe(true)
    expect(hasLineOfSight(walled, [1, 1], [5, 1])).toBe(false)
  })

  test('sees straight through a doorway', () => {
    expect(hasLineOfSight(walled, [1, 1.95], [5, 1.95])).toBe(true)
    expect(hasLineOfSight(walled, [1, 1.95], [5, 3])).toBe(false)
  })

  test('cannot squeeze between two diagonal blocked cells', () => {
    expect(hasLineOfSight(gridFromRows(['.#', '#.']), [0.5, 0.5], [1.5, 1.5])).toBe(false)
    expect(hasLineOfSight(gridFromRows(['..', '..']), [0.5, 0.5], [1.5, 1.5])).toBe(true)
  })

  test('checks every cell the segment touches', () => {
    const grid = gridFromRows(['..#', '...'])
    expect(hasLineOfSight(grid, [0.5, 0.1], [2.9, 1.2])).toBe(false)
    expect(hasLineOfSight(grid, [0.5, 0.5], [2.5, 1.5])).toBe(true)
  })

  test('points off the grid have no sight', () => {
    expect(hasLineOfSight(roomGrid(), [-3, 1], [2, 1])).toBe(false)
  })
})

describe('smoothPath', () => {
  test('pulls the string tight around a corner', () => {
    const grid = roomGrid({ obstacles: [{ center: [3, 1.5], halfExtents: [0.4, 1.6], yaw: 0 }] })
    const raw = findPath(grid, [1, 1], [5, 1])!
    const smooth = smoothPath(grid, raw)
    expect(smooth.length).toBeLessThan(raw.length)
    expect(smooth.length).toBeGreaterThan(2)
    expect(smooth[0]).toEqual(raw[0]!)
    expect(smooth[smooth.length - 1]).toEqual(raw[raw.length - 1]!)
    for (let i = 1; i < smooth.length; i++) {
      expect(hasLineOfSight(grid, smooth[i - 1]!, smooth[i]!)).toBe(true)
    }
    expect(measurePath(smooth).length).toBeLessThan(measurePath(raw).length)
  })

  test('collapses a visible path to its ends', () => {
    const grid = roomGrid()
    const raw = findPath(grid, [0.5, 0.5], [5.5, 3.1])!
    expect(smoothPath(grid, raw)).toEqual([raw[0]!, raw[raw.length - 1]!])
  })
})

describe('samplePathAt', () => {
  const path = measurePath([
    [0, 0],
    [3, 0],
    [3, 0],
    [3, 4],
  ])

  test('measures arc length and drops repeated points', () => {
    expect(path.length).toBe(7)
    expect(path.points).toHaveLength(3)
    expect(path.distances).toEqual([0, 3, 7])
  })

  test('samples position and heading by arc length, clamped to the ends', () => {
    expect(samplePathAt(path, 1.5)).toEqual({ p: [1.5, 0], heading: [1, 0] })
    expect(samplePathAt(path, 5)).toEqual({ p: [3, 2], heading: [0, 1] })
    expect(samplePathAt(path, 3)).toEqual({ p: [3, 0], heading: [0, 1] })
    expect(samplePathAt(path, -1)).toEqual({ p: [0, 0], heading: [1, 0] })
    expect(samplePathAt(path, 99)).toEqual({ p: [3, 4], heading: [0, 1] })
  })

  test('a single point faces +Z', () => {
    expect(samplePathAt(measurePath([[2, 1]]), 4)).toEqual({ p: [2, 1], heading: [0, 1] })
  })
})
