import { describe, expect, test } from 'bun:test'
import {
  type AvatarLook,
  type HairStyleEntry,
  NO_LOOK,
  NO_PAINT,
  readAvatarLook,
} from '@pascal-app/editor'
import { type Random, randomLook } from './random-look'

/** A seeded random (mulberry32), so each run draws the same looks. */
function seeded(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STYLES: HairStyleEntry[] = [
  { id: 'Female_Adult_04', gender: 'female', length: 'short' },
  { id: 'Female_Adult_15', gender: 'female', length: 'long' },
  { id: 'Male_Adult_07', gender: 'male', length: 'short' },
  { id: 'Male_Adult_09', gender: 'male', length: 'long' },
]

const LOOK: AvatarLook = {
  ...NO_LOOK,
  skin: '#C68D63',
  shape: { fit: 0.4, sliders: { eyeSize: 0.9 } },
  hairStyle: 'Female_Adult_04',
  paint: { ...NO_PAINT, eyes: '#3E6AA8', lips: '#B3202E' },
}

const draws = (avatar: string, styles: HairStyleEntry[] | null = STYLES) =>
  Array.from({ length: 200 }, (_, i) => randomLook(LOOK, avatar, styles, seeded(i + 1)))

describe('a random look', () => {
  test('keeps the skin, the photo fit and the chosen iris colour', () => {
    for (const look of draws('Female_Adult_07')) {
      expect(look.skin).toBe(LOOK.skin)
      expect(look.face).toBe(LOOK.face)
      expect(look.shape.fit).toBe(0.4)
      expect(look.paint.eyes).toBe('#3E6AA8')
    }
  })

  test('keeps its sliders and height within half their reach, and is a valid look', () => {
    for (const look of draws('Male_Adult_07')) {
      const values = [
        look.body.height,
        ...Object.values(look.shape.sliders),
        ...Object.values(look.body.sliders),
      ]
      for (const value of values) expect(Math.abs(value)).toBeLessThanOrEqual(0.5)
      expect(readAvatarLook(look)).toEqual(look)
    }
  })

  test('changes most sliders, not only a few', () => {
    const [look] = draws('Male_Adult_07')
    expect(Object.keys(look!.shape.sliders).length).toBeGreaterThan(20)
    expect(Object.keys(look!.body.sliders).length).toBeGreaterThan(6)
  })

  test('borrows only hairstyles of the character’s sex, sometimes keeping its own', () => {
    const styles = draws('Male_Adult_03').map((look) => look.hairStyle)
    expect(styles).toContain(null)
    expect(styles).toContain('Male_Adult_09')
    for (const style of styles) expect([null, 'Male_Adult_07', 'Male_Adult_09']).toContain(style)
  })

  test('keeps the hairstyle it has while the library is unavailable', () => {
    for (const look of draws('Female_Adult_07', null))
      expect(look.hairStyle).toBe('Female_Adult_04')
  })

  test('gives women make-up and men facial hair, each only sometimes', () => {
    const women = draws('Female_Adult_07')
    expect(women.every((look) => look.paint.beard === 'none')).toBe(true)
    expect(women.some((look) => look.paint.lips)).toBe(true)
    expect(women.some((look) => !look.paint.lips)).toBe(true)
    expect(women.some((look) => look.paint.blush)).toBe(true)

    const men = draws('Business_Male_03')
    expect(men.every((look) => !look.paint.lips && !look.paint.blush && !look.paint.shadow)).toBe(
      true,
    )
    expect(men.some((look) => look.paint.beard === 'stubble')).toBe(true)
    expect(men.some((look) => look.paint.beard === 'none')).toBe(true)
  })

  test('paints nothing on a child but the iris', () => {
    for (const look of draws('Female_Child_01')) {
      expect(look.paint).toEqual({ ...NO_PAINT, eyes: '#3E6AA8' })
    }
  })
})
