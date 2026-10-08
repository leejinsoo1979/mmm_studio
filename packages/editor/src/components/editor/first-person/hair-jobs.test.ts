import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { DEFAULT_CUT_PARAMS, type GrowCut, type HairCutStyle } from './hair-cut'
import { type HairHead, loadHairHead } from './hair-fixtures'
import type { HairReply, HairRequest } from './hair-grow'
import { HairJobs } from './hair-jobs'
import { type HairLibrary, loadHairLibrary } from './hair-styles'

const ROCKETBOX = join(import.meta.dir, '../../../../../../apps/editor/public/characters/rocketbox')

let library: HairLibrary
let female: HairHead
let male: HairHead

beforeAll(async () => {
  const real = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(Bun.file(join(ROCKETBOX, 'hair-styles.json')))) as unknown as typeof fetch
  try {
    library = await loadHairLibrary()
  } finally {
    globalThis.fetch = real
  }
  female = await loadHairHead('Female_Adult_01')
  male = await loadHairHead('Male_Adult_01')
})

/** A worker's jobs with its replies kept, its ticks counted (each a turn of the event loop). */
function worker(kept?: number) {
  const replies: { reply: HairReply; transfer: Transferable[] }[] = []
  let ticks = 0
  const onTick: (() => void)[] = []
  const jobs = new HairJobs(
    {
      library: async () => library,
      post: (reply, transfer) => replies.push({ reply, transfer }),
      tick: async () => {
        ticks++
        await new Promise((resolve) => setTimeout(resolve, 0))
        for (const run of onTick.splice(0)) run()
      },
    },
    kept,
  )
  const settle = async (until: () => boolean) => {
    for (let i = 0; i < 2000 && !until(); i++)
      await new Promise((resolve) => setTimeout(resolve, 1))
  }
  return { jobs, replies, settle, ticks: () => ticks, onTick }
}

const cutOf = (style: HairCutStyle, length = 0): GrowCut => ({
  style,
  ...DEFAULT_CUT_PARAMS[style],
  length,
})

/** A fresh copy of a head's base input (the jobs hand its arrays on). */
const baseOf = (head: HairHead): HairRequest => ({
  kind: 'base',
  avatar: head.input.avatar,
  input: structuredClone(head.input),
})

const growOf = (head: HairHead, slot: string, cut: GrowCut, version = 0): HairRequest => ({
  kind: 'grow',
  slot,
  avatar: head.input.avatar,
  cut,
  tier: 'game',
  shape: { version, head: head.flat.points, body: null },
  priority: 0,
})

describe('a hair worker', () => {
  test('answers a grow for a head it has no base for with missing', async () => {
    const { jobs, replies, settle } = worker()
    jobs.handle(growOf(male, 'a', cutOf('twoBlock')))
    await settle(() => replies.length > 0)
    expect(replies.map((r) => r.reply.kind)).toEqual(['missing'])
    expect(replies[0]!.reply).toEqual({ kind: 'missing', avatar: 'Male_Adult_01' })
  })

  test('builds a base, then grows on it, handing the arrays on', async () => {
    const { jobs, replies, settle } = worker()
    jobs.handle(baseOf(male))
    await settle(() => replies.length > 0)
    expect(replies[0]!.reply.kind).toBe('base')
    expect(replies[0]!.transfer.length).toBeGreaterThan(5)
    jobs.handle(growOf(male, 'a', cutOf('twoBlock')))
    await settle(() => replies.length > 1)
    const grown = replies[1]!
    expect(grown.reply.kind).toBe('grow')
    if (grown.reply.kind !== 'grow') return
    expect(grown.reply.slot).toBe('a')
    expect(grown.reply.key).toBe('Male_Adult_01|twoBlock|0|0|0|20|60|game|0')
    expect(grown.reply.build.tier).toBe('game')
    // Every array of the build is handed on, each buffer once.
    const buffers = new Set(grown.transfer)
    expect(buffers.size).toBe(grown.transfer.length)
    expect(buffers.has(grown.reply.build.geometries.inner.position.buffer)).toBe(true)
    expect(buffers.has(grown.reply.build.roots.grown.buffer)).toBe(true)
  }, 30000)

  test('grows only the latest of a slot’s requests', async () => {
    const { jobs, replies, settle } = worker()
    jobs.handle(baseOf(female))
    await settle(() => replies.length > 0)
    jobs.handle(growOf(female, 'a', cutOf('bob', 0.5)))
    jobs.handle(growOf(female, 'a', cutOf('bob', -0.5)))
    await settle(() => replies.length > 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const grows = replies.filter((r) => r.reply.kind === 'grow')
    expect(grows.length).toBe(1)
    expect(grows[0]!.reply.kind === 'grow' && grows[0]!.reply.key).toContain('|-50|')
  }, 30000)

  test('stops a grow under way when its slot asks again', async () => {
    const { jobs, replies, settle, onTick } = worker()
    jobs.handle(baseOf(female))
    await settle(() => replies.length > 0)
    jobs.handle(growOf(female, 'a', cutOf('bob', 0.5)))
    // At the first stage it gives way, a newer request for the slot arrives.
    onTick.push(() => jobs.handle(growOf(female, 'a', cutOf('bob', 1), 1)))
    await settle(() => replies.some((r) => r.reply.kind === 'grow'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    const grows = replies.filter((r) => r.reply.kind === 'grow')
    expect(grows.length).toBe(1)
    expect(grows[0]!.reply.kind === 'grow' && grows[0]!.reply.key).toBe(
      'Female_Adult_01|bob|100|0|0|0|50|game|1',
    )
  }, 30000)

  test('drops a slot’s grow on cancel, and keeps other slots’', async () => {
    const { jobs, replies, settle } = worker()
    jobs.handle(baseOf(male))
    await settle(() => replies.length > 0)
    jobs.handle(growOf(male, 'a', cutOf('twoBlock')))
    jobs.handle(growOf(male, 'b', cutOf('twoBlock', 0.3)))
    jobs.handle({ kind: 'cancel', slot: 'a' })
    await settle(() => replies.length > 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const grows = replies.filter((r) => r.reply.kind === 'grow')
    expect(grows.map((r) => r.reply.kind === 'grow' && r.reply.slot)).toEqual(['b'])
  }, 30000)

  test('lets the least recently used head go, and asks for it again', async () => {
    const { jobs, replies, settle } = worker(1)
    jobs.handle(baseOf(male))
    await settle(() => replies.length > 0)
    jobs.handle(baseOf(female))
    await settle(() => replies.length > 1)
    jobs.handle(growOf(male, 'a', cutOf('twoBlock')))
    await settle(() => replies.length > 2)
    expect(replies[2]!.reply).toEqual({ kind: 'missing', avatar: 'Male_Adult_01' })
  }, 30000)

  test('answers a style it cannot grow yet with an error for that slot', async () => {
    const { jobs, replies, settle } = worker()
    jobs.handle(baseOf(male))
    await settle(() => replies.length > 0)
    jobs.handle(growOf(male, 'a', cutOf('ponytail')))
    await settle(() => replies.length > 1)
    expect(replies[1]!.reply.kind).toBe('error')
    expect(replies[1]!.reply.kind === 'error' && replies[1]!.reply.slot).toBe('a')
  }, 30000)
})
