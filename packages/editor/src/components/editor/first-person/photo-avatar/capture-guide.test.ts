import { describe, expect, test } from 'bun:test'
import {
  CAPTURE_STEPS,
  type GuideFrame,
  type GuideState,
  guide,
  HOLD_MS,
  nextStep,
  sharpness,
  startGuide,
} from './capture-guide'

const frame = (time: number, over: Partial<GuideFrame> = {}): GuideFrame => ({
  time,
  yaw: 0,
  pitch: 0,
  roll: 0,
  eyes: 0.15,
  person: true,
  centre: [0.5, 0.45],
  sharpness: 40,
  ...over,
})

/** Feeds frames 50 ms apart; the advice for the last. */
function feed(state: GuideState, frames: (time: number) => GuideFrame, until: number) {
  let advice = guide(state, frames(0))
  for (let time = 50; time <= until; time += 50) advice = guide(advice.state, frames(time))
  return advice
}

describe('capture guide', () => {
  test('walks front, ¾ and full side views each way', () => {
    expect(CAPTURE_STEPS.map((s) => s.slot)).toEqual([
      'front',
      'left45',
      'left90',
      'right45',
      'right90',
    ])
    expect(CAPTURE_STEPS.map((s) => s.yaw)).toEqual([0, 45, 90, -45, -90])
  })

  test('takes the front photo once the face is square on and held still', () => {
    const early = feed(startGuide(), (t) => frame(t), HOLD_MS - 100)
    expect(early.ready).toBe(true)
    expect(early.take).toBe(false)
    const held = feed(
      startGuide(),
      (t) => frame(t, { sharpness: t === 300 ? 90 : 40 }),
      HOLD_MS + 50,
    )
    expect(held.take).toBe(true)
    // The sharpest frame of the moment is the one kept.
    expect(held.state.best?.time).toBe(300)
  })

  test('says what is wrong instead', () => {
    expect(guide(startGuide(), frame(0, { yaw: 20 })).message).toBe('정면을 바라봐 주세요')
    expect(guide(startGuide(), frame(0, { eyes: 0.03 })).message).toBe('조금 더 가까이 와 주세요')
    expect(guide(startGuide(), frame(0, { yaw: null, eyes: null })).ready).toBe(false)
    // Moving: wait until still.
    const first = guide(startGuide(), frame(0))
    expect(guide(first.state, frame(50, { centre: [0.6, 0.45] })).message).toBe(
      '그대로 잠깐 멈춰 주세요',
    )
    // Blurred throughout: never taken.
    const blurred = feed(startGuide(), (t) => frame(t, { sharpness: 2 }), HOLD_MS + 200)
    expect(blurred.take).toBe(false)
  })

  test('asks for more turn at ¾, and takes it within range', () => {
    const quarter = startGuide(1)
    expect(guide(quarter, frame(0, { yaw: 15 })).message).toBe('조금 더 돌려 주세요')
    expect(guide(quarter, frame(0, { yaw: 70 })).message).toContain('덜 돌려')
    // MediaPipe reads 38° for a 45° turn.
    expect(feed(quarter, (t) => frame(t, { yaw: 38 }), HOLD_MS + 50).take).toBe(true)
    // The other way is the right ¾ step's.
    expect(guide(startGuide(3), frame(0, { yaw: 38 })).ready).toBe(false)
  })

  test('takes a side view once the face has turned past MediaPipe', () => {
    const side = { ...startGuide(2), lastYaw: 50 }
    expect(guide(side, frame(0, { yaw: 30 })).ready).toBe(false)
    expect(guide(side, frame(0, { person: false, yaw: null, eyes: null })).message).toContain(
      '머리와 어깨',
    )
    const taken = feed(side, (t) => frame(t, { yaw: null, eyes: null }), HOLD_MS + 50)
    expect(taken.take).toBe(true)
    // Never having seen the turn begin, it asks for it.
    expect(guide(startGuide(2), frame(0, { yaw: null, eyes: null })).message).toBe(
      CAPTURE_STEPS[2]!.prompt,
    )
  })

  test('moves on step by step to the end', () => {
    let state = startGuide()
    for (let k = 0; k < CAPTURE_STEPS.length; k++) state = nextStep(state)
    expect(guide(state, frame(0)).message).toBe('촬영이 끝났어요')
  })
})

describe('sharpness', () => {
  test('is zero for a flat image and high for fine detail', () => {
    const width = 32
    const flat = new Uint8Array(width * width).fill(120)
    const checks = Uint8Array.from({ length: width * width }, (_, i) =>
      ((i % width) + Math.floor(i / width)) % 2 ? 200 : 40,
    )
    expect(sharpness(flat, width, [4, 4, 24, 24])).toBe(0)
    expect(sharpness(checks, width, [4, 4, 24, 24])).toBeGreaterThan(1000)
  })
})
