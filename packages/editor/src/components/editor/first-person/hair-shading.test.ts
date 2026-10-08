import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_HAIR,
  HAIRLINE_STEPS,
  hairLookValues,
  hairlineWobble,
  linearOf,
  lodWidthScale,
  NO_UNDERCUT,
  ROOT_SHADE,
  rootsStyleValues,
  sortedIndex,
  stripKeys,
  stripRanges,
  TIP_LIFT,
  turnedSince,
  WOBBLE_OCTAVES,
  wobbleCorners,
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
    expect(hairLookValues({ ...look, shine: 0 })).toMatchObject({ expR: 30, expTRT: 16, kR: 0.12 })
    expect(hairLookValues({ ...look, shine: 1 })).toMatchObject({ expR: 120, expTRT: 48, kR: 0.3 })
    expect(hairLookValues({ ...look, shine: 0.5 }).kR).toBeCloseTo(0.21)
    expect(hairLookValues({ ...look, shine: 7 }).expR).toBe(120)
    expect(hairLookValues({ ...look, shine: Number.NaN }).expR).toBe(75)
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
      part: { x: 0.02, fade: [-0.04, 0.08], crown: -0.02 },
      undercut: { line: 0.35, shells: [0.85, 0.55, 0.3] },
    })
    expect(v.hairline).toEqual(hairline)
    expect(v.hairline).not.toBe(hairline)
    expect(v.part).toEqual([0.02, -0.04, 0.08, -0.02])
    expect(v.undercut).toEqual([0.35, 0.85, 0.55, 0.3])
  })

  test('puts no undercut below the whole head', () => {
    const v = rootsStyleValues({
      hairline,
      part: { x: 0, fade: [-0.04, 0.08], crown: -0.02 },
      undercut: null,
    })
    expect(v.undercut).toEqual([NO_UNDERCUT, 0, 0, 0])
    expect(NO_UNDERCUT).toBeLessThan(-Math.PI / 2)
  })
})

describe('hairlineWobble', () => {
  test("is the generator's: its values at fixed azimuths, taken from hair-scalp.ts's hairlineWobble", () => {
    const generator: [number, number][] = [
      [-3.1, -0.0102314],
      [-2.2, 0.0330569],
      [-1.37, -0.0128135],
      [-0.5, -0.0136398],
      [0, 0.0115147],
      [0.123, 0.0351857],
      [0.77, -0.0040452],
      [1.65, 0.0201444],
      [2.9, -0.0335478],
      [Math.PI, 0.0188228],
    ]
    for (const [a, w] of generator) expect(hairlineWobble(a)).toBeCloseTo(w, 6)
  })

  test('the noise corners the shader reads rebuild it over the whole circle', () => {
    for (let a = -Math.PI; a <= Math.PI; a += 0.0137) {
      let sum = 0
      for (const octave of WOBBLE_OCTAVES) {
        const { first, values } = wobbleCorners(octave)
        const x = a * octave.freq
        const i = Math.floor(x)
        const f = x - i
        const t = f * f * (3 - 2 * f)
        const k = i - first
        expect(k).toBeGreaterThanOrEqual(0)
        expect(k + 1).toBeLessThan(values.length)
        sum += octave.amp * (values[k]! + (values[k + 1]! - values[k]!) * t)
      }
      expect(sum).toBeCloseTo(hairlineWobble(a), 6)
    }
  })

  test('stays within its amplitude', () => {
    const most = WOBBLE_OCTAVES.reduce((s, o) => s + o.amp, 0)
    for (let a = -Math.PI; a <= Math.PI; a += 0.01) {
      expect(Math.abs(hairlineWobble(a))).toBeLessThanOrEqual(most)
    }
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
