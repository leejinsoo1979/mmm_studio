import type { NpcChatErrorCode, NpcChatResult, NpcChatTransport } from '../types'

let transport: NpcChatTransport | null = null

/** The app installs the transport of the scene it shows (null when it leaves it). */
export function setNpcChatTransport(next: NpcChatTransport | null): void {
  transport = next
}

export function getNpcChatTransport(): NpcChatTransport | null {
  return transport
}

/** One server-sent event: its `event:` name ('message' when none) and its `data:` lines joined. */
export type SseEvent = { event: string; data: string }

/**
 * An incremental `text/event-stream` parser. Chunks may split anywhere, even
 * between the CR and LF of a line end; comments (keep-alives), `id:` and
 * `retry:` are skipped. `end()` also delivers an event the stream closed
 * without its blank line, so a last `done` is never lost.
 */
export function createSseParser() {
  let buffer = ''
  let event = ''
  let data: string[] = []
  let ready: SseEvent[] = []

  const dispatch = () => {
    if (data.length > 0) ready.push({ event: event || 'message', data: data.join('\n') })
    event = ''
    data = []
  }

  const takeLine = (line: string) => {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }

  const drain = () => {
    const events = ready
    ready = []
    return events
  }

  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk
      let start = 0
      for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i]
        if (char !== '\n' && char !== '\r') continue
        // A CR at the very end may be the first half of a CRLF: wait for the next chunk.
        if (char === '\r' && i === buffer.length - 1) break
        takeLine(buffer.slice(start, i))
        if (char === '\r' && buffer[i + 1] === '\n') i++
        start = i + 1
      }
      buffer = buffer.slice(start)
      return drain()
    },
    end(): SseEvent[] {
      if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1)
      if (buffer) takeLine(buffer)
      buffer = ''
      dispatch()
      return drain()
    },
  }
}

/** The events of a byte stream, decoded as UTF-8 across chunk boundaries (Korean is multi-byte). */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      yield* parser.push(decoder.decode(value, { stream: true }))
    }
    yield* parser.push(decoder.decode())
    yield* parser.end()
  } finally {
    // Also when the reader stops early (at `done`): let the connection go.
    reader.cancel().catch(() => {})
  }
}

/** Our error code for a server's (`ai_unavailable`, `rate_limited`, …); unknown ones are upstream
 *  failures. */
export function toNpcChatErrorCode(code: unknown): NpcChatErrorCode {
  switch (code) {
    case 'rate_limited':
    case 'refusal':
    case 'network':
      return code
    case 'unavailable':
    case 'ai_unavailable':
    case 'ai_disabled':
    case 'forbidden':
    case 'not_found':
      return 'unavailable'
    default:
      return 'upstream'
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Reads the npc-chat route's answer stream: `delta` texts go to `onDelta`,
 * `done` resolves ok (with the reply's voice token), `error` resolves its
 * code. A stream that breaks off or ends without either is a network failure.
 */
export async function readNpcChatStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<NpcChatResult> {
  try {
    for await (const { event, data } of readSse(body)) {
      const payload = parseJson(data)
      if (event === 'delta') {
        if (typeof payload?.text === 'string' && payload.text) onDelta(payload.text)
      } else if (event === 'done') {
        return typeof payload?.token === 'string'
          ? { ok: true, token: payload.token }
          : { ok: true }
      } else if (event === 'error') {
        return { ok: false, code: toNpcChatErrorCode(payload?.code) }
      }
    }
  } catch {
    // A dropped connection or an abort.
  }
  return { ok: false, code: 'network' }
}
