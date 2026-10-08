// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { readLayout, topDownRows } from './render-target-pixels'

/** A width × height RGBA8 image whose every pixel holds (x, y, row tag, 255), laid out as `layout` says. */
function laidOut(width: number, height: number, bytesPerRow: number, bottomUp: boolean) {
  const size = (height - 1) * bytesPerRow + width * 4
  const pixels = new Uint8Array(size).fill(7)
  for (let y = 0; y < height; y++) {
    const row = bottomUp ? height - 1 - y : y
    for (let x = 0; x < width; x++) pixels.set([x, y, 100 + y, 255], row * bytesPerRow + x * 4)
  }
  return pixels
}

function expectTopDown(out: Uint8ClampedArray, width: number, height: number) {
  expect(out.length).toBe(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      expect([...out.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]).toEqual([
        x,
        y,
        100 + y,
        255,
      ])
    }
  }
}

describe('readLayout', () => {
  test('WebGPU pads each row to 256 bytes', () => {
    expect(readLayout(true, 10)).toEqual({ bytesPerRow: 256, bottomUp: false })
    expect(readLayout(true, 64)).toEqual({ bytesPerRow: 256, bottomUp: false })
    expect(readLayout(true, 65)).toEqual({ bytesPerRow: 512, bottomUp: false })
    expect(readLayout(true, 1024)).toEqual({ bytesPerRow: 4096, bottomUp: false })
  })

  test('the WebGL fallback packs rows bottom-up', () => {
    expect(readLayout(false, 10)).toEqual({ bytesPerRow: 40, bottomUp: true })
  })
})

describe('topDownRows', () => {
  test('drops WebGPU row padding (the last row comes unpadded)', () => {
    const layout = readLayout(true, 5)
    expectTopDown(topDownRows(laidOut(5, 3, layout.bytesPerRow, false), 5, 3, layout), 5, 3)
  })

  test('copies rows already a multiple of 256 bytes as they are', () => {
    const layout = readLayout(true, 64)
    expectTopDown(topDownRows(laidOut(64, 2, layout.bytesPerRow, false), 64, 2, layout), 64, 2)
  })

  test('turns the WebGL fallback read upright', () => {
    const layout = readLayout(false, 4)
    expectTopDown(topDownRows(laidOut(4, 3, layout.bytesPerRow, true), 4, 3, layout), 4, 3)
  })
})
