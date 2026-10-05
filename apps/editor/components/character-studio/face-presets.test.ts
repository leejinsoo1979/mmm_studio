import { describe, expect, test } from 'bun:test'
import { DEFAULT_FACE_SHAPE, FACE_SLIDERS, type FaceShape } from '@pascal-app/editor'
import {
  applyPreset,
  FACE_PRESETS,
  type PresetRegion,
  presetMatches,
  regionGlyph,
  regionSliders,
} from './face-presets'

const REGIONS = Object.keys(FACE_PRESETS) as PresetRegion[]
const groupOf = Object.fromEntries(FACE_SLIDERS.map(({ id, group }) => [id, group]))

/** Commands and numbers only, every number finite: something an SVG path parses. */
function parses(d: string) {
  if (!/^M/.test(d)) return false
  const tokens = d.match(/[MCQALZ]|-?\d+(\.\d+)?/g) ?? []
  return tokens.join('').length === d.replace(/[\s,]/g, '').length && !d.includes('NaN')
}

describe('face presets', () => {
  test('every region starts with 기본 and has four to six', () => {
    for (const region of REGIONS) {
      const presets = FACE_PRESETS[region]
      expect(presets[0]?.label).toBe('기본')
      expect(presets[0]?.sliders).toEqual({})
      expect(presets.length).toBeGreaterThanOrEqual(4)
      expect(presets.length).toBeLessThanOrEqual(6)
      expect(new Set(presets.map(({ id }) => id)).size).toBe(presets.length)
    }
  })

  test('a preset sets only its own region’s sliders, within ±1', () => {
    for (const region of REGIONS) {
      for (const preset of FACE_PRESETS[region]) {
        for (const [id, value] of Object.entries(preset.sliders)) {
          expect(groupOf[id]).toBe(region)
          expect(Math.abs(value)).toBeLessThanOrEqual(1)
          expect(value).not.toBe(0)
        }
      }
    }
  })

  test('applying replaces the region’s sliders and keeps the rest and the pins', () => {
    const shape: FaceShape = {
      fit: 1,
      sliders: { eyeSize: 0.3, eyeDepth: -0.2, noseTip: 0.4 },
      pins: { 4: [0, 0, 0.02] },
    }
    const upturned = FACE_PRESETS.eyes.find(({ id }) => id === 'upturned')!
    const next = applyPreset(shape, 'eyes', upturned)
    expect(next.sliders).toEqual({ noseTip: 0.4, eyeTilt: 0.6 })
    expect(next.pins).toBe(shape.pins)
    expect(shape.sliders.eyeSize).toBe(0.3)
    expect(applyPreset(shape, 'eyes', FACE_PRESETS.eyes[0]!).sliders).toEqual({ noseTip: 0.4 })
  })

  test('a preset is picked when the region’s sliders are exactly it', () => {
    const vline = FACE_PRESETS.face.find(({ id }) => id === 'vline')!
    const shape = applyPreset(DEFAULT_FACE_SHAPE, 'face', vline)
    expect(presetMatches(shape, 'face', vline)).toBe(true)
    expect(presetMatches(shape, 'face', FACE_PRESETS.face[0]!)).toBe(false)
    expect(presetMatches(DEFAULT_FACE_SHAPE, 'face', FACE_PRESETS.face[0]!)).toBe(true)
    const nudged = { ...shape, sliders: { ...shape.sliders, faceWidth: 0.1 } }
    expect(presetMatches(nudged, 'face', vline)).toBe(false)
    // Other regions don't matter.
    const withNose = { ...shape, sliders: { ...shape.sliders, noseTip: 0.5 } }
    expect(presetMatches(withNose, 'face', vline)).toBe(true)
    expect(regionSliders(withNose, 'nose')).toEqual({ noseTip: 0.5 })
  })
})

describe('glyphs', () => {
  test('every preset and the extremes draw a path that parses', () => {
    for (const region of REGIONS) {
      for (const preset of FACE_PRESETS[region])
        expect(parses(regionGlyph(region, preset.sliders))).toBe(true)
      const ids = FACE_SLIDERS.filter(({ group }) => group === region).map(({ id }) => id)
      for (const end of [-1, 1]) {
        const sliders = Object.fromEntries(ids.map((id) => [id, end]))
        const d = regionGlyph(region, sliders)
        expect(parses(d)).toBe(true)
        for (const value of d.match(/-?\d+(\.\d+)?/g) ?? []) {
          expect(Number(value)).toBeGreaterThan(-2)
          expect(Number(value)).toBeLessThan(50)
        }
      }
    }
  })

  test('sliders change the drawing', () => {
    for (const region of REGIONS) {
      const plain = regionGlyph(region, {})
      for (const preset of FACE_PRESETS[region].slice(1)) {
        expect(regionGlyph(region, preset.sliders)).not.toBe(plain)
      }
    }
  })
})
