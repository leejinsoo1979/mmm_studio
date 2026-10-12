import { describe, expect, test } from 'bun:test'
import { createSendLedger, MAX_REFUNDS } from './ledger'
import type { AvatarStore } from './store'

/** A store holding only the ledger's record, as JSON (as the file store does). */
function memoryStore(options: { failSave?: () => boolean } = {}) {
  let saved: string | null = null
  const store = {
    loadLedger: async () => (saved === null ? null : JSON.parse(saved)),
    saveLedger: async (value: unknown) => {
      if (options.failSave?.()) throw new Error('ENOSPC')
      saved = JSON.stringify(value)
    },
  } as AvatarStore
  return store
}

const LIMITS = { userDaily: 2, globalDaily: 3 }
const DAY = 24 * 60 * 60_000

describe('createSendLedger', () => {
  test('counts builds sent per user and in all, up to the caps', async () => {
    let t = Date.UTC(2026, 9, 12, 3)
    const ledger = createSendLedger(memoryStore(), () => t)
    expect(await ledger.reserve('a', LIMITS)).toEqual({ ok: true })
    expect(await ledger.reserve('a', LIMITS)).toEqual({ ok: true })
    const daily = await ledger.reserve('a', LIMITS)
    expect(daily).toMatchObject({ ok: false, scope: 'daily' })
    expect(await ledger.reserve('b', LIMITS)).toEqual({ ok: true })
    expect(await ledger.reserve('c', LIMITS)).toMatchObject({ ok: false, scope: 'global' })
    expect(await ledger.counts('a')).toEqual({ user: 2, global: 3 })
    // Until the next UTC day.
    expect(daily.ok === false && daily.retryAfter).toBe(21 * 60 * 60)
    t += DAY
    expect(await ledger.counts('a')).toEqual({ user: 0, global: 0 })
    expect(await ledger.reserve('c', LIMITS)).toEqual({ ok: true })
  })

  test('a refund gives the user a build back but never lowers the day’s total', async () => {
    const ledger = createSendLedger(memoryStore(), () => 0)
    const limits = { userDaily: 1, globalDaily: 100 }
    for (let i = 0; i < MAX_REFUNDS; i++) {
      expect(await ledger.reserve('a', limits)).toEqual({ ok: true })
      await ledger.refund('a')
    }
    expect(await ledger.counts('a')).toEqual({ user: 0, global: MAX_REFUNDS })
    expect(await ledger.reserve('a', limits)).toEqual({ ok: true })
    // The day's refunds are spent: this one stays counted.
    await ledger.refund('a')
    expect(await ledger.reserve('a', limits)).toMatchObject({ ok: false, scope: 'daily' })
    // Nothing sent, nothing to give back.
    await ledger.refund('b')
    expect(await ledger.counts('b')).toEqual({ user: 0, global: MAX_REFUNDS + 1 })
  })

  test('a portrait is used once, until its token would have expired', async () => {
    let t = 1000
    const store = memoryStore()
    const ledger = createSendLedger(store, () => t)
    expect(await ledger.claim('sha-1', 5000)).toBe(true)
    expect(await ledger.claim('sha-1', 5000)).toBe(false)
    // Another process reading the same store sees it too.
    expect(await createSendLedger(store, () => t).claim('sha-1', 5000)).toBe(false)
    await ledger.unclaim('sha-1')
    expect(await ledger.claim('sha-1', 5000)).toBe(true)
    t = 6000
    expect(await ledger.claim('sha-1', 9000)).toBe(true)
  })

  test('one change at a time, and a ledger that can’t be written refuses', async () => {
    const ledger = createSendLedger(memoryStore(), () => 0)
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => ledger.reserve(`u${i}`, LIMITS)),
    )
    expect(results.filter((result) => result.ok)).toHaveLength(3)

    const full = createSendLedger(memoryStore({ failSave: () => true }), () => 0)
    await expect(full.reserve('a', LIMITS)).rejects.toThrow('ENOSPC')
    await expect(full.claim('sha', 10)).rejects.toThrow('ENOSPC')
    expect(await full.counts('a')).toEqual({ user: 0, global: 0 })
  })
})
