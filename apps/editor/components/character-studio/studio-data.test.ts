import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { HAIR_CUT_RANGES, HAIR_CUT_STYLES, type HairStyleEntry } from '@pascal-app/editor'
import { HAIR_CUT_LABELS, HAIR_CUT_SLIDERS, hairSections } from './studio-data'

const STYLES: HairStyleEntry[] = JSON.parse(
  readFileSync(
    new URL('../../public/characters/rocketbox/hair-styles.json', import.meta.url),
    'utf8',
  ),
).styles

describe('the hairstyle gallery', () => {
  test('names every style in the library, each differently', () => {
    const names = hairSections(STYLES).flatMap((section) => section.styles.map(({ name }) => name))
    expect(names).toHaveLength(STYLES.length)
    expect(new Set(names).size).toBe(names.length)
    expect(names.some((name) => /\d$/.test(name))).toBe(false)
  })

  test('goes short to long, leaving out lengths it has none of', () => {
    const sections = hairSections([
      { id: 'Unknown_1', gender: 'male', length: 'long' },
      { id: 'Unknown_2', gender: 'male', length: 'short' },
      { id: 'Unknown_3', gender: 'male', length: 'long' },
    ])
    expect(sections.map(({ label }) => label)).toEqual(['짧은 머리', '긴 머리'])
    expect(sections[1]!.styles.map(({ name }) => name)).toEqual(['긴 머리 1', '긴 머리 2'])
  })
})

describe('the generated hairstyles', () => {
  test('each has a name of its own, in Korean', () => {
    const names = HAIR_CUT_STYLES.map((style) => HAIR_CUT_LABELS[style])
    expect(new Set(names).size).toBe(HAIR_CUT_STYLES.length)
    for (const name of names) expect(name).toMatch(/^[가-힣]+$/)
  })

  test('every slider of a cut is offered once, length first', () => {
    const ids = HAIR_CUT_SLIDERS.map(({ id }) => id)
    expect(ids).toEqual(['length', 'volume', 'curl', 'part', 'fringe'])
    expect(Object.keys(HAIR_CUT_RANGES).sort()).toEqual([...ids].sort())
  })
})
