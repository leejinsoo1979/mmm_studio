import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, LevelNode, useScene, WallNode } from '@pascal-app/core'
import { splitWallAtMidpoint } from './wall-drafting'

type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

function scene(doorX: number | null, curveOffset?: number) {
  const wall = WallNode.parse({
    id: 'wall_a',
    parentId: 'level_a',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.1,
    height: 2.5,
    ...(curveOffset ? { curveOffset } : {}),
    children: doorX === null ? [] : ['door_a'],
  })
  const nodes: AnyNode[] = [LevelNode.parse({ id: 'level_a', children: ['wall_a'] }), wall]
  if (doorX !== null)
    nodes.push(
      DoorNode.parse({
        id: 'door_a',
        parentId: 'wall_a',
        wallId: 'wall_a',
        position: [doorX, 1.05, 0],
        width: 0.9,
        height: 2.1,
      }),
    )
  useScene.setState({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) as never })
}

const walls = () =>
  Object.values(useScene.getState().nodes).filter((n) => n.type === 'wall') as WallNode[]

describe('mmmcraft 벽 분절 (split a wall at its midpoint)', () => {
  test('two halves meet at the midpoint; a door moves onto the half it sits on', () => {
    scene(3)
    expect(splitWallAtMidpoint('wall_a' as never)).toBe(true)
    const halves = walls().sort((a, b) => a.start[0] - b.start[0])
    expect(halves.map((w) => [w.start, w.end])).toEqual([
      [
        [0, 0],
        [2, 0],
      ],
      [
        [2, 0],
        [4, 0],
      ],
    ])
    const door = useScene.getState().nodes['door_a' as never] as DoorNode
    expect(door.parentId).toBe(halves[1]!.id)
    expect(halves[1]!.children).toContain('door_a')
  })

  test('a door across the midpoint or a curved wall leaves the wall whole', () => {
    scene(2)
    expect(splitWallAtMidpoint('wall_a' as never)).toBe(false)
    expect(walls()).toHaveLength(1)
    scene(null, 0.5)
    expect(splitWallAtMidpoint('wall_a' as never)).toBe(false)
    expect(walls()).toHaveLength(1)
  })
})
