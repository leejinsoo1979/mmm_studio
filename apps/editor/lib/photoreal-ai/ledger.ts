import type { PhotorealAiLimits } from './config'
import type { AvatarStore } from './store'

/**
 * What has gone to the paid 3D service, kept in the store so that a restart
 * (or the dev server reloading the route) forgets nothing: the builds sent
 * today, in all and per user, and which portraits have been used. A build is
 * counted just before it is sent. The day's total is the hard ceiling on
 * spend (`AI_AVATAR_DAILY_LIMIT`): nothing lowers it. A user's own count can
 * be given back for a build that failed through no fault of theirs, at most
 * `MAX_REFUNDS` times a day, as the AI 실사 사진 limiter does. A portrait
 * stays used until its token would have expired. One read or write at a
 * time; a ledger that can't be written refuses the build.
 */

type UserDay = { sent: number; refunds: number }

type LedgerRecord = {
  /** UTC day number. */
  day: number
  global: number
  users: Record<string, UserDay>
  /** Portrait hash → until when it stays used (ms). */
  used: Record<string, number>
}

const DAY_MS = 24 * 60 * 60_000
/** Refunds a user gets a day (the AI 실사 사진 limiter's own number). */
export const MAX_REFUNDS = 3

const dayOf = (t: number) => Math.floor(t / DAY_MS)

function isRecord(value: unknown): value is LedgerRecord {
  const record = value as LedgerRecord | null
  return (
    !!record &&
    typeof record.day === 'number' &&
    typeof record.global === 'number' &&
    !!record.users &&
    typeof record.users === 'object' &&
    !!record.used &&
    typeof record.used === 'object'
  )
}

const userDay = (record: LedgerRecord, userKey: string): UserDay => {
  const found = record.users[userKey]
  return {
    sent: typeof found?.sent === 'number' ? found.sent : 0,
    refunds: typeof found?.refunds === 'number' ? found.refunds : 0,
  }
}

export type LedgerRefusal = { ok: false; scope: 'daily' | 'global'; retryAfter: number }

export function createSendLedger(store: AvatarStore, now: () => number = Date.now) {
  let queue: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work)
    queue = next.catch(() => {})
    return next
  }

  async function read(): Promise<LedgerRecord> {
    const raw = await store.loadLedger()
    const t = now()
    const record: LedgerRecord = isRecord(raw)
      ? { ...raw, users: { ...raw.users }, used: { ...raw.used } }
      : { day: dayOf(t), global: 0, users: {}, used: {} }
    if (record.day !== dayOf(t)) {
      record.day = dayOf(t)
      record.global = 0
      record.users = {}
    }
    for (const [sha, until] of Object.entries(record.used)) {
      if (typeof until !== 'number' || until <= t) delete record.used[sha]
    }
    return record
  }

  return {
    /** Counts one build sent for this user when today's caps allow it. */
    reserve(userKey: string, limits: PhotorealAiLimits): Promise<{ ok: true } | LedgerRefusal> {
      return exclusive(async () => {
        const record = await read()
        const own = userDay(record, userKey)
        const retryAfter = Math.max(1, Math.ceil(((record.day + 1) * DAY_MS - now()) / 1000))
        if (record.global >= limits.globalDaily) return { ok: false, scope: 'global', retryAfter }
        if (
          own.sent - own.refunds >= limits.userDaily ||
          own.sent >= limits.userDaily + MAX_REFUNDS
        ) {
          return { ok: false, scope: 'daily', retryAfter }
        }
        record.global += 1
        record.users[userKey] = { ...own, sent: own.sent + 1 }
        await store.saveLedger(record)
        return { ok: true }
      })
    },

    /** Gives one of today's builds back to the user (never to the day's total). */
    refund(userKey: string): Promise<void> {
      return exclusive(async () => {
        const record = await read()
        const own = userDay(record, userKey)
        if (own.refunds >= MAX_REFUNDS || own.refunds >= own.sent) return
        record.users[userKey] = { ...own, refunds: own.refunds + 1 }
        await store.saveLedger(record)
      })
    },

    /** Marks a portrait used until `until`; false when it already is. */
    claim(sha: string, until: number): Promise<boolean> {
      return exclusive(async () => {
        const record = await read()
        if (record.used[sha] !== undefined) return false
        record.used[sha] = until
        await store.saveLedger(record)
        return true
      })
    },

    /** A start refused before anything was built gives its portrait back. */
    unclaim(sha: string): Promise<void> {
      return exclusive(async () => {
        const record = await read()
        if (record.used[sha] === undefined) return
        delete record.used[sha]
        await store.saveLedger(record)
      })
    },

    /** Today's builds: this user's still counted against them, and everyone's sent. */
    counts(userKey: string): Promise<{ user: number; global: number }> {
      return exclusive(async () => {
        const record = await read()
        const own = userDay(record, userKey)
        return { user: own.sent - own.refunds, global: record.global }
      })
    },
  }
}

export type SendLedger = ReturnType<typeof createSendLedger>
