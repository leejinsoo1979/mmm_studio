import { describe, expect, test } from 'bun:test'
import type { RoomFact, SceneFacts } from '../types'
import { dayPartKo, formatArea, renderTemplate, sceneVars } from './templates'

const room = (id: string, name: string, area: number): RoomFact => ({
  id,
  name,
  levelId: 'level_1',
  area,
  centroid: [0, 0],
  polygon: [],
  windows: 0,
  doorsTo: [],
  furniture: [],
  cabinets: [],
  lights: 0,
})

describe('renderTemplate', () => {
  test('fills variables', () => {
    expect(
      renderTemplate('안녕하세요, {player}님! 저는 {npc}예요.', { player: '민준', npc: '지아' }),
    ).toBe('안녕하세요, 민준님! 저는 지아예요.')
  })

  test('josa pairs follow the value', () => {
    expect(renderTemplate('{npc:와/과} 함께', { npc: '지아' })).toBe('지아와 함께')
    expect(renderTemplate('{npc:와/과} 함께', { npc: '민준' })).toBe('민준과 함께')
    expect(renderTemplate('{room:으로/로} 가요', { room: '거실' })).toBe('거실로 가요')
    expect(renderTemplate('{room:으로/로} 가요', { room: '안방' })).toBe('안방으로 가요')
    expect(renderTemplate('저는 {npc:이에요/예요}', { npc: '안내원' })).toBe('저는 안내원이에요')
    expect(renderTemplate('{player:이/가} 왔어요', { player: '지아' })).toBe('지아가 왔어요')
  })

  test('unknown and empty variables render as nothing, particle included', () => {
    expect(renderTemplate('[{weather}]', {})).toBe('[]')
    expect(renderTemplate('[{room:으로/로}]', { room: '' })).toBe('[]')
    expect(renderTemplate('[{constructor}]', {})).toBe('[]')
  })

  test('leaves text that is not a variable alone', () => {
    expect(renderTemplate('{ 공백 } {} {a:b}', { npc: '지아' })).toBe('{ 공백 } {} {a:b}')
  })
})

describe('dayPartKo', () => {
  test('morning, afternoon, evening', () => {
    expect(dayPartKo(8)).toBe('아침')
    expect(dayPartKo(13.5)).toBe('오후')
    expect(dayPartKo(19)).toBe('저녁')
    expect(dayPartKo(2)).toBe('저녁')
  })
})

describe('formatArea', () => {
  test('one decimal, none when whole', () => {
    expect(formatArea(12.345)).toBe('12.3')
    expect(formatArea(32)).toBe('32')
    expect(formatArea(31.96)).toBe('32')
  })
})

describe('sceneVars', () => {
  const facts: SceneFacts = {
    buildings: 1,
    levels: [{ id: 'level_1', name: '1층', index: 0, rooms: [] }],
    rooms: [room('zone_living', '거실', 32.14), room('zone_kitchen', '주방', 12)],
    totalArea: 44.14,
  }

  test('the player’s room, its level and the house', () => {
    expect(sceneVars(facts, 'level_1', 'zone_living')).toEqual({
      room: '거실',
      area: '32.1',
      level: '1층',
      houseArea: '44.1',
      roomCount: '2',
    })
  })

  test('outside every room: only the level and the house', () => {
    const vars = sceneVars(facts, 'level_1', null)
    expect(vars.room).toBeUndefined()
    expect(vars.area).toBeUndefined()
    expect(vars.level).toBe('1층')
    expect(renderTemplate('여기는 {room}', vars)).toBe('여기는 ')
  })

  test('no facts, no variables', () => {
    expect(sceneVars(null, 'level_1', 'zone_living')).toEqual({})
  })
})
