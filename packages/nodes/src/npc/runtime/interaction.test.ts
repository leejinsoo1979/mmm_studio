import { describe, expect, test } from 'bun:test'
import {
  NPC_BUSY_LABEL,
  NPC_TALK_HEIGHT,
  NPC_TALK_RADIUS,
  nearestNpcHit,
  npcTalkLabel,
  rayCapsuleDistance,
  type Vec3,
} from './interaction'

const A: Vec3 = [0, NPC_TALK_RADIUS, 0]
const B: Vec3 = [0, NPC_TALK_HEIGHT - NPC_TALK_RADIUS, 0]
const r = NPC_TALK_RADIUS

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

describe('rayCapsuleDistance', () => {
  test('a level ray meets the body', () => {
    expect(rayCapsuleDistance([0, 1.2, -3], [0, 0, 1], A, B, r)).toBeCloseTo(3 - r, 9)
  })

  test('a ray passing beside it misses', () => {
    expect(rayCapsuleDistance([r + 0.01, 1, -3], [0, 0, 1], A, B, r)).toBeNull()
    expect(rayCapsuleDistance([0, 1, -3], [0, 0, -1], A, B, r)).toBeNull()
  })

  test('the rounded ends: from above onto the head, and just over it', () => {
    expect(rayCapsuleDistance([0, 5, 0], [0, -1, 0], A, B, r)).toBeCloseTo(5 - NPC_TALK_HEIGHT, 9)
    expect(rayCapsuleDistance([0, NPC_TALK_HEIGHT + 0.01, -3], [0, 0, 1], A, B, r)).toBeNull()
    const grazing = rayCapsuleDistance([0, NPC_TALK_HEIGHT - 0.05, -3], [0, 0, 1], A, B, r)
    expect(grazing).not.toBeNull()
    expect(grazing!).toBeGreaterThan(3 - r)
  })

  test('a slanted aim from eye height down to the chest', () => {
    const origin: Vec3 = [0, 1.6, -2]
    const dir = unit([0, 1.2 - 1.6, 2])
    const t = rayCapsuleDistance(origin, dir, A, B, r)!
    const hit = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t]
    expect(Math.hypot(hit[0]!, hit[2]!)).toBeCloseTo(r, 6)
  })

  test('from inside it is a hit at once', () => {
    expect(rayCapsuleDistance([0.1, 1, 0], [0, 0, 1], A, B, r)).toBe(0)
  })
})

describe('nearestNpcHit', () => {
  const aim = { origin: [0, 1.2, 0] as Vec3, dir: [0, 0, 1] as Vec3 }

  test('the nearest NPC in the aim, within its own range', () => {
    const hit = nearestNpcHit(aim.origin, aim.dir, [
      { id: 'far', feet: [0, 0, 4], range: 5 },
      { id: 'near', feet: [0, 0, 2], range: 2.5 },
      { id: 'aside', feet: [2, 0, 1], range: 5 },
    ])
    expect(hit?.id).toBe('near')
    expect(hit?.distance).toBeCloseTo(2 - r, 9)
  })

  test('out of range is out of reach', () => {
    expect(
      nearestNpcHit(aim.origin, aim.dir, [{ id: 'far', feet: [0, 0, 4], range: 2.5 }]),
    ).toBeNull()
    expect(nearestNpcHit(aim.origin, aim.dir, [{ id: 'far', feet: [0, 0, 4], range: 5 }])?.id).toBe(
      'far',
    )
  })

  test('feet on an upper floor lift the capsule', () => {
    expect(nearestNpcHit(aim.origin, aim.dir, [{ id: 'up', feet: [0, 3, 2], range: 5 }])).toBeNull()
  })
})

describe('npcTalkLabel', () => {
  test('the particle follows the name', () => {
    expect(npcTalkLabel('지아', '대화하기', false)).toBe('지아와 대화하기')
    expect(npcTalkLabel('민준', '대화하기', false)).toBe('민준과 대화하기')
    expect(npcTalkLabel('안내원 수진', '상담 받기', false)).toBe('안내원 수진과 상담 받기')
  })

  test('an empty prompt says talk; a busy NPC says so', () => {
    expect(npcTalkLabel('지아', '  ', false)).toBe('지아와 대화하기')
    expect(npcTalkLabel('지아', '대화하기', true)).toBe(NPC_BUSY_LABEL)
  })
})
