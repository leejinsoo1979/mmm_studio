import { describe, expect, test } from 'bun:test'
import { buildNavGrid, navCellAt, navRegionAt } from './grid'
import { farthestWalkableInRadius, randomWalkableInRadius } from './sample'
import type { NavGrid, NavPoint, NavWall } from './types'

function rect(minX: number, minZ: number, maxX: number, maxZ: number): NavPoint[] {
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ]
}

function roomGrid(walls: NavWall[] = []) {
  return buildNavGrid({
    areas: [{ polygon: rect(0, 0, 10, 10), holes: [], height: 0 }],
    walls,
    obstacles: [],
  })
}

// Splits the room at x = 6.05 with no doorway.
const partition: NavWall = { a: [6.05, 0], b: [6.05, 10], halfWidth: 0.05, openings: [] }

function isWalkable(grid: NavGrid, p: NavPoint) {
  return grid.walkable[navCellAt(grid, p)] === 1
}

function distance(a: NavPoint, b: NavPoint) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

describe('randomWalkableInRadius', () => {
  const grid = roomGrid([partition])
  const home: NavPoint = [4, 5]
  const region = navRegionAt(grid, home)

  test('draws walkable cells inside the radius and region', () => {
    for (let i = 0; i < 50; i++) {
      const p = randomWalkableInRadius(grid, home, 3, () => i / 50, region)!
      expect(isWalkable(grid, p)).toBe(true)
      expect(distance(p, home)).toBeLessThanOrEqual(3)
      expect(navRegionAt(grid, p)).toBe(region)
    }
  })

  test('the same draw gives the same cell and a different draw moves it', () => {
    const a = randomWalkableInRadius(grid, home, 3, () => 0.37, region)
    expect(randomWalkableInRadius(grid, home, 3, () => 0.37, region)).toEqual(a)
    expect(randomWalkableInRadius(grid, home, 3, () => 0.81, region)).not.toEqual(a)
  })

  test('draws only from accepted cells, even at the top of the range', () => {
    const accept = (cell: number) => cell % grid.cols < navCellAt(grid, [3, 5]) % grid.cols
    for (const draw of [0, 0.5, 0.9999999]) {
      const p = randomWalkableInRadius(grid, home, 3, () => draw, region, accept)!
      expect(p[0]).toBeLessThan(3)
    }
  })

  test('returns null when nothing qualifies', () => {
    expect(randomWalkableInRadius(grid, [6.05, 5], 0.1, () => 0.5, null)).toBeNull()
    expect(
      randomWalkableInRadius(
        grid,
        home,
        3,
        () => 0.5,
        region,
        () => false,
      ),
    ).toBeNull()
  })
})

describe('farthestWalkableInRadius', () => {
  test('flees to the far side of the radius, away from the chaser', () => {
    const grid = roomGrid()
    const p = farthestWalkableInRadius(grid, [5, 5], 3, [4, 5], null)!
    expect(isWalkable(grid, p)).toBe(true)
    expect(distance(p, [5, 5])).toBeLessThanOrEqual(3)
    // The disc's rim is flat near the optimum (8, 5), so a lattice cell a little off-axis can win.
    expect(p[0]).toBeGreaterThan(7.5)
    expect(Math.abs(p[1] - 5)).toBeLessThan(1)
    expect(distance(p, [4, 5])).toBeGreaterThan(3.8)
  })

  test('stays in its region when a wall cuts the way off', () => {
    const grid = roomGrid([partition])
    const region = navRegionAt(grid, [5, 5])
    const p = farthestWalkableInRadius(grid, [5, 5], 3, [4, 5], region)!
    expect(navRegionAt(grid, p)).toBe(region)
    expect(p[0]).toBeLessThan(6.05)
    expect(distance(p, [4, 5])).toBeGreaterThan(2)
  })

  test('is deterministic and null when nothing qualifies', () => {
    const grid = roomGrid()
    const a = farthestWalkableInRadius(grid, [5, 5], 4, [5, 5], null)
    expect(farthestWalkableInRadius(grid, [5, 5], 4, [5, 5], null)).toEqual(a)
    expect(farthestWalkableInRadius(grid, [50, 50], 3, [4, 5], null)).toBeNull()
  })
})
