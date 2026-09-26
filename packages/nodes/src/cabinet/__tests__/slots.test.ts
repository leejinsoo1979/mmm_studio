import { describe, expect, test } from 'bun:test'
import {
  columnCountLimits,
  firstFreeSlot,
  slotLayout,
  wallSegments,
  widestSegment,
} from '../engine/slots'

describe('mmmcraft slot layout', () => {
  // Numbers from mmmcraft's SpaceCalculator / ColumnIndexer for a default
  // surround space at height 2400.
  test.each([
    [2400, 40, 4, 580],
    [3000, 40, 5, 584],
    [3600, 42, 6, 586],
    [4000, 40, 7, 560],
  ])('surround %p: frames %p, %p × %p', (length, frame, count, width) => {
    const layout = slotLayout({ lengthMm: length, heightMm: 2400 })
    expect([layout.leftMm, layout.rightMm]).toEqual([frame, frame])
    expect(layout.slots.map((s) => s.width)).toEqual(Array(count).fill(width))
    expect(layout.slots[0]?.left).toBe(frame)
    expect(layout.slots.at(-1)?.right).toBe(length - frame)
    expect([layout.bottomMm, layout.topMm]).toEqual([60, 2370])
  })

  test('no-surround: 1.5 gaps, width floored to 0.5', () => {
    const layout = slotLayout({ lengthMm: 2400, heightMm: 2400, mode: 'no-surround' })
    expect(layout.slots.map((s) => s.width)).toEqual([599, 599, 599, 599])
    expect(layout.slots[0]?.left).toBe(1.5)
    const custom = slotLayout({ lengthMm: 3600, heightMm: 2400, mode: 'no-surround' })
    expect(custom.slots[0]?.width).toBe(599.5)
  })

  test('column count override and its 400–600 limits', () => {
    expect(columnCountLimits(3520)).toEqual({ min: 6, max: 8 })
    const layout = slotLayout({ lengthMm: 3600, heightMm: 2400, columnCount: 8 })
    expect(layout.columnCount).toBe(8)
    expect(layout.slots.every((s) => s.width >= 400)).toBe(true)
  })

  test('doors split the run; the widest piece is the default', () => {
    const segments = wallSegments(4000, [[900, 1800]])
    expect(segments).toEqual([
      [0, 900],
      [1800, 4000],
    ])
    expect(widestSegment(segments)).toBe(1)
    // A 0.2 mm sliver before a door is dropped.
    expect(wallSegments(4000, [[0.2, 900]])).toEqual([[900, 4000]])
  })

  test('first free run of slots, skipping occupied ones', () => {
    const { slots } = slotLayout({ lengthMm: 3000, heightMm: 2400 })
    expect(firstFreeSlot(slots, 1, [], 600)).toBe(0)
    const taken = [{ along: slots[0]!.center, away: 300 }]
    expect(firstFreeSlot(slots, 1, taken, 600)).toBe(1)
    expect(firstFreeSlot(slots, 2, [{ along: slots[1]!.center, away: 300 }], 600)).toBe(2)
    // Far from the wall (another wall's run) does not count.
    expect(firstFreeSlot(slots, 1, [{ along: slots[0]!.center, away: 2000 }], 600)).toBe(0)
    const full = slots.map((s) => ({ along: s.center, away: 300 }))
    expect(firstFreeSlot(slots, 1, full, 600)).toBeNull()
  })
})
