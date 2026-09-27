import { describe, expect, test } from 'bun:test'
import { DoorNode, type StepDoorProduct, WallNode } from '../../schema'
import {
  stepDoorBoxes,
  stepDoorError,
  stepDoorLeafHeightMm,
  stepDoorMinDepthMm,
  stepDoorModel,
  stepDoorPlacement,
  stepDoorWallFinish,
  stepLeafPoint,
} from './step-door'

// mmmcraft `stepDoorModel.test.tsx`: a 900 × 2400 opening in a 140 wall.
const wall = (thickness = 0.14, extra: Partial<WallNode> = {}) =>
  WallNode.parse({ start: [0, 0], end: [4, 0], thickness, height: 2.4, ...extra })
const door = (product: StepDoorProduct, extra: Partial<DoorNode> = {}) =>
  DoorNode.parse({
    width: 0.9,
    height: 2.4,
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
    const m = stepDoorModel(door(product), wall(), 0)
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
      const closed = stepDoorModel(door('younglim', { hingesSide }), wall(), 0)
      const open = stepDoorModel(door('younglim', { hingesSide }), wall(), 1)
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
    const thin = wall(0.1)
    const placed = stepDoorPlacement('younglim', thin)
    expect(placed.door.stepDoor?.leafHeight).toBe(2.05)
    // A 100 wall is finished out to the 110 minimum frame.
    expect(placed.wall).toEqual({ thickness: 0.11, bodyThickness: 0.1 })
    expect(stepDoorError(door('younglim', placed.door), { ...thin, ...placed.wall })).toBeNull()
    expect(stepDoorPlacement('younglim', wall(0.14)).wall).toBeNull()
  })

  test('the frame depth is the wall thickness, never thinner than the wall as built', () => {
    const built = wall(0.14)
    const finished = { ...built, ...stepDoorWallFinish(built, 200) }
    expect(finished).toMatchObject({ thickness: 0.2, bodyThickness: 0.14 })
    expect(stepDoorModel(door('yerim-inshow'), finished, 0).depth).toBe(200)
    // Back down to 170 keeps the original body; below it clamps to the body.
    expect(stepDoorWallFinish(finished, 170)).toEqual({ thickness: 0.17, bodyThickness: 0.14 })
    expect(stepDoorWallFinish(finished, 110)).toEqual({ thickness: 0.14, bodyThickness: 0.14 })
    expect(stepDoorMinDepthMm(finished)).toBe(140)
    expect(stepDoorMinDepthMm(wall(0.1))).toBe(110)
  })

  test('rejects a missing product and sizes outside the published range', () => {
    expect(stepDoorError(door('younglim', { stepDoor: undefined }), wall())).toBe(
      '스텝도어 제품을 선택해 주세요.',
    )
    expect(stepDoorError(door('younglim'), wall(0.25))).toBe(
      '영림 스텝 문틀 깊이는 110~240mm로 설정해 주세요.',
    )
    for (const patch of [
      { stepDoor: { product: 'younglim', leafHeight: 2.1 } },
      { height: 2.2 },
      { width: 1.3 },
    ] as Partial<DoorNode>[]) {
      expect(stepDoorError(door('younglim', patch), wall())).not.toBeNull()
    }
    expect(stepDoorError(door('yerim-inshow', { height: 2.8 }), wall())).toMatch(/인방/)
    expect(stepDoorError(door('yerim-inshow', { width: 0.5 }), wall())).toMatch(/폭/)
    expect(stepDoorError(door('yerim-inshow'), wall(0.1))).toBe(
      '예림·인쇼 스텝 문틀 깊이는 110mm 이상으로 설정해 주세요.',
    )
    expect(() => stepDoorModel(door('younglim', { width: 1.3 }), wall(), 0)).toThrow()
  })
})
