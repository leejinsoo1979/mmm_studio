import { describe, expect, test } from 'bun:test'
import { createNpcRateLimiter, npcClientIp } from './rate-limit'

const DAY = 24 * 60 * 60_000

function limiter(start = 10 * DAY + 1000) {
  const clock = { t: start }
  return { clock, take: createNpcRateLimiter(() => clock.t).take }
}

const message = (overrides: Partial<Parameters<ReturnType<typeof limiter>['take']>[0]> = {}) => ({
  ip: '1.2.3.4',
  sceneId: 'scene-1',
  conversationId: crypto.randomUUID(),
  dailyLimit: 1000,
  ...overrides,
})

describe('createNpcRateLimiter', () => {
  test('30 messages per visitor and scene in 10 minutes', () => {
    const { clock, take } = limiter()
    for (let i = 0; i < 30; i++) expect(take(message()).ok).toBe(true)
    expect(take(message())).toEqual({ ok: false, retryAfter: 600 })
    expect(take(message({ sceneId: 'scene-2' })).ok).toBe(true)
    expect(take(message({ ip: '5.6.7.8' })).ok).toBe(true)
    clock.t += 10 * 60_000
    expect(take(message()).ok).toBe(true)
  })

  test('20 user turns per conversation, from any address', () => {
    const { take } = limiter()
    const conversationId = crypto.randomUUID()
    for (let i = 0; i < 20; i++) {
      expect(take(message({ conversationId, ip: `10.0.0.${i}` })).ok).toBe(true)
    }
    const refused = take(message({ conversationId, ip: '10.0.1.1' }))
    expect(refused.ok).toBe(false)
    expect(take(message({ ip: '10.0.1.1' })).ok).toBe(true)
  })

  test('the daily cap per scene resets at UTC midnight', () => {
    const { clock, take } = limiter(10 * DAY + 3 * 60 * 60_000)
    for (let i = 0; i < 3; i++) {
      expect(take(message({ ip: `10.0.0.${i}`, dailyLimit: 3 })).ok).toBe(true)
    }
    expect(take(message({ ip: '10.0.1.1', dailyLimit: 3 }))).toEqual({
      ok: false,
      retryAfter: 21 * 60 * 60,
    })
    expect(take(message({ sceneId: 'scene-2', dailyLimit: 3 })).ok).toBe(true)
    clock.t = 11 * DAY
    expect(take(message({ ip: '10.0.1.1', dailyLimit: 3 })).ok).toBe(true)
  })

  test('a refused message uses up nothing', () => {
    const { take } = limiter()
    const conversationId = crypto.randomUUID()
    for (let i = 0; i < 20; i++) take(message({ conversationId }))
    for (let i = 0; i < 5; i++) expect(take(message({ conversationId })).ok).toBe(false)
    // 20 of the visitor's 30 are used; the refused five didn't count.
    for (let i = 0; i < 10; i++) expect(take(message()).ok).toBe(true)
    expect(take(message()).ok).toBe(false)
  })
})

describe('npcClientIp', () => {
  test('the first forwarded address, then x-real-ip', () => {
    const request = (headers: Record<string, string>) =>
      new Request('http://localhost/api', { headers })
    expect(npcClientIp(request({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }))).toBe('9.9.9.9')
    expect(npcClientIp(request({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8')
    expect(npcClientIp(request({}))).toBe('unknown')
  })
})
