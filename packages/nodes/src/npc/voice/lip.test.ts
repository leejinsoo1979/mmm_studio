import { describe, expect, test } from 'bun:test'
import { followMouth, rmsMouthLevel, speechMouthLevel } from './lip'

describe('speechMouthLevel', () => {
  test('a word opens the mouth wide, and it closes fast', () => {
    expect(speechMouthLevel(0.5, 0)).toBeCloseTo(0.9)
    expect(speechMouthLevel(0.5, 0.1)).toBeLessThan(0.45)
    expect(speechMouthLevel(0.5, 0.4)).toBeLessThanOrEqual(0.3)
  })

  test('a gentle 7 Hz murmur without word events', () => {
    const period = 1 / 7
    expect(speechMouthLevel(period / 4, Number.POSITIVE_INFINITY)).toBeCloseTo(0.3)
    expect(speechMouthLevel((3 * period) / 4, Number.POSITIVE_INFINITY)).toBeCloseTo(0)
    for (let t = 0; t < 2; t += 0.013) {
      const level = speechMouthLevel(t, Number.POSITIVE_INFINITY)
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(0.3 + 1e-9)
    }
  })

  test('stays within 0..1 even for a boundary stamped a moment ahead', () => {
    expect(speechMouthLevel(0, -0.05)).toBeCloseTo(0.9)
  })
})

describe('rmsMouthLevel', () => {
  test('silence closes, loud speech opens fully, and louder is wider', () => {
    expect(rmsMouthLevel(0)).toBe(0)
    expect(rmsMouthLevel(0.005)).toBe(0)
    expect(rmsMouthLevel(0.5)).toBe(1)
    let last = 0
    for (let rms = 0.01; rms <= 0.2; rms += 0.01) {
      const level = rmsMouthLevel(rms)
      expect(level).toBeGreaterThanOrEqual(last)
      last = level
    }
  })
})

describe('followMouth', () => {
  test('opens faster than it closes', () => {
    const opened = followMouth(0, 1, 1 / 60)
    const closed = 1 - followMouth(1, 0, 1 / 60)
    expect(opened).toBeGreaterThan(closed)
    expect(opened).toBeLessThan(1)
  })

  test('settles on the target and never overshoots', () => {
    let level = 0
    for (let i = 0; i < 60; i++) {
      level = followMouth(level, 0.6, 1 / 60)
      expect(level).toBeLessThanOrEqual(0.6)
    }
    expect(level).toBeCloseTo(0.6)
    expect(followMouth(0.4, 0.4, 1)).toBe(0.4)
  })
})
