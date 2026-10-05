import { describe, expect, test } from 'bun:test'
import { findPath, nearestWalkable, nearestWalkableCell } from './astar'
import { buildNavGrid, navCellAt, navRegionAt } from './grid'
import { measurePath } from './smooth'
import type { NavGrid, NavGridInput, NavPoint, NavWall } from './types'

function rect(minX: number, minZ: number, maxX: number, maxZ: number): NavPoint[] {
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ]
}

function roomGrid(walls: NavWall[] = [], obstacles: NavGridInput['obstacles'] = []) {
  return buildNavGrid({
    areas: [{ polygon: rect(0, 0, 6, 4), holes: [], height: 0.05 }],
    walls,
    obstacles,
  })
}

function partition(doorAlong?: number): NavWall {
  return {
    a: [3.05, 0],
    b: [3.05, 4],
    halfWidth: 0.05,
    openings: doorAlong === undefined ? [] : [{ along: doorAlong, halfWidth: 0.45 }],
  }
}

/** 1 m cells from ASCII rows ('.' walkable); every walkable cell shares region 0. */
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

function isWalkable(grid: NavGrid, p: NavPoint) {
  return grid.walkable[navCellAt(grid, p)] === 1
}

describe('findPath', () => {
  test('runs straight down a corridor from the start point to the goal point', () => {
    const grid = buildNavGrid({
      areas: [{ polygon: rect(0, 0, 10, 2), holes: [], height: 0 }],
      walls: [],
      obstacles: [],
    })
    const path = findPath(grid, [0.55, 1.1], [9.45, 1.1])!
    expect(path[0]).toEqual([0.55, 1.1])
    expect(path[path.length - 1]).toEqual([9.45, 1.1])
    expect(measurePath(path).length).toBeCloseTo(8.9, 5)
  })

  test('detours through the doorway and only steps on walkable cells', () => {
    const grid = roomGrid([partition(3)])
    const path = findPath(grid, [1, 1], [5, 1])!
    expect(path.every((p) => isWalkable(grid, p))).toBe(true)
    const crossing = path.filter(([x]) => Math.abs(x - 3.05) < 0.3)
    expect(crossing.length).toBeGreaterThan(0)
    expect(crossing.every(([, z]) => z > 2.75 && z < 3.25)).toBe(true)
    expect(measurePath(path).length).toBeGreaterThan(5)
  })

  test('never cuts a corner', () => {
    const grid = gridFromRows(['..#', '#..'])
    expect(findPath(grid, [0.5, 0.5], [2.5, 1.5])).toEqual([
      [0.5, 0.5],
      [1.5, 0.5],
      [1.5, 1.5],
      [2.5, 1.5],
    ])
    expect(findPath(gridFromRows(['.#', '#.']), [0.5, 0.5], [1.5, 1.5])).toBeNull()
  })

  test('takes diagonals across open floor', () => {
    const path = findPath(gridFromRows(['...', '...', '...']), [0.5, 0.5], [2.5, 2.5])
    expect(path).toEqual([
      [0.5, 0.5],
      [1.5, 1.5],
      [2.5, 2.5],
    ])
  })

  test('a walkable goal in another region is unreachable', () => {
    expect(findPath(roomGrid([partition()]), [1, 1], [5, 1])).toBeNull()
  })

  test('snaps a blocked goal into the start region and a blocked start to the nearest cell', () => {
    const grid = roomGrid([partition()])
    const path = findPath(grid, [1, 2.1], [3.05, 2.1])!
    const end = path[path.length - 1]!
    expect(end[0]).toBeLessThan(3.05)
    expect(navRegionAt(grid, end)).toBe(navRegionAt(grid, [1, 2.1]))

    const fromWall = findPath(grid, [3.15, 2.1], [5, 2.1])!
    expect(isWalkable(grid, fromWall[0]!)).toBe(true)
    expect(fromWall[0]![0]).toBeGreaterThan(3.05)
  })

  test('gives up past maxExpanded', () => {
    const grid = roomGrid()
    expect(findPath(grid, [0.5, 0.5], [5.5, 3.5], { maxExpanded: 10 })).toBeNull()
    expect(findPath(grid, [0.5, 0.5], [5.5, 3.5])).not.toBeNull()
  })

  test('is deterministic', () => {
    const obstacles = [
      { center: [3, 2] as NavPoint, halfExtents: [0.6, 0.6] as NavPoint, yaw: 0.3 },
    ]
    const a = findPath(roomGrid([], obstacles), [0.5, 2], [5.5, 2])
    const b = findPath(roomGrid([], structuredClone(obstacles)), [0.5, 2], [5.5, 2])
    expect(a).not.toBeNull()
    expect(b).toEqual(a)
  })
})

describe('nearestWalkable', () => {
  const grid = gridFromRows(['....', '.##.', '....'])

  test('finds the closest walkable centre, ties to the lower cell', () => {
    expect(nearestWalkable(grid, [1.4, 1.5])).toEqual([0.5, 1.5])
    expect(nearestWalkable(grid, [2, 1.5])).toEqual([1.5, 0.5])
    expect(nearestWalkable(grid, [-5, 0.5])).toEqual([0.5, 0.5])
  })

  test('can be limited to one region', () => {
    const regions = {
      ...grid,
      region: Int32Array.from(grid.region, (r, i) => (i % 4 === 0 ? 1 : r)),
    }
    expect(nearestWalkable(regions, [1.4, 1.5], 0)).toEqual([1.5, 0.5])
    expect(nearestWalkableCell(regions, [1.4, 1.5], 7)).toBe(-1)
  })
})
