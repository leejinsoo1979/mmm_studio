import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBaseForTests } from './__bench__/base-for-tests'
import { movedPositions } from './base-body'
import {
  fitHairPart,
  HAIR_STYLES,
  type HairStyleName,
  partsFor,
  readHairStyle,
} from './hair-library'

const HAIR = join(
  import.meta.dir,
  '../../../../../../../apps/editor/public/characters/photoreal/hair',
)

const style = (name: HairStyleName) => {
  const bytes = readFileSync(join(HAIR, `${name}.bin`))
  return readHairStyle(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
}

describe('hair library', () => {
  test('every style reads whole: parts within their arrays, a cap per body, a scalp tint', () => {
    const index = JSON.parse(readFileSync(join(HAIR, 'styles.json'), 'utf8'))
    expect(Object.keys(index.styles).sort()).toEqual(Object.keys(HAIR_STYLES).sort())
    for (const name of Object.keys(HAIR_STYLES) as HairStyleName[]) {
      const s = style(name)
      expect(s.name).toBe(name)
      expect({ length: s.length, tied: s.tied, volume: s.volume, fringe: s.fringe }).toEqual(
        HAIR_STYLES[name],
      )
      for (const gender of ['male', 'female'] as const) {
        const parts = partsFor(s, gender)
        expect(parts.some((p) => p.name === `cap-${gender}`)).toBe(true)
        expect(parts.some((p) => p.name === 'cards')).toBe(name !== 'buzz')
        for (const part of parts) {
          const n = part.refs.length / 3
          expect(part.weights.length).toBe(n * 3)
          expect(part.uvs.length).toBe(n * 2)
          expect(part.jointWeights.length).toBe(n * 4)
          let worst = 0
          for (const i of part.indices) worst = Math.max(worst, i)
          expect(worst).toBeLessThan(n)
          for (let i = 0; i < n; i++) {
            const sum =
              part.jointWeights[i * 4]! +
              part.jointWeights[i * 4 + 1]! +
              part.jointWeights[i * 4 + 2]! +
              part.jointWeights[i * 4 + 3]!
            expect(sum).toBe(255)
          }
        }
        expect(s.scalp[gender].vertices.length).toBeGreaterThan(100)
        for (const d of s.scalp[gender].density) expect(d >= 0 && d <= 1).toBe(true)
      }
    }
  })

  test('cards fitted MakeHuman’s way sit where MPFB put the base body’s own ponytail01', async () => {
    for (const gender of ['female'] as const) {
      const base = await loadBaseForTests(gender)
      const s = style('ponytail01')
      const cards = partsFor(s, gender).find((p) => p.name === 'cards')!
      const mine = fitHairPart(s, cards, base.basemesh)
      const index = base.primitives.findIndex((p) => p.material === 'Hair')
      const theirs = movedPositions(base, index, new Float64Array(base.basemesh.length))
      let worst = 0
      for (let i = 0; i < mine.length; i += 3) {
        let best = Number.POSITIVE_INFINITY
        for (let j = 0; j < theirs.length; j += 3)
          best = Math.min(
            best,
            Math.hypot(
              mine[i]! - theirs[j]!,
              mine[i + 1]! - theirs[j + 1]!,
              mine[i + 2]! - theirs[j + 2]!,
            ),
          )
        worst = Math.max(worst, best)
      }
      // The base body's positions are 16-bit quantised (about 0.1 mm here).
      expect(worst).toBeLessThan(0.0003)
    }
  })

  test('a style follows a reshaped head, its offsets scaled with it', async () => {
    const base = await loadBaseForTests('female')
    const s = style('long01-bob')
    const cards = partsFor(s, 'female').find((p) => p.name === 'cards')!
    const rest = fitHairPart(s, cards, base.basemesh)
    // The whole head 10 % larger about the eyes: the hair, offsets and all, grows with it.
    const [ex, ey, ez] = base.head.frame.eyes
    const grown = Float64Array.from(base.basemesh)
    for (let i = 0; i < grown.length; i += 3) {
      grown[i] = ex + (grown[i]! - ex) * 1.1
      grown[i + 1] = ey + (grown[i + 1]! - ey) * 1.1
      grown[i + 2] = ez + (grown[i + 2]! - ez) * 1.1
    }
    const moved = fitHairPart(s, cards, grown)
    let worst = 0
    for (let i = 0; i < rest.length; i += 3) {
      const want = [
        ex + (rest[i]! - ex) * 1.1,
        ey + (rest[i + 1]! - ey) * 1.1,
        ez + (rest[i + 2]! - ez) * 1.1,
      ]
      worst = Math.max(
        worst,
        Math.hypot(moved[i]! - want[0]!, moved[i + 1]! - want[1]!, moved[i + 2]! - want[2]!),
      )
    }
    expect(worst).toBeLessThan(1e-5)
  })
})
