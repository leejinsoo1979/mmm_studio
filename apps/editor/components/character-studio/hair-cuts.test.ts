import { describe, expect, test } from 'bun:test'
import { DEFAULT_CUT_PARAMS, DEFAULT_SHINE, type HairCut, readHairCut } from '@pascal-app/editor'
import { OFFERED_CUTS, OFFERED_SLIDERS, pickCut, setSlider } from './hair-cuts'
import { HAIR_CUT_LABELS, HAIR_CUT_SLIDERS } from './studio-data'

const BOB: HairCut = {
  style: 'bob',
  ...DEFAULT_CUT_PARAMS.bob,
  length: 0.4,
  tip: '#d8b07a',
  shine: 0.8,
}

describe('the 헤어 panel’s generated styles', () => {
  test('offers 단발 and 투블럭, with 길이 and 볼륨', () => {
    expect(OFFERED_CUTS.map((style) => HAIR_CUT_LABELS[style])).toEqual(['단발', '투블럭'])
    const labels = HAIR_CUT_SLIDERS.filter(({ id }) => OFFERED_SLIDERS.includes(id))
    expect(labels.map(({ label }) => label)).toEqual(['길이', '볼륨'])
  })
})

describe('pickCut', () => {
  test('starts a style at its own sliders, keeping the tip and shine of the cut worn', () => {
    const picked = pickCut({ hairCut: BOB, hairStyle: null }, 'twoBlock')
    expect(picked.hairCut).toEqual({
      style: 'twoBlock',
      ...DEFAULT_CUT_PARAMS.twoBlock,
      tip: '#d8b07a',
      shine: 0.8,
    })
  })

  test('starts from no tip and the default shine on own hair, and lets a borrowed hairstyle go', () => {
    const picked = pickCut({ hairCut: null, hairStyle: 'Female_Adult_03' }, 'bob')
    expect(picked.hairStyle).toBeNull()
    expect(picked.hairCut).toMatchObject({ style: 'bob', tip: null, shine: DEFAULT_SHINE })
    expect(readHairCut(picked.hairCut)).toEqual(picked.hairCut)
  })

  test('own hair takes the cut off and leaves the rest as it is', () => {
    expect(pickCut({ hairCut: BOB, hairStyle: 'bald' }, null)).toEqual({
      hairCut: null,
      hairStyle: 'bald',
    })
  })
})

describe('setSlider', () => {
  test('sets one slider, in its range, to the hundredth a saved cut keeps', () => {
    const longer = setSlider(BOB, 'length', 0.293333)
    expect(longer).toEqual({ ...BOB, length: 0.29 })
    expect(readHairCut(longer)).toEqual(longer)
    expect(setSlider(BOB, 'volume', 3).volume).toBe(1)
    expect(setSlider(BOB, 'curl', -1).curl).toBe(0)
    expect(Object.is(setSlider(BOB, 'length', -0.001).length, 0)).toBe(true)
  })
})
