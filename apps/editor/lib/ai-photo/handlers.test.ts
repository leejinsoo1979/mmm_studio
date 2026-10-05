import { describe, expect, test } from 'bun:test'
import { type AiPhotoUsage, createAiPhotoHandlers } from './handlers'
import { base64Of, jpeg, multipart, photoForm, png } from './test-images'

type Call = { url: string; init: RequestInit }
type Upstream = (call: Call) => Response | Promise<Response>

const OPENAI_ENV = {
  AI_PHOTO_PROVIDER: 'openai',
  AI_PHOTO_MODEL: 'test-image-model',
  AI_PHOTO_API_KEY: 'key',
  AI_PHOTO_BASE_URL: 'https://api.openai.com/v1',
}
const MODERATION_ENV = {
  AI_PHOTO_MODERATION_MODEL: 'test-moderation',
  AI_PHOTO_MODERATION_BASE_URL: 'https://mod.example.com/v1',
  AI_PHOTO_MODERATION_API_KEY: 'mod-key',
}
const FACE_ENV = { ...MODERATION_ENV, AI_PHOTO_FACE_ENABLED: 'true' }

const result = jpeg(1024, 1536)
const openaiImage: Upstream = () => Response.json({ data: [{ b64_json: base64Of(result) }] })
const isModeration = (call: Call) => call.url.endsWith('/moderations')
/** Moderation finds nothing; everything else goes to `upstream`. */
const cleared =
  (upstream: Upstream = openaiImage): Upstream =>
  (call) =>
    isModeration(call)
      ? Response.json({ results: [{ flagged: false, categories: {} }] })
      : upstream(call)

let nextIp = 1
/** Handlers over a fake upstream; each test gets its own address so shared API guards stay apart. */
function setup(
  env: Record<string, string> = {},
  upstream: Upstream = openaiImage,
  timeoutMs?: number,
) {
  const calls: Call[] = []
  const logs: AiPhotoUsage[] = []
  const ip = `10.1.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`
  const handlers = createAiPhotoHandlers({
    env: { ...OPENAI_ENV, ...env },
    userId: async (request) => request.headers.get('x-test-user'),
    fetch: async (url, init) => {
      const call = { url, init }
      calls.push(call)
      return upstream(call)
    },
    log: (usage) => logs.push(usage),
    timeoutMs,
  })
  const headers = (user: string | null, extra: Record<string, string> = {}) => ({
    'x-forwarded-for': ip,
    ...(user ? { 'x-test-user': user } : {}),
    ...extra,
  })
  return {
    calls,
    logs,
    /** Calls that reached the image provider (not moderation). */
    generations: () => calls.filter((call) => !isModeration(call)),
    status: (user: string | null = 'user-1') =>
      handlers.status(new Request('http://localhost/api/ai-photo', { headers: headers(user) })),
    remaining: async (user: string | null = 'user-1') =>
      (
        (await (
          await handlers.status(
            new Request('http://localhost/api/ai-photo', { headers: headers(user) }),
          )
        ).json()) as { remainingToday: number }
      ).remainingToday,
    post: async (
      form: FormData,
      user: string | null = 'user-1',
      extra: Record<string, string> = {},
      signal?: AbortSignal,
    ) => {
      const { body, contentType } = await multipart(form)
      return handlers.generate(
        new Request('http://localhost/api/ai-photo', {
          method: 'POST',
          body,
          headers: headers(user, { 'content-type': contentType, ...extra }),
          signal,
        }),
      )
    },
  }
}

const faceShot = (overrides: Record<string, unknown> = {}) =>
  photoForm({
    render: jpeg(1024, 1024),
    options: { avatarId: 'Female_Adult_03', framing: 'face', ...overrides },
  })
const fullShot = () =>
  photoForm({ render: jpeg(1024, 1536), options: { avatarId: 'Male_Adult_07', framing: 'full' } })
const withFace = (overrides: Record<string, unknown> = {}) =>
  photoForm({
    render: jpeg(1024, 1024),
    face: jpeg(600, 600),
    options: { avatarId: 'Female_Adult_03', framing: 'face', consent: true, ...overrides },
  })

describe('GET status', () => {
  test('unavailable, with the reason, until configured', async () => {
    const off = setup({ AI_PHOTO_PROVIDER: '' })
    expect(await (await off.status()).json()).toEqual({
      available: false,
      reason: 'not_configured',
    })
    const killed = setup({ AI_PHOTO_ENABLED: 'false' })
    expect(await (await killed.status()).json()).toEqual({ available: false, reason: 'disabled' })
    const unmoderated = setup({ AI_PHOTO_BASE_URL: 'http://localhost:8091/v1' })
    expect(await (await unmoderated.status()).json()).toEqual({
      available: false,
      reason: 'moderation_required',
    })
  })

  test('available: sign-in, the user’s remaining photos and the upload limit', async () => {
    const { status } = setup()
    const signedIn = await status()
    expect(signedIn.headers.get('cache-control')).toBe('no-store')
    expect(await signedIn.json()).toEqual({
      available: true,
      signInRequired: true,
      signedIn: true,
      remainingToday: 10,
      maxImageBytes: 2 * 1024 * 1024,
      faceAllowed: false,
      childAllowed: true,
    })
    expect(await (await status(null)).json()).toMatchObject({
      signedIn: false,
      remainingToday: null,
    })
    const open = setup({ AI_PHOTO_ALLOW_ANONYMOUS: 'true' })
    expect(await (await open.status(null)).json()).toMatchObject({
      signInRequired: false,
      remainingToday: 3,
    })
  })

  test('face photos only when switched on and signed in; children only on a filtered API', async () => {
    const faces = setup({ ...FACE_ENV, AI_PHOTO_ALLOW_ANONYMOUS: 'true' })
    expect(await (await faces.status()).json()).toMatchObject({ faceAllowed: true })
    expect(await (await faces.status(null)).json()).toMatchObject({ faceAllowed: false })
    const gateway = setup({ ...MODERATION_ENV, AI_PHOTO_BASE_URL: 'https://gw.example.com/v1' })
    expect(await (await gateway.status()).json()).toMatchObject({
      faceAllowed: false,
      childAllowed: false,
    })
  })
})

describe('POST', () => {
  test('streams the photo back, uncached, and logs counts only', async () => {
    const { post, calls, logs } = setup()
    const response = await post(fullShot())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-ai-photo-remaining')).toBe('9')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(result)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/images/edits')
    const form = calls[0]!.init.body as FormData
    expect(form.get('size')).toBe('1024x1536')
    expect(String(form.get('prompt'))).toContain('an adult man')
    // The provider's abuse tag is a hash, never the uid.
    expect(String(form.get('user'))).toMatch(/^[0-9a-f]{32}$/)
    expect(String(form.get('user'))).not.toContain('user-1')
    expect(calls[0]!.init.cache).toBe('no-store')

    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      provider: 'openai',
      framing: 'full',
      child: false,
      withFace: false,
      moderated: false,
      status: 200,
      outcome: 'ok',
      bytesOut: result.byteLength,
    })
    expect(JSON.stringify(logs[0])).not.toContain('user-1')
  })

  test('a consented face photo goes along as image 2, moderated, without age claims', async () => {
    const { post, calls, generations } = setup(FACE_ENV, cleared())
    const response = await post(withFace({ hints: { lips: '#cc0033' } }))
    expect(response.status).toBe(200)
    // Both inputs and the result are moderated.
    expect(calls.filter(isModeration)).toHaveLength(3)
    const sent = generations()[0]!.init.body as FormData
    expect(sent.getAll('image[]')).toHaveLength(2)
    const prompt = String(sent.get('prompt'))
    expect(prompt).toContain('Use image 2 only for facial features')
    expect(prompt).not.toMatch(/consent|adult|woman|#cc0033/)
  })

  test('a face photo is refused when off, signed out, or with a child or party avatar', async () => {
    const off = setup(MODERATION_ENV, cleared())
    const refusedOff = await off.post(withFace())
    expect([refusedOff.status, await refusedOff.json()]).toEqual([
      403,
      { error: 'face_not_allowed' },
    ])
    const on = setup({ ...FACE_ENV, AI_PHOTO_ALLOW_ANONYMOUS: 'true' }, cleared())
    expect(await (await on.post(withFace(), null)).json()).toEqual({ error: 'face_not_allowed' })
    for (const avatarId of ['Female_Party_01', 'Male_Child_01']) {
      expect(await (await on.post(withFace({ avatarId }))).json()).toEqual({
        error: 'face_not_allowed',
      })
    }
    expect([...off.calls, ...on.calls]).toHaveLength(0)
    // Nothing was counted.
    expect(await on.remaining()).toBe(10)
  })

  test('a child avatar is refused where the provider has no child-safety filter', async () => {
    const gateway = setup(
      { ...MODERATION_ENV, AI_PHOTO_BASE_URL: 'https://gw.example.com/v1' },
      cleared(),
    )
    const child = photoForm({
      render: jpeg(1024, 1024),
      options: { avatarId: 'Female_Child_02', framing: 'face' },
    })
    const response = await gateway.post(child)
    expect([response.status, await response.json()]).toEqual([403, { error: 'child_not_allowed' }])
    expect(gateway.calls).toHaveLength(0)
    expect((await gateway.post(faceShot())).status).toBe(200)
  })

  test('the kill switch and a missing setup refuse before anything else', async () => {
    const killed = setup({ AI_PHOTO_ENABLED: 'false' })
    const response = await killed.post(faceShot())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'unavailable', reason: 'disabled' })
    expect(killed.calls).toHaveLength(0)
    const keyless = setup({ AI_PHOTO_API_KEY: '' })
    expect(await (await keyless.post(faceShot())).json()).toEqual({
      error: 'unavailable',
      reason: 'no_api_key',
    })
  })

  test('signed out: refused unless anonymous use is on', async () => {
    const closed = setup()
    const refused = await closed.post(faceShot(), null)
    expect(refused.status).toBe(401)
    expect(await refused.json()).toEqual({ error: 'sign_in_required' })
    const open = setup({ AI_PHOTO_ALLOW_ANONYMOUS: 'true' })
    const response = await open.post(faceShot(), null)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-ai-photo-remaining')).toBe('2')
    // No user tag for a signed-out visitor.
    expect((open.calls[0]!.init.body as FormData).has('user')).toBe(false)
  })

  test('the body: multipart only, within the size cap', async () => {
    const { post, calls } = setup()
    const json = await post(faceShot(), 'user-1', { 'content-type': 'application/json' })
    expect(json.status).toBe(415)
    const declared = await post(faceShot(), 'user-1', { 'content-length': '5000000' })
    expect(declared.status).toBe(413)
    const big = photoForm({
      render: jpeg(1024, 1024, { pad: 2_300_000 }),
      face: jpeg(600, 600, { pad: 2_300_000 }),
      options: { avatarId: 'Female_Adult_03', framing: 'face', consent: true },
    })
    const tooBig = await post(big)
    expect(tooBig.status).toBe(413)
    expect(await tooBig.json()).toEqual({ error: 'too_large' })
    expect(calls).toHaveLength(0)
  })

  test('consent and child rules are enforced on the server', async () => {
    const { post, calls } = setup(FACE_ENV)
    const noConsent = await post(withFace({ consent: false }))
    expect([noConsent.status, await noConsent.json()]).toEqual([400, { error: 'consent_required' }])
    const child = await post(withFace({ avatarId: 'Male_Child_01' }))
    expect([child.status, await child.json()]).toEqual([403, { error: 'face_not_allowed' }])
    expect(calls).toHaveLength(0)
  })

  test('a child avatar gets the child rules and no lip colour', async () => {
    const { post, calls, logs } = setup()
    const form = photoForm({
      render: jpeg(1024, 1024),
      options: {
        avatarId: 'Female_Child_02',
        framing: 'face',
        hints: { lips: '#aa0000', hair: '#332211' },
      },
    })
    expect((await post(form)).status).toBe(200)
    const prompt = String((calls[0]!.init.body as FormData).get('prompt'))
    expect(prompt).toContain('This person is a child.')
    expect(prompt).toContain('#332211')
    expect(prompt).not.toContain('#aa0000')
    expect(logs[0]).toMatchObject({ child: true })
  })

  test('a provider refusal is blocked and stays counted', async () => {
    const { post, status } = setup({}, () =>
      Response.json({ error: { code: 'moderation_blocked', type: 'x' } }, { status: 400 }),
    )
    const response = await post(faceShot())
    expect([response.status, await response.json()]).toEqual([422, { error: 'blocked' }])
    expect(await (await status()).json()).toMatchObject({ remainingToday: 9 })
  })

  test('failures where the provider did no billable work are refunded', async () => {
    const down = setup({}, () => new Response('oops', { status: 500 }))
    const failed = await down.post(faceShot())
    expect([failed.status, await failed.json()]).toEqual([502, { error: 'upstream' }])
    expect(down.logs[0]).toMatchObject({ outcome: 'upstream', detail: 'http_500' })
    expect(await down.remaining()).toBe(10)

    const offline = setup({}, () => {
      throw new TypeError('network down')
    })
    expect((await offline.post(faceShot())).status).toBe(502)
    expect(await offline.remaining()).toBe(10)

    const badKey = setup({}, () =>
      Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 }),
    )
    expect((await badKey.post(faceShot())).status).toBe(502)
    expect(await badKey.remaining()).toBe(10)
  })

  const NO_IMAGE: [string, Record<string, string>, Upstream, number][] = [
    [
      'a Gemini text-only answer',
      { AI_PHOTO_PROVIDER: 'gemini', AI_PHOTO_BASE_URL: '' },
      () =>
        Response.json({
          candidates: [
            { finishReason: 'STOP', content: { parts: [{ text: "I can't create that image." }] } },
          ],
        }),
      422,
    ],
    ...['NO_IMAGE', 'IMAGE_OTHER', 'IMAGE_RECITATION', 'OTHER'].map(
      (finishReason): [string, Record<string, string>, Upstream, number] => [
        `a Gemini ${finishReason} finish`,
        { AI_PHOTO_PROVIDER: 'gemini', AI_PHOTO_BASE_URL: '' },
        () => Response.json({ candidates: [{ finishReason, content: { parts: [] } }] }),
        422,
      ],
    ),
    [
      'an OpenAI user error',
      {},
      () =>
        Response.json(
          { error: { code: 'invalid_request_error', type: 'image_generation_user_error' } },
          { status: 400 },
        ),
      502,
    ],
    ['an OpenAI answer with no data', {}, () => Response.json({ data: [] }), 502],
    [
      'a URL-only answer',
      {},
      () => Response.json({ data: [{ url: 'https://cdn.example.com/x.png' }] }),
      502,
    ],
  ]

  for (const [name, env, upstream, status] of NO_IMAGE) {
    test(`${name} stays counted, so retries run into the daily limit`, async () => {
      const { post, generations } = setup({ ...env, AI_PHOTO_USER_DAILY_LIMIT: '2' }, upstream)
      for (let i = 0; i < 2; i++) expect((await post(faceShot())).status).toBe(status)
      const limited = await post(faceShot())
      expect([limited.status, await limited.json()]).toMatchObject([
        429,
        { error: 'rate_limited', scope: 'daily' },
      ])
      expect(generations()).toHaveLength(2)
    })
  }

  test('refunds run out: 3 a day, then failures count', async () => {
    const { post, remaining, generations } = setup(
      { AI_PHOTO_USER_DAILY_LIMIT: '2' },
      () => new Response('oops', { status: 503 }),
    )
    for (let i = 0; i < 3; i++) expect((await post(faceShot())).status).toBe(502)
    expect(await remaining()).toBe(2)
    for (let i = 0; i < 2; i++) expect((await post(faceShot())).status).toBe(502)
    expect(await remaining()).toBe(0)
    expect((await post(faceShot())).status).toBe(429)
    expect(generations()).toHaveLength(5)
  })

  test('the provider’s rate limit is passed on with Retry-After', async () => {
    const { post, status } = setup(
      {},
      () => new Response('{}', { status: 429, headers: { 'retry-after': '20' } }),
    )
    const response = await post(faceShot())
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('20')
    expect(await response.json()).toEqual({ error: 'rate_limited', retryAfter: 20, scope: 'burst' })
    expect(await (await status()).json()).toMatchObject({ remainingToday: 10 })
  })

  test('our own limits: busy while one runs, then the burst limit', async () => {
    let finish = () => {}
    let started = () => {}
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    const { post } = setup({}, async () => {
      started()
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return openaiImage({ url: '', init: {} })
    })
    const first = post(faceShot())
    await running
    const second = await post(faceShot())
    expect([second.status, await second.json()]).toEqual([429, { error: 'busy' }])
    finish()
    expect((await first).status).toBe(200)

    const quick = setup()
    for (let i = 0; i < 3; i++) expect((await quick.post(faceShot())).status).toBe(200)
    const limited = await quick.post(faceShot())
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('600')
    expect(await limited.json()).toEqual({ error: 'rate_limited', retryAfter: 600, scope: 'burst' })
  })

  const hang: Upstream = ({ init }) =>
    new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })

  test('a provider that takes too long times out; the request went out, so it stays counted', async () => {
    const { post, remaining } = setup({}, hang, 30)
    const response = await post(faceShot())
    expect([response.status, await response.json()]).toEqual([504, { error: 'timeout' }])
    expect(await remaining()).toBe(9)
  })

  test('a visitor who leaves before generation is refunded; during it, counted', async () => {
    const early = new AbortController()
    const beforeGeneration = setup(MODERATION_ENV, (call) => {
      if (isModeration(call)) setTimeout(() => early.abort(), 5)
      return hang(call)
    })
    expect((await beforeGeneration.post(faceShot(), 'user-1', {}, early.signal)).status).toBe(502)
    expect(beforeGeneration.generations()).toHaveLength(0)
    expect(await beforeGeneration.remaining()).toBe(10)

    const late = new AbortController()
    const duringGeneration = setup({}, (call) => {
      setTimeout(() => late.abort(), 5)
      return hang(call)
    })
    expect((await duringGeneration.post(faceShot(), 'user-1', {}, late.signal)).status).toBe(502)
    expect(duringGeneration.logs[0]).toMatchObject({ detail: 'client_aborted' })
    expect(await duringGeneration.remaining()).toBe(9)
  })

  test('moderation checks the inputs and the result, failing closed', async () => {
    const moderation = MODERATION_ENV
    const outputB64 = base64Of(result)
    const moderated =
      (flag: (body: string) => boolean | 'error'): Upstream =>
      ({ url, init }) => {
        if (!url.endsWith('/moderations')) return openaiImage({ url, init })
        const verdict = flag(init.body as string)
        if (verdict === 'error') return new Response('down', { status: 503 })
        return Response.json({ results: [{ flagged: verdict, categories: {} }] })
      }

    const clean = setup(
      moderation,
      moderated(() => false),
    )
    expect((await clean.post(faceShot())).status).toBe(200)
    expect(clean.calls.map((call) => call.url)).toEqual([
      'https://mod.example.com/v1/moderations',
      'https://api.openai.com/v1/images/edits',
      'https://mod.example.com/v1/moderations',
    ])
    expect(clean.logs[0]).toMatchObject({ moderated: true })

    const input = setup(
      moderation,
      moderated((body) => !body.includes(outputB64)),
    )
    const inputBlocked = await input.post(faceShot())
    expect([inputBlocked.status, await inputBlocked.json()]).toEqual([422, { error: 'blocked' }])
    expect(input.calls).toHaveLength(1)

    const output = setup(
      moderation,
      moderated((body) => body.includes(outputB64)),
    )
    const outputBlocked = await output.post(faceShot())
    expect([outputBlocked.status, await outputBlocked.json()]).toEqual([422, { error: 'blocked' }])
    expect(output.logs[0]).toMatchObject({ detail: 'output_flagged', bytesOut: 0 })

    const broken = setup(
      moderation,
      moderated(() => 'error'),
    )
    expect((await broken.post(faceShot())).status).toBe(502)
    expect(broken.calls).toHaveLength(1)
    // Nothing was generated: refunded.
    expect(await broken.remaining()).toBe(10)

    // The result could not be checked, but it was generated (and billed): counted.
    const uncheckable = setup(
      moderation,
      moderated((body) => (body.includes(outputB64) ? 'error' : false)),
    )
    expect((await uncheckable.post(faceShot())).status).toBe(502)
    expect(uncheckable.logs[0]).toMatchObject({ detail: 'moderation', bytesOut: 0 })
    expect(await uncheckable.remaining()).toBe(9)
  })

  test('gemini end to end', async () => {
    const image = png(1024, 1024)
    const { post, calls } = setup({ AI_PHOTO_PROVIDER: 'gemini', AI_PHOTO_BASE_URL: '' }, () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: base64Of(image) } }],
            },
          },
        ],
      }),
    )
    const response = await post(faceShot())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(image)
    expect(calls[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/test-image-model:generateContent',
    )
    expect(calls[0]!.init.headers).toMatchObject({ 'x-goog-api-key': 'key' })
  })
})
