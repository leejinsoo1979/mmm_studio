import { describe, expect, test } from 'bun:test'
import {
  ATLAS_HEIGHT,
  ATLAS_KINDS,
  ATLAS_LAYERS,
  ATLAS_TILE_WIDTH,
  ATLAS_WIDTH,
  atlasKindOf,
  atlasLayerOf,
  atlasLayerRow,
  coverageShare,
  LAYER_STRIDE,
  packLayers,
  STRIP_LAYER,
  strandAtlas,
  unpackLayers,
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
    const layers = (kind: keyof typeof ATLAS_KINDS) =>
      Array.from({ length: ATLAS_KINDS[kind].count }, (_, i) => share(ATLAS_KINDS[kind].first + i))
    const dense = Math.min(...layers('dense'))
    const medium = layers('medium')
    const wispy = Math.max(...layers('wispy'))
    expect(dense).toBeGreaterThan(Math.max(...medium))
    expect(Math.min(...medium)).toBeGreaterThan(wispy)
    expect(share(ATLAS_KINDS.solid.first)).toBeGreaterThan(0.9)
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

describe('ATLAS_KINDS', () => {
  test('gives every layer exactly one kind, in order', () => {
    const owners = Array.from({ length: ATLAS_LAYERS }, (_, layer) => atlasKindOf(layer))
    let next = 0
    for (const [kind, { first, count }] of Object.entries(ATLAS_KINDS)) {
      expect(first as number).toBe(next)
      for (let i = 0; i < count; i++) expect(owners[first + i]).toBe(kind as never)
      next = first + count
    }
    expect(next).toBe(ATLAS_LAYERS)
    expect(() => atlasKindOf(ATLAS_LAYERS)).toThrow()
  })

  test('keeps the wispy and stray layers next to each other (the material frays them as one range)', () => {
    expect(ATLAS_KINDS.stray.first as number).toBe(
      ATLAS_KINDS.wispy.first + ATLAS_KINDS.wispy.count,
    )
  })

  test("picks each of a kind's variants, and only its own", () => {
    for (const kind of Object.keys(ATLAS_KINDS) as (keyof typeof ATLAS_KINDS)[]) {
      const { first, count } = ATLAS_KINDS[kind]
      const seen = new Set<number>()
      for (let k = 0; k <= 100; k++) {
        const layer = atlasLayerOf(kind, k / 100)
        expect(atlasKindOf(layer)).toBe(kind)
        seen.add(layer)
      }
      expect([...seen].sort((p, q) => p - q)).toEqual(
        Array.from({ length: count }, (_, i) => first + i),
      )
    }
  })
})

describe('packLayers', () => {
  test('round-trips every atlas layer and strip layer', () => {
    for (const layer of Object.values(STRIP_LAYER)) {
      for (let atlas = 0; atlas < ATLAS_LAYERS; atlas++) {
        expect(unpackLayers(packLayers(atlas, layer))).toEqual({ atlasLayer: atlas, layer })
      }
    }
    expect(ATLAS_LAYERS).toBeLessThanOrEqual(LAYER_STRIDE)
  })

  test('survives float rounding on the way through the GPU', () => {
    expect(unpackLayers(packLayers(11, STRIP_LAYER.mid) - 1e-4)).toEqual({
      atlasLayer: 11,
      layer: 1,
    })
    expect(unpackLayers(packLayers(0, STRIP_LAYER.outer) + 1e-4)).toEqual({
      atlasLayer: 0,
      layer: 2,
    })
  })
})
