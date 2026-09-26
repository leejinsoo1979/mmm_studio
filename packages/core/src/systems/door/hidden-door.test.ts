import { describe, expect, test } from 'bun:test'
import { DoorNode, WallNode } from '../../schema'
import {
  hiddenDoorError,
  hiddenDoorFrontPanels,
  hiddenDoorModel,
  hiddenDoorSections,
} from './hidden-door'

const wall = (construction?: WallNode['construction'], thickness = 0.158) =>
  WallNode.parse({ start: [0, 0], end: [4, 0], thickness, construction })
const door = (width = 0.9, height = 2.1, extra: Partial<DoorNode> = {}) =>
  DoorNode.parse({ width, height, doorType: 'hidden', ...extra })

describe('mmmcraft hidden door', () => {
  test('leaf = opening − 128 wide, − header inset high (목상 58.5, 떡가베 63.5)', () => {
    const timber = hiddenDoorModel(
      door(),
      wall({ kind: 'timber', side: 'left' }, 0.15800773151634348),
      0,
    )
    expect(timber.leafWidth).toBeCloseTo(772, 6)
    expect(timber.leafHeight).toBeCloseTo(2041.5, 6)
    const bonded = hiddenDoorModel(
      door(),
      wall({ kind: 'bonded', side: 'left', bothFaces: true }),
      0,
    )
    expect(bonded.leafHeight).toBeCloseTo(2036.5, 6)
    expect(
      hiddenDoorModel(door(0.963, 2.1625), wall({ kind: 'bonded', side: 'left' }), 0).leafWidth,
    ).toBeCloseTo(835, 6)
  })

  test('mmmcraft messages', () => {
    expect(hiddenDoorError(door(), wall())).toBe('히든도어는 목상 또는 떡가베 벽에 배치해 주세요.')
    expect(hiddenDoorError(door(0.3), wall({ kind: 'timber', side: 'left' }))).toBe(
      '개구부와 벽 두께가 첨부 CAD의 히든도어 단면보다 작습니다.',
    )
    expect(hiddenDoorError(door(1.1), wall({ kind: 'timber', side: 'left' }))).toBe(
      '도무스 150 경첩은 문짝 폭 900mm 이하에 적용해 주세요.',
    )
    expect(
      hiddenDoorError(
        door(0.9, 2.1, { hiddenHingeHeights: [0.15, 0.2, 1.8] }),
        wall({ kind: 'timber', side: 'left' }),
      ),
    ).toBe('경첩 표시 위치는 문 안에 아래부터 위로, 서로 150mm 이상 떨어지게 입력해 주세요.')
    expect(hiddenDoorError(door(), wall({ kind: 'timber', side: 'left' }))).toBeNull()
  })

  test('opens away from the finished face; hinge side sets the handing', () => {
    const left = hiddenDoorModel(
      door(0.9, 2.1, { hingesSide: 'left' }),
      wall({ kind: 'timber', side: 'left' }),
      1,
    )
    expect(left.angle).toBeCloseTo(-Math.PI / 2, 9)
    expect(left.hingeX).toBeCloseTo(-386, 9)
    const right = hiddenDoorModel(
      door(0.9, 2.1, { hingesSide: 'right' }),
      wall({ kind: 'timber', side: 'right' }),
      0.5,
    )
    expect(right.angle).toBeCloseTo(-Math.PI / 4, 9)
  })

  test('section rows: 목상 has a stud; 떡가베 has back boards on both faces', () => {
    const timber = hiddenDoorSections(
      hiddenDoorModel(door(), wall({ kind: 'timber', side: 'left' }), 0),
    )
    expect(timber.map((r) => r.id)).toContain('stud')
    const bonded = hiddenDoorSections(
      hiddenDoorModel(door(), wall({ kind: 'bonded', side: 'left', bothFaces: true }), 0),
    )
    expect(bonded.map((r) => r.id)).toEqual(
      expect.arrayContaining(['back-finish-1p', 'back-finish-2p']),
    )
    expect(bonded.map((r) => r.id)).not.toContain('stud')
  })

  test('front 2P: 70 side panels and a 3 mm reveal', () => {
    const front = hiddenDoorFrontPanels(
      hiddenDoorModel(door(), wall({ kind: 'timber', side: 'left' }), 0),
    )
    expect(front.gap).toBeCloseTo(3, 9)
    expect(front.panels.map((p) => p.width)).toEqual([70, 70, 754])
  })
})
