import { describe, expect, test } from 'bun:test'
import { deltaE2000, rgbToLab } from './colour'

describe('the bench colour difference', () => {
  test('matches Sharma, Wu and Dalal’s CIEDE2000 test pairs', () => {
    const pairs: [[number, number, number], [number, number, number], number][] = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
      [[50, 2.5, 0], [56, -27, -3], 31.903],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
      [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    ]
    for (const [a, b, expected] of pairs) expect(deltaE2000(a, b)).toBeCloseTo(expected, 3)
  })

  test('puts white at L 100 and mid grey near L 53', () => {
    expect(rgbToLab([255, 255, 255])[0]).toBeCloseTo(100, 2)
    expect(rgbToLab([128, 128, 128])[0]).toBeCloseTo(53.59, 1)
  })
})
