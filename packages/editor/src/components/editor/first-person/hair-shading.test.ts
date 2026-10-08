import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_HAIR,
  HAIRLINE_STEPS,
  hairLookValues,
  hairlineAt,
  highlightExponent,
  linearOf,
  lodWidthScale,
  NO_UNDERCUT,
  packLayers,
  ROOT_SHADE,
  rootsStyleValues,
  STRIP_LAYER,
  sortedIndex,
  stripKeys,
  stripRanges,
  TIP_LIFT,
  turnedSince,
  unpackLayers,
} from './hair-shading'

function close(a: number[], b: number[], digits = 6) {
  for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i]!, digits)
}

describe('linearOf', () => {
  test('turns sRGB hex into linear light', () => {
    close(linearOf('#ffffff'), [1, 1, 1])
    close(linearOf('#000000'), [0, 0, 0])
    // sRGB 0.5 is linear 0.214.
    close(linearOf('#808080'), [0.2158605, 0.2158605, 0.2158605])
  })

  test('falls back on anything but #rrggbb', () => {
    expect(linearOf('red')).toEqual(linearOf(DEFAULT_HAIR))
    expect(linearOf(null)).toEqual(linearOf(DEFAULT_HAIR))
    expect(linearOf('#12345')).toEqual(linearOf(DEFAULT_HAIR))
    expect(linearOf(undefined, '#ffffff')).toEqual([1, 1, 1])
  })
})

describe('hairLookValues', () => {
  const look = { base: '#6a4a3a', tip: null, shine: 0.5, skin: '#d0a080' }

  test('darkens the root and, with no tip colour, lifts the tip a little', () => {
    const v = hairLookValues(look)
    close(
      v.root,
      v.base.map((c) => c * ROOT_SHADE),
    )
    close(
      v.tip,
      v.base.map((c) => c * TIP_LIFT),
    )
    close(v.skin, linearOf('#d0a080'))
  })

  test('takes a tip colour as given', () => {
    close(hairLookValues({ ...look, tip: '#e0c080' }).tip, linearOf('#e0c080'))
    // A bad tip is the same as none.
    expect(hairLookValues({ ...look, tip: 'gold' }).tip).toEqual(hairLookValues(look).tip)
  })

  test('never lifts a channel past 1', () => {
    expect(Math.max(...hairLookValues({ ...look, base: '#ffffff' }).tip)).toBe(1)
  })

  test('maps shine onto the highlights, clamped', () => {
    expect(hairLookValues({ ...look, shine: 0 })).toMatchObject({ expR: 60, expTRT: 16, kR: 0.2 })
    expect(hairLookValues({ ...look, shine: 1 })).toMatchObject({ expR: 260, expTRT: 48, kR: 0.5 })
    expect(hairLookValues({ ...look, shine: 0.5 }).kR).toBeCloseTo(0.35)
    expect(hairLookValues({ ...look, shine: 7 }).expR).toBe(260)
    expect(hairLookValues({ ...look, shine: Number.NaN }).expR).toBe(160)
  })
})

describe('packLayers', () => {
  test('round-trips every atlas layer and strip layer', () => {
    for (const layer of Object.values(STRIP_LAYER)) {
      for (let atlas = 0; atlas < 12; atlas++) {
        expect(unpackLayers(packLayers(atlas, layer))).toEqual({ atlasLayer: atlas, layer })
      }
    }
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

describe('highlightExponent', () => {
  test('keeps the exponent on strips 6 pixels wide or more at full detail', () => {
    expect(highlightExponent(200, 6, 1)).toBe(200)
    expect(highlightExponent(200, 40, 1)).toBe(200)
  })

  test('eases toward 16 on narrower strips and halves at the lowest detail', () => {
    expect(highlightExponent(200, 0, 1)).toBe(16)
    expect(highlightExponent(200, 3, 1)).toBe(108)
    expect(highlightExponent(200, 6, 0)).toBe(100)
  })
})

test('lodWidthScale widens strips as fewer are drawn', () => {
  expect(lodWidthScale(1)).toBe(1)
  expect(lodWidthScale(0.5)).toBeCloseTo(1.741, 3)
  expect(lodWidthScale(0.2)).toBeCloseTo(3.624, 3)
  expect(Number.isFinite(lodWidthScale(0))).toBe(true)
})

describe('rootsStyleValues', () => {
  const hairline = Float32Array.from({ length: HAIRLINE_STEPS }, (_, i) => 0.7 - i * 0.05)

  test('passes the hairline, part and undercut through', () => {
    const v = rootsStyleValues({
      hairline,
      part: { x: 0.02, fade: -0.3 },
      undercut: { line: 0.35, shells: [0.85, 0.55, 0.3] },
    })
    expect(v.hairline).toEqual(hairline)
    expect(v.hairline).not.toBe(hairline)
    expect(v.part).toEqual([0.02, -0.3])
    expect(v.undercut).toEqual([0.35, 0.85, 0.55, 0.3])
  })

  test('puts no undercut below the whole head', () => {
    const v = rootsStyleValues({ hairline, part: { x: 0, fade: 0 }, undercut: null })
    expect(v.undercut).toEqual([NO_UNDERCUT, 0, 0, 0])
    expect(NO_UNDERCUT).toBeLessThan(-Math.PI / 2)
  })

  test('reads the hairline as the shader does', () => {
    expect(hairlineAt(hairline, 0)).toBeCloseTo(0.7)
    expect(hairlineAt(hairline, -Math.PI)).toBeCloseTo(0.7 - 32 * 0.05)
    expect(hairlineAt(hairline, Math.PI / 64)).toBeCloseTo(0.7 - 0.025)
    expect(hairlineAt(hairline, 9)).toBeCloseTo(hairlineAt(hairline, Math.PI))
  })
})

/** Strips of two triangles each along z, their strand ids out of order. */
function strips(zs: number[]) {
  const position = new Float32Array(zs.length * 4 * 3)
  const hairData = new Float32Array(zs.length * 4 * 4)
  const index = new Uint32Array(zs.length * 6)
  zs.forEach((z, s) => {
    for (let k = 0; k < 4; k++) {
      position.set([k & 1, k >> 1, z], (s * 4 + k) * 3)
      hairData[(s * 4 + k) * 4 + 3] = 100 - s * 7
    }
    index.set(
      [0, 1, 2, 1, 3, 2].map((v) => v + s * 4),
      s * 6,
    )
  })
  return { position, hairData, index }
}

describe('soft pass order', () => {
  test('finds each strip and its middle', () => {
    const { position, hairData, index } = strips([0.3, -0.2, 0.1])
    const r = stripRanges(index, position, hairData)
    expect([...r.start]).toEqual([0, 6, 12])
    expect([...r.count]).toEqual([6, 6, 6])
    expect(r.centre[2]).toBeCloseTo(0.3)
    expect(r.centre[5]).toBeCloseTo(-0.2)
  })

  test('keys strips by how near the camera they are', () => {
    const { position, hairData, index } = strips([0.3, -0.2, 0.1])
    const keys = stripKeys(stripRanges(index, position, hairData), [0, 0, 1])
    expect(keys[0]! > keys[2]! && keys[2]! > keys[1]!).toBe(true)
  })

  test('draws the farthest strip first, keeping each strip whole', () => {
    const { position, hairData, index } = strips([0.3, -0.2, 0.1])
    const ranges = stripRanges(index, position, hairData)
    const front = sortedIndex(index, ranges, [0, 0, 1])
    expect([...front.subarray(0, 6)]).toEqual([...index.subarray(6, 12)])
    expect([...front.subarray(6, 12)]).toEqual([...index.subarray(12, 18)])
    expect([...front.subarray(12)]).toEqual([...index.subarray(0, 6)])
    const back = sortedIndex(index, ranges, [0, 0, -1])
    expect([...back.subarray(0, 6)]).toEqual([...index.subarray(0, 6)])
    expect([...back].sort()).toEqual([...index].sort())
  })

  test('sorts again only once the view has turned 8 degrees', () => {
    const at = (deg: number) =>
      [Math.sin((deg * Math.PI) / 180), 0, Math.cos((deg * Math.PI) / 180)] as const
    expect(turnedSince(null, at(0))).toBe(true)
    expect(turnedSince(at(0), at(7))).toBe(false)
    expect(turnedSince(at(0), at(9))).toBe(true)
  })
})
