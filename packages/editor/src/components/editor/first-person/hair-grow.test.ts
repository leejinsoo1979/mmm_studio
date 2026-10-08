import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { headFits } from './hair-base'
import { DEFAULT_CUT_PARAMS, type HairCut, type HairCutStyle } from './hair-cut'
import { HAIR_HEADS, type HairHead, loadHairHead } from './hair-fixtures'
import { type Groom, groomOf, regional, STYLES } from './hair-groom'
import {
  type Grown,
  growHair,
  growSeed,
  growStrips,
  type HairBuild,
  type HeadData,
  headData,
  headFrame,
  type RibbonArrays,
  rootLength,
  type ShapeInput,
  type Tier,
} from './hair-grow'
import { LAYER, RIBBON_ITEM_SIZES } from './hair-ribbons'
import { angles, inEyes, radiusAt, rayTriangle } from './hair-scalp'
import { type HairLibrary, loadHairLibrary } from './hair-styles'
import { fitBald } from './head-skull'

const ROCKETBOX = join(import.meta.dir, '../../../../../../apps/editor/public/characters/rocketbox')

async function hairLibrary(): Promise<HairLibrary> {
  const real = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(Bun.file(join(ROCKETBOX, 'hair-styles.json')))) as unknown as typeof fetch
  try {
    return await loadHairLibrary()
  } finally {
    globalThis.fetch = real
  }
}

/** The slice's styles. */
const SLICE = ['bob', 'twoBlock'] as const satisfies readonly HairCutStyle[]

const cutOf = (style: HairCutStyle, sliders: Partial<HairCut> = {}): HairCut => ({
  style,
  ...DEFAULT_CUT_PARAMS[style],
  tip: null,
  shine: 0.5,
  ...sliders,
})

type Grows = { fixture: HairHead; head: HeadData; shape: ShapeInput }

let library: HairLibrary
const heads = new Map<string, Grows>()
const builds = new Map<string, HairBuild>()
const strips = new Map<string, Grown>()

/** A grow of a cut on a frozen head (the frozen flattened head as its shape), kept for the tests after. */
async function build(id: string, cut: HairCut, tier: Tier): Promise<HairBuild> {
  const key = `${id}|${JSON.stringify(cut)}|${tier}`
  let found = builds.get(key)
  if (!found) {
    const { fixture, head, shape } = heads.get(id)!
    found = (await growHair(head, groomOf(cut, fixture.who), tier, shape, growSeed(id, cut.style)))!
    builds.set(key, found)
  }
  return found
}

function grown(id: string, cut: HairCut, tier: Tier): Grown {
  const key = `${id}|${JSON.stringify(cut)}|${tier}`
  let found = strips.get(key)
  if (!found) {
    const { fixture, head, shape } = heads.get(id)!
    found = growStrips(head, groomOf(cut, fixture.who), tier, shape, growSeed(id, cut.style))
    strips.set(key, found)
  }
  return found
}

const groomFor = (id: string, cut: HairCut): Groom => groomOf(cut, heads.get(id)!.fixture.who)

beforeAll(async () => {
  library = await hairLibrary()
  for (const id of HAIR_HEADS) {
    const fixture = await loadHairHead(id)
    const head = headData(
      fixture.input,
      { head: { ...fixture.flat, normals: new Float32Array() } },
      library,
    )
    heads.set(id, { fixture, head, shape: { version: 0, head: fixture.flat.points, body: null } })
  }
})

/** Each strip's points (flat) out of a geometry's ribbons: every second vertex, a new strip where u is 0. */
function ribbonStrips(geometry: RibbonArrays) {
  const out: { points: number[]; strand: number; layer: number }[] = []
  const vertices = geometry.position.length / 3
  for (let v = 0; v < vertices; v += 2) {
    if (geometry.hairData[v * 4] === 0) {
      out.push({
        points: [],
        strand: geometry.hairData[v * 4 + 3]!,
        layer: Math.floor(geometry.hairShape[v * 4 + 2]! / 16),
      })
    }
    out[out.length - 1]!.points.push(...geometry.position.subarray(v * 3, v * 3 + 3))
  }
  return out
}

const allStrips = (b: HairBuild) =>
  [b.geometries.inner, b.geometries.outer, b.geometries.strays]
    .filter((g): g is RibbonArrays => !!g)
    .flatMap(ribbonStrips)

describe.each([...HAIR_HEADS])('%s', (id) => {
  describe.each([...SLICE])('%s', (style) => {
    test('roots stand on the flattened head', async () => {
      const b = await build(id, cutOf(style), 'studio')
      const { fixture, head } = heads.get(id)!
      const frame = headFrame(head)
      const { tri, bary, grown: at } = b.roots
      const { points, index } = fixture.flat
      // Each root on its own triangle of the head as grown (sunk a little into it).
      for (let r = 0; r < tri.length; r++) {
        const [u, v] = [bary[r * 2]!, bary[r * 2 + 1]!]
        const corners = [0, 1, 2].map((k) => index[tri[r]! * 3 + k]!)
        const surface = [0, 1, 2].map(
          (axis) =>
            points[corners[0]! * 3 + axis]! * (1 - u - v) +
            points[corners[1]! * 3 + axis]! * u +
            points[corners[2]! * 3 + axis]! * v,
        )
        const off = Math.hypot(...surface.map((value, axis) => value - at[r * 3 + axis]!))
        expect(off / frame.mm).toBeLessThanOrEqual(1)
      }
      // And every strip starts at its strand's root.
      for (const strip of allStrips(b)) {
        const r = strip.strand
        const off = Math.hypot(...[0, 1, 2].map((axis) => strip.points[axis]! - at[r * 3 + axis]!))
        expect(off / frame.mm).toBeLessThan(1e-3)
      }
    }, 30000)

    test('no strand point or segment middle is more than 1 mm inside the head', async () => {
      const b = await build(id, cutOf(style), 'studio')
      const { fixture, head, shape } = heads.get(id)!
      const frame = headFrame(head)
      const map = frame.radiusMap(shape)
      const [ox, oy, oz] = frame.origin
      const { cranium } = headFits(fixture.input, library)
      const bald = {
        points: fitBald(library.skull, cranium).points,
        index: library.skull.triangles,
      }
      const surfaces = [{ points: fixture.flat.points, index: fixture.flat.index }, bald]
      let worst = 0
      let worstExact = 0
      let sampled = 0
      let n = 0
      const inside = (x: number, y: number, z: number, exact: boolean) => {
        const dx = x - ox
        const dy = y - oy
        const dz = z - oz
        const r = Math.hypot(dx, dy, dz)
        const R = radiusAt(map, dx / r, dy / r, dz / r)
        if (R > 0) worst = Math.max(worst, R - r)
        if (!exact) return
        // A brute-force cast: the head's outermost hit, the skull's where the head has none.
        let far = 0
        for (const { points, index } of surfaces) {
          if (far > 0) break
          for (let t = 0; t < index.length; t += 3) {
            const d = rayTriangle(
              points,
              index[t]!,
              index[t + 1]!,
              index[t + 2]!,
              ox,
              oy,
              oz,
              dx / r,
              dy / r,
              dz / r,
            )
            if (d > far) far = d
          }
        }
        if (far > 0) worstExact = Math.max(worstExact, far - r)
        sampled++
      }
      // Roots sink into the head by design (checked on their own above): from the next point on.
      for (const strip of allStrips(b)) {
        const p = strip.points
        for (let k = 1; k < p.length / 3; k++) {
          inside(p[k * 3]!, p[k * 3 + 1]!, p[k * 3 + 2]!, n++ % 50 === 0)
          if (k > 1) {
            inside(
              (p[k * 3]! + p[k * 3 - 3]!) / 2,
              (p[k * 3 + 1]! + p[k * 3 - 2]!) / 2,
              (p[k * 3 + 2]! + p[k * 3 - 1]!) / 2,
              false,
            )
          }
        }
      }
      expect(sampled).toBeGreaterThan(50)
      expect(worst / frame.mm).toBeLessThanOrEqual(1)
      expect(worstExact / frame.mm).toBeLessThanOrEqual(1)
    }, 60000)

    test('keeps out of the eyes, and its roots off the ears', async () => {
      const b = await build(id, cutOf(style, { fringe: 1 }), 'studio')
      const { fixture, head } = heads.get(id)!
      const frame = headFrame(head)
      for (const strip of allStrips(b)) {
        const p = strip.points
        for (let k = 0; k < p.length / 3; k++) {
          expect(inEyes(frame.keepOut, p[k * 3]!, p[k * 3 + 1]!, p[k * 3 + 2]! - 1e-6)).toBe(false)
        }
      }
      const ears = fixture.input.ears!
      const earPoints: number[][] = []
      for (let i = 0; i < ears.length; i++) {
        if (ears[i]) earPoints.push([...fixture.input.head.points.subarray(i * 3, i * 3 + 3)])
      }
      expect(earPoints.length).toBeGreaterThan(10)
      const { grown: roots } = b.roots
      for (let r = 0; r < roots.length / 3; r++) {
        const near = Math.min(
          ...earPoints.map((q) =>
            Math.hypot(q[0]! - roots[r * 3]!, q[1]! - roots[r * 3 + 1]!, q[2]! - roots[r * 3 + 2]!),
          ),
        )
        expect(near / frame.mm).toBeGreaterThan(4)
      }
    }, 30000)

    test('uncut strips are as long as the length field says', () => {
      const cut = cutOf(style, { length: 0.5 })
      const g = grown(id, cut, 'studio')
      const plain = groomFor(id, cutOf(style, { length: 0 }))
      const frame = headFrame(heads.get(id)!.head)
      const scale = 2 ** (0.9 * 0.5)
      let checked = 0
      for (let i = 0; i < g.strips.count; i++) {
        if (g.info.cut[i] !== 0) continue
        const first = g.strips.start[i]!
        const last = g.strips.start[i + 1]! - 1
        const arc = g.strips.s[last]! - g.strips.s[first]!
        const field =
          rootLength(plain, g.info.a[i]!, g.info.e[i]!, g.info.group[i]!, frame.cm * frame.hs) *
          scale
        expect(Math.abs(arc - field) / field).toBeLessThanOrEqual(0.03)
        checked++
      }
      // 단발 cuts nearly all of its strips; 투블럭's top is left long.
      if (style === 'twoBlock') expect(checked).toBeGreaterThan(100)
    }, 30000)

    test('cut strips end at their cut, lock by lock', () => {
      const g = grown(id, cutOf(style), 'studio')
      const groom = groomFor(id, cutOf(style))
      const frame = headFrame(heads.get(id)!.head)
      const segment = 1.2 * frame.cm * frame.hs
      const byLock = new Map<number, number[]>()
      for (let i = 0; i < g.strips.count; i++) {
        if (g.info.cut[i] !== 1) continue
        const last = g.strips.start[i + 1]! - 1
        const endY = g.strips.points[last * 3 + 1]!
        // The end within a segment of its level, over which 단발's ends turn under.
        expect(Math.abs(endY - g.info.level[i]!)).toBeLessThanOrEqual(
          segment + groom.endCurl * 0.6 * frame.cm,
        )
        const list = byLock.get(g.info.lock[i]!) ?? []
        list.push(g.info.level[i]!)
        byLock.set(g.info.lock[i]!, list)
      }
      expect(byLock.size).toBeGreaterThan(20)
      let lockMeans: number[] = []
      for (const levels of byLock.values()) {
        expect((Math.max(...levels) - Math.min(...levels)) / frame.mm).toBeLessThanOrEqual(2.01)
        lockMeans.push(levels.reduce((a, b) => a + b, 0) / levels.length)
      }
      // Across locks the ends stray by the style's jitter: not a straight comb, not beyond it.
      const fringe = g.info.group
      void fringe
      lockMeans = lockMeans.filter(Number.isFinite)
      const jitter = groom.ends.jitter * frame.cm * frame.hs
      const spread = Math.max(...lockMeans) - Math.min(...lockMeans)
      expect(spread).toBeGreaterThan(0)
      if (style === 'bob') {
        // Front, sides and back cut at their own depths: within one region the locks stray by the jitter.
        const front = [...byLock.entries()]
          .filter(([lock]) => {
            const i = Array.from(g.info.lock).indexOf(lock)
            return Math.abs(g.info.a[i]!) < 0.3 && g.info.group[i] !== 2
          })
          .map(([, levels]) => levels[0]!)
        if (front.length > 3) {
          const frontSpread = Math.max(...front) - Math.min(...front)
          expect(frontSpread).toBeGreaterThan(0.2 * jitter)
          expect(frontSpread).toBeLessThanOrEqual(2 * jitter + 2 * frame.mm)
        }
      }
    }, 30000)

    test('fits every tier cap at the sliders’ ends', () => {
      const def = STYLES[style]
      for (const length of [-1, 1]) {
        for (const volume of [-1, 1]) {
          for (const curl of [0, 1]) {
            for (const tier of ['studio', 'game'] as const) {
              const g = grown(id, cutOf(style, { length, volume, curl }), tier)
              let triangles = 0
              for (let i = 0; i < g.strips.count; i++)
                triangles += 2 * (g.strips.start[i + 1]! - g.strips.start[i]! - 1)
              expect(triangles).toBeLessThanOrEqual(def.caps[tier])
              expect(g.strips.count).toBeGreaterThan(200)
            }
          }
        }
      }
    }, 120000)

    test('changing length, volume or curl leaves the roots byte for byte', async () => {
      const plain = await build(id, cutOf(style), 'game')
      for (const sliders of [{ length: 0.7 }, { volume: -0.6 }, { curl: 0.8 }]) {
        const other = await build(id, cutOf(style, sliders), 'game')
        expect(
          Buffer.from(other.roots.grown.buffer).equals(Buffer.from(plain.roots.grown.buffer)),
        ).toBe(true)
        expect(other.roots.tri).toEqual(plain.roots.tri)
      }
    }, 60000)

    test('is the same for the same seed', async () => {
      const { fixture, head, shape } = heads.get(id)!
      const groom = groomOf(cutOf(style), fixture.who)
      const a = (await growHair(head, groom, 'game', shape, 7))!
      const b = (await growHair(head, groom, 'game', shape, 7))!
      const c = (await growHair(head, groom, 'game', shape, 8))!
      for (const key of Object.keys(RIBBON_ITEM_SIZES) as (keyof typeof RIBBON_ITEM_SIZES)[]) {
        const x = a.geometries.inner[key]
        const y = b.geometries.inner[key]
        expect(
          Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(
            Buffer.from(y.buffer, y.byteOffset, y.byteLength),
          ),
        ).toBe(true)
      }
      expect(
        Buffer.from(a.geometries.outer.index.buffer).equals(
          Buffer.from(b.geometries.outer.index.buffer),
        ),
      ).toBe(true)
      expect(
        Buffer.from(a.geometries.inner.position.buffer).equals(
          Buffer.from(c.geometries.inner.position.buffer),
        ),
      ).toBe(false)
    }, 30000)

    test('skins to the head: two bones at most, no face bone', async () => {
      const b = await build(id, cutOf(style), 'studio')
      const { boneIndex } = heads.get(id)!.fixture.input
      const allowed = new Set([boneIndex.head, boneIndex.neck, boneIndex.spine2])
      for (const geometry of [b.geometries.inner, b.geometries.outer, b.geometries.strays!]) {
        const { skinIndex, skinWeight } = geometry
        for (let v = 0; v < skinWeight.length / 4; v++) {
          let sum = 0
          let bones = 0
          for (let j = 0; j < 4; j++) {
            const w = skinWeight[v * 4 + j]!
            sum += w
            if (w > 0) {
              bones++
              expect(allowed.has(skinIndex[v * 4 + j]!)).toBe(true)
            }
          }
          expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-5)
          expect(bones).toBeLessThanOrEqual(2)
          // 투블럭 has nothing rooted low: the head alone.
          if (style === 'twoBlock') {
            expect(skinIndex[v * 4]).toBe(boneIndex.head)
            expect(skinWeight[v * 4]).toBe(1)
          }
        }
      }
    }, 30000)

    test('curls have six points or more to a turn', () => {
      const g = grown(id, cutOf(style, { curl: 1 }), 'studio')
      const p = g.strips.points
      let worst = 0
      for (let i = 0; i < g.strips.count; i++) {
        for (let k = g.strips.start[i]! + 1; k < g.strips.start[i + 1]! - 1; k++) {
          const a = [0, 1, 2].map((axis) => p[k * 3 + axis]! - p[k * 3 - 3 + axis]!)
          const b = [0, 1, 2].map((axis) => p[k * 3 + 3 + axis]! - p[k * 3 + axis]!)
          const cos =
            (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) /
            (Math.hypot(...a) * Math.hypot(...b) || 1)
          worst = Math.max(worst, Math.acos(Math.min(1, Math.max(-1, cos))))
        }
      }
      expect(worst).toBeLessThanOrEqual(Math.PI / 3)
    }, 30000)

    test('stands the outer layer off the head by its regional volume', () => {
      const g = grown(id, cutOf(style), 'studio')
      const groom = groomFor(id, cutOf(style))
      const { head, shape } = heads.get(id)!
      const frame = headFrame(head)
      const map = frame.radiusMap(shape)
      const [ox, oy, oz] = frame.origin
      const cmHs = frame.cm * frame.hs
      const shares = { crown: 0, top: 0, sides: 0, back: 0, nape: 0 }
      const regions = new Map<string, { got: number; want: number; n: number }>()
      for (let i = 0; i < g.strips.count; i++) {
        if (g.info.layer[i] !== LAYER.outer || g.info.group[i] === 2) continue
        for (let k = g.strips.start[i]!; k < g.strips.start[i + 1]!; k++) {
          // Past the clearance's ramp, still over the head (above its widest line).
          if (g.strips.s[k]! < 3.5 * cmHs) continue
          const [x, y, z] = [
            g.strips.points[k * 3]!,
            g.strips.points[k * 3 + 1]!,
            g.strips.points[k * 3 + 2]!,
          ]
          const [a, e] = angles(x - ox, y - oy, z - oz)
          if (e < 0.1) continue
          const r = Math.hypot(x - ox, y - oy, z - oz)
          const R = radiusAt(map, (x - ox) / r, (y - oy) / r, (z - oz) / r)
          if (R <= 0) continue
          const region = e > 0.85 ? 'top' : Math.abs(a) < 2.2 ? 'sides' : 'back'
          const entry = regions.get(region) ?? { got: 0, want: 0, n: 0 }
          entry.got += r - R
          entry.want += regional(groom.volume, a, e, shares) * cmHs + 0.15 * frame.cm
          entry.n++
          regions.set(region, entry)
        }
      }
      expect(regions.size).toBeGreaterThan(1)
      for (const [region, { got, want, n }] of regions) {
        if (n < 50) continue
        expect({ region, ratio: got / want }).toEqual({ region, ratio: expect.any(Number) })
        expect(got / want).toBeGreaterThan(0.75)
        expect(got / want).toBeLessThan(1.25)
      }
    }, 30000)
  })
})

describe('the vertex layout', () => {
  test('is one for every style, tier and geometry', async () => {
    const layouts = new Set<string>()
    for (const style of SLICE) {
      for (const tier of ['studio', 'game'] as const) {
        const b = await build('Male_Adult_01', cutOf(style), tier)
        for (const geometry of Object.values(b.geometries)) {
          const vertices = geometry.position.length / 3
          const layout = Object.entries(geometry)
            .map(([name, array]) => {
              const size =
                name === 'index' ? 1 : RIBBON_ITEM_SIZES[name as keyof typeof RIBBON_ITEM_SIZES]
              if (name !== 'index') expect(array.length).toBe(vertices * size)
              return `${name}:${array.constructor.name}:${size}`
            })
            .sort()
            .join(',')
          layouts.add(layout)
          expect(geometry.index.length % 3).toBe(0)
          expect(Math.max(...geometry.index)).toBeLessThan(vertices)
        }
      }
    }
    expect(layouts.size).toBe(1)
  }, 60000)

  test('draws the game tier as its own smaller build', async () => {
    const studio = await build('Female_Adult_01', cutOf('bob'), 'studio')
    const game = await build('Female_Adult_01', cutOf('bob'), 'game')
    expect(game.stats.triangles).toBeLessThan(studio.stats.triangles / 2)
    expect(studio.geometries.strays).toBeDefined()
    expect(studio.geometries.soft).toBeDefined()
    expect(game.geometries.strays).toBeUndefined()
    expect(studio.strips.inner + studio.strips.outer).toBeGreaterThan(
      game.strips.inner + game.strips.outer,
    )
  }, 30000)
})
