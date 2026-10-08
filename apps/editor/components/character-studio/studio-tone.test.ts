import { describe, expect, test } from 'bun:test'
import { CONTACT } from './studio-contact-shadow'
import {
  NEUTRAL_COMPRESSION,
  neutralUntone,
  type Rgb,
  SHADOW_POWER,
  untonedColor,
} from './studio-tone'

/** three's NeutralToneMapping (src/nodes/display/ToneMappingFunctions.js), on the CPU. */
function neutral([r, g, b]: Rgb, exposure = 1): Rgb {
  let color: Rgb = [r * exposure, g * exposure, b * exposure]
  const x = Math.min(...color)
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04
  color = color.map((c) => c - offset) as Rgb
  const peak = Math.max(...color)
  if (peak < NEUTRAL_COMPRESSION) return color
  const d = 1 - NEUTRAL_COMPRESSION
  const newPeak = 1 - (d * d) / (peak + d - NEUTRAL_COMPRESSION)
  color = color.map((c) => (c * newPeak) / peak) as Rgb
  const fade = 1 - 1 / (0.15 * (peak - newPeak) + 1)
  return color.map((c) => c + (newPeak - c) * fade) as Rgb
}

const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
/** The 8-bit sRGB pixel the output pass writes for a linear colour drawn into the frame. */
const shown = (drawn: Rgb, exposure = 1) =>
  neutral(drawn, exposure).map((c) => Math.round(toSrgb(c) * 255))

describe('neutralUntone', () => {
  test('Neutral maps it back to what it was given, below the compression', () => {
    for (let r = 0; r <= 0.7; r += 0.05) {
      for (let g = 0; g <= 0.7; g += 0.07) {
        for (let b = 0; b <= 0.7; b += 0.09) {
          const back = neutral(neutralUntone([r, g, b]))
          expect(back[0]).toBeCloseTo(r, 9)
          expect(back[1]).toBeCloseTo(g, 9)
          expect(back[2]).toBeCloseTo(b, 9)
        }
      }
    }
  })

  test('holds at the exposure it is given', () => {
    const back = neutral(neutralUntone([0.02, 0.3, 0.5], 1.4), 1.4)
    expect(back[0]).toBeCloseTo(0.02, 9)
    expect(back[1]).toBeCloseTo(0.3, 9)
    expect(back[2]).toBeCloseTo(0.5, 9)
  })

  test('is continuous where Neutral switches from its curve to a flat offset', () => {
    const below = neutralUntone([0.04 - 1e-9, 0.5, 0.5])
    const above = neutralUntone([0.04, 0.5, 0.5])
    expect(below[1]).toBeCloseTo(above[1], 6)
  })

  test('leaves black black', () => {
    expect(neutralUntone([0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('untonedColor', () => {
  test('the AI photo backdrop shows as its own grey', () => {
    const { r, g, b } = untonedColor('#c9cdd3')
    expect(shown([r, g, b])).toEqual([0xc9, 0xcd, 0xd3])
  })

  test('the backdrop gradient stops show as themselves', () => {
    for (const stop of [
      [42, 46, 53],
      [20, 22, 26],
      [7, 8, 10],
      [29, 34, 41],
    ] as Rgb[]) {
      const css = `rgb(${stop.join(',')})`
      const { r, g, b } = untonedColor(css)
      expect(shown([r, g, b])).toEqual(stop)
    }
  })

  test('is brighter than the colour itself, which Neutral would darken', () => {
    const color = untonedColor('#5b8fb9')
    expect(color.r).toBeGreaterThan(toLinear(0x5b / 255))
  })
})

describe('SHADOW_POWER', () => {
  /**
   * How far (8-bit levels) the shadow, at any opacity up to the contact
   * shadow's, shows from WebGL's black blended over `css` in display colours.
   */
  const furthest = (css: Rgb, power: number) => {
    const drawn = neutralUntone(css.map((c) => toLinear(c / 255)) as Rgb)
    let furthest = 0
    for (let a = 0; a <= CONTACT.opacity + 1e-9; a += 0.025) {
      const gpu = shown(drawn.map((c) => c * (1 - a) ** power) as Rgb)
      for (let i = 0; i < 3; i++)
        furthest = Math.max(furthest, Math.abs(gpu[i]! - css[i]! * (1 - a)))
    }
    return furthest
  }

  test('darkens the platform round the feet as WebGL did, within 4 levels', () => {
    for (const tone of [
      [23, 24, 26],
      [33, 36, 40],
      [40, 42, 46],
      [45, 46, 48],
    ] as Rgb[]) {
      expect(furthest(tone, SHADOW_POWER.platform)).toBeLessThanOrEqual(4)
    }
  })

  test('darkens the AI photo grey as WebGL did, within 5 levels', () => {
    expect(furthest([0xc9, 0xcd, 0xd3], SHADOW_POWER.light)).toBeLessThanOrEqual(5)
  })

  test('takes a power of its own for each: one for both is out by a dozen levels or more', () => {
    for (const power of [SHADOW_POWER.platform, SHADOW_POWER.light]) {
      expect(
        Math.max(furthest([40, 42, 46], power), furthest([0xc9, 0xcd, 0xd3], power)),
      ).toBeGreaterThan(12)
    }
  })
})
