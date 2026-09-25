import { describe, expect, test } from 'bun:test'
import { type AnyNode, WallNode } from '@pascal-app/core'
import { wallRun } from '../kitchen'
import { attachToWall, frontDirection } from '../placement'

const wall = (id: string, start: [number, number], end: [number, number], thickness = 0.2) =>
  WallNode.parse({ id, start, end, thickness, parentId: 'level_a' })

// A 4 × 3 m room: walls along the four sides, centred on the origin.
const room = [
  wall('wall_s', [-2, -1.5], [2, -1.5]),
  wall('wall_e', [2, -1.5], [2, 1.5]),
  wall('wall_n', [2, 1.5], [-2, 1.5]),
  wall('wall_w', [-2, 1.5], [-2, -1.5]),
]

describe('attachToWall', () => {
  test('backs onto the wall face and faces into the room', () => {
    const hit = attachToWall({
      point: [0.3, -1.1],
      footprint: { widthM: 0.6, depthM: 0.6 },
      walls: room,
      neighbours: [],
    })
    expect(hit?.wallId).toBe('wall_s')
    // Face at z = -1.4; centre half a depth in front of it.
    expect(hit?.position[1]).toBeCloseTo(-1.1, 6)
    expect(hit?.position[0]).toBeCloseTo(0.3, 6)
    const front = frontDirection(hit?.rotationY ?? 0)
    expect(front[0]).toBeCloseTo(0, 6)
    expect(front[1]).toBeCloseTo(1, 6)
  })

  test('butts up to a neighbour on the same wall', () => {
    const hit = attachToWall({
      point: [0.66, -1.1],
      footprint: { widthM: 0.6, depthM: 0.6 },
      walls: room,
      neighbours: [{ position: [0, -1.1], rotationY: 0, widthM: 0.6, depthM: 0.6 }],
    })
    expect(hit?.position[0]).toBeCloseTo(0.6, 6)
  })

  test('ignores points far from every wall', () => {
    expect(
      attachToWall({
        point: [0, 0],
        footprint: { widthM: 0.6, depthM: 0.6 },
        walls: room,
        neighbours: [],
      }),
    ).toBeNull()
  })
})

describe('wallRun', () => {
  test('uses the room-side face trimmed at both inside corners', () => {
    const nodes = Object.fromEntries(room.map((w) => [w.id, w])) as unknown as Record<
      string,
      AnyNode
    >
    const run = wallRun(room[0] as WallNode, nodes)
    expect(run?.lengthMm).toBe(3800)
    expect(run?.normal[0]).toBeCloseTo(0, 6)
    expect(run?.normal[1]).toBeCloseTo(1, 6)
    // Standing in the room facing this wall (looking −Z), left is −X.
    const leftEnd = run?.origin ?? [0, 0]
    expect(leftEnd[0]).toBeCloseTo(-1.9, 6)
    expect(leftEnd[1]).toBeCloseTo(-1.4, 6)
    // `along` is the cabinet's local +X for a cabinet facing the normal.
    const [ax, az] = run?.along ?? [0, 0]
    const ry = run?.rotationY ?? 0
    expect(ax).toBeCloseTo(Math.cos(ry), 6)
    expect(az).toBeCloseTo(-Math.sin(ry), 6)
  })
})
