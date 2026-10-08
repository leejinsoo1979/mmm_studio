import { describe, expect, test } from 'bun:test'
import { AI_PHOTO_SHOTS } from '@/lib/ai-photo/shared'
import { makeOpaque, shotSize, snapshotFrame } from './studio-capture'

const NONE = { top: 0, right: 0, bottom: 0, left: 0 }

describe('shotSize', () => {
  test('gives the AI photo its sizes', () => {
    expect(shotSize(AI_PHOTO_SHOTS.face)).toEqual({ width: 1024, height: 1024 })
    expect(shotSize(AI_PHOTO_SHOTS.upper)).toEqual({ width: 1024, height: 1536 })
    expect(shotSize(AI_PHOTO_SHOTS.full)).toEqual({ width: 1024, height: 1536 })
  })

  test('keeps the long edge for a wide shot', () => {
    expect(shotSize({ aspect: 16 / 9, longEdge: 1920 })).toEqual({ width: 1920, height: 1080 })
  })
})

describe('snapshotFrame', () => {
  test('takes the free room at twice its CSS size', () => {
    const frame = snapshotFrame(
      { width: 1600, height: 860 },
      { top: 100, right: 400, bottom: 120, left: 320 },
      8192,
    )
    expect(frame).toEqual({ x: 320, y: 100, w: 880, h: 640, scale: 2, width: 1760, height: 1280 })
  })

  test('stays within the longest snapshot side', () => {
    const frame = snapshotFrame({ width: 3000, height: 1500 }, NONE, 8192)
    expect(frame.scale).toBeCloseTo(4096 / 3000, 9)
    expect(frame.width).toBe(4096)
    expect(frame.height).toBe(2048)
  })

  test('stays within the largest texture the device takes', () => {
    const frame = snapshotFrame({ width: 1600, height: 900 }, NONE, 2048)
    expect(frame.width).toBe(2048)
    expect(frame.height).toBe(1152)
  })

  test('keeps at least a pixel when the chrome covers the stage', () => {
    const frame = snapshotFrame(
      { width: 400, height: 300 },
      { top: 500, right: 500, bottom: 500, left: 500 },
      8192,
    )
    expect(frame.x).toBe(399)
    expect(frame.y).toBe(299)
    expect(frame.w).toBe(1)
    expect(frame.h).toBe(1)
    expect(frame.width).toBe(2)
    expect(frame.height).toBe(2)
  })
})

describe('makeOpaque', () => {
  test('makes every pixel opaque and keeps its colour', () => {
    const image = { data: new Uint8ClampedArray([200, 100, 50, 162, 10, 20, 30, 255, 0, 0, 0, 0]) }
    makeOpaque(image)
    expect([...image.data]).toEqual([200, 100, 50, 255, 10, 20, 30, 255, 0, 0, 0, 255])
  })
})
