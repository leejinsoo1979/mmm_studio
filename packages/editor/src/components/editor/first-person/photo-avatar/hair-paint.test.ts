import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBaseForTests } from './__bench__/base-for-tests'
import { readHairStyle } from './hair-library'
import { hairGains, pictureMedian, scalpDensity, tintScalp, tonePicture } from './hair-paint'
import { srgbToLinear } from './texture'

const HAIR = join(
  import.meta.dir,
  '../../../../../../../apps/editor/public/characters/photoreal/hair',
)

describe('hair paint', () => {
  test('a picture toned to a colour has that colour as its solid pixels’ median, its alpha kept', () => {
    const rgba = new Uint8ClampedArray(64 * 4)
    for (let i = 0; i < 64; i++) rgba.set([60 + i, 40 + i, 30 + i, i % 4 === 0 ? 0 : 255], i * 4)
    const blonde: [number, number, number] = [
      srgbToLinear(190),
      srgbToLinear(150),
      srgbToLinear(95),
    ]
    const out = tonePicture(rgba, hairGains(rgba, blonde))
    const median = pictureMedian(out)
    for (let k = 0; k < 3; k++) expect(Math.abs(median[k]! - blonde[k]!)).toBeLessThan(0.01)
    for (let i = 0; i < 64; i++) expect(out[i * 4 + 3]).toBe(rgba[i * 4 + 3]!)
    // Lighter strands stay lighter.
    expect(out[63 * 4]!).toBeGreaterThan(out[1 * 4]!)
  })

  test('the scalp tint lands on the head’s texture under the hairline only, fading out', async () => {
    const base = await loadBaseForTests('male')
    const bytes = readFileSync(join(HAIR, 'short02.bin'))
    const style = readHairStyle(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    )
    const size = 512
    const density = scalpDensity(style, 'male', base.headSkin.mesh, base.headSkin.weld, size)
    let full = 0
    let partial = 0
    let none = 0
    for (const d of density) {
      if (d > 0.99) full++
      else if (d > 0.01) partial++
      else none++
    }
    expect(full).toBeGreaterThan(1000)
    expect(partial).toBeGreaterThan(200)
    expect(none).toBeGreaterThan(full)
    const pixels = new Uint8ClampedArray(size * size * 4).fill(200)
    tintScalp(pixels, density, [0.02, 0.01, 0.005])
    const at = density.findIndex((d) => d > 0.99)
    const clear = density.indexOf(0)
    expect(pixels[at * 4]!).toBeLessThan(120)
    expect(pixels[clear * 4]).toBe(200)
  })
})
