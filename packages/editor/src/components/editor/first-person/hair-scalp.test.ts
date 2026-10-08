import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { headFits } from './hair-base'
import { groomOf, hairlineTable, unionHairline } from './hair-groom'
import { headData, headFrame } from './hair-grow'
import {
  hairlineAt,
  hairlineDensity,
  inEyes,
  mulberry32,
  octDecode,
  octEncode,
  outOfEyes,
  ROOT_PASSES,
  radiusAt,
  rayTriangle,
  rootCandidates,
  TEMPLATE_CM,
} from './hair-scalp'
import { type HairLibrary, loadHairLibrary } from './hair-styles'
import { loadHairHead } from './hair-test-utils'
import { fitBald } from './head-skull'

const ROCKETBOX = join(import.meta.dir, '../../../../../../apps/editor/public/characters/rocketbox')

let library: HairLibrary

beforeAll(async () => {
  const real = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(Bun.file(join(ROCKETBOX, 'hair-styles.json')))) as unknown as typeof fetch
  try {
    library = await loadHairLibrary()
  } finally {
    globalThis.fetch = real
  }
})

const union = (a: number, e: number) => e > hairlineAt(unionHairline(), a) - 0.1

describe('root candidates', () => {
  test('come out the same, pass after pass, each pass its gap apart', () => {
    const one = rootCandidates(library.skull, 'test-a', union)
    const two = rootCandidates(library.skull, 'test-b', union)
    expect(two.point).toEqual(one.point)
    expect(one.passEnd.length).toBe(ROOT_PASSES.length)
    // Passes in order, so any prefix (far, game, studio) holds the ones before it.
    for (let i = 1; i < one.count; i++)
      expect(one.pass[i]!).toBeGreaterThanOrEqual(one.pass[i - 1]!)
    // The first pass is the guides (about 150–260 over the scalp); all three about 2600.
    expect(one.passEnd[0]!).toBeGreaterThan(150)
    expect(one.passEnd[0]!).toBeLessThan(320)
    expect(one.count).toBeGreaterThan(2000)
    // No two of a pass nearer than its gap, nor any to one of an earlier pass.
    for (let i = 0; i < one.count; i++) {
      const gap = ROOT_PASSES[one.pass[i]!]!.gap * TEMPLATE_CM
      for (let j = 0; j < i; j++) {
        const d = Math.hypot(
          one.point[i * 3]! - one.point[j * 3]!,
          one.point[i * 3 + 1]! - one.point[j * 3 + 1]!,
          one.point[i * 3 + 2]! - one.point[j * 3 + 2]!,
        )
        expect(d).toBeGreaterThanOrEqual(gap * 0.999)
      }
    }
  }, 60000)

  test('a style keeps none under its hairline', () => {
    const c = rootCandidates(library.skull, 'test-a', union)
    for (const sex of ['male', 'female'] as const) {
      const table = hairlineTable(
        groomOf(
          {
            style: 'bob',
            length: 0,
            volume: 0,
            curl: 0,
            part: 0,
            fringe: 0.5,
            tip: null,
            shine: 0.5,
          },
          { sex, child: false },
        ),
      )
      for (let i = 0; i < c.count; i++) {
        if (hairlineDensity(table, c.a[i]!, c.e[i]!) > 0) {
          expect(c.e[i]!).toBeGreaterThan(hairlineAt(table, c.a[i]!) - 0.04 - 0.05)
        }
      }
    }
  })
})

describe('the radius map', () => {
  test('matches rays cast through the head itself within half a millimetre', async () => {
    const fixture = await loadHairHead('Male_Adult_01')
    const head = headData(
      fixture.input,
      { head: { ...fixture.flat, normals: new Float32Array() } },
      library,
    )
    const frame = headFrame(head)
    const map = frame.radiusMap({ version: 0, head: fixture.flat.points, body: null })
    const [ox, oy, oz] = frame.origin
    const { cranium } = headFits(fixture.input, library)
    const bald = { points: fitBald(library.skull, cranium).points, index: library.skull.triangles }
    const random = mulberry32(5)
    const cast = (
      surface: { points: ArrayLike<number>; index: ArrayLike<number> },
      d: number[],
    ) => {
      let far = 0
      for (let t = 0; t < surface.index.length; t += 3) {
        const hit = rayTriangle(
          surface.points,
          surface.index[t]!,
          surface.index[t + 1]!,
          surface.index[t + 2]!,
          ox,
          oy,
          oz,
          d[0]!,
          d[1]!,
          d[2]!,
        )
        if (hit > far) far = hit
      }
      return far
    }
    let checked = 0
    while (checked < 500) {
      // Over the scalp (where hair grows).
      const a = (random() * 2 - 1) * Math.PI
      const e = 0.2 + random() * 1.3
      const d = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)]
      const exact = cast(fixture.flat, d) || cast(bald, d)
      if (exact <= 0) continue
      // Where the surface steps (an ear's rim, a fold), bilinear reading can't follow: skip those.
      const step = 0.03
      const around = [-step, 0, step].flatMap((da) =>
        [-step, 0, step].map((de) => {
          const n = [
            Math.cos(e + de) * Math.sin(a + da),
            Math.sin(e + de),
            Math.cos(e + de) * Math.cos(a + da),
          ]
          return cast(fixture.flat, n) || cast(bald, n)
        }),
      )
      if (around.some((r) => Math.abs(r - exact) > 2 * frame.mm)) continue
      // Read bilinear between texels about 2 mm apart, where the scalp slopes away most.
      expect(Math.abs(radiusAt(map, d[0]!, d[1]!, d[2]!) - exact) / frame.mm).toBeLessThanOrEqual(
        0.5,
      )
      checked++
    }
  }, 120000)

  test('encodes and decodes directions both ways', () => {
    const random = mulberry32(9)
    const at = [0, 0]
    const back = [0, 0, 0]
    for (let i = 0; i < 1000; i++) {
      const d = [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1]
      const l = Math.hypot(...d)
      octEncode(d[0]!, d[1]!, d[2]!, at)
      octDecode(at[0]!, at[1]!, back)
      for (let k = 0; k < 3; k++) expect(back[k]!).toBeCloseTo(d[k]! / l, 5)
    }
  })
})

describe('the eyes', () => {
  test('push a point out of them', async () => {
    const fixture = await loadHairHead('Female_Adult_01')
    const head = headData(
      fixture.input,
      { head: { ...fixture.flat, normals: new Float32Array() } },
      library,
    )
    const { keepOut } = headFrame(head)
    const [eye] = fixture.input.marks.eyes as number[][]
    const p = Float32Array.from([eye![0]!, eye![1]! + 0.005, eye![2]! + 0.005])
    expect(inEyes(keepOut, p[0]!, p[1]!, p[2]!)).toBe(true)
    expect(outOfEyes(keepOut, p, 0)).toBe(true)
    expect(inEyes(keepOut, p[0]!, p[1]!, p[2]!)).toBe(false)
  })
})
