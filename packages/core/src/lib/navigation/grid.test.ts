import { describe, expect, test } from 'bun:test'
import {
  buildNavGrid,
  hashNavInput,
  NAV_CELL_SIZE,
  navCellAt,
  navCellCenter,
  navRegionAt,
} from './grid'
import type { NavArea, NavGrid, NavGridInput, NavOpening, NavPoint, NavWall } from './types'

// Cell centres sit at odd multiples of 0.1 m, so the probes below use them to stay off cell edges.

function rect(minX: number, minZ: number, maxX: number, maxZ: number): NavPoint[] {
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ]
}

function room(minX: number, minZ: number, maxX: number, maxZ: number, height = 0.05): NavArea {
  return { polygon: rect(minX, minZ, maxX, maxZ), holes: [], height }
}

function navInput(partial: Partial<NavGridInput>): NavGridInput {
  return { areas: [], walls: [], obstacles: [], ...partial }
}

function isWalkable(grid: NavGrid, x: number, z: number) {
  const cell = navCellAt(grid, [x, z])
  return cell >= 0 && grid.walkable[cell] === 1
}

function heightAt(grid: NavGrid, x: number, z: number) {
  return grid.height[navCellAt(grid, [x, z])]
}

// A partition across a 6 × 4 m room at x = 3.05, optionally with doorways.
function partition(openings: NavOpening[] = []): NavWall {
  return { a: [3.05, 0], b: [3.05, 4], halfWidth: 0.05, openings }
}

/** Centres (z) of the walkable cells in the grid column containing `x`. */
function walkableColumn(grid: NavGrid, x: number) {
  const col = navCellAt(grid, [x, 2.1]) % grid.cols
  const zs: number[] = []
  for (let row = 0; row < grid.rows; row++) {
    const cell = row * grid.cols + col
    if (grid.walkable[cell]) zs.push(navCellCenter(grid, cell)[1])
  }
  return zs
}

describe('buildNavGrid', () => {
  test('marks a slab walkable at its elevation', () => {
    const grid = buildNavGrid(navInput({ areas: [room(0, 0, 4, 4, 0.3)] }))
    expect(grid.cellSize).toBe(NAV_CELL_SIZE)
    expect(isWalkable(grid, 2.1, 2.1)).toBe(true)
    expect(heightAt(grid, 2.1, 2.1)).toBeCloseTo(0.3)
    expect(isWalkable(grid, 4.3, 2.1)).toBe(false)
    expect(grid.regionCount).toBe(1)
  })

  test('keeps the agent radius off the floor edge', () => {
    const grid = buildNavGrid(navInput({ areas: [room(0, 0, 4, 4)] }))
    expect(isWalkable(grid, 0.1, 2.1)).toBe(false)
    expect(isWalkable(grid, 0.3, 2.1)).toBe(true)
  })

  test('slab holes are not walkable', () => {
    const area = { ...room(0, 0, 4, 4), holes: [rect(1.5, 1.5, 2.5, 2.5)] }
    const grid = buildNavGrid(navInput({ areas: [area] }))
    expect(isWalkable(grid, 2.1, 2.1)).toBe(false)
    expect(isWalkable(grid, 1.1, 1.1)).toBe(true)
  })

  test('the highest slab sets the height and site ground only fills what slabs leave', () => {
    const ground: NavArea = { polygon: rect(-5, -5, 11, 9), holes: [], height: 0, ground: true }
    const grid = buildNavGrid(
      navInput({ areas: [ground, room(0, 0, 4, 4, 0.05), room(2, 0, 6, 4, 0.2)] }),
    )
    expect(heightAt(grid, 1.1, 2.1)).toBeCloseTo(0.05)
    expect(heightAt(grid, 3.1, 2.1)).toBeCloseTo(0.2)
    expect(heightAt(grid, 5.1, 2.1)).toBeCloseTo(0.2)
    expect(heightAt(grid, 8.1, 2.1)).toBe(0)
    expect(isWalkable(grid, 8.1, 2.1)).toBe(true)
    // The slab edge continues into ground, so it isn't kept clear.
    expect(isWalkable(grid, 0.1, 2.1)).toBe(true)
  })

  test('a wall blocks its half width plus the agent radius and splits the regions', () => {
    const grid = buildNavGrid(navInput({ areas: [room(0, 0, 6, 4)], walls: [partition()] }))
    expect(isWalkable(grid, 2.7, 2.1)).toBe(true)
    expect(isWalkable(grid, 2.9, 2.1)).toBe(false)
    expect(isWalkable(grid, 3.3, 2.1)).toBe(false)
    expect(isWalkable(grid, 3.5, 2.1)).toBe(true)
    expect(grid.regionCount).toBe(2)
    expect(navRegionAt(grid, [1.1, 2.1])).not.toBe(navRegionAt(grid, [5.1, 2.1]))
  })

  test('a doorway opens two cells of its wall and joins the regions', () => {
    const grid = buildNavGrid(
      navInput({ areas: [room(0, 0, 6, 4)], walls: [partition([{ along: 2, halfWidth: 0.45 }])] }),
    )
    const zs = walkableColumn(grid, 3.1)
    expect(zs).toHaveLength(2)
    expect(zs[0]).toBeCloseTo(1.9)
    expect(zs[1]).toBeCloseTo(2.1)
    expect(grid.regionCount).toBe(1)
  })

  test('a wide doorway keeps the agent radius off each jamb', () => {
    const grid = buildNavGrid(
      navInput({ areas: [room(0, 0, 6, 4)], walls: [partition([{ along: 2, halfWidth: 0.9 }])] }),
    )
    const zs = walkableColumn(grid, 3.1)
    expect(zs).toHaveLength(6)
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(2 - 0.65)
    expect(Math.max(...zs)).toBeLessThanOrEqual(2 + 0.65)
  })

  test('narrow doorways stay passable wherever they sit on the lattice', () => {
    for (const width of [0.6, 0.7, 0.8, 0.9]) {
      for (const along of [1.95, 2, 2.05, 2.1, 2.15]) {
        const grid = buildNavGrid(
          navInput({
            areas: [room(0, 0, 6, 4)],
            walls: [partition([{ along, halfWidth: width / 2 }])],
          }),
        )
        expect(grid.regionCount).toBe(1)
      }
    }
  })

  test('a doorway only opens its own wall and never clears furniture', () => {
    const door = partition([{ along: 2, halfWidth: 0.45 }])
    const twin = buildNavGrid(navInput({ areas: [room(0, 0, 6, 4)], walls: [door, partition()] }))
    expect(twin.regionCount).toBe(2)

    const blocked = buildNavGrid(
      navInput({
        areas: [room(0, 0, 6, 4)],
        walls: [door],
        obstacles: [{ center: [3.05, 2], halfExtents: [0.2, 0.5], yaw: 0 }],
      }),
    )
    expect(blocked.regionCount).toBe(2)
  })

  test('a box blocks its footprint plus the agent radius', () => {
    const grid = buildNavGrid(
      navInput({
        areas: [room(0, 0, 6, 4)],
        obstacles: [{ center: [3, 2], halfExtents: [0.5, 0.5], yaw: 0 }],
      }),
    )
    expect(isWalkable(grid, 3.1, 2.1)).toBe(false)
    expect(isWalkable(grid, 3.7, 2.1)).toBe(false)
    expect(isWalkable(grid, 3.9, 2.1)).toBe(true)
  })

  test('a box turns with its yaw the way three.js rotates the node', () => {
    // Long axis turned 45° from +X toward -Z.
    const grid = buildNavGrid(
      navInput({
        areas: [room(0, 0, 6, 4)],
        obstacles: [{ center: [3, 2], halfExtents: [1, 0.2], yaw: Math.PI / 4 }],
      }),
    )
    expect(isWalkable(grid, 3.7, 1.3)).toBe(false)
    expect(isWalkable(grid, 2.3, 2.7)).toBe(false)
    expect(isWalkable(grid, 3.7, 2.7)).toBe(true)
    expect(isWalkable(grid, 2.3, 1.3)).toBe(true)
  })

  test('the version is the input hash and follows every change', () => {
    const input = navInput({
      areas: [room(0, 0, 6, 4)],
      obstacles: [{ center: [3, 2], halfExtents: [0.5, 0.5], yaw: 0 }],
    })
    const grid = buildNavGrid(input)
    expect(grid.version).toBe(hashNavInput(input))
    expect(buildNavGrid(structuredClone(input)).version).toBe(grid.version)

    const moved = structuredClone(input)
    moved.obstacles[0]!.center = [3.2, 2]
    expect(hashNavInput(moved)).not.toBe(grid.version)
  })

  test('very large sites get coarser cells and a capped window over the building', () => {
    const ground: NavArea = {
      polygon: rect(-150, -150, 150, 150),
      holes: [],
      height: 0,
      ground: true,
    }
    const grid = buildNavGrid(navInput({ areas: [ground, room(0, 0, 10, 10)] }))
    expect(grid.cellSize).toBe(NAV_CELL_SIZE * 2)
    expect(grid.cols).toBe(400)
    expect(grid.rows).toBe(400)
    expect(isWalkable(grid, 5.2, 5.2)).toBe(true)
    expect(navCellAt(grid, [120, 5])).toBe(-1)
  })

  test('an empty input builds an empty grid', () => {
    const grid = buildNavGrid(navInput({}))
    expect(grid.cols * grid.rows).toBe(0)
    expect(navCellAt(grid, [0, 0])).toBe(-1)
    expect(grid.regionCount).toBe(0)
  })
})
