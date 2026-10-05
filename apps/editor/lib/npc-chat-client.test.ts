import { describe, expect, test } from 'bun:test'
import { createNpcChatTransport, NPC_STATUS_TTL_MS } from './npc-chat-client'

type Call = { url: string; init: RequestInit }

/** A fetch that answers from `reply` and records what was asked. */
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

/** A response body that arrives in the given chunks (split anywhere, even inside a character). */
function streamOf(chunks: string[]) {
  const bytes = new TextEncoder().encode(chunks.join(''))
  const cuts = chunks.reduce<number[]>((list, chunk) => {
    const last = list.at(-1) ?? 0
    list.push(last + new TextEncoder().encode(chunk).length)
    return list
  }, [])
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let from = 0
      for (const cut of cuts) {
        // Split a multi-byte character across two chunks.
        const at = Math.max(from, cut - 1)
        controller.enqueue(bytes.slice(from, at))
        from = at
      }
      controller.enqueue(bytes.slice(from))
      controller.close()
    },
  })
}

const sse = (chunks: string[]) =>
  new Response(streamOf(chunks), { headers: { 'Content-Type': 'text/event-stream' } })

const request = (signal = new AbortController().signal) => ({
  npcId: 'npc_a',
  conversationId: '0b8f8a7e-36a4-4a35-9b8e-0f6c1e2f3a4b',
  messages: [{ role: 'user' as const, text: '거실은 몇 평이에요?' }],
  context: { roomId: 'zone_living' },
  playerName: undefined,
  signal,
})

describe('status', () => {
  test('is asked once a minute, with the visitor’s token', async () => {
    let clock = 1_000
    const { calls, fetch } = fakeFetch(() =>
      Response.json({ available: true, voice: 'server', model: 'x' }),
    )
    const transport = createNpcChatTransport('scene 1', { fetch, headers, now: () => clock })
    expect(await transport.status()).toEqual({ available: true, voice: 'server' })
    clock += NPC_STATUS_TTL_MS - 1
    await transport.status()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('/api/scenes/scene%201/npc-chat')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer id-token')
    clock += 1
    await transport.status()
    expect(calls).toHaveLength(2)
  })

  test('a failure reads as unavailable and is asked again next time', async () => {
    let fail = true
    const { calls, fetch } = fakeFetch(() =>
      fail ? Promise.reject(new TypeError('offline')) : Response.json({ available: false }),
    )
    const transport = createNpcChatTransport('s', { fetch, headers, now: () => 0 })
    expect(await transport.status()).toEqual({
      available: false,
      reason: 'network',
      voice: 'browser',
    })
    fail = false
    expect(await transport.status()).toEqual({ available: false, voice: 'browser' })
    expect(calls).toHaveLength(2)
  })
})

describe('send', () => {
  test('streams the reply and hands back its voice token', async () => {
    const { calls, fetch } = fakeFetch(() =>
      sse([
        'event: meta\ndata: {"npc":"지아"}\n\n',
        ': keep-alive\r\n\r\n',
        'event: delta\r\ndata: {"text":"안녕하세요, "}\r\n\r\n',
        'event: delta\ndata: {"text":"거실은 열두 평이에요."}\n\n',
        'event: done\ndata: {"stop":"end_turn","token":"t.123"}\n\n',
      ]),
    )
    const transport = createNpcChatTransport('s', { fetch, headers })
    let text = ''
    const result = await transport.send(request(), (delta) => {
      text += delta
    })
    expect(result).toEqual({ ok: true, token: 't.123' })
    expect(text).toBe('안녕하세요, 거실은 열두 평이에요.')

    const { url, init } = calls[0]!
    expect(url).toBe('/api/scenes/s/npc-chat')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      authorization: 'Bearer id-token',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      npcId: 'npc_a',
      conversationId: '0b8f8a7e-36a4-4a35-9b8e-0f6c1e2f3a4b',
      messages: [{ role: 'user', text: '거실은 몇 평이에요?' }],
      context: { roomId: 'zone_living' },
    })
  })

  test('an error event, a broken stream, refusals before streaming', async () => {
    const answers: (() => Response | Promise<Response>)[] = [
      () =>
        sse([
          'event: delta\ndata: {"text":"음"}\n\n',
          'event: error\ndata: {"code":"refusal"}\n\n',
        ]),
      () => sse(['event: delta\ndata: {"text":"음"}\n\n']),
      () => Response.json({ error: 'rate_limited', retryAfter: 30 }, { status: 429 }),
      () => Response.json({ error: 'ai_disabled' }, { status: 403 }),
      () => Response.json({ error: 'invalid_request' }, { status: 400 }),
      () => Promise.reject(new TypeError('offline')),
    ]
    const { fetch } = fakeFetch(() => answers.shift()!())
    const transport = createNpcChatTransport('s', { fetch, headers })
    const codes = []
    for (let i = 0; i < 6; i++) {
      const result = await transport.send(request(), () => {})
      codes.push(result.ok ? 'ok' : result.code)
    }
    expect(codes).toEqual([
      'refusal',
      'network',
      'rate_limited',
      'unavailable',
      'upstream',
      'network',
    ])
  })

  test('AI switched off on the server: the cached status is asked again', async () => {
    let available = true
    const { calls, fetch } = fakeFetch(({ init }) =>
      init.method === 'POST'
        ? Response.json({ error: 'ai_unavailable' }, { status: 503 })
        : Response.json({ available, voice: 'browser' }),
    )
    const transport = createNpcChatTransport('s', { fetch, headers, now: () => 0 })
    expect((await transport.status()).available).toBe(true)
    available = false
    expect(await transport.send(request(), () => {})).toEqual({ ok: false, code: 'unavailable' })
    expect((await transport.status()).available).toBe(false)
    expect(calls.filter((call) => call.init.method !== 'POST')).toHaveLength(2)
  })

  test('an abort ends the request as a network failure', async () => {
    const abort = new AbortController()
    const { fetch } = fakeFetch(({ init }) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"안"}\n\n'))
          init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
        },
      })
      return new Response(body)
    })
    const transport = createNpcChatTransport('s', { fetch, headers })
    const result = transport.send(request(abort.signal), () => abort.abort())
    expect(await result).toEqual({ ok: false, code: 'network' })
  })
})

describe('speak', () => {
  test('posts the line and its token, and returns the audio', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x00])
    const { calls, fetch } = fakeFetch(
      () => new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } }),
    )
    const transport = createNpcChatTransport('s', { fetch, headers })
    const signal = new AbortController().signal
    const clip = await transport.speak({
      npcId: 'npc_a',
      text: '안녕하세요!',
      token: 't.1',
      signal,
    })
    expect(new Uint8Array(clip!)).toEqual(audio)
    expect(calls[0]!.url).toBe('/api/scenes/s/npc-voice')
    expect(calls[0]!.init.signal).toBe(signal)
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      npcId: 'npc_a',
      text: '안녕하세요!',
      token: 't.1',
    })
  })

  test('a refusal is null; busy or a failed upstream may answer later', async () => {
    const statuses = [403, 503, 400, 429, 502]
    const { fetch } = fakeFetch(() =>
      Response.json({ error: 'x' }, { status: statuses.shift() ?? 500 }),
    )
    const transport = createNpcChatTransport('s', { fetch, headers })
    const speak = () =>
      transport.speak({ npcId: 'n', text: '네', signal: new AbortController().signal })
    expect(await speak()).toBeNull()
    expect(await speak()).toBeNull()
    expect(await speak()).toBeNull()
    await expect(speak()).rejects.toThrow()
    await expect(speak()).rejects.toThrow()
  })
})
