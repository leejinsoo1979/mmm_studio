import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode, useScene, WallNode } from '@pascal-app/core'
import { CabinetNode } from '../schema'
import { placePresetInSlot, selectSlotWall, slotGuideFor, useSlotMode } from '../slot-mode'

const wall = (id: string, start: [number, number], end: [number, number]) =>
  WallNode.parse({ id, start, end, thickness: 0.1, height: 2.4, parentId: 'level_a' })

// mmmcraft's test room: 3700 × 3100 centre lines, 100 mm walls → inner 3600 × 3000.
const room = [
  wall('wall_s', [-1.85, -1.55], [1.85, -1.55]),
  wall('wall_e', [1.85, -1.55], [1.85, 1.55]),
  wall('wall_n', [1.85, 1.55], [-1.85, 1.55]),
  wall('wall_w', [-1.85, 1.55], [-1.85, -1.55]),
]

function reset(extra: AnyNode[] = []) {
  const level = LevelNode.parse({ id: 'level_a', children: room.map((w) => w.id) })
  const nodes = Object.fromEntries(
    [level, ...room, ...extra].map((n) => [n.id, n]),
  ) as unknown as Record<string, AnyNode>
  useScene.setState({ nodes })
  useSlotMode.setState({
    enabled: true,
    wallId: null,
    segment: null,
    columnCount: null,
    frameMode: 'surround',
  })
}

const cabinets = () =>
  Object.values(useScene.getState().nodes).filter(
    (n) => n.type === ('cabinet' as never),
  ) as unknown as CabinetNode[]

describe('slot mode (mmmcraft Room 슬롯 생성)', () => {
  beforeEach(() => reset())

  test('the reference wall gets mmmcraft slots: 3600 → 6 × 586 on 42 frames', () => {
    const guide = slotGuideFor('wall_s', useSlotMode.getState(), useScene.getState().nodes)
    expect(guide?.lengthMm).toBe(3600)
    expect(guide?.layout.slots.map((s) => s.width)).toEqual(Array(6).fill(586))
    expect([guide?.layout.bottomMm, guide?.layout.topMm]).toEqual([60, 2370])
  })

  test('double-click places into the first free slots, resized; dual takes two', () => {
    selectSlotWall('wall_s')
    const a = placePresetInSlot('single-2hanging')
    const b = placePresetInSlot('dual-2hanging')
    expect('id' in a && 'id' in b).toBe(true)
    const [single, dual] = cabinets()
    expect(single?.widthMm).toBe(586)
    expect(dual?.widthMm).toBe(1172)
    // Full height: 2370 on the 60 base (body 2310), back on the wall face (z = -1.5).
    expect(single?.heightMm).toBe(2370)
    expect(single?.toeKick.heightMm).toBe(60)
    expect((single?.position[2] ?? 0) - (single?.depthMm ?? 0) / 2000).toBeCloseTo(-1.5, 6)
    // Slot 1 starts at the 42 frame: centre at -1.8 + 0.042 + 0.293.
    expect(single?.position[0]).toBeCloseTo(-1.8 + 0.042 + 0.293, 6)
    expect(dual?.position[0]).toBeCloseTo(-1.8 + 0.042 + 0.586 + 0.586, 6)
  })

  test("a full wall reports mmmcraft's message", () => {
    selectSlotWall('wall_s')
    for (let i = 0; i < 6; i += 1) expect('id' in placePresetInSlot('single-2hanging')).toBe(true)
    expect(placePresetInSlot('single-2hanging')).toEqual({ error: '기준 벽에 빈 슬롯이 없습니다.' })
  })

  test("choosing a wall clears only that wall's furniture, in one undo step", () => {
    selectSlotWall('wall_s')
    placePresetInSlot('single-2hanging')
    selectSlotWall('wall_n')
    placePresetInSlot('single-2hanging')
    expect(cabinets().length).toBe(2)
    expect(selectSlotWall('wall_s')).toBe(1)
    expect(cabinets().length).toBe(1)
  })

  test('doors split the wall; slots go on the widest piece', () => {
    const door = {
      object: 'node',
      id: 'door_a',
      type: 'door',
      parentId: 'wall_s',
      position: [0.95, 1.05, 0],
      width: 0.9,
    } as unknown as AnyNode
    reset([door])
    const guide = slotGuideFor('wall_s', useSlotMode.getState(), useScene.getState().nodes)
    // Door 0.5–1.4 m from the wall start = 450–1350 along the 3600 inner face.
    expect(guide?.segments).toEqual([
      [0, 450],
      [1350, 3600],
    ])
    expect(guide?.lengthMm).toBe(2250)
    expect(guide?.layout.slots[0]?.left).toBeGreaterThan(1350)
  })

  test("the side wall's unit in the shared corner counts as on the new wall (mmmcraft rule)", () => {
    selectSlotWall('wall_w')
    for (let i = 0; i < 5; i += 1) placePresetInSlot('single-2hanging')
    // Its centre is inside slot 1's span and within 1.5 × depth of the south face.
    expect(selectSlotWall('wall_s')).toBe(1)
    expect(cabinets().length).toBe(4)
    const result = placePresetInSlot('single-2hanging')
    const placed = cabinets().find((c) => 'id' in result && c.id === result.id)
    expect(placed?.position[0]).toBeCloseTo(-1.8 + 0.042 + 0.293, 6)
  })

  test('refuses a slot another cabinet overlaps (mmmcraft 다른 가구와 겹칩니다)', () => {
    // A long unit turned sideways, standing off the wall (so it does not mark
    // the slot taken) but reaching across slot 1.
    const blocker = CabinetNode.parse({
      widthMm: 1800,
      depthMm: 600,
      position: [-1.8 + 0.042 + 0.293, 0, -1.5 + 0.95],
      rotation: [0, Math.PI / 2, 0],
      parentId: 'level_a',
    })
    reset([blocker as unknown as AnyNode])
    selectSlotWall('wall_s')
    expect(placePresetInSlot('single-2hanging')).toEqual({ error: '다른 가구와 겹칩니다.' })
  })
})
