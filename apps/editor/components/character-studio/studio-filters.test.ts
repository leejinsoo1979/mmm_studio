import { describe, expect, test } from 'bun:test'
import { STUDIO_FILTERS } from './stage-contract'
import {
  applyColorMatrix,
  filterMatrix,
  functionMatrix,
  GRAIN_TILE,
  gradientLine,
  grainPixels,
  IDENTITY_MATRIX,
  overlayBackground,
  parseFilter,
  STUDIO_FILTER,
  vignetteEllipse,
} from './studio-filters'

/** A matrix applied to one colour (0–1). */
function apply(matrix: number[], [r, g, b]: [number, number, number]) {
  const pixel = new Uint8ClampedArray([r * 255, g * 255, b * 255, 255])
  applyColorMatrix(pixel, matrix)
  return [...pixel].map((value) => value / 255)
}

describe('the studio filters', () => {
  test('cover every filter the stage contract names, and every recipe reads', () => {
    for (const { id } of STUDIO_FILTERS) {
      const recipe = STUDIO_FILTER[id]
      expect(recipe).toBeDefined()
      expect(() => parseFilter(recipe.css)).not.toThrow()
      expect(filterMatrix(id).every(Number.isFinite)).toBe(true)
    }
  })

  test('사실적 changes nothing', () => {
    expect(STUDIO_FILTER.realistic.css).toBe('none')
    expect(STUDIO_FILTER.realistic.overlays).toEqual([])
    expect(filterMatrix('realistic')).toEqual(IDENTITY_MATRIX)
  })

  test('reads amounts, percentages and turns', () => {
    expect(parseFilter('grayscale(1) contrast(118%) hue-rotate(-8deg)')).toEqual([
      { name: 'grayscale', amount: 1 },
      { name: 'contrast', amount: 1.18 },
      { name: 'hue-rotate', amount: -8 },
    ])
    expect(() => parseFilter('blur(2px)')).toThrow()
    expect(() => parseFilter('hue-rotate(8)')).toThrow()
  })

  test('grayscale gives every channel the same', () => {
    const m = functionMatrix({ name: 'grayscale', amount: 1 })
    for (let column = 0; column < 5; column++) {
      expect(m[column]).toBeCloseTo(m[5 + column]!, 9)
      expect(m[column]).toBeCloseTo(m[10 + column]!, 9)
    }
    const [r, g, b] = apply(filterMatrix('mono'), [0.8, 0.3, 0.1])
    expect(r).toBeCloseTo(g!, 2)
    expect(g).toBeCloseTo(b!, 2)
  })

  test('contrast stretches round the middle grey', () => {
    const m = functionMatrix({ name: 'contrast', amount: 1.38 })
    expect(1.38 * 0.5 + m[4]!).toBeCloseTo(0.5, 9)
    const [low] = apply(m, [0.4, 0.4, 0.4])
    const [high] = apply(m, [0.6, 0.6, 0.6])
    expect(0.5 - low!).toBeCloseTo(high! - 0.5, 2)
    expect(high! - low!).toBeCloseTo(0.2 * 1.38, 2)
  })

  test('a full hue turn and zero saturation behave', () => {
    const turn = functionMatrix({ name: 'hue-rotate', amount: 360 })
    for (const [i, value] of IDENTITY_MATRIX.entries()) expect(turn[i]).toBeCloseTo(value, 9)
    const grey = apply(functionMatrix({ name: 'saturate', amount: 0 }), [0.9, 0.2, 0.4])
    expect(grey[0]).toBeCloseTo(grey[1]!, 2)
  })

  test('shapes the vignette as CSS’s farthest-corner ellipse', () => {
    const box = { width: 1280, height: 720, cx: 528, cy: 360 }
    const { rx, ry } = vignetteEllipse(box)
    // Shaped as its closest sides, through the farthest corner.
    expect(rx / ry).toBeCloseTo(528 / 360, 9)
    expect((1280 - 528) ** 2 / rx ** 2 + 360 ** 2 / ry ** 2).toBeCloseTo(1, 9)
    expect(overlayBackground({ kind: 'vignette', strength: 0.3 }, box, null)).toContain(
      'at 528px 360px',
    )
  })

  test('lays a gradient along CSS’s gradient line', () => {
    const down = gradientLine(180, 200, 100)
    expect(down.x0).toBeCloseTo(100, 9)
    expect(down.y0).toBeCloseTo(0, 9)
    expect(down.x1).toBeCloseTo(100, 9)
    expect(down.y1).toBeCloseTo(100, 9)
    const slant = gradientLine(160, 200, 100)
    expect(slant.y1).toBeGreaterThan(slant.y0)
    expect(slant.x1).toBeGreaterThan(slant.x0)
  })

  test('makes the same grain every time', () => {
    const grain = grainPixels()
    expect(grain.length).toBe(GRAIN_TILE * GRAIN_TILE * 4)
    expect(grainPixels()).toEqual(grain)
    const mean = grain.reduce((sum, value, i) => (i % 4 === 0 ? sum + value : sum), 0)
    expect(mean / (GRAIN_TILE * GRAIN_TILE)).toBeCloseTo(127.5, -1)
  })
})
