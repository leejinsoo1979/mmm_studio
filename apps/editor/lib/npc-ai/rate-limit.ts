/**
 * Cost guards for NPC AI chat, per server process: a visitor (IP) may send 30
 * messages per scene in 10 minutes, a conversation gets 20 user turns, and a
 * scene gets `dailyLimit` replies per UTC day. In-memory counters are per
 * serverless instance, so the daily cap is the backstop for public links.
 */

export type NpcRateLimitResult = { ok: true } | { ok: false; retryAfter: number }

export type NpcRateLimitRequest = {
  ip: string
  sceneId: string
  conversationId: string
  dailyLimit: number
}

type Bucket = { count: number; resetAt: number }

const WINDOW_MS = 10 * 60_000
const PER_VISITOR = 30
const PER_CONVERSATION = 20
/** How long a conversation's turn count is kept. */
const CONVERSATION_MS = 6 * 60 * 60_000
const DAY_MS = 24 * 60 * 60_000
const SWEEP_MS = 60_000

export function createNpcRateLimiter(now: () => number = Date.now) {
  const visitors = new Map<string, Bucket>()
  const conversations = new Map<string, Bucket>()
  const scenes = new Map<string, Bucket>()
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
    for (const map of [visitors, conversations, scenes]) {
      for (const [key, entry] of map) if (entry.resetAt <= t) map.delete(key)
    }
  }

  return {
    /** Counts one message when every limit allows it; a refused message counts nowhere. */
    take({ ip, sceneId, conversationId, dailyLimit }: NpcRateLimitRequest): NpcRateLimitResult {
      const t = now()
      sweep(t)
      const checks: [Bucket, number][] = [
        [bucket(visitors, `${ip}|${sceneId}`, t, t + WINDOW_MS), PER_VISITOR],
        [bucket(conversations, conversationId, t, t + CONVERSATION_MS), PER_CONVERSATION],
        [bucket(scenes, sceneId, t, (Math.floor(t / DAY_MS) + 1) * DAY_MS), dailyLimit],
      ]
      const full = checks.filter(([entry, limit]) => entry.count >= limit)
      if (full.length > 0) {
        const wait = Math.max(...full.map(([entry]) => entry.resetAt - t))
        return { ok: false, retryAfter: Math.max(1, Math.ceil(wait / 1000)) }
      }
      for (const [entry] of checks) entry.count++
      return { ok: true }
    },
  }
}

/** The caller's address as the proxy reports it. */
export function npcClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip') || 'unknown'
}
