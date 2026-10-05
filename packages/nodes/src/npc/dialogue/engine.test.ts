import { describe, expect, test } from 'bun:test'
import { npcDialogueTemplate } from '../presets'
import { DialogueGraph } from '../schema'
import type { RoomFact, SceneFacts } from '../types'
import {
  choose,
  type DialogueContext,
  describeRoomKo,
  enter,
  MAX_CHOICES,
  roomAt,
  tourOrder,
} from './engine'

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

const room = (
  id: string,
  name: string,
  area: number,
  polygon: [number, number][],
  extra: Partial<RoomFact> = {},
): RoomFact => ({
  id,
  name,
  levelId: 'level_1',
  area,
  centroid: [0, 0],
  polygon,
  windows: 0,
  doorsTo: [],
  furniture: [],
  cabinets: [],
  lights: 0,
  ...extra,
})

// 거실 opens to 주방 and 복도, 복도 to 안방; 창고 has no door; 다락 is upstairs.
const ROOMS = [
  room('living', '거실', 32, rect(0, 0, 6, 5), {
    doorsTo: ['kitchen', 'hall'],
    floorMaterial: '헤링본 마루',
    windows: 3,
    furniture: [
      { name: '의자', count: 4 },
      { name: '소파', count: 1 },
      { name: '테이블', count: 1 },
      { name: '스탠드', count: 1 },
    ],
  }),
  room('kitchen', '주방', 12, rect(6, 0, 9, 4), { doorsTo: ['living'] }),
  room('hall', '복도', 8, rect(0, 5, 6, 6), { doorsTo: ['living', 'bed'] }),
  room('bed', '안방', 15, rect(0, 6, 5, 9), { doorsTo: ['hall'] }),
  room('storage', '창고', 4, rect(9, 0, 11, 2)),
  room('nook', '독서 공간', 2, rect(1, 1, 2, 2)),
  room('attic', '다락', 10, rect(0, 0, 3, 3), { levelId: 'level_2' }),
]

const FACTS: SceneFacts = {
  buildings: 1,
  levels: [
    { id: 'level_1', name: '1층', index: 0, rooms: [] },
    { id: 'level_2', name: '2층', index: 1, rooms: [] },
  ],
  rooms: ROOMS,
  totalArea: ROOMS.reduce((sum, r) => sum + r.area, 0),
}

const ctx = (extra: Partial<DialogueContext> = {}): DialogueContext => ({
  flags: new Set(),
  vars: { player: '민준', npc: '지아', room: '거실' },
  facts: FACTS,
  levelId: 'level_1',
  roomId: 'living',
  tourStart: 'living',
  visited: [],
  ...extra,
})

const GRAPH = DialogueGraph.parse({
  start: 'hello',
  lines: [
    {
      id: 'hello',
      text: '안녕하세요, {player}님! 저는 {npc:이에요/예요}.',
      emote: 'wave',
      onEnter: [{ kind: 'setFlag', flag: 'met' }],
      choices: [
        { id: 'first', label: '처음 뵙네요', next: 'hello', hideIf: ['met'] },
        { id: 'again', label: '또 만났네요', next: 'more', requires: ['met'] },
        {
          id: 'follow',
          label: '같이 가요',
          next: 'more',
          actions: [{ kind: 'follow' }, { kind: 'setFlag', flag: 'following' }],
        },
        {
          id: 'forget',
          label: '잊어 주세요',
          next: 'more',
          actions: [{ kind: 'setFlag', flag: 'met', value: false }],
        },
        { id: 'ask', label: '물어볼게요', next: 'more', actions: [{ kind: 'askAi' }] },
        { id: 'bye', label: '안녕히 계세요' },
      ],
    },
    {
      id: 'more',
      text: '또 궁금한 게 있나요?',
      next: 'hello',
      onEnter: [{ kind: 'emote', emote: 'nod' }, { kind: 'describeRoom' }, { kind: 'end' }],
    },
    {
      id: 'rooms',
      text: '어느 방으로 갈까요?',
      roomMenu: true,
      choices: [{ id: 'back', label: '다음에요', next: 'hello' }],
    },
    {
      id: 'tour',
      text: '다음 방으로 가요',
      onEnter: [{ kind: 'guideTo', room: '@next' }],
    },
    {
      id: 'there',
      text: '저기로 가요',
      onEnter: [
        { kind: 'guideTo', room: 'attic' },
        { kind: 'describeRoom', room: 'bed' },
      ],
    },
  ],
})

const ids = (choices: { id: string }[]) => choices.map((choice) => choice.id)

describe('enter', () => {
  test('renders the text and runs onEnter before filtering choices by flags', () => {
    const result = enter(GRAPH, 'hello', ctx())!
    expect(result.line.text).toBe('안녕하세요, 민준님! 저는 지아예요.')
    expect(result.line.emote).toBe('wave')
    expect(result.flags.has('met')).toBe(true)
    expect(ids(result.line.choices)).toEqual(['again', 'follow', 'forget', 'ask', 'bye'])
    expect(result.effects).toEqual([])
  })

  test('marks the choices that open AI chat', () => {
    const { line } = enter(GRAPH, 'hello', ctx())!
    expect(line.choices.filter((choice) => choice.askAi).map((choice) => choice.id)).toEqual([
      'ask',
    ])
  })

  test('onEnter actions become effects in order', () => {
    const result = enter(GRAPH, 'more', ctx())!
    expect(result.line.next).toBe('hello')
    expect(result.line.choices).toEqual([])
    expect(result.effects.map((effect) => effect.kind)).toEqual(['emote', 'say', 'end'])
    expect(result.effects[0]).toEqual({ kind: 'emote', id: 'nod' })
  })

  test('an unknown line ends the conversation', () => {
    expect(enter(GRAPH, 'missing', ctx())).toBeNull()
  })

  test('does not touch the flags it was given', () => {
    const flags = new Set<string>()
    enter(GRAPH, 'hello', ctx({ flags }))
    expect(flags.size).toBe(0)
  })
})

describe('choose', () => {
  test('goes to next with the choice’s effects and flags', () => {
    const result = choose(GRAPH, 'hello', 'follow', ctx({ flags: new Set(['met']) }))!
    expect(result.next).toBe('more')
    expect(result.label).toBe('같이 가요')
    expect(result.effects).toEqual([{ kind: 'follow' }])
    expect([...result.flags].sort()).toEqual(['following', 'met'])
  })

  test('setFlag false clears a flag', () => {
    const result = choose(GRAPH, 'hello', 'forget', ctx({ flags: new Set(['met']) }))!
    expect(result.flags.has('met')).toBe(false)
  })

  test('a null next ends the conversation', () => {
    const result = choose(GRAPH, 'hello', 'bye', ctx())!
    expect(result.next).toBeNull()
    expect(result.effects).toEqual([])
  })

  test('askAi becomes an effect, next stays the line to come back to', () => {
    const result = choose(GRAPH, 'hello', 'ask', ctx())!
    expect(result.effects).toEqual([{ kind: 'askAi' }])
    expect(result.next).toBe('more')
  })

  test('hidden and unknown choices are refused', () => {
    expect(choose(GRAPH, 'hello', 'again', ctx())).toBeNull()
    expect(choose(GRAPH, 'hello', 'first', ctx({ flags: new Set(['met']) }))).toBeNull()
    expect(choose(GRAPH, 'hello', 'nope', ctx())).toBeNull()
    expect(choose(GRAPH, 'missing', 'bye', ctx())).toBeNull()
  })
})

describe('room menu', () => {
  test('offers the level’s rooms in tour order, bar the player’s, before the line’s own', () => {
    const { line } = enter(GRAPH, 'rooms', ctx())!
    expect(ids(line.choices)).toEqual([
      'room:kitchen',
      'room:hall',
      'room:bed',
      'room:storage',
      'room:nook',
      'back',
    ])
    expect(line.choices[0]!.label).toBe('주방으로 가요')
    expect(line.choices[1]!.label).toBe('복도로 가요')
  })

  test('fills the list up to the choice keys', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      room(`r${i}`, `방 ${i}`, 20 - i, rect(20 + i, 0, 21 + i, 1)),
    )
    const facts = { ...FACTS, rooms: many }
    const { line } = enter(GRAPH, 'rooms', ctx({ facts, roomId: null, tourStart: null }))!
    expect(line.choices).toHaveLength(MAX_CHOICES)
    expect(line.choices.at(-1)!.id).toBe('back')
  })

  test('a room choice guides there and comes back to the menu', () => {
    const result = choose(GRAPH, 'rooms', 'room:bed', ctx())!
    expect(result.effects).toEqual([
      { kind: 'guideTo', roomId: 'bed' },
      { kind: 'say', text: '좋아요, 안방으로 안내할게요. 따라오세요!' },
    ])
    expect(result.next).toBe('rooms')
    expect(result.label).toBe('안방으로 가요')
  })

  test('a room the menu doesn’t offer is refused', () => {
    expect(choose(GRAPH, 'rooms', 'room:attic', ctx())).toBeNull()
    expect(choose(GRAPH, 'rooms', 'room:living', ctx())).toBeNull()
  })
})

describe('tour', () => {
  test('breadth-first through the doors, larger rooms first, then unreached rooms', () => {
    expect(tourOrder(FACTS, 'level_1', 'living').map((r) => r.id)).toEqual([
      'living',
      'kitchen',
      'hall',
      'bed',
      'storage',
      'nook',
    ])
    expect(tourOrder(FACTS, 'level_1', 'bed').map((r) => r.id)).toEqual([
      'bed',
      'hall',
      'living',
      'kitchen',
      'storage',
      'nook',
    ])
  })

  test('without a start it begins at the largest room', () => {
    expect(tourOrder(FACTS, 'level_1', null)[0]!.id).toBe('living')
    expect(tourOrder(null, 'level_1', null)).toEqual([])
  })

  test('@next goes to the next room neither shown nor underfoot', () => {
    expect(enter(GRAPH, 'tour', ctx())!.effects).toEqual([{ kind: 'guideTo', roomId: 'kitchen' }])
    expect(enter(GRAPH, 'tour', ctx({ roomId: 'kitchen', visited: ['living'] }))!.effects).toEqual([
      { kind: 'guideTo', roomId: 'hall' },
    ])
  })

  test('@next says so once every room was shown', () => {
    const visited = ['living', 'kitchen', 'hall', 'bed', 'storage', 'nook']
    expect(enter(GRAPH, 'tour', ctx({ visited }))!.effects).toEqual([
      { kind: 'say', text: '이제 모든 방을 다 둘러보셨어요.' },
    ])
  })

  test('a room on another level can’t be guided to', () => {
    const [guide, described] = enter(GRAPH, 'there', ctx())!.effects
    expect(guide).toEqual({ kind: 'say', text: '그 방은 지금 안내해 드리기 어려워요.' })
    expect(described).toEqual({
      kind: 'say',
      text: '안방은 면적이 약 15㎡예요.',
    })
  })
})

describe('describeRoom', () => {
  test('where the player stands: area, floor, top furniture, windows', () => {
    expect(describeRoomKo(ROOMS[0]!, true)).toBe(
      '여기는 거실이에요. 면적은 약 32㎡이고, 바닥은 헤링본 마루예요. 의자 4개, 소파, 테이블이 놓여 있어요. 창이 3개 있어서 밝아요.',
    )
  })

  test('another room, without a floor material', () => {
    expect(describeRoomKo(ROOMS[1]!, false)).toBe('주방은 면적이 약 12㎡예요.')
    expect(describeRoomKo({ ...ROOMS[1]!, name: '드레스룸' }, false)).toBe(
      '드레스룸은 면적이 약 12㎡예요.',
    )
  })

  test('without facts it says there is nothing to tell', () => {
    expect(enter(GRAPH, 'more', ctx({ facts: null }))!.effects[1]).toEqual({
      kind: 'say',
      text: '이곳은 따로 소개해 드릴 정보가 없어요.',
    })
  })
})

describe('roomAt', () => {
  test('the smallest room holding the point, on that level', () => {
    expect(roomAt(FACTS, 'level_1', [3, 3])?.id).toBe('living')
    expect(roomAt(FACTS, 'level_1', [1.5, 1.5])?.id).toBe('nook')
    expect(roomAt(FACTS, 'level_2', [1.5, 1.5])?.id).toBe('attic')
    expect(roomAt(FACTS, 'level_1', [50, 50])).toBeNull()
    expect(roomAt(FACTS, 'level_1', null)).toBeNull()
  })
})

describe('with the preset templates', () => {
  test('the tour starts at the next room and returns to its menu', () => {
    const tour = npcDialogueTemplate('tour')
    const welcome = enter(tour, tour.start, ctx())!
    expect(ids(welcome.line.choices)).toEqual(['here', 'rooms', 'tour', 'ask', 'bye'])
    const picked = choose(tour, tour.start, 'tour', ctx())!
    expect(picked.effects).toEqual([{ kind: 'guideTo', roomId: 'kitchen' }])
    expect(picked.next).toBe('lead')
    expect(enter(tour, 'lead', ctx())!.line.next).toBe('menu')
  })

  test('small talk hides “같이 가요” once following', () => {
    const smallTalk = npcDialogueTemplate('smallTalk')
    const flags = new Set(['following'])
    expect(ids(enter(smallTalk, 'hello', ctx({ flags }))!.line.choices)).toEqual([
      'weather',
      'house',
      'stop',
      'bye',
    ])
  })
})
