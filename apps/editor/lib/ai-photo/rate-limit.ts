import type { AiPhotoLimitScope } from './shared'

/**
 * Cost guards for AI photos, per server process: a user gets 3 photos per
 * 10 minutes, `userDaily` per UTC day and one at a time; an address gets 6
 * per 10 minutes and 30 per day (several accounts on one connection); the
 * instance gets `globalDaily` per day. A signed-out visitor (when allowed) is
 * keyed by address and gets 3 per day. A failed photo can be given back, but
 * only 3 times a day per user and 6 per address, so failures that were billed
 * after all can't be repeated for free. In-memory counters are per serverless
 * instance, so the provider's own spend cap is the real backstop.
 */

export type AiPhotoLimits = { userDaily: number; globalDaily: number }

export type AiPhotoTake = {
  /** `uid:<uid>`, or `ip:<ip>` for a signed-out visitor. */
  userKey: string
  anonymous: boolean
  ip: string
  limits: AiPhotoLimits
}

export type AiPhotoTakeResult =
  | {
      ok: true
      remainingToday: number
      /**
       * Frees the in-flight slot; `refund` gives the photo back (provider
       * failure) while the day's refunds last. Idempotent.
       */
      release: (refund: boolean) => void
    }
  | { ok: false; code: 'rate_limited'; scope: AiPhotoLimitScope; retryAfter: number }
  | { ok: false; code: 'busy' }

type Bucket = { count: number; resetAt: number }

const BURST_MS = 10 * 60_000
const USER_BURST = 3
const IP_BURST = 6
const IP_DAILY = 30
const ANONYMOUS_DAILY = 3
const USER_REFUNDS = 3
const IP_REFUNDS = 6
const DAY_MS = 24 * 60 * 60_000
const SWEEP_MS = 60_000

const nextDay = (t: number) => (Math.floor(t / DAY_MS) + 1) * DAY_MS

export function createAiPhotoLimiter(now: () => number = Date.now) {
  const userBurst = new Map<string, Bucket>()
  const userDay = new Map<string, Bucket>()
  const ipBurst = new Map<string, Bucket>()
  const ipDay = new Map<string, Bucket>()
  const global = new Map<string, Bucket>()
  const userRefunds = new Map<string, Bucket>()
  const ipRefunds = new Map<string, Bucket>()
  const inFlight = new Set<string>()
  let sweptAt = 0

  const bucket = (map: Map<string, Bucket>, key: string, t: number, resetAt: number) => {
    const current = map.get(key)
    if (current && current.resetAt > t) return current
    const fresh = { count: 0, resetAt }
    map.set(key, fresh)
    return fresh
  }

  const sweep = (t: number) => {
    if (t - sweptAt < SWEEP_MS) return
    sweptAt = t
    for (const map of [userBurst, userDay, ipBurst, ipDay, global, userRefunds, ipRefunds]) {
      for (const [key, entry] of map) if (entry.resetAt <= t) map.delete(key)
    }
  }

  const dailyFor = (anonymous: boolean, limits: AiPhotoLimits) =>
    anonymous ? ANONYMOUS_DAILY : limits.userDaily

  return {
    /** Counts one photo when every limit allows it; a refused request counts nowhere. */
    take({ userKey, anonymous, ip, limits }: AiPhotoTake): AiPhotoTakeResult {
      if (inFlight.has(userKey)) return { ok: false, code: 'busy' }
      const t = now()
      sweep(t)
      const day = nextDay(t)
      const own = bucket(userDay, userKey, t, day)
      const checks: [Bucket, number, AiPhotoLimitScope][] = [
        [bucket(userBurst, userKey, t, t + BURST_MS), USER_BURST, 'burst'],
        [bucket(ipBurst, ip, t, t + BURST_MS), IP_BURST, 'burst'],
        [own, dailyFor(anonymous, limits), 'daily'],
        [bucket(ipDay, ip, t, day), IP_DAILY, 'daily'],
        [bucket(global, 'all', t, day), limits.globalDaily, 'global'],
      ]
      const full = checks.filter(([entry, limit]) => entry.count >= limit)
      if (full.length > 0) {
        const [entry, , scope] = full.reduce((a, b) => (b[0].resetAt > a[0].resetAt ? b : a))
        return {
          ok: false,
          code: 'rate_limited',
          scope,
          retryAfter: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)),
        }
      }
      for (const [entry] of checks) entry.count++
      inFlight.add(userKey)
      let released = false
      return {
        ok: true,
        remainingToday: Math.max(0, dailyFor(anonymous, limits) - own.count),
        release(refund) {
          if (released) return
          released = true
          inFlight.delete(userKey)
          if (!refund) return
          const at = now()
          const refunds: [Bucket, number][] = [
            [bucket(userRefunds, userKey, at, nextDay(at)), USER_REFUNDS],
            [bucket(ipRefunds, ip, at, nextDay(at)), IP_REFUNDS],
          ]
          if (refunds.some(([entry, limit]) => entry.count >= limit)) return
          for (const [entry] of refunds) entry.count++
          for (const [entry] of checks) entry.count = Math.max(0, entry.count - 1)
        },
      }
    },

    /** Photos this user has left today on this instance. */
    remaining(userKey: string, anonymous: boolean, limits: AiPhotoLimits): number {
      const t = now()
      const entry = userDay.get(userKey)
      const used = entry && entry.resetAt > t ? entry.count : 0
      return Math.max(0, dailyFor(anonymous, limits) - used)
    },
  }
}

export type AiPhotoLimiter = ReturnType<typeof createAiPhotoLimiter>
