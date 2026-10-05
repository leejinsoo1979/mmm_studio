import { describe, expect, test } from 'bun:test'
import {
  AI_PHOTO_ERROR_TEXT,
  AI_PHOTO_STATUS_TTL_MS,
  type AiPhotoRequest,
  aiPhotoErrorText,
  createAiPhotoClient,
  decodeDataUrl,
  facePhotoBlob,
} from './client'
import { base64Of, jpeg, webp } from './test-images'

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
const image = (type = 'image/jpeg') => new Blob([jpeg(1024, 1024)], { type })
const photo = (overrides: Partial<AiPhotoRequest> = {}): AiPhotoRequest => ({
  render: image(),
  consent: false,
  avatarId: 'Female_Adult_03',
  framing: 'face',
  ...overrides,
})
const AVAILABLE = {
  available: true,
  signInRequired: true,
  signedIn: true,
  remainingToday: 10,
  maxImageBytes: 2097152,
  faceAllowed: true,
  childAllowed: true,
}

describe('status', () => {
  test('is asked once a minute, with the user’s token, unless fresh', async () => {
    let clock = 1_000
    const { calls, fetch } = fakeFetch(() => Response.json({ ...AVAILABLE, extra: 'x' }))
    const client = createAiPhotoClient({ fetch, headers, now: () => clock })
    expect(await client.status()).toEqual(AVAILABLE)
    clock += AI_PHOTO_STATUS_TTL_MS - 1
    await client.status()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('/api/ai-photo')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer id-token')
    await client.status({ fresh: true })
    expect(calls).toHaveLength(2)
    clock += AI_PHOTO_STATUS_TTL_MS
    await client.status()
    expect(calls).toHaveLength(3)
  })

  test('face and child permissions default to no', async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({ ...AVAILABLE, faceAllowed: 'yes', childAllowed: undefined }),
    )
    expect(await createAiPhotoClient({ fetch, headers }).status()).toMatchObject({
      faceAllowed: false,
      childAllowed: false,
    })
  })

  test('unavailable reasons are kept; a failure reads as network and is asked again', async () => {
    let fail = true
    const { calls, fetch } = fakeFetch(() =>
      fail
        ? Promise.reject(new TypeError('offline'))
        : Response.json({ available: false, reason: 'disabled' }),
    )
    const client = createAiPhotoClient({ fetch, headers, now: () => 0 })
    expect(await client.status()).toEqual({ available: false, reason: 'network' })
    fail = false
    expect(await client.status()).toEqual({ available: false, reason: 'disabled' })
    expect(calls).toHaveLength(2)
    const unmoderated = fakeFetch(() =>
      Response.json({ available: false, reason: 'moderation_required' }),
    )
    expect(await createAiPhotoClient({ fetch: unmoderated.fetch, headers }).status()).toEqual({
      available: false,
      reason: 'moderation_required',
    })
  })
})

describe('create', () => {
  test('sends the render, face and options as multipart, and returns the image', async () => {
    const returned = jpeg(1024, 1024)
    const { calls, fetch } = fakeFetch(
      () =>
        new Response(returned, {
          headers: { 'content-type': 'image/jpeg', 'x-ai-photo-remaining': '7' },
        }),
    )
    const client = createAiPhotoClient({ fetch, headers, now: () => 0 })
    const face = new Blob([webp(512, 512)], { type: 'image/webp' })
    const result = await client.create(
      photo({
        face,
        consent: true,
        hints: { hair: '#ABCDEF', skin: 'tan', eyes: null, lips: '#aa0000' },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.remainingToday).toBe(7)
    expect(result.image.type).toBe('image/jpeg')
    expect(new Uint8Array(await result.image.arrayBuffer())).toEqual(returned)

    const { url, init } = calls[0]!
    expect(url).toBe('/api/ai-photo')
    expect(init.method).toBe('POST')
    // The browser writes the multipart content type itself.
    expect(init.headers).toEqual({ authorization: 'Bearer id-token' })
    const form = init.body as FormData
    expect([...form.keys()]).toEqual(['options', 'render', 'face'])
    expect(JSON.parse(String(form.get('options')))).toEqual({
      avatarId: 'Female_Adult_03',
      framing: 'face',
      style: 'realistic',
      consent: true,
      hints: { hair: '#abcdef', lips: '#aa0000' },
    })
    expect((form.get('render') as File).name).toBe('render.jpg')
    expect((form.get('face') as File).name).toBe('face.webp')
  })

  test('a child’s lip colour is not sent; no hints, no field', async () => {
    const { calls, fetch } = fakeFetch(
      () => new Response(jpeg(8, 8), { headers: { 'content-type': 'image/jpeg' } }),
    )
    const client = createAiPhotoClient({ fetch, headers })
    await client.create(photo({ avatarId: 'Male_Child_01', hints: { lips: '#aa0000' } }))
    expect(JSON.parse(String((calls[0]!.init.body as FormData).get('options')))).toEqual({
      avatarId: 'Male_Child_01',
      framing: 'face',
      style: 'realistic',
      consent: false,
    })
  })

  test('refuses locally what the server would refuse', async () => {
    const { calls, fetch } = fakeFetch(() => Response.json({}))
    const client = createAiPhotoClient({ fetch, headers })
    expect(await client.create(photo({ face: image() }))).toEqual({
      ok: false,
      code: 'consent_required',
    })
    for (const avatarId of ['Female_Child_01', 'Female_Party_02']) {
      expect(await client.create(photo({ avatarId, face: image(), consent: true }))).toEqual({
        ok: false,
        code: 'face_not_allowed',
      })
    }
    expect(await client.create(photo({ avatarId: 'Someone_Famous' }))).toEqual({
      ok: false,
      code: 'invalid_request',
    })
    const huge = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' })
    expect(await client.create(photo({ render: huge }))).toEqual({ ok: false, code: 'too_large' })
    expect(calls).toHaveLength(0)
  })

  test('route errors keep their code, retry time and scope', async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({ error: 'rate_limited', retryAfter: 3600, scope: 'daily' }, { status: 429 }),
    )
    const result = await createAiPhotoClient({ fetch, headers }).create(photo())
    expect(result).toEqual({ ok: false, code: 'rate_limited', retryAfter: 3600, scope: 'daily' })
    if (!result.ok) expect(aiPhotoErrorText(result)).toContain('내일')
    expect(aiPhotoErrorText({ ok: false, code: 'rate_limited', scope: 'burst' })).toBe(
      AI_PHOTO_ERROR_TEXT.rate_limited,
    )
  })

  test('the API guard’s refusals and bare statuses map to our codes', async () => {
    const cases: [Response, string][] = [
      [Response.json({ error: 'origin_not_allowed' }, { status: 403 }), 'unavailable'],
      [Response.json({ error: 'unauthorized' }, { status: 401 }), 'unavailable'],
      [Response.json({ error: 'blocked' }, { status: 422 }), 'blocked'],
      [Response.json({ error: 'child_not_allowed' }, { status: 403 }), 'child_not_allowed'],
      [new Response('gateway', { status: 504 }), 'timeout'],
      [new Response('', { status: 413 }), 'too_large'],
      [new Response('', { status: 500 }), 'upstream'],
    ]
    for (const [response, code] of cases) {
      const { fetch } = fakeFetch(() => response)
      expect(await createAiPhotoClient({ fetch, headers }).create(photo())).toEqual({
        ok: false,
        code: code as never,
      })
    }
    const { fetch } = fakeFetch(
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '9' } }),
    )
    expect(await createAiPhotoClient({ fetch, headers }).create(photo())).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfter: 9,
    })
  })

  test('a 503 or a new photo makes the next status ask again', async () => {
    let answer: Response = Response.json(AVAILABLE)
    const { calls, fetch } = fakeFetch(() => answer)
    const client = createAiPhotoClient({ fetch, headers, now: () => 0 })
    await client.status()
    answer = Response.json({ error: 'unavailable', reason: 'disabled' }, { status: 503 })
    expect(await client.create(photo())).toEqual({ ok: false, code: 'unavailable' })
    answer = Response.json({ available: false, reason: 'disabled' })
    expect(await client.status()).toEqual({ available: false, reason: 'disabled' })
    expect(calls).toHaveLength(3)

    answer = new Response(jpeg(8, 8), { headers: { 'content-type': 'image/jpeg' } })
    await client.create(photo())
    answer = Response.json(AVAILABLE)
    await client.status()
    expect(calls).toHaveLength(5)
  })

  test('network failure, cancel, and a success that is not an image', async () => {
    const offline = fakeFetch(() => Promise.reject(new TypeError('offline')))
    expect(await createAiPhotoClient({ fetch: offline.fetch, headers }).create(photo())).toEqual({
      ok: false,
      code: 'network',
    })
    const controller = new AbortController()
    const cancelled = fakeFetch(() => {
      controller.abort()
      return Promise.reject(new DOMException('aborted', 'AbortError'))
    })
    expect(
      await createAiPhotoClient({ fetch: cancelled.fetch, headers }).create(
        photo({ signal: controller.signal }),
      ),
    ).toEqual({ ok: false, code: 'aborted' })
    const html = fakeFetch(
      () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    )
    expect(await createAiPhotoClient({ fetch: html.fetch, headers }).create(photo())).toEqual({
      ok: false,
      code: 'upstream',
    })
  })
})

describe('face photo', () => {
  test('decodeDataUrl', () => {
    const bytes = jpeg(16, 16)
    expect(decodeDataUrl(`data:image/jpeg;base64,${base64Of(bytes)}`)).toEqual({
      type: 'image/jpeg',
      bytes,
    })
    expect(decodeDataUrl('data:image/jpeg,raw')).toBeNull()
    expect(decodeDataUrl('https://example.com/face.jpg')).toBeNull()
    expect(decodeDataUrl('data:image/jpeg;base64,***')).toBeNull()
  })

  test('a JPEG or WebP within the limits goes as it is', async () => {
    const bytes = webp(768, 768)
    const blob = await facePhotoBlob(`data:image/webp;base64,${base64Of(bytes)}`)
    expect(blob?.type).toBe('image/webp')
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(bytes)
  })

  test('unreadable data is nothing', async () => {
    expect(await facePhotoBlob('data:image/jpeg;base64,aGVsbG8=')).toBeNull()
    expect(await facePhotoBlob('nope')).toBeNull()
  })
})
