import { describe, expect, test } from 'bun:test'
import { type AiPhotoTake, createAiPhotoLimiter } from './rate-limit'

const DAY = 24 * 60 * 60_000
const MINUTE = 60_000

function limiter(start = 10 * DAY + 1000) {
  const clock = { t: start }
  return { clock, ...createAiPhotoLimiter(() => clock.t) }
}

const request = (overrides: Partial<AiPhotoTake> = {}): AiPhotoTake => ({
  userKey: 'uid:a',
  anonymous: false,
  ip: '1.2.3.4',
  limits: { userDaily: 10, globalDaily: 200 },
  ...overrides,
})

/** Takes and releases one photo, kept counted. */
function photo(take: ReturnType<typeof limiter>['take'], overrides: Partial<AiPhotoTake> = {}) {
  const result = take(request(overrides))
  if (result.ok) result.release(false)
  return result
}

describe('createAiPhotoLimiter', () => {
  test('one photo at a time per user', () => {
    const { take } = limiter()
    const first = take(request())
    expect(first.ok).toBe(true)
    expect(take(request())).toEqual({ ok: false, code: 'busy' })
    // Another user is not held up.
    expect(photo(take, { userKey: 'uid:b' }).ok).toBe(true)
    if (first.ok) first.release(false)
    expect(photo(take).ok).toBe(true)
  })

  test('3 per user in 10 minutes', () => {
    const { clock, take } = limiter()
    for (let i = 0; i < 3; i++) expect(photo(take).ok).toBe(true)
    expect(photo(take)).toEqual({
      ok: false,
      code: 'rate_limited',
      scope: 'burst',
      retryAfter: 600,
    })
    clock.t += 10 * MINUTE
    expect(photo(take).ok).toBe(true)
  })

  test('6 per address in 10 minutes, across accounts', () => {
    const { take } = limiter()
    for (let i = 0; i < 6; i++) expect(photo(take, { userKey: `uid:${i}` }).ok).toBe(true)
    expect(photo(take, { userKey: 'uid:new' })).toMatchObject({ ok: false, scope: 'burst' })
    expect(photo(take, { userKey: 'uid:new', ip: '5.6.7.8' }).ok).toBe(true)
  })

  test('the user’s daily limit, until the next UTC day', () => {
    const { clock, take, remaining } = limiter()
    const limits = { userDaily: 4, globalDaily: 200 }
    const results = []
    for (let i = 0; i < 4; i++) {
      results.push(photo(take, { limits }))
      clock.t += 11 * MINUTE
    }
    expect(results.map((r) => r.ok && r.remainingToday)).toEqual([3, 2, 1, 0])
    expect(remaining('uid:a', false, limits)).toBe(0)
    const refused = photo(take, { limits })
    expect(refused).toMatchObject({ ok: false, code: 'rate_limited', scope: 'daily' })
    const nextDay = 11 * DAY
    expect(refused.ok === false && 'retryAfter' in refused && refused.retryAfter).toBe(
      Math.ceil((nextDay - clock.t) / 1000),
    )
    clock.t = nextDay
    expect(remaining('uid:a', false, limits)).toBe(4)
    expect(photo(take, { limits }).ok).toBe(true)
  })

  test('a signed-out visitor gets 3 a day', () => {
    const { clock, take, remaining } = limiter()
    const visitor = { userKey: 'ip:1.2.3.4', anonymous: true }
    expect(remaining('ip:1.2.3.4', true, request().limits)).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(photo(take, visitor).ok).toBe(true)
      clock.t += 11 * MINUTE
    }
    expect(photo(take, visitor)).toMatchObject({ ok: false, scope: 'daily' })
  })

  test('30 per address a day', () => {
    const { clock, take } = limiter()
    for (let i = 0; i < 30; i++) {
      expect(photo(take, { userKey: `uid:${i}` }).ok).toBe(true)
      if (i % 6 === 5) clock.t += 10 * MINUTE
    }
    expect(photo(take, { userKey: 'uid:new' })).toMatchObject({ ok: false, scope: 'daily' })
  })

  test('the instance’s daily limit, for everyone', () => {
    const { take } = limiter()
    const limits = { userDaily: 10, globalDaily: 2 }
    expect(photo(take, { userKey: 'uid:1', ip: '1.1.1.1', limits }).ok).toBe(true)
    expect(photo(take, { userKey: 'uid:2', ip: '2.2.2.2', limits }).ok).toBe(true)
    expect(photo(take, { userKey: 'uid:3', ip: '3.3.3.3', limits })).toMatchObject({
      ok: false,
      scope: 'global',
    })
  })

  test('a refund gives the photo back; release is idempotent', () => {
    const { take, remaining } = limiter()
    const limits = { userDaily: 2, globalDaily: 200 }
    const failed = take(request({ limits }))
    expect(failed.ok && failed.remainingToday).toBe(1)
    if (failed.ok) {
      failed.release(true)
      failed.release(true)
    }
    expect(remaining('uid:a', false, limits)).toBe(2)
    expect(photo(take, { limits }).ok).toBe(true)
    expect(photo(take, { limits }).ok).toBe(true)
    expect(photo(take, { limits }).ok).toBe(false)
  })

  test('3 refunds a day per user, 6 per address; then failures stay counted', () => {
    const { clock, take, remaining } = limiter()
    const limits = { userDaily: 10, globalDaily: 200 }
    const fail = (overrides: Partial<AiPhotoTake> = {}) => {
      const result = take(request({ limits, ...overrides }))
      if (result.ok) result.release(true)
      return result.ok
    }
    for (let i = 0; i < 3; i++) expect(fail()).toBe(true)
    expect(remaining('uid:a', false, limits)).toBe(10)
    expect(fail()).toBe(true)
    expect(remaining('uid:a', false, limits)).toBe(9)

    // Other accounts on the same address share its 6.
    for (let i = 0; i < 3; i++) expect(fail({ userKey: 'uid:b' })).toBe(true)
    expect(remaining('uid:b', false, limits)).toBe(10)
    clock.t += 10 * MINUTE
    expect(fail({ userKey: 'uid:c' })).toBe(true)
    expect(remaining('uid:c', false, limits)).toBe(9)
    expect(fail({ userKey: 'uid:d', ip: '5.6.7.8' })).toBe(true)
    expect(remaining('uid:d', false, limits)).toBe(10)

    clock.t = 11 * DAY
    expect(fail()).toBe(true)
    expect(remaining('uid:a', false, limits)).toBe(10)
  })

  test('a refused request counts nowhere', () => {
    const { take, remaining } = limiter()
    for (let i = 0; i < 3; i++) photo(take)
    for (let i = 0; i < 5; i++) expect(photo(take).ok).toBe(false)
    expect(remaining('uid:a', false, request().limits)).toBe(7)
  })
})
