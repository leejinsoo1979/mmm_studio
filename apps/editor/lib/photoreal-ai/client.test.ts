import { describe, expect, test } from 'bun:test'
import { createPhotorealAiClient, PHOTOREAL_AI_STATUS_TTL_MS, readJobReport } from './client'
import {
  AI_PERSON_DEFAULTS,
  AI_PORTRAIT_TOKEN_HEADER,
  PHOTOREAL_AI_REMAINING_HEADER,
} from './shared'

type Call = { url: string; init: RequestInit }

function fakeFetch(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit) => {
    const call = { url, init }
    calls.push(call)
    return reply(call)
  }
  return { calls, fetch }
}

const headers = async () => ({ authorization: 'Bearer id-token' })
const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name]

const JOB = 'a'.repeat(24)
const AVATAR = `${'b'.repeat(16)}-${'c'.repeat(24)}`

const AVAILABLE = {
  available: true as const,
  mock: false,
  signedIn: true,
  portraitsLeft: 8,
  avatarsLeft: 2,
  notice: 'AI가 새로 만든 가상의 성인 인물이에요.',
}

const image = (bytes = 64, type = 'image/jpeg') => new Blob([new Uint8Array(bytes)], { type })

describe('status', () => {
  test('is asked once a minute, with the user’s token, unless fresh', async () => {
    let clock = 1_000
    const { calls, fetch } = fakeFetch(() => Response.json({ ...AVAILABLE, extra: 'x' }))
    const client = createPhotorealAiClient({ fetch, headers, now: () => clock })
    expect(await client.status()).toEqual(AVAILABLE)
    clock += PHOTOREAL_AI_STATUS_TTL_MS - 1
    await client.status()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('/api/photoreal-ai')
    expect(header(calls[0]!, 'authorization')).toBe('Bearer id-token')
    await client.status({ fresh: true })
    expect(calls).toHaveLength(2)
  })

  test('mock and sign-in default to no; odd counts read as unknown', async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({ available: true, mock: 'yes', portraitsLeft: '3', avatarsLeft: -2.5 }),
    )
    expect(await createPhotorealAiClient({ fetch, headers }).status()).toEqual({
      available: true,
      mock: false,
      signedIn: false,
      portraitsLeft: null,
      avatarsLeft: 0,
      notice: '',
    })
  })

  test('says which step is off; an unknown reason reads as not configured, a failure as network', async () => {
    let answer: () => Response | Promise<Response> = () => Promise.reject(new TypeError('offline'))
    const { calls, fetch } = fakeFetch(() => answer())
    const client = createPhotorealAiClient({ fetch, headers, now: () => 0 })
    expect(await client.status()).toEqual({ available: false, reason: 'network', part: 'portrait' })
    answer = () =>
      Response.json({ available: false, reason: 'service_not_configured', part: 'avatar' })
    expect(await client.status()).toEqual({
      available: false,
      reason: 'service_not_configured',
      part: 'avatar',
    })
    expect(calls).toHaveLength(2)
    answer = () => Response.json({ available: false, reason: 'gremlins' })
    expect(await client.status({ fresh: true })).toEqual({
      available: false,
      reason: 'not_configured',
      part: 'portrait',
    })
    answer = () => new Response('oops', { status: 500 })
    expect(await client.status({ fresh: true })).toMatchObject({ reason: 'network' })
  })
})

describe('createPortrait', () => {
  test('posts the choices as JSON and keeps the image with its token and the count left', async () => {
    const { calls, fetch } = fakeFetch(
      () =>
        new Response(new Uint8Array(100), {
          headers: {
            'content-type': 'image/jpeg',
            [AI_PORTRAIT_TOKEN_HEADER]: 'signed.token',
            [PHOTOREAL_AI_REMAINING_HEADER]: '7',
          },
        }),
    )
    const result = await createPhotorealAiClient({ fetch, headers }).createPortrait(
      AI_PERSON_DEFAULTS,
    )
    expect(result).toMatchObject({ ok: true, token: 'signed.token', portraitsLeft: 7 })
    if (result.ok) expect(result.image.size).toBe(100)
    const call = calls[0]!
    expect(call.url).toBe('/api/photoreal-ai/portrait')
    expect(call.init.method).toBe('POST')
    expect(header(call, 'content-type')).toBe('application/json')
    expect(header(call, 'authorization')).toBe('Bearer id-token')
    expect(JSON.parse(call.init.body as string)).toEqual({ choices: AI_PERSON_DEFAULTS })
  })

  test('an answer without an image or a token is the server’s fault', async () => {
    let reply = () => Response.json({ ok: true }) as Response
    const { fetch } = fakeFetch(() => reply())
    const client = createPhotorealAiClient({ fetch, headers })
    expect(await client.createPortrait(AI_PERSON_DEFAULTS)).toEqual({
      ok: false,
      code: 'upstream',
    })
    reply = () => new Response(new Uint8Array(10), { headers: { 'content-type': 'image/png' } })
    expect(await client.createPortrait(AI_PERSON_DEFAULTS)).toEqual({
      ok: false,
      code: 'upstream',
    })
  })

  test('keeps the route’s codes, scope and wait; falls back on the HTTP status', async () => {
    let reply = (): Response => Response.json({ error: 'blocked' }, { status: 422 })
    const { fetch } = fakeFetch(() => reply())
    const client = createPhotorealAiClient({ fetch, headers })
    expect(await client.createPortrait(AI_PERSON_DEFAULTS)).toEqual({
      ok: false,
      code: 'blocked',
    })
    reply = () =>
      Response.json({ error: 'rate_limited', retryAfter: 41.2, scope: 'daily' }, { status: 429 })
    expect(await client.createPortrait(AI_PERSON_DEFAULTS)).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfter: 42,
      scope: 'daily',
    })
    reply = () => new Response('slow down', { status: 429, headers: { 'retry-after': '9' } })
    expect(await client.createPortrait(AI_PERSON_DEFAULTS)).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfter: 9,
    })
    for (const [status, code] of [
      [400, 'invalid_request'],
      [413, 'too_large'],
      [503, 'unavailable'],
      [504, 'timeout'],
      [500, 'upstream'],
    ] as const) {
      reply = () => Response.json({ error: 'something_else' }, { status })
      expect(await client.createPortrait(AI_PERSON_DEFAULTS)).toEqual({ ok: false, code })
    }
  })

  test('a lost connection reads as network, a cancelled one as aborted', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('offline')))
    const client = createPhotorealAiClient({ fetch, headers })
    expect(await client.createPortrait(AI_PERSON_DEFAULTS)).toEqual({ ok: false, code: 'network' })
    const controller = new AbortController()
    controller.abort()
    expect(await client.createPortrait(AI_PERSON_DEFAULTS, controller.signal)).toEqual({
      ok: false,
      code: 'aborted',
    })
  })
})

describe('startAvatar', () => {
  test('sends the portrait as it came and its token, nothing else', async () => {
    const { calls, fetch } = fakeFetch(() =>
      Response.json(
        { job: JOB, state: 'working', stage: 'queued', progress: 5, mock: false },
        { status: 202, headers: { [PHOTOREAL_AI_REMAINING_HEADER]: '1' } },
      ),
    )
    const portrait = image(80)
    const result = await createPhotorealAiClient({ fetch, headers }).startAvatar(portrait, 'tok')
    expect(result).toEqual({
      ok: true,
      job: {
        jobId: JOB,
        state: 'working',
        stage: 'queued',
        progress: 5,
        avatar: null,
        error: null,
      },
      avatarsLeft: 1,
    })
    const call = calls[0]!
    expect(call.url).toBe('/api/photoreal-ai/avatar')
    expect(header(call, 'content-type')).toBeUndefined()
    const form = call.init.body as FormData
    expect([...form.keys()]).toEqual(['portrait', 'token'])
    expect((form.get('portrait') as Blob).size).toBe(80)
    expect(form.get('token')).toBe('tok')
  })

  test('refusals keep their code', async () => {
    const { fetch } = fakeFetch(() => Response.json({ error: 'portrait_used' }, { status: 409 }))
    expect(await createPhotorealAiClient({ fetch, headers }).startAvatar(image(), 't')).toEqual({
      ok: false,
      code: 'portrait_used',
    })
  })
})

describe('avatarJob', () => {
  test('reads the job by its id', async () => {
    const { calls, fetch } = fakeFetch(() =>
      Response.json({ job: JOB, state: 'working', stage: 'computing', progress: 40, mock: true }),
    )
    expect(await createPhotorealAiClient({ fetch, headers }).avatarJob(JOB)).toEqual({
      ok: true,
      job: {
        jobId: JOB,
        state: 'working',
        stage: 'computing',
        progress: 40,
        avatar: null,
        error: null,
      },
    })
    expect(calls[0]!.url).toBe(`/api/photoreal-ai/avatar/${JOB}`)
  })

  test('a miss says why (job unknown, signed out, unreachable); none of them ends the job', async () => {
    let status = 404
    const { fetch } = fakeFetch(() => new Response('', { status }))
    const client = createPhotorealAiClient({ fetch, headers })
    expect(await client.avatarJob(JOB)).toEqual({ ok: false, miss: 'not_found' })
    status = 401
    expect(await client.avatarJob(JOB)).toEqual({ ok: false, miss: 'sign_in_required' })
    status = 502
    expect(await client.avatarJob(JOB)).toEqual({ ok: false, miss: 'unreachable' })
    const offline = fakeFetch(() => Promise.reject(new TypeError('offline')))
    expect(await createPhotorealAiClient({ fetch: offline.fetch, headers }).avatarJob(JOB)).toEqual(
      { ok: false, miss: 'unreachable' },
    )
  })

  test('job views: progress in range, a finish needs a well-formed avatar, unknown errors are upstream', () => {
    expect(readJobReport({ job: JOB, state: 'working', stage: 'warp', progress: 140 })).toEqual({
      jobId: JOB,
      state: 'working',
      stage: 'queued',
      progress: 100,
      avatar: null,
      error: null,
    })
    const avatar = { id: AVATAR, gender: 'female', name: 'AI 인물 1', url: '/x', ai: true }
    expect(
      readJobReport({ job: JOB, state: 'done', stage: 'done', progress: 100, avatar }),
    ).toEqual({
      jobId: JOB,
      state: 'done',
      stage: 'done',
      progress: 100,
      avatar: { id: AVATAR, gender: 'female', name: 'AI 인물 1' },
      error: null,
    })
    for (const bad of [undefined, { ...avatar, id: '../x' }, { ...avatar, gender: 'other' }]) {
      expect(readJobReport({ job: JOB, state: 'done', avatar: bad })).toMatchObject({
        state: 'failed',
        error: 'upstream',
      })
    }
    expect(readJobReport({ job: JOB, state: 'failed', error: 'avatar_failed' })).toMatchObject({
      error: 'avatar_failed',
    })
    expect(readJobReport({ job: JOB, state: 'failed', error: 'kaboom' })).toMatchObject({
      error: 'upstream',
    })
    expect(readJobReport({ job: 'nope', state: 'working' })).toBeNull()
    expect(readJobReport({ job: JOB, state: 'paused' })).toBeNull()
    expect(readJobReport(null)).toBeNull()
  })
})

describe('the AI 인물 list', () => {
  test('lists with the token; no listing (null) when refused or offline; deletes by id', async () => {
    let reply = (): Response => Response.json({ avatars: [{ id: AVATAR }] })
    const { calls, fetch } = fakeFetch(() => reply())
    const client = createPhotorealAiClient({ fetch, headers })
    expect(await client.avatars()).toEqual([{ id: AVATAR }] as never)
    expect(calls[0]!.url).toBe('/api/photoreal-ai/avatars')
    expect(header(calls[0]!, 'authorization')).toBe('Bearer id-token')
    reply = () => Response.json({ error: 'sign_in_required' }, { status: 401 })
    expect(await client.avatars()).toBeNull()
    reply = () => new Response('<html>', { status: 200 })
    expect(await client.avatars()).toBeNull()
    reply = () => Response.json({ avatars: [] })
    expect(await client.avatars()).toEqual([])
    reply = () => Response.json({ deleted: AVATAR })
    expect(await client.deleteAvatar(AVATAR)).toBe(true)
    expect(calls.at(-1)).toMatchObject({
      url: `/api/photoreal-ai/avatars/${AVATAR}`,
      init: { method: 'DELETE' },
    })
    reply = () => Response.json({ error: 'not_found' }, { status: 404 })
    expect(await client.deleteAvatar(AVATAR)).toBe(false)
  })
})
