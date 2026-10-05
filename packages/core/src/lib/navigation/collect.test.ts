import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../../registry'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  ElevatorNode,
  LevelNode,
  SiteNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
} from '../../schema'
import { collectNavInputForLevel } from './collect'
import { buildNavGrid, hashNavInput, navCellAt } from './grid'
import type { NavPoint } from './types'

const LEVEL = 'level_nav'
const BOX_KIND = 'nav-test-box'

type TestBox = {
  id: string
  type: typeof BOX_KIND
  parentId: string
  visible: boolean
  position: [number, number, number]
  rotation: [number, number, number]
  dimensions: [number, number, number]
  mounted?: boolean
}

// A stand-in for item / cabinet / shelf: the registry's floor footprint is all the nav reads.
beforeEach(() => {
  if (nodeRegistry.has(BOX_KIND)) return
  registerNode({
    kind: BOX_KIND,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(BOX_KIND) }) as any,
    category: 'furnish',
    defaults: () => ({}) as any,
    capabilities: {
      floorPlaced: {
        footprint: (node) => {
          const box = node as unknown as TestBox
          return { dimensions: box.dimensions, rotation: box.rotation }
        },
        applies: (node) => !(node as unknown as TestBox).mounted,
        collides: true,
      },
    },
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  })
})

function rect(minX: number, minZ: number, maxX: number, maxZ: number): NavPoint[] {
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ]
}

function testBox(id: string, x: number, z: number, props: Partial<TestBox> = {}): AnyNode {
  const box: TestBox = {
    id,
    type: BOX_KIND,
    parentId: LEVEL,
    visible: true,
    position: [x, 0, z],
    rotation: [0, 0, 0],
    dimensions: [0.8, 0.8, 0.6],
    ...props,
  }
  return box as unknown as AnyNode
}

/** A level holding `children` (by their `parentId`), plus any other nodes. */
function scene(children: AnyNode[], levelProps: Record<string, unknown> = {}) {
  const level = {
    ...LevelNode.parse({ id: LEVEL, ...levelProps }),
    children: children.filter((node) => node.parentId === LEVEL).map((node) => node.id),
  } as AnyNode
  return Object.fromEntries([level, ...children].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
}

const slab = SlabNode.parse({ id: 'slab_a', parentId: LEVEL, polygon: rect(0, 0, 6, 4) })

function partition(doorIds: string[] = []) {
  return WallNode.parse({
    id: 'wall_a',
    parentId: LEVEL,
    start: [3.05, 0],
    end: [3.05, 4],
    thickness: 0.1,
    children: doorIds,
  })
}

const door = DoorNode.parse({ id: 'door_a', parentId: 'wall_a', position: [2, 1.05, 0] })

describe('collectNavInputForLevel', () => {
  test('slabs become areas and doors become openings on their wall', () => {
    const input = collectNavInputForLevel(scene([slab, partition(['door_a']), door]), LEVEL)
    expect(input.areas).toEqual([{ polygon: rect(0, 0, 6, 4), holes: [], height: 0.05 }])
    expect(input.walls).toEqual([
      { a: [3.05, 0], b: [3.05, 4], halfWidth: 0.05, openings: [{ along: 2, halfWidth: 0.45 }] },
    ])
    expect(input.obstacles).toEqual([])
  })

  test('a doorway connects the rooms either side of its wall', () => {
    const withDoor = buildNavGrid(
      collectNavInputForLevel(scene([slab, partition(['door_a']), door]), LEVEL),
    )
    const withoutDoor = buildNavGrid(collectNavInputForLevel(scene([slab, partition()]), LEVEL))
    expect(withDoor.regionCount).toBe(1)
    expect(withoutDoor.regionCount).toBe(2)
  })

  test('colliding footprints block, except low, wall-mounted and hosted ones', () => {
    const hosted = testBox('box_hosted', 4.5, 1, { parentId: 'box_table' })
    const nodes = scene([
      slab,
      testBox('box_table', 1.5, 2, { rotation: [0, 0.5, 0] }),
      testBox('box_rug', 4.5, 2, { dimensions: [2, 0.02, 1.4] }),
      testBox('box_shelf', 4.5, 3, { mounted: true }),
      hosted,
    ])
    const input = collectNavInputForLevel(nodes, LEVEL)
    expect(input.obstacles).toEqual([{ center: [1.5, 2], halfExtents: [0.4, 0.3], yaw: 0.5 }])
  })

  test('stairs and the shafts of elevators serving the level are blocked', () => {
    const stair = StairNode.parse({
      id: 'stair_a',
      parentId: LEVEL,
      position: [1.5, 0, 1],
      children: ['sseg_a'],
    })
    const flight = StairSegmentNode.parse({
      id: 'sseg_a',
      parentId: 'stair_a',
      width: 1,
      length: 2,
    })
    const served = ElevatorNode.parse({
      id: 'elevator_a',
      parentId: 'building_a',
      position: [4.5, 0, 2],
    })
    const upstairs = ElevatorNode.parse({
      id: 'elevator_b',
      parentId: 'building_a',
      position: [4.5, 0, 0.5],
      fromLevelId: 'level_up',
      toLevelId: 'level_up',
    })
    const building = BuildingNode.parse({
      id: 'building_a',
      children: [LEVEL, 'level_up', 'elevator_a', 'elevator_b'],
    })
    const levelUp = LevelNode.parse({ id: 'level_up', parentId: 'building_a', level: 1 })
    const nodes = scene([slab, stair, flight, served, upstairs, building, levelUp], {
      parentId: 'building_a',
    })

    const input = collectNavInputForLevel(nodes, LEVEL)
    expect(input.obstacles).toHaveLength(2)
    expect(input.obstacles[0]).toEqual({ center: [1.5, 2], halfExtents: [0.5, 1], yaw: 0 })
    expect(input.obstacles[1]!.center).toEqual([4.5, 2])
    expect(input.obstacles[1]!.halfExtents[0]).toBeCloseTo(0.92 + 0.09)

    const grid = buildNavGrid(input)
    expect(grid.walkable[navCellAt(grid, [4.5, 2.1])]).toBe(0)
  })

  test('a level without slabs stands on the fallback floor around its content', () => {
    const [area, ...rest] = collectNavInputForLevel(scene([partition()]), LEVEL).areas
    expect(rest).toEqual([])
    expect(area!.height).toBe(0)
    rect(-11.95, -13, 18.05, 17).forEach(([x, z], index) => {
      expect(area!.polygon[index]![0]).toBeCloseTo(x)
      expect(area!.polygon[index]![1]).toBeCloseTo(z)
    })
  })

  test('site ground joins the ground level only, in the building frame', () => {
    const site = SiteNode.parse({ id: 'site_a', children: ['building_a'] })
    const building = BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_a',
      position: [10, 0, 0],
      children: [LEVEL],
    })
    const nodes = scene([slab, site, building], { parentId: 'building_a' })

    const ground = collectNavInputForLevel(nodes, LEVEL, { includeSiteGround: true }).areas[1]
    expect(ground).toEqual({ polygon: rect(-25, -15, 5, 15), holes: [], height: 0, ground: true })
    expect(collectNavInputForLevel(nodes, LEVEL).areas).toHaveLength(1)

    const upstairs = scene([slab, site, building], { parentId: 'building_a', level: 1 })
    expect(
      collectNavInputForLevel(upstairs, LEVEL, { includeSiteGround: true }).areas,
    ).toHaveLength(1)

    const turned = scene([slab, site, { ...building, rotation: [0, Math.PI / 2, 0] } as AnyNode], {
      parentId: 'building_a',
    })
    const corner = collectNavInputForLevel(turned, LEVEL, { includeSiteGround: true }).areas[1]!
      .polygon[2]!
    // Site (15, 15) is 5 m along +X and 15 m along +Z from the building origin.
    expect(corner[0]).toBeCloseTo(-15)
    expect(corner[1]).toBeCloseTo(5)
  })

  test('curved walls become polylines without openings', () => {
    const curved = WallNode.parse({
      id: 'wall_curved',
      parentId: LEVEL,
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
    })
    const walls = collectNavInputForLevel(scene([slab, curved]), LEVEL).walls
    expect(walls).toHaveLength(16)
    expect(walls[0]!.a[0]).toBeCloseTo(0)
    expect(walls[15]!.b[0]).toBeCloseTo(4)
    expect(walls.every((wall) => wall.openings.length === 0)).toBe(true)
  })

  test('hidden nodes are ignored', () => {
    const hidden = { ...partition(), visible: false } as AnyNode
    expect(collectNavInputForLevel(scene([slab, hidden]), LEVEL).walls).toEqual([])
  })

  test('the input does not depend on child or insertion order', () => {
    const children = [
      slab,
      partition(['door_a']),
      door,
      testBox('box_a', 1.5, 2),
      testBox('box_b', 4.5, 1, { rotation: [0, 1, 0] }),
    ]
    const forward = scene(children)
    const reversed = scene([...children].reverse())

    const a = collectNavInputForLevel(forward, LEVEL)
    const b = collectNavInputForLevel(reversed, LEVEL)
    expect(b).toEqual(a)
    expect(hashNavInput(b)).toBe(hashNavInput(a))
  })

  test('an unknown level collects nothing', () => {
    expect(collectNavInputForLevel(scene([slab]), 'level_missing')).toEqual({
      areas: [],
      walls: [],
      obstacles: [],
    })
  })
})
