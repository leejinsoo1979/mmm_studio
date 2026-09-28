import { describe, expect, test } from 'bun:test'
import {
  getRoomPresetPolygon,
  normalizeQuarterTurns,
  type RoomPresetPlacement,
  roomPresetLocalToPlan,
} from './wall-drafting'
import type { WallPlanPoint } from './wall-snap-geometry'

const L_SHAPE: WallPlanPoint[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [1 / 6, 0.5],
  [1 / 6, -1 / 6],
  [-0.5, -1 / 6],
]

function rounded(points: WallPlanPoint[]) {
  return points.map(([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000])
}

describe('room preset placement', () => {
  test('scales the unit outline by the size around the centre', () => {
    const placement: RoomPresetPlacement = { center: [2, 3], size: [6, 3], turns: 0 }
    expect(rounded(getRoomPresetPolygon(L_SHAPE, placement))).toEqual([
      [-1, 1.5],
      [5, 1.5],
      [5, 4.5],
      [3, 4.5],
      [3, 2.5],
      [-1, 2.5],
    ])
  })

  test('a quarter turn rotates clockwise seen from above and swaps the footprint', () => {
    const placement: RoomPresetPlacement = { center: [0, 0], size: [4, 2], turns: 1 }
    // The shape's +x now runs along the plan's +z.
    expect(rounded([roomPresetLocalToPlan([0.5, 0], placement)])).toEqual([[0, 2]])
    const xs = getRoomPresetPolygon(L_SHAPE, placement).map(([x]) => x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2)
  })

  test('four quarter turns come back to the start', () => {
    expect(normalizeQuarterTurns(4)).toBe(0)
    expect(normalizeQuarterTurns(-1)).toBe(3)
    const base: RoomPresetPlacement = { center: [1, 1], size: [3, 5], turns: 0 }
    expect(rounded(getRoomPresetPolygon(L_SHAPE, { ...base, turns: 4 }))).toEqual(
      rounded(getRoomPresetPolygon(L_SHAPE, base)),
    )
  })
})
