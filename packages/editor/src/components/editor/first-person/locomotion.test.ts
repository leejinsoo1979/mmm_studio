import { describe, expect, test } from 'bun:test'
import {
  advanceGaitPhase,
  locomotionWeights,
  THIRD_PERSON_RUN_SPEED,
  THIRD_PERSON_WALK_SPEED,
  WALKTHROUGH_CHARACTERS,
} from './locomotion'

describe('locomotionWeights', () => {
  test('standing still is pure idle', () => {
    expect(locomotionWeights(0)).toEqual({ idle: 1, walk: 0, run: 0, runBlend: 0 })
  })

  test('walking speed is pure walk, running speed pure run', () => {
    expect(locomotionWeights(THIRD_PERSON_WALK_SPEED)).toMatchObject({ idle: 0, walk: 1, run: 0 })
    expect(locomotionWeights(THIRD_PERSON_RUN_SPEED)).toMatchObject({ idle: 0, walk: 0, run: 1 })
  })

  test('weights always sum to one', () => {
    for (let speed = 0; speed <= 4; speed += 0.1) {
      const { idle, walk, run } = locomotionWeights(speed)
      expect(idle + walk + run).toBeCloseTo(1, 6)
    }
  })
})

describe('advanceGaitPhase', () => {
  const male = WALKTHROUGH_CHARACTERS.male

  test('walking one stride length completes exactly one loop', () => {
    let phase = 0.25
    for (let i = 0; i < 100; i++) phase = advanceGaitPhase(phase, male.walk.distance, 0.01, male, 0)
    expect(phase).toBeCloseTo(0.25, 6)
  })

  test('the phase holds while standing', () => {
    expect(advanceGaitPhase(0.4, 0, 0.1, male, 0)).toBe(0.4)
  })

  test('running strides are longer, so the same distance advances less', () => {
    const walked = advanceGaitPhase(0, 1, 0.5, male, 0)
    const ran = advanceGaitPhase(0, 1, 0.5, male, 1)
    expect(ran).toBeLessThan(walked)
  })
})
