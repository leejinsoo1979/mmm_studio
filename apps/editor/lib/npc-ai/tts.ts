import type { RoomFact, SceneFacts } from '@pascal-app/nodes/npc/knowledge'
import type { NpcNode } from '@pascal-app/nodes/npc/schema'
import type { NpcTtsConfig } from './config'

/**
 * The NPC voice route's rules, pure: which text an NPC may be asked to say
 * (so the route is no general text-to-speech service), the voice it speaks
 * with, the upstream `/audio/speech` request, and a small LRU for prepared
 * candidates and synthesized audio.
 */

/** The longest text voiced in one request (an authored line is at most 300 characters). */
export const NPC_SPEECH_MAX = 300

/**
 * Lines any NPC may say, written in the client and not in the scene: the
 * dialogue store's and the scripted engine's fixed lines
 * (`packages/nodes/src/npc/dialogue/store.ts` SAY / ERROR_LINES,
 * `dialogue/engine.ts`, `runtime/brain.ts`). A line missing here is only said
 * by the browser voice instead.
 */
const SYSTEM_LINES = [
  '안녕하세요!',
  '안녕하세요! 무엇이 궁금하세요?',
  '네, 궁금한 걸 편하게 물어보세요.',
  '지금은 자세한 상담이 어려워요. 다른 질문이 있으면 골라 주세요.',
  '지금은 자세한 상담이 어려워요. 다음에 다시 찾아 주세요.',
  '오늘은 이야기를 많이 나눴네요. 다음에 또 물어봐 주세요.',
  '잠시 후 다시 물어봐 주세요.',
  '그 이야기는 도와드리기 어려워요.',
  '잠깐 말이 막혔어요. 다시 한 번 물어봐 주세요.',
  '연결이 잠깐 끊겼어요. 다시 한 번 물어봐 주세요.',
  '이제 모든 방을 다 둘러보셨어요.',
  '그 방은 지금 안내해 드리기 어려워요.',
  '이곳은 따로 소개해 드릴 정보가 없어요.',
  '여기서 기다릴게요',
]

/** A dialogue template variable, `{name}` or `{name:a/b}` (as `renderTemplate` reads them). */
const VARIABLE = /\{([A-Za-z]+)(?::([^{}/]+)\/([^{}/]+))?\}/g
/** A template with more variables than this is only accepted as written: each one widens the
 *  match, and many in a row would make it slow. */
const MAX_TEMPLATE_VARIABLES = 8
/** Areas and counts as the client renders them ("32", "12.5"). */
const NUMBER = String.raw`\d{1,6}(?:\.\d)?`
/** The visitor's display name (the dialogue store sends at most 24 characters). */
const PLAYER = String.raw`[^\n]{1,24}`
/** A voice id an OpenAI-compatible speech API takes; browser voice names (with spaces) are not. */
const VOICE_ID = /^[\w.-]{1,64}$/

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One of `values`, literally; null when there are none (the variable then renders empty). */
function anyOf(values: Iterable<string>): string | null {
  const unique = [...new Set(values)].filter(Boolean)
  return unique.length > 0 ? `(?:${unique.map(escapeRegExp).join('|')})` : null
}

/**
 * The regex source of everything `template` can render to: each variable is
 * its slot's pattern (or nothing, as an empty variable renders), with either
 * particle of a `{name:a/b}` pair. Null when the template has too many
 * variables to match safely.
 */
export function templatePattern(
  template: string,
  slots: Readonly<Record<string, string | null>>,
): string | null {
  let source = ''
  let last = 0
  let count = 0
  for (const match of template.matchAll(VARIABLE)) {
    if (++count > MAX_TEMPLATE_VARIABLES) return null
    const [whole, name, a, b] = match
    source += escapeRegExp(template.slice(last, match.index))
    last = match.index + whole.length
    const slot = name && Object.hasOwn(slots, name) ? slots[name] : null
    if (!slot) continue
    const particle = a && b ? `(?:${escapeRegExp(a)}|${escapeRegExp(b)})` : ''
    source += `(?:${slot}${particle})?`
  }
  return source + escapeRegExp(template.slice(last))
}

/** What `describeRoomKo` (dialogue/engine.ts) says about a room, and a guide's "this way". */
function roomPatterns(room: RoomFact): string[] {
  const name = escapeRegExp(room.name)
  const area = `약 ${NUMBER}㎡`
  let tail = room.floorMaterial
    ? `이고, 바닥은 ${escapeRegExp(room.floorMaterial)}(?:이에요|예요)\\.`
    : '예요\\.'
  const furniture = [...room.furniture]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(({ name, count }) => (count > 1 ? `${name} ${count}개` : name))
  if (furniture.length > 0) tail += ` ${escapeRegExp(furniture.join(', '))}(?:이|가) 놓여 있어요\\.`
  if (room.windows > 0) tail += ` 창이 ${room.windows}개 있어서 밝아요\\.`
  return [
    `여기는 ${name}(?:이에요|예요)\\. 면적은 ${area}${tail}`,
    `${name}(?:은|는) 면적이 ${area}${tail}`,
    `좋아요, ${name}(?:으로|로) 안내할게요\\. 따라오세요!`,
  ]
}

/** What one stored NPC may be voiced saying, without a reply token. */
export type NpcSpeechCandidates = { exact: ReadonlySet<string>; patterns: readonly RegExp[] }

/**
 * Everything the NPC can say from the stored scene: its dialogue lines, barks
 * and AI greeting (as written, and rendered with the variables the client
 * fills in), the fixed lines every NPC shares, and the room descriptions and
 * guide lines of the scene's rooms.
 */
export function npcSpeechCandidates(npc: NpcNode, facts: SceneFacts): NpcSpeechCandidates {
  const templates = [
    ...(npc.dialogue?.lines.map((line) => line.text) ?? []),
    ...npc.behavior.greet.barks,
    npc.ai.greeting,
  ].filter(Boolean)
  const slots: Record<string, string | null> = {
    player: PLAYER,
    npc: anyOf([npc.name]),
    room: anyOf(facts.rooms.map((room) => room.name)),
    level: anyOf(facts.levels.map((level) => level.name)),
    area: NUMBER,
    houseArea: NUMBER,
    roomCount: String.raw`\d{1,4}`,
    time: '(?:아침|오후|저녁)',
  }
  const sources = [
    ...templates.flatMap((template) => {
      const source = templatePattern(template, slots)
      // Without variables it is already among the exact lines.
      return source === null || source === escapeRegExp(template) ? [] : [source]
    }),
    ...facts.rooms.flatMap(roomPatterns),
  ]
  return {
    exact: new Set([...SYSTEM_LINES, ...templates].map((text) => text.trim())),
    patterns: sources.map((source) => new RegExp(`^(?:${source})$`)),
  }
}

/** Whether `text` (trimmed) is something the NPC says by itself. */
export function isNpcSpeech(candidates: NpcSpeechCandidates, text: string): boolean {
  const said = text.trim()
  return candidates.exact.has(said) || candidates.patterns.some((pattern) => pattern.test(said))
}

/** The NPC's own voice id when it names one the server can use, else the configured default. */
export function npcTtsVoice(config: NpcTtsConfig, npc: NpcNode): string | null {
  const own = npc.voice.voice
  return own !== 'auto' && VOICE_ID.test(own) ? own : config.voice
}

export type NpcTtsInput = { text: string; voice: string | null; speed: number }

/** `POST {base}/audio/speech` for an mp3 of `text`. Without a voice the server's default speaks. */
export function ttsRequest(
  config: NpcTtsConfig,
  { text, voice, speed }: NpcTtsInput,
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  return {
    url: `${config.baseUrl}/audio/speech`,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        input: text,
        response_format: 'mp3',
        ...(voice ? { voice } : {}),
        ...(speed !== 1 ? { speed } : {}),
      }),
    },
  }
}

/** A least-recently-used map holding at most `maxEntries`, and at most `maxWeight` by `weigh`. */
export function createLru<V>(
  maxEntries: number,
  maxWeight = Number.POSITIVE_INFINITY,
  weigh: (value: V) => number = () => 0,
) {
  const entries = new Map<string, V>()
  let weight = 0
  const drop = (key: string) => {
    const value = entries.get(key)
    if (value === undefined) return
    entries.delete(key)
    weight -= weigh(value)
  }
  return {
    get(key: string): V | undefined {
      const value = entries.get(key)
      if (value !== undefined) {
        entries.delete(key)
        entries.set(key, value)
      }
      return value
    },
    set(key: string, value: V): void {
      drop(key)
      if (weigh(value) > maxWeight) return
      entries.set(key, value)
      weight += weigh(value)
      for (const oldest of entries.keys()) {
        if (entries.size <= maxEntries && weight <= maxWeight) break
        drop(oldest)
      }
    },
    get size() {
      return entries.size
    },
  }
}

const DEFAULT_DAILY_LIMIT = 1000

/** Voiced lines per scene per UTC day that reach the speech API: the chat route's
 *  `NPC_AI_DAILY_LIMIT`, so one setting caps both. */
export function npcVoiceDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const limit = Number.parseInt(env.NPC_AI_DAILY_LIMIT?.trim() ?? '', 10)
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_DAILY_LIMIT
}

/** The whole body, or null once it runs past `maxBytes` (the rest is not read). */
export async function readBodyCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) return null
      chunks.push(value)
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
