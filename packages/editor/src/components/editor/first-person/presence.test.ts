import { describe, expect, test } from 'bun:test'
import { lerpAngle, type PresenceSample, pushPresenceSample, samplePresence } from './presence'

const at = (time: number, x: number, yaw = 0): PresenceSample => ({
  time,
  position: [x, 0, 0],
  yaw,
})

describe('samplePresence', () => {
  test('glides between the reports around the moment drawn', () => {
    const samples = [at(0, 0), at(1000, 2)]
    expect(samplePresence(samples, 500)?.position[0]).toBeCloseTo(1, 6)
  })

  test('holds the nearest report outside the reported span', () => {
    const samples = [at(0, 0), at(1000, 2)]
    expect(samplePresence(samples, -100)?.position[0]).toBe(0)
    expect(samplePresence(samples, 5000)?.position[0]).toBe(2)
  })

  test('a respawn jumps instead of gliding across the house', () => {
    const samples = [at(0, 0), at(1000, 30)]
    expect(samplePresence(samples, 500)?.position[0]).toBe(30)
  })

  test('nobody reported, nothing to draw', () => {
    expect(samplePresence([], 0)).toBeNull()
  })
})

describe('lerpAngle', () => {
  test('turns the short way across ±π', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1)
  })
})

describe('pushPresenceSample', () => {
  test('keeps reports in order and only the latest few', () => {
    const samples: PresenceSample[] = []
    for (let i = 0; i < 10; i++) pushPresenceSample(samples, at(i * 1000, i))
    pushPresenceSample(samples, at(500, 99))
    expect(samples.length).toBe(6)
    expect(samples[0]?.time).toBe(4000)
    expect(samples.every((sample) => sample.position[0] !== 99)).toBe(true)
  })
})
