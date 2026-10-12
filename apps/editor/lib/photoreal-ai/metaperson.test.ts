import { describe, expect, test } from 'bun:test'
import { jpeg } from '../ai-photo/test-images'
import type { AvatarServiceConfig } from './config'
import {
  buildExportParameters,
  createMetaPersonService,
  exportGlb,
  httpFailure,
  parseAvailableExportParameters,
} from './metaperson'
import { createMetaPersonFake, FAKE_OUTFITS, type FakeCall } from './metaperson-fake'
import type { AvatarLook, ServiceRef } from './service'
import { testAvatarGlb } from './test-glb'
import { writeZip } from './zip'

const CONFIG: AvatarServiceConfig = {
  kind: 'metaperson',
  baseUrl: 'https://api.avatarsdk.com',
  clientId: 'client-id-123',
  clientSecret: 'client-secret-456',
  playerUid: null,
}
const LOOK: AvatarLook = {
  sex: 'female',
  hairStyle: 'shoulder',
  hairColour: 'black',
  outfit: 'knit',
}
const PHOTO = { bytes: jpeg(1024, 1024), type: 'image/jpeg' as const }
const GLB = testAvatarGlb()
const signal = () => new AbortController().signal

type Seen = { url: string; init: RequestInit }

function setup(
  options: {
    override?: (call: FakeCall) => Response | undefined | Promise<Response | undefined>
    outcome?: 'completed' | 'failed'
    age?: 'child' | 'not_child'
    zip?: boolean
    tokenTtlS?: number
    players?: { load: () => Promise<string | null>; save: (code: string) => Promise<void> }
  } = {},
) {
  let t = 1_000_000
  const now = () => t
  const fake = createMetaPersonFake({
    glb: () => GLB,
    now,
    clientId: CONFIG.clientId,
    clientSecret: CONFIG.clientSecret,
    buildMs: 10_000,
    exportMs: 2000,
    ...options,
  })
  const seen: Seen[] = []
  const service = createMetaPersonService({
    config: CONFIG,
    fetch: async (url, init) => {
      seen.push({ url, init })
      return fake.fetch(url, init)
    },
    now,
    sleep: async () => {},
    players: options.players,
  })
  return {
    service,
    fake,
    seen,
    advance: (ms: number) => {
      t += ms
    },
  }
}

const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

describe('the MetaPerson adapter against the protocol fake', () => {
  test('creates, polls, downloads and deletes, sending the secret only to the token endpoint', async () => {
    const { service, fake, seen, advance } = setup()
    const created = await service.create({ photo: PHOTO, look: LOOK, name: 'ai-person' }, signal())
    if (!created.ok) throw new Error(created.detail)
    expect(created.ref.avatar).toBeTruthy()
    expect(created.ref.player).toBeTruthy()

    const paths = fake.calls.map((call) => `${call.method} ${call.path} ${call.status}`)
    expect(paths).toEqual([
      'POST /o/token/ 200',
      'POST /players/ 201',
      'GET /export_parameters/available/metaperson_2.1/ 200',
      'POST /avatars/ 201',
    ])
    const token = seen[0]!
    expect(new URLSearchParams(String(token.init.body)).get('client_secret')).toBe(
      CONFIG.clientSecret,
    )
    for (const call of seen.slice(1)) {
      expect(header(call.init, 'authorization')).toMatch(/^Bearer [0-9a-f]+$/)
      expect(JSON.stringify([call.url, call.init.headers])).not.toContain(CONFIG.clientSecret)
    }
    expect(header(seen[3]!.init, 'x-playeruid')).toBe(created.ref.player!)
    const form = seen[3]!.init.body as FormData
    expect(form.get('pipeline')).toBe('metaperson_2.1')
    expect(form.get('pipeline_subtype')).toBe('female')
    expect(JSON.parse(String(form.get('parameters')))).toEqual({
      avatar_modifications: { remove_smile: true },
    })
    const exported = JSON.parse(String(form.get('export_parameters')))
    expect(exported).toMatchObject({
      format: 'glb',
      textures: { embed: true, profile: '1K.jpg' },
      haircuts: { list: ['HaircutGenerated'] },
      outfits: { list: ['fake_knit_sweater'] },
      blendshapes: { list: ['mobile_51'] },
    })
    expect((form.get('photo') as File).name).toBe('photo.jpg')

    const stages: string[] = []
    let ref: ServiceRef = created.ref
    for (const ms of [0, 1000, 5000, 5000, 500, 1500]) {
      advance(ms)
      const poll = await service.poll(ref, signal())
      if (!poll.ok) throw new Error(poll.detail)
      stages.push(poll.state === 'working' ? `${poll.stage}:${poll.progress}` : 'ready')
      ref = poll.ref
    }
    expect(stages).toEqual([
      'uploading:0',
      'queued:0',
      'computing:60',
      'exporting:100',
      'exporting:100',
      'ready',
    ])
    expect(ref.file).toContain('/files/avatar/file/')

    const download = await service.download(ref, signal())
    if (!download.ok) throw new Error(download.detail)
    expect(download.glb).toEqual(GLB)
    expect(await service.remove(ref, signal())).toBe(true)
    expect(fake.avatars.size).toBe(0)
    // One token for the whole build.
    expect(fake.calls.filter((call) => call.path === '/o/token/')).toHaveLength(1)
  })

  test('a GLB served as is (not zipped) is taken too', async () => {
    const { service, advance } = setup({ zip: false })
    const created = await service.create({ photo: PHOTO, look: LOOK, name: 'a' }, signal())
    if (!created.ok) throw new Error(created.detail)
    advance(20_000)
    const poll = await service.poll(created.ref, signal())
    if (!poll.ok || poll.state !== 'ready') throw new Error('not ready')
    const download = await service.download(poll.ref, signal())
    expect(download.ok && download.glb).toEqual(GLB)
  })

  test('falls back to HTTP Basic when the token form is refused, and keeps the style', async () => {
    const { service, seen } = setup({
      override: ({ path, init }) =>
        path === '/o/token/' && String(init.body).includes('client_id')
          ? Response.json({ error: 'invalid_client' }, { status: 401 })
          : undefined,
    })
    const status = await service.pipelineAvailable('male', signal())
    expect(status).toBe(200)
    const tokenCalls = seen.filter((call) => call.url.endsWith('/o/token/'))
    expect(tokenCalls).toHaveLength(2)
    expect(header(tokenCalls[1]!.init, 'authorization')).toBe(
      `Basic ${Buffer.from(`${CONFIG.clientId}:${CONFIG.clientSecret}`).toString('base64')}`,
    )
  })

  test('wrong credentials are the owner’s problem', async () => {
    const fake = createMetaPersonFake({ glb: () => GLB })
    const service = createMetaPersonService({
      config: { ...CONFIG, clientSecret: 'wrong' },
      fetch: fake.fetch,
      sleep: async () => {},
    })
    const created = await service.create({ photo: PHOTO, look: LOOK, name: 'a' }, signal())
    expect(created).toEqual({ ok: false, code: 'unavailable', detail: 'token_http_401' })
  })

  test('an expired token is replaced once, then the call is retried', async () => {
    let refused = 1
    const { service, fake } = setup({
      override: ({ path }) =>
        path === '/players/' && refused-- > 0
          ? Response.json({ detail: 'Token expired.' }, { status: 401 })
          : undefined,
    })
    expect(await service.pipelineAvailable('female', signal())).toBe(200)
    expect(fake.calls.filter((call) => call.path === '/o/token/')).toHaveLength(2)
  })

  test('a token past its lifetime is fetched again', async () => {
    const { service, fake, advance } = setup({ tokenTtlS: 120 })
    await service.pipelineAvailable('female', signal())
    advance(61_000)
    await service.pipelineAvailable('female', signal())
    expect(fake.calls.filter((call) => call.path === '/o/token/')).toHaveLength(2)
  })

  test('maps refusals: plan, rate limit with Retry-After, server errors, network', async () => {
    const answer = (response: () => Response) =>
      setup({
        override: ({ method, path }) =>
          method === 'POST' && path === '/avatars/' ? response() : undefined,
      })
    const create = (s: ReturnType<typeof setup>) =>
      s.service.create({ photo: PHOTO, look: LOOK, name: 'a' }, signal())

    expect(await create(answer(() => new Response('{}', { status: 402 })))).toMatchObject({
      ok: false,
      code: 'unavailable',
      detail: 'http_402',
    })
    expect(
      await create(
        answer(() => new Response('{}', { status: 429, headers: { 'retry-after': '12' } })),
      ),
    ).toEqual({ ok: false, code: 'rate_limited', detail: 'http_429', retryAfter: 12 })
    const busy = answer(() => new Response('{}', { status: 503 }))
    expect(await create(busy)).toMatchObject({ ok: false, code: 'upstream', detail: 'http_503' })
    // A create is never repeated: it could build (and bill) twice.
    expect(busy.fake.calls.filter((call) => call.path === '/avatars/')).toHaveLength(1)
    const bad = answer(() => Response.json({ photo: ['Unsupported image.'] }, { status: 400 }))
    expect(await create(bad)).toMatchObject({ ok: false, code: 'rejected' })
    const offline = answer(() => {
      throw new TypeError('offline')
    })
    expect(await create(offline)).toMatchObject({ ok: false, code: 'upstream', detail: 'network' })
  })

  test('status asks are retried on 5xx, up to three attempts', async () => {
    let failures = 2
    const flaky = setup({
      override: ({ method, path }) =>
        method === 'GET' && /^\/avatars\/[^/]+\/$/.test(path) && failures-- > 0
          ? new Response('', { status: 502 })
          : undefined,
    })
    const created = await flaky.service.create({ photo: PHOTO, look: LOOK, name: 'a' }, signal())
    if (!created.ok) throw new Error(created.detail)
    expect((await flaky.service.poll(created.ref, signal())).ok).toBe(true)

    const down = setup({
      override: ({ method, path }) =>
        method === 'GET' && /^\/avatars\/[^/]+\/$/.test(path)
          ? new Response('', { status: 500 })
          : undefined,
    })
    const again = await down.service.create({ photo: PHOTO, look: LOOK, name: 'a' }, signal())
    if (!again.ok) throw new Error(again.detail)
    expect(await down.service.poll(again.ref, signal())).toEqual({
      ok: false,
      code: 'upstream',
      detail: 'http_500',
    })
    expect(down.fake.calls.filter((call) => call.status === 500)).toHaveLength(3)
  })

  test('a failed build, a child, a deleted avatar', async () => {
    const failed = setup({ outcome: 'failed' })
    const one = await failed.service.create({ photo: PHOTO, look: LOOK, name: 'a' }, signal())
    if (!one.ok) throw new Error(one.detail)
    failed.advance(20_000)
    expect(await failed.service.poll(one.ref, signal())).toEqual({
      ok: false,
      code: 'failed',
      detail: 'failed_7',
    })

    const child = setup({ age: 'child' })
    const two = await child.service.create({ photo: PHOTO, look: LOOK, name: 'a' }, signal())
    if (!two.ok) throw new Error(two.detail)
    child.advance(20_000)
    expect(await child.service.poll(two.ref, signal())).toEqual({
      ok: false,
      code: 'blocked',
      detail: 'model_info_child',
    })

    expect(await child.service.remove(two.ref, signal())).toBe(true)
    expect(await child.service.poll(two.ref, signal())).toMatchObject({ ok: false, code: 'gone' })
    expect(await child.service.remove(two.ref, signal())).toBe(true)
  })

  test('never follows a URL off the service with the token; a redirect elsewhere goes without it', async () => {
    const foreign = setup({
      override: ({ method, path }) =>
        method === 'POST' && path === '/avatars/'
          ? Response.json(
              { code: 'x', url: 'https://evil.example.com/avatars/x/' },
              { status: 201 },
            )
          : undefined,
    })
    expect(
      await foreign.service.create({ photo: PHOTO, look: LOOK, name: 'a' }, signal()),
    ).toMatchObject({ ok: false, code: 'upstream', detail: 'foreign_url' })

    const fake = createMetaPersonFake({
      glb: () => GLB,
      clientId: CONFIG.clientId,
      clientSecret: CONFIG.clientSecret,
      buildMs: 0,
      exportMs: 0,
      override: ({ path }) =>
        path.endsWith('/files/avatar/file/')
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://storage.example.com/model.zip?sig=1' },
            })
          : undefined,
    })
    let storage: RequestInit | null = null
    const service = createMetaPersonService({
      config: CONFIG,
      fetch: async (url, init) => {
        if (!url.startsWith('https://storage.example.com/')) return fake.fetch(url, init)
        storage = init
        return new Response(writeZip([{ name: 'avatar/model.glb', bytes: GLB }]))
      },
      sleep: async () => {},
    })
    const created = await service.create({ photo: PHOTO, look: LOOK, name: 'a' }, signal())
    if (!created.ok) throw new Error(created.detail)
    const poll = await service.poll(created.ref, signal())
    if (!poll.ok || poll.state !== 'ready') throw new Error('not ready')
    const download = await service.download(poll.ref, signal())
    expect(download.ok && download.glb).toEqual(GLB)
    expect(storage).not.toBeNull()
    expect(header(storage!, 'authorization')).toBeNull()
    expect(header(storage!, 'x-playeruid')).toBeNull()
  })

  test('keeps the registered player in the store and reuses it', async () => {
    const saved: string[] = []
    const first = setup({
      players: { load: async () => null, save: async (code) => void saved.push(code) },
    })
    await first.service.pipelineAvailable('female', signal())
    expect(saved).toHaveLength(1)
    const second = setup({ players: { load: async () => 'stored-player', save: async () => {} } })
    expect(await second.service.pipelineAvailable('female', signal())).toBe(400)
    expect(second.fake.calls.some((call) => call.path === '/players/')).toBe(false)
  })

  test('an aborted request is reported, not retried', async () => {
    const { service } = setup()
    const controller = new AbortController()
    controller.abort()
    expect(
      await service.create({ photo: PHOTO, look: LOOK, name: 'a' }, controller.signal),
    ).toMatchObject({ ok: false, code: 'upstream' })
  })
})

describe('export parameters', () => {
  const available = parseAvailableExportParameters({
    haircuts: { list: ['HaircutGenerated', 'short_01'], textures: ['Color'] },
    outfits: ['casual_tshirt_01', 'business_suit_02', 'sport_track_01'],
    blendshapes: { list: ['mobile_51', 'visemes_15'] },
    glasses: ['glasses_01'],
    animations: 'not a list',
  })

  test('reads both list shapes', () => {
    expect(available).toEqual({
      haircuts: ['HaircutGenerated', 'short_01'],
      outfits: ['casual_tshirt_01', 'business_suit_02', 'sport_track_01'],
      blendshapes: ['mobile_51', 'visemes_15'],
      glasses: ['glasses_01'],
    })
  })

  test('picks the outfit by its words, the generated haircut, no glasses', () => {
    const suit = buildExportParameters(available, { ...LOOK, outfit: 'suit' })!
    expect(suit.outfits).toEqual({
      list: ['business_suit_02'],
      embed: true,
      textures: { embed: true, list: ['Color', 'Normal', 'GltfMetallicRoughness'] },
    })
    expect(suit.haircuts).toMatchObject({ list: ['HaircutGenerated'] })
    expect(suit).not.toHaveProperty('glasses')
    expect(buildExportParameters(available, { ...LOOK, outfit: 'sport' })!.outfits).toMatchObject({
      list: ['sport_track_01'],
    })
    // No word matches: the first outfit, never none.
    expect(
      buildExportParameters(available, { ...LOOK, outfit: 'workwear' })!.outfits,
    ).toMatchObject({ list: ['casual_tshirt_01'] })
    expect(buildExportParameters(available, { ...LOOK, hairStyle: 'shaved' })).not.toHaveProperty(
      'haircuts',
    )
  })

  test('falls back to top, bottoms and shoes, and refuses to export unclothed', () => {
    const parts = buildExportParameters(
      { outfits_top: ['knit_top'], outfits_bottom: ['jeans'], outfits_shoes: ['sneakers'] },
      LOOK,
    )!
    expect(parts.outfits_top).toMatchObject({ list: ['knit_top'] })
    expect(parts.outfits_bottom).toMatchObject({ list: ['jeans'] })
    expect(parts.outfits_shoes).toMatchObject({ list: ['sneakers'] })
    expect(buildExportParameters({ outfits_top: ['knit_top'] }, LOOK)).toBeNull()
    expect(buildExportParameters({ haircuts: ['HaircutGenerated'] }, LOOK)).toBeNull()
  })

  test('the fake lists outfits for both bodies', async () => {
    for (const sex of ['female', 'male'] as const) {
      const params = buildExportParameters(
        { outfits: [...FAKE_OUTFITS[sex]], haircuts: ['HaircutGenerated'] },
        { ...LOOK, sex },
      )
      expect(params?.outfits).toBeDefined()
    }
  })
})

describe('exportGlb', () => {
  test('a GLB, a ZIP holding one, or nothing', () => {
    expect(exportGlb(GLB)).toBe(GLB)
    const zipped = writeZip([
      { name: 'avatar/readme.txt', bytes: new TextEncoder().encode('hi') },
      { name: 'avatar/model.glb', bytes: GLB },
    ])
    expect(exportGlb(zipped)).toEqual(GLB)
    expect(exportGlb(writeZip([{ name: 'avatar/model.fbx', bytes: GLB }]))).toBeNull()
    expect(exportGlb(writeZip([{ name: 'model.glb', bytes: new Uint8Array([1, 2]) }]))).toBeNull()
    expect(exportGlb(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull()
  })
})

describe('httpFailure', () => {
  test('who must act on each status', () => {
    expect(httpFailure(401).code).toBe('unavailable')
    expect(httpFailure(402).code).toBe('unavailable')
    expect(httpFailure(403).code).toBe('unavailable')
    expect(httpFailure(404).code).toBe('gone')
    expect(httpFailure(400).code).toBe('rejected')
    expect(httpFailure(408).code).toBe('upstream')
    expect(httpFailure(504).code).toBe('upstream')
    expect(httpFailure(429)).toEqual({
      ok: false,
      code: 'rate_limited',
      detail: 'http_429',
      retryAfter: 30,
    })
  })
})
