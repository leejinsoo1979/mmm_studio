import { describe, expect, test } from 'bun:test'
import {
  advanceGaitPhase,
  airborneJumpTime,
  GAITS,
  gaitSpeed,
  locomotionWeights,
  MOTION_SETS,
  RUN_SPEED,
  runningJumpWeight,
  scaledGaits,
  WALK_SPEED,
} from './locomotion'

const male = MOTION_SETS.male
const sum = (w: ReturnType<typeof locomotionWeights>) =>
  w.idle + GAITS.reduce((total, gait) => total + w[gait], 0)

describe('locomotionWeights', () => {
  test('standing still is pure idle', () => {
    expect(locomotionWeights(0, male)).toMatchObject({ idle: 1, walk: 0, runFast: 0 })
  })

  test('each gait plays alone at its own pace', () => {
    for (const gait of GAITS) {
      const weights = locomotionWeights(gaitSpeed(male.gaits[gait]), male)
      expect(weights[gait]).toBeCloseTo(1, 6)
      expect(weights.loopDistance).toBeCloseTo(male.gaits[gait].distance, 6)
    }
  })

  test('between two gaits only those two blend', () => {
    const between = (gaitSpeed(male.gaits.walkFast) + gaitSpeed(male.gaits.run)) / 2
    const weights = locomotionWeights(between, male)
    expect(weights.walkFast).toBeGreaterThan(0)
    expect(weights.run).toBeGreaterThan(0)
    expect(weights.idle + weights.walk + weights.runFast).toBe(0)
  })

  test('weights always sum to one, past the fastest gait too', () => {
    for (let speed = 0; speed <= 8; speed += 0.1) {
      expect(sum(locomotionWeights(speed, male))).toBeCloseTo(1, 6)
    }
  })
})

describe('advanceGaitPhase', () => {
  test('covering one stride length completes exactly one loop', () => {
    let phase = 0.25
    for (let i = 0; i < 100; i++)
      phase = advanceGaitPhase(phase, male.gaits.walk.distance, 0.01, male.gaits.walk.distance)
    expect(phase).toBeCloseTo(0.25, 6)
  })

  test('the phase holds while standing', () => {
    expect(advanceGaitPhase(0.4, 0, 0.1, 1)).toBe(0.4)
  })
})

describe('airborneJumpTime', () => {
  const marks = male.jumps.jump

  test('leaving the ground plays take-off, the top of the arc plays the apex', () => {
    expect(airborneJumpTime(marks, { launchSpeed: 3, verticalSpeed: 3, height: 0, peak: 0 })).toBe(
      marks.takeoff,
    )
    expect(
      airborneJumpTime(marks, { launchSpeed: 3, verticalSpeed: 0, height: 0.5, peak: 0.5 }),
    ).toBe(marks.apex)
  })

  test('falling back to take-off height reaches touch-down', () => {
    expect(
      airborneJumpTime(marks, { launchSpeed: 3, verticalSpeed: -3, height: 0, peak: 0.5 }),
    ).toBe(marks.land)
  })

  test('stepping off a ledge (no launch) falls from the apex pose', () => {
    const time = airborneJumpTime(marks, {
      launchSpeed: 0,
      verticalSpeed: -1,
      height: -0.2,
      peak: 0,
    })
    expect(time).toBe(marks.land)
  })
})

describe('speeds', () => {
  test('walking is a brisk walk and running a run, for both characters', () => {
    for (const character of Object.values(MOTION_SETS)) {
      const walk = locomotionWeights(WALK_SPEED, character)
      expect(walk.walkFast).toBeGreaterThan(0.9)
      const run = locomotionWeights(RUN_SPEED, character)
      expect(run.run + run.runFast).toBeCloseTo(1, 6)
    }
  })

  test('a smaller body strides proportionally shorter, so its gaits come in at lower speeds', () => {
    const child = scaledGaits(male.gaits, 0.6)
    expect(child.walk.distance).toBeCloseTo(male.gaits.walk.distance * 0.6, 6)
    expect(child.walk.duration).toBe(male.gaits.walk.duration)
    expect(gaitSpeed(child.run)).toBeLessThan(gaitSpeed(male.gaits.run))
  })

  test('a standing jump on the spot, a running jump at a run', () => {
    expect(runningJumpWeight(0)).toBe(0)
    expect(runningJumpWeight(WALK_SPEED)).toBeGreaterThan(0)
    expect(runningJumpWeight(RUN_SPEED)).toBe(1)
  })
})
