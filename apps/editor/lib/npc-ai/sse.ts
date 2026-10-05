import type { NpcChatTurn } from '@pascal-app/nodes'
import type { NpcAiConfig, NpcAiProvider } from './config'

/**
 * The two wire protocols NPC chat speaks, over plain `fetch` (no SDK): the
 * request to the configured provider, its streamed reply read as provider-
 * neutral events, and the `text/event-stream` frames the route sends on.
 */

export type NpcStopReason = 'end_turn' | 'max_tokens' | 'refusal'

/** Token counts for the usage log (never the text). */
export type NpcUsage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }

export type ProviderEvent =
  | { kind: 'text'; text: string }
  | { kind: 'stop'; reason: NpcStopReason }
  | { kind: 'usage'; usage: NpcUsage }
  | { kind: 'error' }

/** One server-sent event: its `event:` name ('message' when none) and its `data:` lines joined. */
export type SseEvent = { event: string; data: string }

export function providerRequest(
  config: NpcAiConfig,
  system: string,
  messages: NpcChatTurn[],
  maxTokens: number,
): { url: string; init: RequestInit } {
  const turns = messages.map((turn) => ({ role: turn.role, content: turn.text }))
  if (config.provider === 'anthropic') {
    return {
      url: `${config.baseUrl}/v1/messages`,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          // Byte-stable per scene version, so repeated turns read it from the prompt cache.
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: turns,
          max_tokens: maxTokens,
          stream: true,
        }),
      },
    }
  }
  return {
    url: `${config.baseUrl}/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: system }, ...turns],
        stream: true,
        max_tokens: maxTokens,
      }),
    },
  }
}

/** The provider-neutral events of a provider's streamed reply. */
export async function* readProviderStream(
  body: ReadableStream<Uint8Array>,
  provider: NpcAiProvider,
): AsyncGenerator<ProviderEvent> {
  const reader = body.getReader()
  // Streaming decode: a Korean character's bytes may be split across chunks.
  const utf8 = new TextDecoder()
  const decoder = createSseDecoder()
  const read = provider === 'anthropic' ? readAnthropicEvent : readOpenAiEvent
  try {
    while (true) {
      const { done, value } = await reader.read()
      const events = done
        ? [...decoder.push(utf8.decode()), ...decoder.end()]
        : decoder.push(utf8.decode(value, { stream: true }))
      for (const event of events) yield* read(event)
      if (done) return
    }
  } finally {
    // Stops the upstream body when the route stops reading early.
    await reader.cancel().catch(() => {})
  }
}

/**
 * An incremental `text/event-stream` decoder. Chunks may split anywhere, even
 * inside a CRLF; comments (keep-alives), `id:` and `retry:` are skipped.
 */
export function createSseDecoder() {
  let buffer = ''
  let event = ''
  let data: string[] = []

  const takeLine = (line: string, out: SseEvent[]) => {
    if (line === '') {
      if (data.length > 0) out.push({ event: event || 'message', data: data.join('\n') })
      event = ''
      data = []
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const raw = colon === -1 ? '' : line.slice(colon + 1)
    const fieldValue = raw.startsWith(' ') ? raw.slice(1) : raw
    if (field === 'event') event = fieldValue
    else if (field === 'data') data.push(fieldValue)
  }

  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk
      // A CR at the end may be the first half of a CRLF: keep it for the next chunk.
      const held = buffer.endsWith('\r') ? '\r' : ''
      const lines = (held ? buffer.slice(0, -1) : buffer).split(/\r\n|\r|\n/)
      buffer = (lines.pop() ?? '') + held
      const out: SseEvent[] = []
      for (const line of lines) takeLine(line, out)
      return out
    },
    /** Delivers an event the stream closed without its blank line. */
    end(): SseEvent[] {
      const out: SseEvent[] = []
      const rest = buffer.replace(/\r$/, '')
      if (rest) takeLine(rest, out)
      buffer = ''
      takeLine('', out)
      return out
    },
  }
}

type OpenAiChunk = {
  error?: unknown
  choices?: {
    delta?: { content?: string | null; refusal?: string | null }
    finish_reason?: string | null
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  } | null
}

/** A Chat Completions chunk (`data: {choices:[{delta:{content}}]}` … `data: [DONE]`). */
export function readOpenAiEvent({ data }: SseEvent): ProviderEvent[] {
  if (data === '[DONE]') return []
  const chunk = parseJson<OpenAiChunk>(data)
  if (!chunk) return []
  if (chunk.error) return [{ kind: 'error' }]
  const events: ProviderEvent[] = []
  const choice = chunk.choices?.[0]
  if (choice?.delta?.content) events.push({ kind: 'text', text: choice.delta.content })
  if (choice?.delta?.refusal) events.push({ kind: 'stop', reason: 'refusal' })
  const finish = choice?.finish_reason
  if (finish) {
    const reason =
      finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end_turn'
    events.push({ kind: 'stop', reason })
  }
  if (chunk.usage) {
    events.push({
      kind: 'usage',
      usage: {
        input: chunk.usage.prompt_tokens,
        output: chunk.usage.completion_tokens,
        cacheRead: chunk.usage.prompt_tokens_details?.cached_tokens,
      },
    })
  }
  return events
}

type AnthropicUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}
type AnthropicEvent = {
  type?: string
  delta?: { type?: string; text?: string; stop_reason?: string | null }
  message?: { usage?: AnthropicUsage }
  usage?: AnthropicUsage
}

/** A Messages API stream event (`message_start`, `content_block_delta`, `message_delta`, `error` …). */
export function readAnthropicEvent({ event, data }: SseEvent): ProviderEvent[] {
  const message = parseJson<AnthropicEvent>(data)
  switch (message?.type ?? event) {
    case 'content_block_delta':
      return message?.delta?.type === 'text_delta' && message.delta.text
        ? [{ kind: 'text', text: message.delta.text }]
        : []
    case 'message_start':
      return message?.message?.usage ? [anthropicUsage(message.message.usage)] : []
    case 'message_delta': {
      const events: ProviderEvent[] = []
      const stop = message?.delta?.stop_reason
      if (stop) {
        const reason = stop === 'refusal' || stop === 'max_tokens' ? stop : 'end_turn'
        events.push({ kind: 'stop', reason })
      }
      if (message?.usage) events.push(anthropicUsage(message.usage))
      return events
    }
    case 'error':
      return [{ kind: 'error' }]
    default:
      return []
  }
}

function anthropicUsage(usage: AnthropicUsage): ProviderEvent {
  return {
    kind: 'usage',
    usage: {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens,
      cacheWrite: usage.cache_creation_input_tokens,
    },
  }
}

/** One frame of the route's own stream (`meta`, `delta`, `done`, `error`). */
export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
