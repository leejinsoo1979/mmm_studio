import { describe, expect, test } from 'bun:test'
import {
  ATLAS_HEIGHT,
  ATLAS_LAYER,
  ATLAS_LAYERS,
  ATLAS_TILE_WIDTH,
  ATLAS_WIDTH,
  atlasLayerRow,
  coverageShare,
  strandAtlas,
} from './hair-atlas'

const mips = strandAtlas()

describe('strandAtlas', () => {
  test('is a full mip chain of the 12 layers side by side, down to 1 × 1', () => {
    expect(mips[0]!.width).toBe(ATLAS_WIDTH)
    expect(mips[0]!.height).toBe(ATLAS_HEIGHT)
    expect(mips.at(-1)).toMatchObject({ width: 1, height: 1 })
    mips.forEach((mip, level) => {
      expect(mip.width).toBe(Math.max(1, Math.floor(ATLAS_WIDTH / 2 ** level)))
      expect(mip.height).toBe(Math.max(1, Math.floor(ATLAS_HEIGHT / 2 ** level)))
      expect(mip.data.length).toBe(mip.width * mip.height * 4)
    })
  })

  test("keeps each layer's coverage share at every mip down to 32 texels across (within 2%)", () => {
    for (let layer = 0; layer < ATLAS_LAYERS; layer++) {
      const base = coverageShare(mips[0]!, layer * ATLAS_TILE_WIDTH, (layer + 1) * ATLAS_TILE_WIDTH)
      for (let level = 1; ATLAS_TILE_WIDTH >> level >= 32; level++) {
        const w = ATLAS_TILE_WIDTH >> level
        const share = coverageShare(mips[level]!, layer * w, (layer + 1) * w)
        expect(Math.abs(share - base)).toBeLessThanOrEqual(0.02)
      }
    }
  })

  test('gives each role its density: dense over medium over wispy, solid nearly whole', () => {
    const share = (layer: number) =>
      coverageShare(mips[0]!, layer * ATLAS_TILE_WIDTH, (layer + 1) * ATLAS_TILE_WIDTH)
    const dense = Math.min(...ATLAS_LAYER.dense.map(share))
    const medium = ATLAS_LAYER.medium.map(share)
    const wispy = Math.max(...ATLAS_LAYER.wispy.map(share))
    expect(dense).toBeGreaterThan(Math.max(...medium))
    expect(Math.min(...medium)).toBeGreaterThan(wispy)
    expect(share(ATLAS_LAYER.solid)).toBeGreaterThan(0.9)
  })

  test('repeats along the strand: row 0 is row 1024', () => {
    for (let layer = 0; layer < ATLAS_LAYERS; layer++) {
      expect(atlasLayerRow(layer, ATLAS_HEIGHT)).toEqual(atlasLayerRow(layer, 0))
      expect(atlasLayerRow(layer, ATLAS_HEIGHT + 37)).toEqual(atlasLayerRow(layer, 37))
    }
  })

  test('mip 0 is the rows themselves', () => {
    const top = mips[0]!
    for (const layer of [0, 6, 9]) {
      const row = atlasLayerRow(layer, 300)
      const o = (300 * ATLAS_WIDTH + layer * ATLAS_TILE_WIDTH) * 4
      expect(top.data.subarray(o, o + ATLAS_TILE_WIDTH * 4)).toEqual(row)
    }
  })

  test('no fibre ends inside the repeat: no row of a layer goes bare of fibres or coverage', () => {
    const top = mips[0]!
    for (let layer = 0; layer < ATLAS_LAYERS; layer++) {
      const rowMeans: number[] = []
      const rowCover: number[] = []
      for (let y = 0; y < ATLAS_HEIGHT; y++) {
        let fibre = 0
        let cover = 0
        for (let x = 0; x < ATLAS_TILE_WIDTH; x++) {
          const o = (y * ATLAS_WIDTH + layer * ATLAS_TILE_WIDTH + x) * 4
          fibre += top.data[o + 1]!
          cover += top.data[o]!
        }
        rowMeans.push(fibre / ATLAS_TILE_WIDTH)
        rowCover.push(cover / ATLAS_TILE_WIDTH)
      }
      const mean = rowMeans.reduce((a, b) => a + b, 0) / rowMeans.length
      const cover = rowCover.reduce((a, b) => a + b, 0) / rowCover.length
      for (let y = 0; y < ATLAS_HEIGHT; y++) {
        expect(Math.abs(rowMeans[y]! - mean) / mean).toBeLessThan(0.2)
        expect(Math.abs(rowCover[y]! - cover) / cover).toBeLessThan(0.25)
      }
    }
  })

  test("never covers a layer's two edge columns, so far mips never borrow a neighbour's coverage", () => {
    const top = mips[0]!
    for (let layer = 0; layer < ATLAS_LAYERS; layer++) {
      for (let y = 0; y < ATLAS_HEIGHT; y += 7) {
        for (const x of [0, 1, ATLAS_TILE_WIDTH - 2, ATLAS_TILE_WIDTH - 1]) {
          expect(top.data[(y * ATLAS_WIDTH + layer * ATLAS_TILE_WIDTH + x) * 4]).toBe(0)
        }
      }
    }
  })

  test('is the same every time', () => {
    const again = strandAtlas()
    expect(again[0]!.data).toEqual(mips[0]!.data)
    expect(again[3]!.data).toEqual(mips[3]!.data)
  })
})
