import { describe, expect, test } from 'bun:test'
import { DoorNode, type StepDoorProduct, WallNode } from '../../schema'
import {
  stepDoorBoxes,
  stepDoorError,
  stepDoorLeafHeightMm,
  stepDoorModel,
  stepDoorPlacement,
  stepLeafPoint,
} from './step-door'

// mmmcraft `stepDoorModel.test.tsx`: a 900 × 2400 opening, 140 frame.
const door = (product: StepDoorProduct, extra: Partial<DoorNode> = {}) =>
  DoorNode.parse({
    width: 0.9,
    height: 2.4,
    frameDepth: 0.14,
    doorType: 'step',
    stepDoor: { product, leafHeight: product === 'younglim' ? 2.05 : 2.1 },
    ...extra,
  })

type Range = [number, number]
const bounds = (b: { at: number[]; size: number[] }) =>
  b.at.map((c, i) => [c - (b.size[i] as number) / 2, c + (b.size[i] as number) / 2]) as [
    Range,
    Range,
    Range,
  ]

describe('mmmcraft step door', () => {
  test.each([
    ['yerim-inshow', 25, 15, 844, 2100, 297],
    ['younglim', 30, 18, 834, 2050, 347],
  ] as const)('%s: separate jambs, returns, leaf and header at the published sizes', (product, jamb, finish, width, height, header) => {
    const m = stepDoorModel(door(product), 0)
    const { fixed, leaf } = stepDoorBoxes(m)
    const part = (name: string) => [...fixed, ...leaf].find((b) => b.name === name)!
    expect(part('step-door-leaf').size).toEqual([width, height, 35])
    expect(part('step-door-header').size[1]).toBeCloseTo(header, 6)
    // 3 mm 매지 between the leaf top and the header.
    expect(bounds(part('step-door-header'))[1][0] - height).toBeCloseTo(3, 6)
    expect(part('step-door-jamb:1').size.slice(0, 2)).toEqual([jamb, 2400])
    expect(part('step-door-return:1').size[0]).toBe(finish)
    // Closed leaf (hinge-relative → door frame) sits 3 mm in front of the return.
    const leafZ = bounds(part('step-door-leaf'))[2].map((z) => z + m.hingeZ) as Range
    expect(leafZ[0] - bounds(part('step-door-return:1'))[2][1]).toBeCloseTo(3, 6)
    expect(leafZ[1]).toBeCloseTo(70, 6)
  })

  test('the header stays put and the leaf swings out of its flush face', () => {
    for (const hingesSide of ['left', 'right'] as const) {
      const closed = stepDoorModel(door('younglim', { hingesSide }), 0)
      const open = stepDoorModel(door('younglim', { hingesSide }), 1)
      const header = (m: typeof open) =>
        stepDoorBoxes(m).fixed.find((b) => b.name === 'step-door-header')
      expect(header(open)).toEqual(header(closed))
      // The free edge ends up leafWidth in front of the hinge, on the +z side.
      const [x, z] = stepLeafPoint(open, open.handed * open.leafWidth, 0)
      expect(x).toBeCloseTo(open.hingeX, 6)
      expect(z).toBeCloseTo(open.hingeZ + open.leafWidth, 6)
    }
  })

  test('initial leaf height keeps the header in range for tall and low rooms', () => {
    expect(stepDoorLeafHeightMm('younglim', 2800)).toBe(2200)
    expect(stepDoorLeafHeightMm('yerim-inshow', 2251)).toBe(2048)
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.1, height: 2.4 })
    const placed = door('younglim', stepDoorPlacement('younglim', wall))
    expect(placed.frameDepth).toBe(0.11)
    expect(placed.stepDoor?.leafHeight).toBe(2.05)
    expect(stepDoorError(placed)).toBeNull()
  })

  test('rejects a missing product and sizes outside the published range', () => {
    expect(stepDoorError(door('younglim', { stepDoor: undefined }))).toBe(
      '스텝도어 제품을 선택해 주세요.',
    )
    for (const patch of [
      { frameDepth: 0.25 },
      { stepDoor: { product: 'younglim', leafHeight: 2.1 } },
      { height: 2.2 },
      { width: 1.3 },
    ] as Partial<DoorNode>[]) {
      expect(stepDoorError(door('younglim', patch))).not.toBeNull()
    }
    expect(stepDoorError(door('yerim-inshow', { height: 2.8 }))).toMatch(/인방/)
    expect(stepDoorError(door('yerim-inshow', { width: 0.5 }))).toMatch(/폭/)
    expect(stepDoorError(door('yerim-inshow', { frameDepth: 0.1 }))).toBe(
      '예림·인쇼 스텝 문틀 깊이는 110mm 이상으로 설정해 주세요.',
    )
    expect(() => stepDoorModel(door('younglim', { width: 1.3 }), 0)).toThrow()
  })
})
