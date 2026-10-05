import { describe, expect, test } from 'bun:test'
import type { NpcAiConfig } from './config'
import {
  createSseDecoder,
  encodeSse,
  type ProviderEvent,
  providerRequest,
  readAnthropicEvent,
  readOpenAiEvent,
  readProviderStream,
} from './sse'

function decodeAll(chunks: string[]) {
  const decoder = createSseDecoder()
  return [...chunks.flatMap((chunk) => decoder.push(chunk)), ...decoder.end()]
}

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(stream: AsyncGenerator<ProviderEvent>) {
  const events: ProviderEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

const openAiText = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`

describe('createSseDecoder', () => {
  test('events split anywhere, CRLF split across chunks, keep-alive comments', () => {
    const events = decodeAll([
      ': keep-alive\r',
      '\n\r\nevent: delta\r',
      '\ndata: {"a":',
      '1}\r\n\r\n',
      'data: one\ndata: two\n\n',
      ': ping\n\n',
    ])
    expect(events).toEqual([
      { event: 'delta', data: '{"a":1}' },
      { event: 'message', data: 'one\ntwo' },
    ])
  })

  test('a lone CR ends a line; the last event needs no blank line', () => {
    expect(decodeAll(['data: a\r\rdata: b'])).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ])
  })
})

describe('readOpenAiEvent', () => {
  test('text deltas, finish reasons and [DONE]', () => {
    expect(
      readOpenAiEvent({ event: 'message', data: '{"choices":[{"delta":{"content":"안녕"}}]}' }),
    ).toEqual([{ kind: 'text', text: '안녕' }])
    expect(
      readOpenAiEvent({
        event: 'message',
        data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
      }),
    ).toEqual([{ kind: 'stop', reason: 'end_turn' }])
    expect(
      readOpenAiEvent({
        event: 'message',
        data: '{"choices":[{"delta":{},"finish_reason":"length"}]}',
      }),
    ).toEqual([{ kind: 'stop', reason: 'max_tokens' }])
    expect(readOpenAiEvent({ event: 'message', data: '[DONE]' })).toEqual([])
  })

  test('refusals, errors and usage', () => {
    expect(
      readOpenAiEvent({
        event: 'message',
        data: '{"choices":[{"delta":{},"finish_reason":"content_filter"}]}',
      }),
    ).toEqual([{ kind: 'stop', reason: 'refusal' }])
    expect(
      readOpenAiEvent({ event: 'message', data: '{"choices":[{"delta":{"refusal":"no"}}]}' }),
    ).toEqual([{ kind: 'stop', reason: 'refusal' }])
    expect(readOpenAiEvent({ event: 'message', data: '{"error":{"message":"x"}}' })).toEqual([
      { kind: 'error' },
    ])
    expect(
      readOpenAiEvent({
        event: 'message',
        data: '{"choices":[],"usage":{"prompt_tokens":900,"completion_tokens":40,"prompt_tokens_details":{"cached_tokens":800}}}',
      }),
    ).toEqual([{ kind: 'usage', usage: { input: 900, output: 40, cacheRead: 800 } }])
    expect(readOpenAiEvent({ event: 'message', data: 'not json' })).toEqual([])
  })
})

describe('readAnthropicEvent', () => {
  test('text deltas, stop reasons and usage', () => {
    expect(
      readAnthropicEvent({
        event: 'content_block_delta',
        data: '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"네"}}',
      }),
    ).toEqual([{ kind: 'text', text: '네' }])
    expect(
      readAnthropicEvent({
        event: 'content_block_delta',
        data: '{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"…"}}',
      }),
    ).toEqual([])
    expect(
      readAnthropicEvent({
        event: 'message_start',
        data: '{"type":"message_start","message":{"usage":{"input_tokens":12,"cache_read_input_tokens":3000,"cache_creation_input_tokens":0,"output_tokens":1}}}',
      }),
    ).toEqual([{ kind: 'usage', usage: { input: 12, output: 1, cacheRead: 3000, cacheWrite: 0 } }])
    expect(
      readAnthropicEvent({
        event: 'message_delta',
        data: '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}',
      }),
    ).toEqual([
      { kind: 'stop', reason: 'end_turn' },
      {
        kind: 'usage',
        usage: { input: undefined, output: 42, cacheRead: undefined, cacheWrite: undefined },
      },
    ])
  })

  test('refusal, max_tokens, errors and pings', () => {
    const stop = (reason: string) =>
      readAnthropicEvent({
        event: 'message_delta',
        data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: reason } }),
      })
    expect(stop('refusal')).toEqual([{ kind: 'stop', reason: 'refusal' }])
    expect(stop('max_tokens')).toEqual([{ kind: 'stop', reason: 'max_tokens' }])
    expect(
      readAnthropicEvent({
        event: 'error',
        data: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      }),
    ).toEqual([{ kind: 'error' }])
    expect(readAnthropicEvent({ event: 'ping', data: '{"type":"ping"}' })).toEqual([])
  })
})

describe('readProviderStream', () => {
  test('an OpenAI-compatible stream, Korean split mid-character', async () => {
    const bytes = new TextEncoder().encode(`${openAiText('안녕하세요')}data: [DONE]\n\n`)
    // Inside 안 (EC 95 88).
    const split = bytes.indexOf(0xec) + 1
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split))
        controller.enqueue(bytes.slice(split))
        controller.close()
      },
    })
    expect(await collect(readProviderStream(stream, 'openai'))).toEqual([
      { kind: 'text', text: '안녕하세요' },
    ])
  })

  test('an Anthropic stream', async () => {
    const events = await collect(
      readProviderStream(
        body([
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n',
          'event: ping\ndata: {"type":"ping"}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"거실"}}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]),
        'anthropic',
      ),
    )
    expect(events.map((event) => event.kind)).toEqual(['usage', 'text', 'stop'])
    expect(events.at(-1)).toEqual({ kind: 'stop', reason: 'refusal' })
  })
})

describe('providerRequest', () => {
  const config = (overrides: Partial<NpcAiConfig>): NpcAiConfig => ({
    provider: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'key',
    model: 'some-model',
    dailyLimit: 1000,
    ...overrides,
  })
  const messages = [{ role: 'user' as const, text: '안녕하세요' }]

  test('openai: Chat Completions with the system turn first and a bearer key', () => {
    const { url, init } = providerRequest(config({}), 'SYSTEM', messages, 256)
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer key',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'some-model',
      messages: [
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: '안녕하세요' },
      ],
      stream: true,
      max_tokens: 256,
    })
    const local = providerRequest(config({ apiKey: null }), 'SYSTEM', messages, 256)
    expect(local.init.headers).toEqual({ 'content-type': 'application/json' })
  })

  test('anthropic: Messages API with a cached system block', () => {
    const { url, init } = providerRequest(
      config({ provider: 'anthropic', baseUrl: 'https://api.example.com' }),
      'SYSTEM',
      messages,
      256,
    )
    expect(url).toBe('https://api.example.com/v1/messages')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'key',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'some-model',
      system: [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: '안녕하세요' }],
      max_tokens: 256,
      stream: true,
    })
  })
})

test('encodeSse frames one event', () => {
  expect(encodeSse('delta', { text: '네' })).toBe('event: delta\ndata: {"text":"네"}\n\n')
})
