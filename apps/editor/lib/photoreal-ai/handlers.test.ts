import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sniffImage } from '../ai-photo/image-header'
import { base64Of, jpeg, multipart, png } from '../ai-photo/test-images'
import { readGlb } from './glb'
import { createPhotorealAiHandlers, type PhotorealAiUsage } from './handlers'
import { createMetaPersonFake, type FakeCall } from './metaperson-fake'
import { verifyPortrait } from './portrait-token'
import {
  AI_PERSON_DEFAULTS,
  AI_PORTRAIT_TOKEN_HEADER,
  type AiPersonChoices,
  type AvatarJobView,
  PHOTOREAL_AI_REMAINING_HEADER,
  type PhotorealAiAvatarList,
} from './shared'
import { testAvatarGlb } from './test-glb'

const APP = join(import.meta.dir, '../..')
const SHIPPED_GLB = join(APP, 'public/characters/photoreal/makehuman-female-01.glb')
const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const REAL_ENV = {
  AI_PHOTO_PROVIDER: 'openai',
  AI_PHOTO_MODEL: 'test-image-model',
  AI_PHOTO_API_KEY: 'image-key',
  AI_PHOTO_BASE_URL: 'https://api.openai.com/v1',
  AI_AVATAR_CLIENT_ID: 'client-id',
  AI_AVATAR_CLIENT_SECRET: 'client-secret',
  AI_AVATAR_SECRET: 'test-signing-secret',
}
const MODERATION_ENV = {
  AI_PHOTO_MODERATION_MODEL: 'test-moderation',
  AI_PHOTO_MODERATION_BASE_URL: 'https://mod.example.com/v1',
  AI_PHOTO_MODERATION_API_KEY: 'mod-key',
}

type Call = { url: string; init: RequestInit }
type ImageApi = (call: Call) => Response | Promise<Response>

let generated = 0
/** Each generation's bytes differ, as real ones do. */
const openaiImage: ImageApi = () =>
  Response.json({ data: [{ b64_json: base64Of(jpeg(1024, 1024, { pad: ++generated })) }] })
const clearModeration = () => Response.json({ results: [{ flagged: false, categories: {} }] })

let nextIp = 1

function setup(
  env: Record<string, string> = {},
  options: {
    image?: ImageApi
    moderation?: (call: Call) => Response
    service?: {
      outcome?: 'completed' | 'failed'
      age?: 'child' | 'not_child'
      override?: (call: FakeCall) => Response | undefined
    }
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'photoreal-ai-'))
  roots.push(root)
  let t = Date.UTC(2026, 9, 12, 3)
  const now = () => t
  const calls: Call[] = []
  const logs: PhotorealAiUsage[] = []
  const fake = createMetaPersonFake({
    glb: () => testAvatarGlb(),
    now,
    clientId: REAL_ENV.AI_AVATAR_CLIENT_ID,
    clientSecret: REAL_ENV.AI_AVATAR_CLIENT_SECRET,
    buildMs: 20_000,
    exportMs: 2000,
    ...options.service,
  })
  const ip = `10.7.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`
  const handlers = createPhotorealAiHandlers({
    env: { ...REAL_ENV, AI_AVATAR_STORE_DIR: root, ...env },
    cwd: APP,
    userId: async (request) => request.headers.get('x-test-user'),
    fetch: async (url, init) => {
      const call = { url, init }
      calls.push(call)
      if (url.startsWith('https://api.avatarsdk.com/')) return fake.fetch(url, init)
      if (url.endsWith('/moderations')) return (options.moderation ?? clearModeration)(call)
      return (options.image ?? openaiImage)(call)
    },
    now,
    sleep: async () => {},
    log: (usage) => logs.push(usage),
  })
  const headers = (user: string | null, extra: Record<string, string> = {}) => ({
    'x-forwarded-for': ip,
    ...(user ? { 'x-test-user': user } : {}),
    ...extra,
  })
  const request = (
    method: string,
    path: string,
    user: string | null,
    init: { body?: BodyInit; headers?: Record<string, string> } = {},
  ) =>
    handlers.route(
      method,
      path.split('/').filter(Boolean),
      new Request(`http://localhost/api/photoreal-ai/${path}`, {
        method,
        body: init.body,
        headers: headers(user, init.headers),
      }),
    )

  const api = {
    root,
    fake,
    calls,
    logs,
    advance: (ms: number) => {
      t += ms
    },
    imageCalls: () =>
      calls.filter(
        (call) => !call.url.endsWith('/moderations') && !call.url.includes('avatarsdk.com'),
      ),
    status: async (user: string | null = 'user-1') => (await request('GET', '', user)).json(),
    portrait: (choices: Partial<AiPersonChoices> | Record<string, unknown> = {}, user = 'user-1') =>
      request('POST', 'portrait', user, {
        body: JSON.stringify({ choices: { ...AI_PERSON_DEFAULTS, ...choices } }),
        headers: { 'content-type': 'application/json' },
      }),
    /** A portrait and its token, from the route. */
    async signed(user = 'user-1', choices: Partial<AiPersonChoices> = {}) {
      const response = await api.portrait(choices, user)
      expect(response.status).toBe(200)
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        token: response.headers.get(AI_PORTRAIT_TOKEN_HEADER) ?? '',
        type: response.headers.get('content-type') ?? '',
      }
    },
    async start(portrait: { bytes: Uint8Array; token: string; type?: string }, user = 'user-1') {
      const form = new FormData()
      form.append('portrait', new Blob([portrait.bytes], { type: portrait.type ?? 'image/jpeg' }))
      form.append('token', portrait.token)
      const { body, contentType } = await multipart(form)
      return request('POST', 'avatar', user, { body, headers: { 'content-type': contentType } })
    },
    poll: (job: string, user = 'user-1') => request('GET', `avatar/${job}`, user),
    list: async (user = 'user-1') =>
      ((await (await request('GET', 'avatars', user)).json()) as PhotorealAiAvatarList).avatars,
    file: (id: string, file: string) => request('GET', `avatars/${id}/${file}`, null),
    remove: (id: string, user = 'user-1') => request('DELETE', `avatars/${id}`, user),
    /** Polls with the clock moving until the job ends. */
    async finish(job: string, user = 'user-1', stepMs = 4000) {
      const views: AvatarJobView[] = []
      for (let i = 0; i < 40; i++) {
        api.advance(stepMs)
        const view = (await (await api.poll(job, user)).json()) as AvatarJobView
        views.push(view)
        if (view.state !== 'working') break
      }
      return views
    },
  }
  return api
}

describe('GET status', () => {
  test('says which part is missing', async () => {
    expect(await setup({ AI_PHOTO_PROVIDER: '' }).status()).toEqual({
      available: false,
      reason: 'not_configured',
      part: 'portrait',
    })
    expect(await setup({ AI_AVATAR_CLIENT_SECRET: '' }).status()).toEqual({
      available: false,
      reason: 'service_not_configured',
      part: 'avatar',
    })
    expect(await setup({ AI_AVATAR_ENABLED: 'false' }).status()).toMatchObject({
      available: false,
      reason: 'disabled',
    })
  })

  test('what is left today, and the notice', async () => {
    expect(await setup().status()).toEqual({
      available: true,
      mock: false,
      signedIn: true,
      portraitsLeft: 8,
      avatarsLeft: 2,
      notice: expect.stringContaining('AI가 새로 만든 가상의 성인'),
    })
    expect(await setup().status(null)).toMatchObject({ signedIn: false, portraitsLeft: null })
  })
})

describe('POST portrait', () => {
  test('needs a signed-in user and a well-formed JSON body', async () => {
    const api = setup()
    expect((await api.portrait({}, null as unknown as string)).status).toBe(401)
    const wrongType = await setup().portrait({ notes: '' })
    expect(wrongType.status).toBe(200)
    const bad = setup()
    expect((await bad.portrait({ sex: 'robot' })).status).toBe(400)
    expect((await bad.portrait({ name: '김민준' })).status).toBe(400)
    const text = await bad.portrait({})
    expect(text.status).toBe(200)
  })

  test('refused notes cost nothing and never leave the server', async () => {
    const api = setup()
    const response = await api.portrait({ notes: '김민준 닮게' })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'name_not_allowed' })
    expect((await api.portrait({ notes: '17살처럼' })).status).toBe(422)
    expect(api.calls).toHaveLength(0)
    expect(await api.status()).toMatchObject({ portraitsLeft: 8 })
  })

  test('openai: a text-only generation, signed for the 3D step', async () => {
    const api = setup()
    const response = await api.portrait({ sex: 'male', age: '40s', notes: '왼쪽 눈 밑에 작은 점' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get(PHOTOREAL_AI_REMAINING_HEADER)).toBe('7')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(sniffImage(bytes)).toEqual({ type: 'image/jpeg', width: 1024, height: 1024 })
    const [call] = api.imageCalls()
    expect(call!.url).toBe('https://api.openai.com/v1/images/generations')
    const body = JSON.parse(call!.init.body as string)
    expect(body).toMatchObject({ model: 'test-image-model', n: 1, size: '1024x1024' })
    expect(body.user).toMatch(/^[0-9a-f]{32}$/)
    expect(body).not.toHaveProperty('moderation')
    expect(body.prompt).toContain('fictional adult man')
    expect(body.prompt).toContain('<notes>왼쪽 눈 밑에 작은 점</notes>')

    const token = response.headers.get(AI_PORTRAIT_TOKEN_HEADER)!
    const verified = verifyPortrait(token, bytes, 'user-1', {
      env: { AI_AVATAR_SECRET: REAL_ENV.AI_AVATAR_SECRET },
      now: Date.UTC(2026, 9, 12, 3),
    })
    expect(verified).toMatchObject({ ok: true, claim: { sex: 'male', age: '40s' } })
    expect(verified.ok && verified.claim.mock).toBeUndefined()

    const [log] = api.logs
    expect(log).toMatchObject({ step: 'portrait', outcome: 'ok', notes: true, mock: false })
    expect(JSON.stringify(api.logs)).not.toContain('user-1')
    expect(JSON.stringify(api.logs)).not.toContain('눈')
  })

  test('moderation: the notes first, then the result', async () => {
    const order: string[] = []
    const api = setup(MODERATION_ENV, {
      moderation: (call) => {
        const input = JSON.parse(call.init.body as string).input[0]
        order.push(input.type)
        return clearModeration()
      },
    })
    expect((await api.portrait({ notes: '주근깨가 살짝 있는 피부' })).status).toBe(200)
    expect(order).toEqual(['text', 'image_url'])

    const flagged = setup(MODERATION_ENV, {
      moderation: (call) =>
        Response.json({
          results: [{ flagged: (call.init.body as string).includes('"text"'), categories: {} }],
        }),
    })
    const refused = await flagged.portrait({ notes: '차분한 분위기' })
    expect(refused.status).toBe(422)
    expect(await refused.json()).toEqual({ error: 'blocked' })
    expect(flagged.imageCalls()).toHaveLength(0)
    expect(await flagged.status()).toMatchObject({ portraitsLeft: 7 })
  })

  test('provider refusals, failures, limits and sizes', async () => {
    const blocked = setup(
      {},
      {
        image: () => Response.json({ error: { code: 'moderation_blocked' } }, { status: 400 }),
      },
    )
    expect((await blocked.portrait()).status).toBe(422)
    expect(await blocked.status()).toMatchObject({ portraitsLeft: 7 })

    const down = setup({}, { image: () => new Response('', { status: 500 }) })
    expect((await down.portrait()).status).toBe(502)
    expect(await down.status()).toMatchObject({ portraitsLeft: 8 })

    const throttled = setup(
      {},
      {
        image: () => new Response('', { status: 429, headers: { 'retry-after': '40' } }),
      },
    )
    const limited = await throttled.portrait()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('40')

    const small = setup(
      {},
      {
        image: () => Response.json({ data: [{ b64_json: base64Of(jpeg(512, 512)) }] }),
      },
    )
    const tooSmall = await small.portrait()
    expect(tooSmall.status).toBe(502)
    expect(small.logs[0]).toMatchObject({ outcome: 'upstream', detail: 'too_small' })

    const capped = setup({ AI_AVATAR_PORTRAIT_USER_DAILY_LIMIT: '1' })
    expect((await capped.portrait()).status).toBe(200)
    const over = await capped.portrait()
    expect(over.status).toBe(429)
    expect(await over.json()).toMatchObject({ error: 'rate_limited', scope: 'daily' })
  })

  test('the 목업 draws a portrait and calls nothing', async () => {
    const api = setup({ AI_AVATAR_MOCK: 'true', AI_PHOTO_PROVIDER: '', AI_AVATAR_CLIENT_ID: '' })
    expect(await api.status()).toMatchObject({ available: true, mock: true })
    const portrait = await api.signed('user-1', { skinTone: 'deep' })
    expect(sniffImage(portrait.bytes)).toEqual({ type: 'image/png', width: 1024, height: 1024 })
    expect(api.calls).toHaveLength(0)
    expect(
      verifyPortrait(portrait.token, portrait.bytes, 'user-1', {
        env: { AI_AVATAR_SECRET: REAL_ENV.AI_AVATAR_SECRET },
        now: Date.UTC(2026, 9, 12, 3),
      }),
    ).toMatchObject({ ok: true, claim: { mock: true } })
  })

  test('the 목업 is off in production', async () => {
    const api = setup({
      AI_AVATAR_MOCK: 'true',
      NODE_ENV: 'production',
      AI_PHOTO_PROVIDER: '',
    })
    expect(await api.status()).toMatchObject({ available: false, reason: 'not_configured' })
  })
})

describe('POST avatar and the job', () => {
  test('a signed portrait becomes a saved, trimmed, listed avatar; the service keeps no copy', async () => {
    const api = setup()
    const portrait = await api.signed('user-1', { sex: 'male', outfit: 'suit' })
    const started = await api.start(portrait)
    expect(started.status).toBe(202)
    expect(started.headers.get(PHOTOREAL_AI_REMAINING_HEADER)).toBe('1')
    const job = (await started.json()) as AvatarJobView
    expect(job).toMatchObject({ state: 'working', stage: 'queued', mock: false })
    expect(JSON.stringify(job)).not.toContain('avatarsdk')

    const views = await api.finish(job.job)
    expect(views.map((view) => view.stage)).toContain('computing')
    const done = views.at(-1)!
    expect(done).toMatchObject({ state: 'done', stage: 'done', progress: 100 })
    expect(done.avatar).toMatchObject({
      name: 'AI 인물 1',
      gender: 'male',
      ai: true,
      credit: 'AI 생성 인물 · Avatar SDK MetaPerson',
    })
    expect(api.fake.avatars.size).toBe(0)

    const [listed] = await api.list()
    expect(listed).toEqual(done.avatar!)
    const model = await api.file(listed!.id, 'model.glb')
    expect(model.status).toBe(200)
    expect(model.headers.get('content-type')).toBe('model/gltf-binary')
    const read = readGlb(new Uint8Array(await model.arrayBuffer()))
    expect(read.ok && read.json.meshes?.[0]?.extras?.targetNames).toEqual([
      'eyeBlinkLeft',
      'eyeBlinkRight',
    ])
    const photo = await api.file(listed!.id, 'portrait')
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(portrait.bytes)
    expect(listed!.url).toBe(`/api/photoreal-ai/avatars/${listed!.id}/model.glb`)

    // Asking again changes nothing; another user can't see or delete it.
    expect(((await (await api.poll(job.job)).json()) as AvatarJobView).state).toBe('done')
    expect((await api.poll(job.job, 'user-2')).status).toBe(404)
    expect(await api.list('user-2')).toEqual([])
    expect((await api.remove(listed!.id, 'user-2')).status).toBe(404)
    expect((await api.remove(listed!.id)).status).toBe(200)
    expect(await api.list()).toEqual([])
    expect((await api.file(listed!.id, 'model.glb')).status).toBe(404)

    const events = api.logs.filter((log) => log.step === 'avatar').map((log) => log.outcome)
    expect(events).toEqual(['ok', 'ok'])
  })

  test('takes only this server’s portrait, for this user, unchanged, in time, once', async () => {
    const api = setup()
    const portrait = await api.signed()
    const forged = await api.start({
      bytes: jpeg(1024, 1024, { pad: 99_999 }),
      token: portrait.token,
    })
    expect(forged.status).toBe(403)
    expect(await forged.json()).toEqual({ error: 'portrait_invalid' })
    expect((await api.start(portrait, 'user-2')).status).toBe(403)
    expect((await api.start({ ...portrait, token: 'x.1.y' })).status).toBe(403)
    expect((await api.start({ bytes: png(64, 64), token: portrait.token })).status).toBe(422)

    api.advance(31 * 60_000)
    const late = await api.start(portrait)
    expect(late.status).toBe(410)
    expect(await late.json()).toEqual({ error: 'portrait_expired' })

    const fresh = await api.signed()
    expect((await api.start(fresh)).status).toBe(202)
    const again = await api.start(fresh)
    expect([409, 429]).toContain(again.status)
    expect(api.fake.calls.filter((call) => call.path === '/avatars/')).toHaveLength(1)
  })

  test('one build at a time, two a day', async () => {
    const api = setup()
    const first = await api.signed()
    const second = await api.signed()
    const third = await api.signed()
    const one = (await (await api.start(first)).json()) as AvatarJobView
    const busy = await api.start(second)
    expect(busy.status).toBe(429)
    expect(await busy.json()).toEqual({ error: 'busy' })
    await api.finish(one.job)
    api.advance(11 * 60_000)
    const two = (await (await api.start(second)).json()) as AvatarJobView
    await api.finish(two.job)
    api.advance(11 * 60_000)
    const over = await api.start(third)
    expect(over.status).toBe(429)
    expect(await over.json()).toMatchObject({ error: 'rate_limited', scope: 'daily' })
    expect((await api.list()).map((avatar) => avatar.name)).toEqual(['AI 인물 1', 'AI 인물 2'])
  })

  test('a 목업 portrait is not taken by the real service, nor a real one by the 목업', async () => {
    const mock = setup({ AI_AVATAR_MOCK: 'true' })
    const drawn = await mock.signed()
    const real = setup()
    // Same signing secret: only the claim's 목업 mark tells them apart.
    expect((await real.start(drawn)).status).toBe(403)
    const photo = await real.signed()
    expect((await mock.start(photo)).status).toBe(403)
  })

  test('the service refusing to start gives the build and the portrait back', async () => {
    const api = setup(
      {},
      {
        service: {
          override: ({ method, path }) =>
            method === 'POST' && path === '/avatars/'
              ? new Response('{}', { status: 402 })
              : undefined,
        },
      },
    )
    const portrait = await api.signed()
    const refused = await api.start(portrait)
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ error: 'unavailable' })
    expect(await api.status()).toMatchObject({ avatarsLeft: 2 })
    expect(api.logs.at(-1)).toMatchObject({ step: 'avatar', event: 'failed', detail: 'http_402' })
    // Nothing stored for it.
    expect(await api.list()).toEqual([])
  })

  test('a build the service fails ends the job, refunded, with its copy deleted', async () => {
    const api = setup({}, { service: { outcome: 'failed' } })
    const job = (await (await api.start(await api.signed())).json()) as AvatarJobView
    const last = (await api.finish(job.job)).at(-1)!
    expect(last).toMatchObject({ state: 'failed', stage: 'failed', error: 'avatar_failed' })
    expect(api.fake.avatars.size).toBe(0)
    expect(await api.status()).toMatchObject({ avatarsLeft: 2 })
    expect(await api.list()).toEqual([])
  })

  test('a child per the service is never kept, and not refunded', async () => {
    const api = setup({}, { service: { age: 'child' } })
    const job = (await (await api.start(await api.signed())).json()) as AvatarJobView
    expect((await api.finish(job.job)).at(-1)).toMatchObject({ state: 'failed', error: 'blocked' })
    expect(await api.list()).toEqual([])
    expect(await api.status()).toMatchObject({ avatarsLeft: 1 })
  })

  test('a build past its deadline times out', async () => {
    const api = setup(
      {},
      {
        service: {
          override: ({ method, path }) =>
            method === 'GET' && /^\/avatars\/[^/]+\/$/.test(path)
              ? Response.json({ status: 'Queued', progress: 0 })
              : undefined,
        },
      },
    )
    const job = (await (await api.start(await api.signed())).json()) as AvatarJobView
    const last = (await api.finish(job.job, 'user-1', 60_000)).at(-1)!
    expect(last).toMatchObject({ state: 'failed', error: 'timeout' })
  })

  test('the service being briefly down is ridden out', async () => {
    let failures = 4
    const api = setup(
      {},
      {
        service: {
          override: ({ method, path }) =>
            method === 'GET' && /^\/avatars\/[^/]+\/$/.test(path) && failures-- > 0
              ? new Response('', { status: 503 })
              : undefined,
        },
      },
    )
    const job = (await (await api.start(await api.signed())).json()) as AvatarJobView
    expect((await api.finish(job.job)).at(-1)).toMatchObject({ state: 'done' })
  })

  test('the 목업 runs the whole flow with no external call', async () => {
    const api = setup({ AI_AVATAR_MOCK: 'true', AI_PHOTO_PROVIDER: '', AI_AVATAR_CLIENT_ID: '' })
    const job = (await (
      await api.start(await api.signed('user-1', { sex: 'female' }))
    ).json()) as AvatarJobView
    expect(job.mock).toBe(true)
    const done = (await api.finish(job.job)).at(-1)!
    expect(done).toMatchObject({ state: 'done', avatar: { credit: 'AI 생성 인물 · 목업' } })
    expect(api.calls).toHaveLength(0)
    const model = await api.file(done.avatar!.id, 'model.glb')
    // The shipped character is meshopt-compressed, so it is stored as it is.
    expect(new Uint8Array(await model.arrayBuffer())).toEqual(
      new Uint8Array(readFileSync(SHIPPED_GLB)),
    )
  })

  test('the files and listing stay when making new avatars is switched off', async () => {
    const api = setup()
    const job = (await (await api.start(await api.signed())).json()) as AvatarJobView
    const done = (await api.finish(job.job)).at(-1)!
    const off = createPhotorealAiHandlers({
      env: { AI_AVATAR_ENABLED: 'false', AI_AVATAR_STORE_DIR: api.root },
      cwd: APP,
      userId: async () => 'user-1',
    })
    const id = done.avatar!.id
    const listed = await off.route('GET', ['avatars'], new Request('http://localhost/x'))
    expect(((await listed.json()) as PhotorealAiAvatarList).avatars).toHaveLength(1)
    expect(
      (await off.route('GET', ['avatars', id, 'model.glb'], new Request('http://localhost/x')))
        .status,
    ).toBe(200)
    expect((await off.route('GET', [], new Request('http://localhost/x'))).status).toBe(200)
    expect(
      (await off.route('POST', ['portrait'], new Request('http://localhost/x', { method: 'POST' })))
        .status,
    ).toBe(503)
  })

  test('unknown paths and methods are 404', async () => {
    const api = setup()
    const handlers = createPhotorealAiHandlers({ env: REAL_ENV, userId: async () => 'u' })
    for (const [method, path] of [
      ['GET', ['portrait']],
      ['PUT', ['avatar']],
      ['GET', ['avatars', 'a', 'b', 'c']],
      ['GET', ['nope']],
    ] as const) {
      const response = await handlers.route(method, path, new Request('http://localhost/x'))
      expect(response.status).toBe(404)
    }
    expect((await api.poll('not-a-job')).status).toBe(404)
    expect((await api.file('bad-id', 'model.glb')).status).toBe(404)
    expect((await api.file(`${'a'.repeat(16)}-${'b'.repeat(24)}`, 'secrets.txt')).status).toBe(404)
  })
})
