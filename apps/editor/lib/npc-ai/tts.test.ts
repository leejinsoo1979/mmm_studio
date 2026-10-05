import { describe, expect, test } from 'bun:test'
import type { RoomFact, SceneFacts } from '@pascal-app/nodes/npc/knowledge'
import { NpcNode } from '@pascal-app/nodes/npc/schema'
// The client's own renderers, so the patterns are checked against what it really says.
import { describeRoomKo } from '../../../../packages/nodes/src/npc/dialogue/engine'
import { renderTemplate } from '../../../../packages/nodes/src/npc/dialogue/templates'
import type { NpcTtsConfig } from './config'
import {
  createLru,
  isNpcSpeech,
  npcSpeechCandidates,
  npcTtsVoice,
  npcVoiceDailyLimit,
  readBodyCapped,
  templatePattern,
  ttsRequest,
} from './tts'

const room = (overrides: Partial<RoomFact> & Pick<RoomFact, 'id' | 'name'>): RoomFact => ({
  levelId: 'level_1',
  area: 20,
  centroid: [0, 0],
  polygon: [],
  windows: 0,
  doorsTo: [],
  furniture: [],
  cabinets: [],
  lights: 0,
  ...overrides,
})

const living = room({
  id: 'zone_living',
  name: '거실',
  area: 32.14,
  floorMaterial: '오크 원목',
  windows: 2,
  furniture: [
    { name: '소파', count: 1 },
    { name: '의자', count: 4 },
    { name: '식탁', count: 1 },
    { name: '스탠드', count: 1 },
  ],
})
const bedroom = room({ id: 'zone_bed', name: '안방', area: 12 })

const facts: SceneFacts = {
  buildings: 1,
  levels: [{ id: 'level_1', name: '1층', index: 0, rooms: [] }],
  rooms: [living, bedroom],
  totalArea: 44.1,
}

const npc = NpcNode.parse({
  name: '지아',
  avatar: 'Female_Adult_01',
  dialogue: {
    start: 'hello',
    lines: [
      { id: 'hello', text: '안녕하세요, {player}님! 저는 {npc:이에요/예요}.' },
      { id: 'room', text: '여기는 {room:이고/고}, {area}㎡예요. {time}에 오셨네요.' },
      { id: 'plain', text: '천천히 둘러보세요.' },
    ],
  },
  behavior: { greet: { barks: ['어서 오세요!', '{player}님, 반가워요'] } },
  ai: { greeting: '무엇이든 물어보세요, {player}님.' },
})

const candidates = npcSpeechCandidates(npc, facts)
const speaks = (text: string) => isNpcSpeech(candidates, text)

describe('npcSpeechCandidates', () => {
  test('authored lines, barks and the greeting, as written and as rendered', () => {
    const vars = { player: '민수', npc: '지아', room: '거실', area: '32.1', time: '오후' }
    for (const line of npc.dialogue?.lines ?? []) {
      expect(speaks(line.text)).toBe(true)
      expect(speaks(renderTemplate(line.text, vars))).toBe(true)
    }
    expect(speaks('어서 오세요!')).toBe(true)
    expect(speaks(' 어서 오세요! ')).toBe(true)
    expect(speaks('방문객님, 반가워요')).toBe(true)
    expect(speaks('무엇이든 물어보세요, 민수님.')).toBe(true)
    // Variables the client had no value for render empty, particle included.
    expect(
      speaks(renderTemplate('여기는 {room:이고/고}, {area}㎡예요. {time}에 오셨네요.', {})),
    ).toBe(true)
  })

  test('fixed lines every NPC shares', () => {
    expect(speaks('네, 궁금한 걸 편하게 물어보세요.')).toBe(true)
    expect(speaks('여기서 기다릴게요')).toBe(true)
  })

  test("room descriptions and guide lines, exactly as the client's engine words them", () => {
    for (const fact of facts.rooms) {
      expect(speaks(describeRoomKo(fact, true))).toBe(true)
      expect(speaks(describeRoomKo(fact, false))).toBe(true)
    }
    expect(speaks('좋아요, 거실로 안내할게요. 따라오세요!')).toBe(true)
    expect(speaks('좋아요, 안방으로 안내할게요. 따라오세요!')).toBe(true)
  })

  test('nothing else', () => {
    expect(speaks('아무 말이나 읽어 주세요')).toBe(false)
    expect(speaks('안녕하세요, 민수님! 저는 지아예요. 그리고 이 문장은 덧붙였어요.')).toBe(false)
    // A variable takes its own values only: the NPC's name, the scene's rooms, a time of day.
    expect(speaks('안녕하세요, 민수님! 저는 철수예요.')).toBe(false)
    expect(speaks('여기는 서재고, 32㎡예요. 오후에 오셨네요.')).toBe(false)
    expect(speaks('여기는 거실이고, 32㎡예요. 새벽에 오셨네요.')).toBe(false)
    expect(speaks('좋아요, 서재로 안내할게요. 따라오세요!')).toBe(false)
    // The player's name is free but short.
    expect(speaks(`${'가'.repeat(25)}님, 반가워요`)).toBe(false)
    expect(speaks('')).toBe(false)
  })

  test("another NPC's lines are not this one's", () => {
    const other = npcSpeechCandidates(NpcNode.parse({ name: '민준' }), facts)
    expect(isNpcSpeech(other, '천천히 둘러보세요.')).toBe(false)
    expect(isNpcSpeech(other, '안녕하세요!')).toBe(true)
  })
})

describe('templatePattern', () => {
  test('escapes the text around the variables', () => {
    const source = templatePattern('가격은 (약) {area}㎡ + α?', { area: '\\d+' })
    expect(new RegExp(`^${source}$`).test('가격은 (약) 12㎡ + α?')).toBe(true)
    expect(new RegExp(`^${source}$`).test('가격은 약 12㎡ + α')).toBe(false)
  })

  test('unknown variables render empty; too many variables are refused', () => {
    expect(templatePattern('a{nope}b', {})).toBe('ab')
    expect(templatePattern('{player}'.repeat(9), { player: '.' })).toBeNull()
  })
})

const config: NpcTtsConfig = {
  baseUrl: 'https://speech.example.com/v1',
  apiKey: 'key',
  model: 'speech-model',
  voice: 'default-voice',
}

describe('npcTtsVoice', () => {
  test("the NPC's own voice id, else the configured default", () => {
    const withVoice = (voice: string) => NpcNode.parse({ voice: { voice } })
    expect(npcTtsVoice(config, withVoice('auto'))).toBe('default-voice')
    expect(npcTtsVoice(config, withVoice('voice_b'))).toBe('voice_b')
    // A browser voice name is no speech API voice.
    expect(npcTtsVoice(config, withVoice('Microsoft SunHi Online (Natural) - Korean'))).toBe(
      'default-voice',
    )
    expect(npcTtsVoice({ ...config, voice: null }, withVoice('auto'))).toBeNull()
  })
})

describe('ttsRequest', () => {
  test('an OpenAI-compatible speech request for mp3', () => {
    const { url, init } = ttsRequest(config, { text: '안녕하세요', voice: 'v', speed: 1.2 })
    expect(url).toBe('https://speech.example.com/v1/audio/speech')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer key',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'speech-model',
      input: '안녕하세요',
      response_format: 'mp3',
      voice: 'v',
      speed: 1.2,
    })
  })

  test('a local server without a key or voice, at normal speed', () => {
    const { init } = ttsRequest({ ...config, apiKey: null }, { text: '네', voice: null, speed: 1 })
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'speech-model',
      input: '네',
      response_format: 'mp3',
    })
  })
})

test('npcVoiceDailyLimit', () => {
  expect(npcVoiceDailyLimit({})).toBe(1000)
  expect(npcVoiceDailyLimit({ NPC_AI_DAILY_LIMIT: '250' })).toBe(250)
  expect(npcVoiceDailyLimit({ NPC_AI_DAILY_LIMIT: '-1' })).toBe(1000)
})

describe('createLru', () => {
  test('keeps the most recently used entries', () => {
    const lru = createLru<number>(2)
    lru.set('a', 1)
    lru.set('b', 2)
    expect(lru.get('a')).toBe(1)
    lru.set('c', 3)
    expect(lru.get('b')).toBeUndefined()
    expect(lru.get('a')).toBe(1)
    expect(lru.size).toBe(2)
  })

  test('within a weight budget, refusing what alone is too heavy', () => {
    const lru = createLru<string>(10, 5, (value) => value.length)
    lru.set('a', 'xx')
    lru.set('b', 'yy')
    lru.set('c', 'zz')
    expect(lru.get('a')).toBeUndefined()
    expect([lru.get('b'), lru.get('c')]).toEqual(['yy', 'zz'])
    lru.set('d', 'toolong')
    expect(lru.get('d')).toBeUndefined()
    lru.set('b', 'y')
    expect(lru.size).toBe(2)
  })
})

describe('readBodyCapped', () => {
  const stream = (...chunks: number[][]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk))
        controller.close()
      },
    })

  test('joins the chunks', async () => {
    expect(await readBodyCapped(stream([1, 2], [3]), 3)).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('null past the cap', async () => {
    expect(await readBodyCapped(stream([1, 2], [3, 4]), 3)).toBeNull()
  })
})
