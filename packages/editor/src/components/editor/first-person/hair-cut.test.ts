import { describe, expect, test } from 'bun:test'
import {
  cutKey,
  DEFAULT_CUT_PARAMS,
  DEFAULT_SHINE,
  HAIR_CUT_RANGES,
  HAIR_CUT_STYLES,
  type HairCut,
  readHairCut,
} from './hair-cut'

/** The longest cut as JSON: the longest style name, every slider at a two-place negative, a tip. */
const LARGEST_CUT: HairCut = {
  style: 'twoBlock',
  length: -0.37,
  volume: -0.37,
  curl: 0.37,
  part: -0.37,
  fringe: 0.37,
  tip: '#a0522d',
  shine: 0.37,
}

const picked = (style: HairCut['style']): HairCut => ({
  style,
  ...DEFAULT_CUT_PARAMS[style],
  tip: null,
  shine: DEFAULT_SHINE,
})

describe('a hair cut as saved or received', () => {
  test('comes back the same, at its largest and as each style is picked', () => {
    expect(readHairCut(JSON.parse(JSON.stringify(LARGEST_CUT)))).toEqual(LARGEST_CUT)
    for (const style of HAIR_CUT_STYLES) {
      expect(readHairCut(JSON.parse(JSON.stringify(picked(style))))).toEqual(picked(style))
    }
  })

  test('is no cut when it is junk or names a style this client lacks', () => {
    for (const junk of [
      undefined,
      null,
      42,
      'bob',
      [],
      {},
      ['bob'],
      { style: 'mohawk' },
      { style: 'bald' },
      { style: 'Female_Adult_04' },
      { style: 'Bob' },
      { length: 0.5 },
    ]) {
      expect(readHairCut(junk)).toBeNull()
    }
  })

  test('keeps each slider in its range, to the hundredth', () => {
    const cut = readHairCut({
      ...LARGEST_CUT,
      length: 3,
      volume: -7,
      curl: -0.5,
      part: 1.5,
      fringe: 2,
      shine: -1,
    })
    expect(cut).toEqual({
      ...LARGEST_CUT,
      length: 1,
      volume: -1,
      curl: 0,
      part: 1,
      fringe: 1,
      shine: 0,
    })
    const rounded = readHairCut({ ...LARGEST_CUT, length: 0.123456, part: -0.004, fringe: 0.995 })
    expect(rounded?.length).toBe(0.12)
    expect(Object.is(rounded?.part, 0)).toBe(true)
    expect(rounded?.fringe).toBe(1)
  })

  test('gives a missing or broken slider the style’s own setting', () => {
    expect(readHairCut({ style: 'dandy' })).toEqual(picked('dandy'))
    const broken = readHairCut({
      style: 'bob',
      length: Number.NaN,
      volume: '0.5',
      curl: null,
      part: Number.POSITIVE_INFINITY,
      fringe: { value: 1 },
      shine: [0.9],
    })
    expect(broken).toEqual(picked('bob'))
  })

  test('takes a tip colour only as #rrggbb', () => {
    expect(readHairCut({ ...LARGEST_CUT, tip: '#A0522D' })?.tip).toBe('#A0522D')
    for (const tip of ['red', '#a0522', '#a0522dd', 'a0522d', 42, {}, undefined]) {
      expect(readHairCut({ ...LARGEST_CUT, tip })?.tip).toBeNull()
    }
  })
})

describe('each style’s starting sliders', () => {
  test('are in range, length, volume and curl the style’s own', () => {
    expect(new Set(HAIR_CUT_STYLES).size).toBe(9)
    expect(Object.keys(DEFAULT_CUT_PARAMS).sort()).toEqual([...HAIR_CUT_STYLES].sort())
    for (const style of HAIR_CUT_STYLES) {
      const params = DEFAULT_CUT_PARAMS[style]
      expect(Object.keys(params).sort()).toEqual(Object.keys(HAIR_CUT_RANGES).sort())
      for (const [id, [low, high]] of Object.entries(HAIR_CUT_RANGES)) {
        const value = params[id as keyof typeof HAIR_CUT_RANGES]
        expect(value).toBeGreaterThanOrEqual(low)
        expect(value).toBeLessThanOrEqual(high)
      }
      expect([params.length, params.volume, params.curl]).toEqual([0, 0, 0])
    }
  })

  test('give the 댄디컷 the fullest fringe and the 숏컷 a side part', () => {
    const fringes = HAIR_CUT_STYLES.map((style) => DEFAULT_CUT_PARAMS[style].fringe)
    expect(Math.max(...fringes)).toBe(DEFAULT_CUT_PARAMS.dandy.fringe)
    expect(DEFAULT_CUT_PARAMS.short.part).toBeGreaterThan(0)
    expect(DEFAULT_CUT_PARAMS.bob.part).toBe(0)
  })
})

describe('the key hair is grown for', () => {
  test('ignores the tip colour and the shine', () => {
    const plain: HairCut = { ...LARGEST_CUT, tip: null, shine: 1 }
    expect(cutKey(plain)).toBe(cutKey(LARGEST_CUT))
  })

  test('tells every style and slider apart, to the hundredth', () => {
    const keys = new Set(HAIR_CUT_STYLES.map((style) => cutKey(picked(style))))
    expect(keys.size).toBe(HAIR_CUT_STYLES.length)
    for (const id of Object.keys(HAIR_CUT_RANGES) as (keyof typeof HAIR_CUT_RANGES)[]) {
      expect(cutKey({ ...LARGEST_CUT, [id]: LARGEST_CUT[id] + 0.01 })).not.toBe(cutKey(LARGEST_CUT))
    }
    expect(cutKey({ ...LARGEST_CUT, length: -0.371 })).toBe(cutKey(LARGEST_CUT))
    expect(cutKey({ ...picked('bob'), part: -0.001 })).toBe(cutKey(picked('bob')))
  })
})
