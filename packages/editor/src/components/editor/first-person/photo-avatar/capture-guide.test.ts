import { describe, expect, test } from 'bun:test'
import {
  CAPTURE_STEPS,
  type GuideFrame,
  type GuideState,
  guide,
  HOLD_MS,
  LEVEL_PITCH,
  nextStep,
  PATIENCE_MS,
  sharpness,
  startGuide,
} from './capture-guide'

const frame = (time: number, over: Partial<GuideFrame> = {}): GuideFrame => ({
  time,
  yaw: 0,
  pitch: LEVEL_PITCH,
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
    // Nodding well down or up from level.
    expect(guide(startGuide(), frame(0, { pitch: -25 })).ready).toBe(false)
    expect(guide(startGuide(), frame(0, { pitch: 3 })).ready).toBe(false)
    // Blurred throughout: never taken.
    const blurred = feed(startGuide(), (t) => frame(t, { sharpness: 2 }), HOLD_MS + 200)
    expect(blurred.take).toBe(false)
  })

  test('takes a level face however MediaPipe reads its nod', () => {
    // Level faces looking into the lens read from about 4° to 16° chin down.
    for (const pitch of [-4, -16]) {
      expect(feed(startGuide(), (t) => frame(t, { pitch }), HOLD_MS + 50).take).toBe(true)
    }
  })

  test('asks for more turn at ¾, and takes it within range', () => {
    const quarter = startGuide(1)
    expect(guide(quarter, frame(0, { yaw: 15 })).message).toBe('조금 더 돌려 주세요')
    expect(guide(quarter, frame(0, { yaw: 70 })).message).toContain('덜 돌려')
    // MediaPipe reads a 45° turn as 43° to 53°.
    for (const yaw of [38, 53]) {
      expect(feed(quarter, (t) => frame(t, { yaw }), HOLD_MS + 50).take).toBe(true)
    }
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

  test('waits for a photo worth keeping: one face, enough light, from the front, eyes open, a still mouth', () => {
    const held = (over: Partial<GuideFrame>, step = 0) =>
      feed(startGuide(step), (t) => frame(t, over), HOLD_MS + 50)
    const said = (over: Partial<GuideFrame>, step = 0) => guide(startGuide(step), frame(0, over))
    const ok = {
      faces: 1,
      lit: 180,
      burnt: 0.01,
      balance: 0.95,
      blink: 0.1,
      jawOpen: 0.02,
      smile: 0.05,
    }
    expect(held(ok).take).toBe(true)

    expect(said({ ...ok, faces: 2 }).message).toContain('혼자')
    expect(said({ ...ok, lit: 30 }).message).toContain('어두워요')
    // A dark skin in good light: its highlights are lit, however dark the skin's own tone.
    expect(held({ ...ok, lit: 110 }).take).toBe(true)
    expect(said({ ...ok, burnt: 0.6 }).message).toContain('너무 밝아요')
    expect(said({ ...ok, balance: 0.5 }).message).toContain('정면으로 마주')
    expect(said({ ...ok, blink: 0.8 }).message).toContain('눈을')
    expect(said({ ...ok, jawOpen: 0.5 }).message).toContain('입을 다물고')
    expect(said({ ...ok, smile: 0.7 }).message).toContain('무표정')
    for (const spoilt of [
      { faces: 2 },
      { lit: 30 },
      { burnt: 0.6 },
      { balance: 0.5 },
      { blink: 0.8 },
      { smile: 0.7 },
    ]) {
      expect(held({ ...ok, ...spoilt }).take).toBe(false)
    }

    // Asked to face the light for a while; a person who can't (a lamp that won't move) is taken
    // as they are, told so.
    const sideLit = feed(
      startGuide(),
      (t) => frame(t, { ...ok, balance: 0.5 }),
      PATIENCE_MS + HOLD_MS + 100,
    )
    expect(sideLit.take).toBe(true)
    expect(
      feed(startGuide(), (t) => frame(t, { ...ok, balance: 0.5 }), PATIENCE_MS - 200).take,
    ).toBe(false)
    expect(
      feed(startGuide(), (t) => frame(t, { ...ok, balance: 0.5 }), PATIENCE_MS + 300).message,
    ).toContain('이대로 찍을게요')
    // Eyes MediaPipe reads as shut however open they are (narrow or hooded ones, or a closed-eyed
    // scan) are asked about, then taken as they are: no one is held at the camera for them.
    expect(feed(startGuide(), (t) => frame(t, { ...ok, blink: 0.8 }), PATIENCE_MS - 200).take).toBe(
      false,
    )
    const shut = feed(startGuide(), (t) => frame(t, { ...ok, blink: 0.8 }), PATIENCE_MS + 300)
    expect(shut.message).toContain('눈이 감겨 보여요. 이대로 찍을게요')
    expect(
      feed(startGuide(), (t) => frame(t, { ...ok, blink: 0.8 }), PATIENCE_MS + HOLD_MS + 100).take,
    ).toBe(true)
    // So is a mouth that reads as open or smiling.
    expect(
      feed(
        startGuide(1),
        (t) => frame(t, { ...ok, yaw: 45, smile: 0.7 }),
        PATIENCE_MS + HOLD_MS + 100,
      ).take,
    ).toBe(true)
    // What can always be fixed is waited for however long it takes.
    for (const spoilt of [{ faces: 2 }, { lit: 30 }, { burnt: 0.6 }]) {
      expect(feed(startGuide(), (t) => frame(t, { ...ok, ...spoilt }), PATIENCE_MS * 3).take).toBe(
        false,
      )
    }
    // Light from one side matters for the front view only, whose light the skin is read under;
    // the ¾ views still want open eyes and a still mouth.
    expect(held({ ...ok, yaw: 45, balance: 0.4 }, 1).take).toBe(true)
    expect(held({ ...ok, yaw: 45, smile: 0.7 }, 1).take).toBe(false)
    // A full side view: MediaPipe reads no expression there, so none is asked for.
    const side = { ...startGuide(2), lastYaw: 50 }
    const lost = { ...ok, yaw: null, eyes: null, blink: 0.9, smile: 0.9, balance: null }
    expect(feed(side, (t) => frame(t, lost), HOLD_MS + 50).take).toBe(true)
    // Unread (no blendshapes, no face): nothing is held against the frame.
    expect(
      held({ blink: null, jawOpen: null, smile: null, balance: null, lit: null, burnt: null }).take,
    ).toBe(true)
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

  test('reads only the part of the box inside the image', () => {
    const width = 32
    const checks = Uint8Array.from({ length: width * width }, (_, i) =>
      ((i % width) + Math.floor(i / width)) % 2 ? 200 : 40,
    )
    const past = sharpness(checks, width, [4, 20, 24, 40])
    expect(Number.isFinite(past)).toBe(true)
    expect(past).toBeGreaterThan(1000)
  })
})
