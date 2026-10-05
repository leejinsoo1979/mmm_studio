import { describe, expect, test } from 'bun:test'
import {
  createSseParser,
  readNpcChatStream,
  readSse,
  type SseEvent,
  toNpcChatErrorCode,
} from './chat-transport'

/** Feeds `chunks` to a fresh parser and collects every event, the end included. */
function parse(chunks: string[]): SseEvent[] {
  const parser = createSseParser()
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.end()]
}

const streamOf = (chunks: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      }
      controller.close()
    },
  })

async function collect(body: ReadableStream<Uint8Array>) {
  const events: SseEvent[] = []
  for await (const event of readSse(body)) events.push(event)
  return events
}

describe('createSseParser', () => {
  test('named events and default messages', () => {
    expect(parse(['event: delta\ndata: {"text":"안녕"}\n\ndata: plain\n\n'])).toEqual([
      { event: 'delta', data: '{"text":"안녕"}' },
      { event: 'message', data: 'plain' },
    ])
  })

  test('chunks split anywhere give the same events', () => {
    const text = 'event: delta\ndata: {"text":"여기는 거실이에요."}\n\nevent: done\ndata: {}\n\n'
    const whole = parse([text])
    for (let cut = 1; cut < text.length; cut++) {
      expect(parse([text.slice(0, cut), text.slice(cut)])).toEqual(whole)
    }
    expect(parse(text.split(''))).toEqual(whole)
  })

  test('CRLF, lone CR, and a CRLF split between chunks', () => {
    expect(parse(['event: a\r\ndata: 1\r\n\r\n'])).toEqual([{ event: 'a', data: '1' }])
    expect(parse(['event: a\rdata: 1\r\r'])).toEqual([{ event: 'a', data: '1' }])
    expect(parse(['data: 1\r', '\n\r', '\ndata: 2\n\n'])).toEqual([
      { event: 'message', data: '1' },
      { event: 'message', data: '2' },
    ])
  })

  test('multi-line data joins with newlines; one leading space is dropped', () => {
    expect(parse(['data: first\ndata:second\ndata:  third\n\n'])).toEqual([
      { event: 'message', data: 'first\nsecond\n third' },
    ])
  })

  test('comments, ids and retries are skipped; an event without data is not sent', () => {
    expect(
      parse([': keep-alive\n\nid: 7\nretry: 1000\nevent: ping\n\nevent: delta\ndata: x\n\n']),
    ).toEqual([{ event: 'delta', data: 'x' }])
  })

  test('the event type does not leak into the next event', () => {
    expect(parse(['event: delta\ndata: a\n\ndata: b\n\n'])).toEqual([
      { event: 'delta', data: 'a' },
      { event: 'message', data: 'b' },
    ])
  })

  test('end() delivers an event cut off before its blank line', () => {
    expect(parse(['event: done\ndata: {"token":"t"}'])).toEqual([
      { event: 'done', data: '{"token":"t"}' },
    ])
    expect(parse(['event: done\ndata: {}\r'])).toEqual([{ event: 'done', data: '{}' }])
  })
})

describe('readSse', () => {
  test('decodes Korean split inside a character', async () => {
    const bytes = new TextEncoder().encode('data: 거실\n\n')
    const events = await collect(streamOf([bytes.slice(0, 8), bytes.slice(8)]))
    expect(events).toEqual([{ event: 'message', data: '거실' }])
  })
})

describe('readNpcChatStream', () => {
  test('deltas, then done with the reply token', async () => {
    const deltas: string[] = []
    const result = await readNpcChatStream(
      streamOf([
        'event: meta\ndata: {"npc":"지아"}\n\n',
        'event: delta\ndata: {"text":"안녕하세요, "}\n\n: keep-alive\n\n',
        'event: delta\ndata: {"text":"여기는 거실이에요."}\n\n',
        'event: done\ndata: {"stop":"end_turn","token":"abc.def"}\n\n',
      ]),
      (text) => deltas.push(text),
    )
    expect(deltas).toEqual(['안녕하세요, ', '여기는 거실이에요.'])
    expect(result).toEqual({ ok: true, token: 'abc.def' })
  })

  test('done without a token', async () => {
    const result = await readNpcChatStream(streamOf(['event: done\ndata: {}\n\n']), () => {})
    expect(result).toEqual({ ok: true })
  })

  test('error events map to our codes', async () => {
    const run = (code: string) =>
      readNpcChatStream(
        streamOf([
          `event: delta\ndata: {"text":"음"}\n\nevent: error\ndata: {"code":"${code}"}\n\n`,
        ]),
        () => {},
      )
    expect(await run('refusal')).toEqual({ ok: false, code: 'refusal' })
    expect(await run('max_tokens')).toEqual({ ok: false, code: 'upstream' })
    expect(await run('rate_limited')).toEqual({ ok: false, code: 'rate_limited' })
  })

  test('a stream that ends without done, or breaks, is a network failure', async () => {
    expect(
      await readNpcChatStream(streamOf(['event: delta\ndata: {"text":"a"}\n\n']), () => {}),
    ).toEqual({ ok: false, code: 'network' })
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('reset'))
      },
    })
    expect(await readNpcChatStream(broken, () => {})).toEqual({ ok: false, code: 'network' })
  })

  test('bad JSON in a delta is skipped', async () => {
    const deltas: string[] = []
    const result = await readNpcChatStream(
      streamOf([
        'event: delta\ndata: {oops\n\nevent: delta\ndata: {"text":"네"}\n\nevent: done\ndata: {}\n\n',
      ]),
      (text) => deltas.push(text),
    )
    expect(deltas).toEqual(['네'])
    expect(result.ok).toBe(true)
  })
})

describe('toNpcChatErrorCode', () => {
  test('server codes', () => {
    expect(toNpcChatErrorCode('ai_unavailable')).toBe('unavailable')
    expect(toNpcChatErrorCode('ai_disabled')).toBe('unavailable')
    expect(toNpcChatErrorCode('rate_limited')).toBe('rate_limited')
    expect(toNpcChatErrorCode(undefined)).toBe('upstream')
  })
})
