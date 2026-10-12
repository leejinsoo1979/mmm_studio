import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { type BaseResult, flattenHead } from './hair-base'
import { DEFAULT_CUT_PARAMS, type GrowCut, type HairCut, type HairCutStyle } from './hair-cut'
import { loadHairLibrary } from './hair-styles'
import { loadHairHead } from './hair-test-utils'
import {
  followRoots,
  GrowPlan,
  growCut,
  pointsHash,
  SETTLE_MS,
  shapedFlat,
  strandOffsets,
  wornLook,
} from './hair-wear'

const cutOf = (style: HairCutStyle, length = 0): GrowCut => ({
  style,
  ...DEFAULT_CUT_PARAMS[style],
  length,
})

describe('GrowPlan in the studio', () => {
  test('grows a newly picked style at the studio tier at once, and is settled once it is on', () => {
    const plan = new GrowPlan('studio', 3)
    expect(plan.settled).toBe(true)
    const ask = plan.want(cutOf('bob'), 0)!
    expect(ask).toMatchObject({ tier: 'studio', version: 3, cut: cutOf('bob') })
    expect(plan.settled).toBe(false)
    plan.built(ask.key)
    expect(plan.settled).toBe(true)
    expect(plan.dueAt).toBeNull()
  })

  test('previews a slider drag at the game tier, then grows the studio tier once the drag settles', () => {
    const plan = new GrowPlan('studio', 0)
    plan.built(plan.want(cutOf('bob'), 0)!.key)
    const first = plan.want(cutOf('bob', 0.2), 1000)!
    expect(first.tier).toBe('game')
    const second = plan.want(cutOf('bob', 0.4), 1050)!
    expect(second.tier).toBe('game')
    plan.built(second.key)
    expect(plan.settled).toBe(false)
    expect(plan.due(1050 + SETTLE_MS - 1)).toBeNull()
    expect(plan.dueAt).toBe(1050 + SETTLE_MS)
    const final = plan.due(1050 + SETTLE_MS)!
    expect(final).toMatchObject({ tier: 'studio', cut: cutOf('bob', 0.4) })
    expect(plan.due(5000)).toBeNull()
    plan.built(final.key)
    expect(plan.settled).toBe(true)
  })

  test('a new style mid-drag goes straight to the studio tier', () => {
    const plan = new GrowPlan('studio', 0)
    plan.built(plan.want(cutOf('bob'), 0)!.key)
    plan.want(cutOf('bob', 0.3), 10)
    const picked = plan.want(cutOf('twoBlock'), 20)!
    expect(picked.tier).toBe('studio')
    expect(plan.dueAt).toBeNull()
  })

  test('the same cut again asks for nothing', () => {
    const plan = new GrowPlan('studio', 0)
    plan.built(plan.want(cutOf('bob'), 0)!.key)
    expect(plan.want(cutOf('bob'), 10)).toBeNull()
    expect(plan.settled).toBe(true)
  })

  test('a face drag grows nothing until it settles, then grows against the newest shape', () => {
    const plan = new GrowPlan('studio', 0)
    plan.built(plan.want(cutOf('bob'), 0)!.key)
    plan.shaped(1, 100)
    plan.shaped(2, 150)
    expect(plan.due(150)).toBeNull()
    expect(plan.settled).toBe(false)
    const regrow = plan.due(150 + SETTLE_MS)!
    expect(regrow).toMatchObject({ tier: 'studio', version: 2 })
    plan.built(regrow.key)
    expect(plan.settled).toBe(true)
  })

  test('a shape that lands while a grow is under way regrows once that settles', () => {
    const plan = new GrowPlan('studio', 0)
    const first = plan.want(cutOf('twoBlock'), 0)!
    plan.shaped(1, 10)
    plan.built(first.key)
    expect(plan.settled).toBe(false)
    expect(plan.due(10 + SETTLE_MS)).toMatchObject({ version: 1, tier: 'studio' })
  })

  test("a failed grow leaves nothing waiting, and an old grow's answer changes nothing", () => {
    const plan = new GrowPlan('studio', 0)
    const first = plan.want(cutOf('bob'), 0)!
    const second = plan.want(cutOf('twoBlock'), 5)!
    plan.built(first.key)
    expect(plan.settled).toBe(false)
    plan.failed(second.key)
    expect(plan.settled).toBe(false)
    expect(plan.want(cutOf('twoBlock'), 10)).toBeNull()
  })

  test('own hair is always settled, and forgets the cut', () => {
    const plan = new GrowPlan('studio', 0)
    plan.want(cutOf('bob'), 0)
    expect(plan.want(null, 5)).toBeNull()
    expect(plan.settled).toBe(true)
    expect(plan.want(cutOf('bob'), 10)!.tier).toBe('studio')
  })
})

describe('GrowPlan answers', () => {
  test('puts on an older preview that comes in while a newer one is still growing', () => {
    const plan = new GrowPlan('studio', 0)
    plan.built(plan.want(cutOf('bob'), 0)!.key)
    const first = plan.want(cutOf('bob', 0.2), 10)!
    const second = plan.want(cutOf('bob', 0.4), 20)!
    expect(plan.latest(second)).toBe(true)
    expect(plan.latest(first)).toBe(false)
    expect(plan.built(first.key)).toBe(true)
    expect(plan.pending).toBe(true)
    expect(plan.built(second.key)).toBe(true)
  })

  test('never puts on an answer older than the hair on, or for a style no longer worn', () => {
    const plan = new GrowPlan('studio', 0)
    const bob = plan.want(cutOf('bob'), 0)!
    const twoBlock = plan.want(cutOf('twoBlock'), 5)!
    expect(plan.built(bob.key)).toBe(false)
    expect(plan.built(twoBlock.key)).toBe(true)
    expect(plan.built(bob.key)).toBe(false)
    expect(plan.settled).toBe(true)
  })

  test('is pending while a grow is out or one is due, and not after', () => {
    const plan = new GrowPlan('studio', 0)
    expect(plan.pending).toBe(false)
    const ask = plan.want(cutOf('bob'), 0)!
    expect(plan.pending).toBe(true)
    plan.built(ask.key)
    expect(plan.pending).toBe(false)
    plan.shaped(1, 100)
    expect(plan.pending).toBe(true)
    plan.built(plan.due(100 + SETTLE_MS)!.key)
    expect(plan.pending).toBe(false)
  })

  test('asks for the final tier again after a failure', () => {
    const plan = new GrowPlan('studio', 0)
    const ask = plan.want(cutOf('twoBlock'), 0)!
    plan.failed(ask.key)
    expect(plan.pending).toBe(false)
    const again = plan.retry()!
    expect(again).toMatchObject({ tier: 'studio', key: ask.key })
    expect(plan.built(again.key)).toBe(true)
    expect(plan.settled).toBe(true)
    expect(new GrowPlan('studio', 0).retry()).toBeNull()
  })
})

describe('growCut and wornLook', () => {
  const cut: HairCut = {
    style: 'bob',
    ...DEFAULT_CUT_PARAMS.bob,
    length: 0.3,
    tip: '#e0c080',
    shine: 0.7,
  }

  test('grows from the style and sliders alone', () => {
    expect(growCut(cut)).toEqual({
      style: 'bob',
      ...DEFAULT_CUT_PARAMS.bob,
      length: 0.3,
    })
  })

  test("takes the look's dye and skin, or the avatar's own", () => {
    const own = { hair: '#2a1d16', skin: '#c8987a' }
    expect(wornLook(cut, { hair: null, skin: null }, own)).toEqual({
      base: '#2a1d16',
      tip: '#e0c080',
      shine: 0.7,
      skin: '#c8987a',
    })
    expect(wornLook(cut, { hair: '#aa3322', skin: '#805040' }, own)).toMatchObject({
      base: '#aa3322',
      skin: '#805040',
    })
  })
})

describe('shapedFlat and pointsHash', () => {
  test("carries the head's moves onto the flattened head, point by point", () => {
    const flat = Float32Array.of(0, 1, 0, 1, 1, 0)
    const loaded = Float32Array.of(0, 1.02, 0, 1, 1, 0)
    const shown = Float32Array.of(0.01, 1.02, 0, 1, 1, 0.5)
    const out = shapedFlat(flat, loaded, shown)
    expect([...out].map((v) => Number(v.toFixed(5)))).toEqual([0.01, 1, 0, 1, 1, 0.5])
    expect(shapedFlat(flat, loaded, loaded)).toEqual(flat)
  })

  test('is the flattened head itself where the counts differ', () => {
    const flat = Float32Array.of(0, 1, 0)
    expect(shapedFlat(flat, new Float32Array(6), new Float32Array(6))).toEqual(flat)
  })

  test('tells points apart bit for bit', () => {
    const a = Float32Array.of(0, 1, 2)
    expect(pointsHash(a)).toBe(pointsHash(Float32Array.from(a)))
    expect(pointsHash(a)).not.toBe(pointsHash(Float32Array.of(0, 1, 2.0001)))
  })
})

describe('GrowPlan in the game', () => {
  test('grows every change at the game tier, a crowd at the far one', () => {
    const game = new GrowPlan('game', 0)
    game.built(game.want(cutOf('bob'), 0)!.key)
    expect(game.want(cutOf('bob', 0.5), 10)!.tier).toBe('game')
    const crowd = new GrowPlan('crowd', 0)
    expect(crowd.want(cutOf('bob'), 0)!.tier).toBe('far')
  })
})

describe('strandOffsets', () => {
  // One triangle, two strands on it.
  const index = Uint32Array.of(0, 1, 2)
  const grownOn = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0)
  const roots = { tri: Uint32Array.of(0, 0), bary: Float32Array.of(0, 0, 0.5, 0.5) }

  test('are zero on the head the hair was grown against', () => {
    const out = new Float32Array(8).fill(9)
    strandOffsets(roots, index, grownOn, grownOn, out)
    expect([...out]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  test('move each strand as its point on its triangle moved', () => {
    const now = Float32Array.from(grownOn)
    now[1]! += 0.01 // the first corner up 1 cm
    now[5]! += 0.02 // the second corner forward 2 cm
    const out = new Float32Array(8)
    strandOffsets(roots, index, grownOn, now, out)
    expect(out[1]).toBeCloseTo(0.01, 6)
    expect(out[2]).toBeCloseTo(0, 6)
    expect(out[5]).toBeCloseTo(0, 6)
    expect(out[6]).toBeCloseTo(0.01, 6)
  })

  test('write no more strands than the texture holds', () => {
    const out = new Float32Array(4)
    strandOffsets(roots, index, grownOn, grownOn, out)
    expect(out.length).toBe(4)
  })
})

describe('followRoots', () => {
  let base: BaseResult
  beforeAll(async () => {
    const real = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        Bun.file(
          join(
            import.meta.dir,
            '../../../../../../apps/editor/public/characters/rocketbox/hair-styles.json',
          ),
        ),
      )) as unknown as typeof fetch
    try {
      base = flattenHead((await loadHairHead('Male_Adult_01')).input, await loadHairLibrary())
    } finally {
      globalThis.fetch = real
    }
  })

  test('stands the root layer where the base put it, on the head as flattened', () => {
    const { srcVertex, height } = base.roots
    const position = new Float32Array(base.roots.position.length)
    const normal = new Float32Array(base.roots.normal.length)
    followRoots(srcVertex, height, base.head.points, base.head.normals, position, normal)
    let most = 0
    for (let i = 0; i < position.length; i++) {
      most = Math.max(most, Math.abs(position[i]! - base.roots.position[i]!))
    }
    expect(most).toBeLessThan(1e-6)
    expect([...normal]).toEqual([...base.roots.normal])
  })

  test('carries it with the head as it is reshaped', () => {
    const { srcVertex, height } = base.roots
    const points = Float32Array.from(base.head.points)
    for (let i = 1; i < points.length; i += 3) points[i]! += 0.002
    const position = new Float32Array(base.roots.position.length)
    const normal = new Float32Array(base.roots.normal.length)
    followRoots(srcVertex, height, points, base.head.normals, position, normal)
    expect(position[1]! - base.roots.position[1]!).toBeCloseTo(0.002, 5)
  })
})
