import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  LightNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { CabinetNode } from '../../cabinet/schema'
import type { NpcNameResolvers } from '../types'
import { formatSceneFactsKo } from './format-ko'
import { collectSceneFacts } from './scene-facts'

type Point = [number, number]

const ITEM_NAMES: Record<string, string> = {
  sofa: '소파',
  'dining-chair': '식탁 의자',
  books: '책',
}
const MATERIAL_NAMES: Record<string, string> = {
  'library:wood-hungarianparquet10': '헤링본 마루 10',
  'library:flooring-tile85a': '쿼리 타일',
  'library:concrete-plaster': '도장 미장',
}
const names: NpcNameResolvers = {
  item: (asset) => ITEM_NAMES[asset.id] ?? asset.name,
  material: (ref) => MATERIAL_NAMES[ref] ?? '',
}

const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Point[] => [
  [minX, minZ],
  [maxX, minZ],
  [maxX, maxZ],
  [minX, maxZ],
]

function asset(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, name, category: 'furniture', thumbnail: '/t.webp', src: '/m.glb', ...extra }
}

function scene(list: { id: string }[]): Record<string, AnyNode> {
  return Object.fromEntries(list.map((node) => [node.id, node as AnyNode]))
}

/**
 * Ground floor: 거실 (zone, 6×5) | 주방 (zone, 4×5) split by a wall with a door,
 * an outside wall with a window, one slab under both and a tiled auto slab
 * under the kitchen, and an unzoned auto slab room behind (4×3, a 1 m² hole).
 * First floor: one zone with the editor's default name.
 */
function house() {
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ level: 0, parentId: building.id })
  const upper = LevelNode.parse({ level: 1, parentId: building.id })
  const on = { parentId: ground.id }
  const living = ZoneNode.parse({ ...on, name: '거실', polygon: rect(0, 0, 6, 5) })
  const kitchen = ZoneNode.parse({ ...on, name: '주방', polygon: rect(6, 0, 10, 5) })
  const base = SlabNode.parse({
    ...on,
    polygon: rect(0, 0, 10, 5),
    slots: { surface: 'library:wood-hungarianparquet10' },
  })
  const kitchenFloor = SlabNode.parse({
    ...on,
    name: 'Room 2 Slab',
    autoFromWalls: true,
    polygon: rect(6, 0, 10, 5),
    slots: { surface: 'library:flooring-tile85a' },
  })
  const back = SlabNode.parse({
    ...on,
    name: 'Room 3 Slab',
    autoFromWalls: true,
    polygon: rect(0, 5, 4, 8),
    holes: [rect(1, 6, 2, 7)],
  })
  // Runs +Z, so its front (left) face looks at -X: the living room.
  const split = WallNode.parse({
    ...on,
    start: [6, 0],
    end: [6, 5],
    thickness: 0.1,
    slots: { interior: 'library:concrete-plaster' },
  })
  const outside = WallNode.parse({ ...on, start: [0, 0], end: [10, 0], thickness: 0.2 })
  const door = DoorNode.parse({ parentId: split.id, wallId: split.id, position: [2.5, 1.05, 0] })
  const window = WindowNode.parse({
    parentId: outside.id,
    wallId: outside.id,
    position: [3, 1.2, 0],
  })
  const ceiling = CeilingNode.parse({ ...on, polygon: rect(0, 0, 10, 5), height: 2.4 })
  const sofa = ItemNode.parse({ ...on, asset: asset('sofa', 'Sofa'), position: [2, 0, 2] })
  const renamed = ItemNode.parse({
    ...on,
    name: '엄마 소파',
    asset: asset('sofa', 'Sofa'),
    position: [1, 0, 1],
  })
  const books = ItemNode.parse({
    parentId: sofa.id,
    asset: asset('books', 'Books'),
    position: [0.3, 0.5, 0],
  })
  const chairs = [8, 8.5].map((x) =>
    ItemNode.parse({ ...on, asset: asset('dining-chair', 'Dining Chair'), position: [x, 0, 2] }),
  )
  // On the wall's back face, so in the kitchen.
  const clock = ItemNode.parse({
    parentId: split.id,
    wallId: split.id,
    side: 'back',
    asset: asset('clock', 'Clock', { attachTo: 'wall-side' }),
    position: [1, 1.5, 0],
  })
  const hidden = ItemNode.parse({
    ...on,
    visible: false,
    asset: asset('sofa', 'Sofa'),
    position: [3, 0, 3],
  })
  const lamp = LightNode.parse({ ...on, position: [8, 2.4, 3] })
  const cabinets = [
    CabinetNode.parse({
      ...on,
      family: 'base',
      variant: 'sink',
      widthMm: 1200,
      position: [9, 0, 1],
      frontColor: '#ffffff',
    }),
    CabinetNode.parse({
      ...on,
      family: 'base',
      variant: 'cooktop',
      widthMm: 800,
      position: [8, 0, 1],
      frontColor: '#fafafa',
    }),
    CabinetNode.parse({ ...on, family: 'upper', widthMm: 1800, position: [8.5, 1.4, 0.4] }),
    CabinetNode.parse({
      ...on,
      family: 'tall',
      widthMm: 2400,
      position: [1, 0, 4.5],
      frontColor: '#1a1a1a',
    }),
  ]
  const room = ZoneNode.parse({ parentId: upper.id, name: 'Zone 1', polygon: rect(0, 0, 3, 3) })

  const nodes = scene([
    building,
    ground,
    upper,
    living,
    kitchen,
    base,
    kitchenFloor,
    back,
    split,
    outside,
    door,
    window,
    ceiling,
    sofa,
    renamed,
    books,
    ...chairs,
    clock,
    hidden,
    lamp,
    ...cabinets,
    room,
  ])
  return { nodes, ids: { living: living.id, kitchen: kitchen.id, back: back.id } }
}

function roomNamed(facts: ReturnType<typeof collectSceneFacts>, name: string) {
  const room = facts.rooms.find((candidate) => candidate.name === name)
  if (!room) throw new Error(`no room ${name}`)
  return room
}

describe('collectSceneFacts', () => {
  const { nodes, ids } = house()
  const facts = collectSceneFacts(nodes, names)

  test('zones win; auto slabs outside every zone are rooms too, named 공간 N', () => {
    expect(facts.buildings).toBe(1)
    expect(facts.levels.map((level) => level.name)).toEqual(['1층', '2층'])
    expect(facts.levels[0]!.rooms.map((room) => room.name)).toEqual(['거실', '주방', '공간 3'])
    expect(facts.levels[1]!.rooms.map((room) => room.name)).toEqual(['구역 1'])
    expect(facts.rooms).toHaveLength(4)
  })

  test('area leaves out holes; centroids are level-local', () => {
    expect(roomNamed(facts, '거실').area).toBe(30)
    expect(roomNamed(facts, '공간 3').area).toBe(11)
    expect(roomNamed(facts, '거실').centroid).toEqual([3, 2.5])
    expect(facts.totalArea).toBe(30 + 20 + 11 + 9)
  })

  test('a door links the rooms on both sides; a window counts for the room it opens', () => {
    expect(roomNamed(facts, '거실').doorsTo).toEqual([ids.kitchen])
    expect(roomNamed(facts, '주방').doorsTo).toEqual([ids.living])
    expect(roomNamed(facts, '공간 3').doorsTo).toEqual([])
    expect(roomNamed(facts, '거실').windows).toBe(1)
    expect(roomNamed(facts, '주방').windows).toBe(0)
  })

  test('floor from the smallest slab under the room, walls from the face towards it', () => {
    expect(roomNamed(facts, '거실').floorMaterial).toBe('헤링본 마루 10')
    expect(roomNamed(facts, '주방').floorMaterial).toBe('쿼리 타일')
    expect(roomNamed(facts, '공간 3').floorMaterial).toBeUndefined()
    expect(roomNamed(facts, '거실').wallMaterial).toBe('도장 미장')
    expect(roomNamed(facts, '주방').wallMaterial).toBeUndefined()
    expect(roomNamed(facts, '거실').ceilingHeight).toBe(2.4)
    expect(roomNamed(facts, '공간 3').ceilingHeight).toBeUndefined()
  })

  test('furniture is grouped per room, wall and nested items included, hidden ones not', () => {
    expect(roomNamed(facts, '거실').furniture).toEqual([
      { name: '소파', count: 1 },
      { name: '엄마 소파', count: 1 },
      { name: '책', count: 1 },
    ])
    expect(roomNamed(facts, '주방').furniture).toEqual([
      { name: '식탁 의자', count: 2 },
      { name: 'Clock', count: 1 },
    ])
    expect(roomNamed(facts, '주방').lights).toBe(1)
    expect(roomNamed(facts, '거실').lights).toBe(0)
  })

  test('cabinets keep family, variant, width and a named finish', () => {
    expect(roomNamed(facts, '주방').cabinets).toContainEqual({
      family: 'base',
      variant: 'sink',
      widthMm: 1200,
      finish: '화이트',
    })
    expect(roomNamed(facts, '주방').cabinets).toHaveLength(3)
    expect(roomNamed(facts, '거실').cabinets).toEqual([
      { family: 'tall', variant: 'standard', widthMm: 2400, finish: '블랙' },
    ])
  })

  test('the same scene in any order gives the same facts', () => {
    const reversed = Object.fromEntries(Object.entries(nodes).reverse())
    expect(collectSceneFacts(reversed, names)).toEqual(facts)
  })

  test('without zones or auto slabs, plain slabs are the rooms', () => {
    const level = LevelNode.parse({ level: 0 })
    const slab = SlabNode.parse({ parentId: level.id, polygon: rect(0, 0, 5, 4) })
    const facts = collectSceneFacts(scene([level, slab]), names)
    expect(facts.rooms.map((room) => [room.name, room.area])).toEqual([['공간 1', 20]])
    expect(facts.buildings).toBe(0)
  })

  test('auto slab rooms keep their detected names', () => {
    const level = LevelNode.parse({ level: -1, name: '' })
    const plain = SlabNode.parse({ parentId: level.id, polygon: rect(0, 0, 9, 9) })
    const auto = SlabNode.parse({
      parentId: level.id,
      name: '드레스룸',
      autoFromWalls: true,
      polygon: rect(0, 0, 2, 2),
    })
    const facts = collectSceneFacts(scene([level, plain, auto]), names)
    expect(facts.levels[0]!.name).toBe('지하 1층')
    expect(facts.rooms.map((room) => room.name)).toEqual(['드레스룸'])
  })
})

describe('formatSceneFactsKo', () => {
  const facts = collectSceneFacts(house().nodes, names)

  test('the house in Korean, rooms with their details', () => {
    const text = formatSceneFactsKo(facts, 'rooms-furniture')
    expect(text.split('\n').slice(0, 5)).toEqual([
      '[집 정보]',
      '- 건물 1동, 2개 층, 전체 바닥면적 약 70㎡, 방 4개',
      '## 1층',
      '- 거실 약 30㎡ · 천장 2.4m · 바닥 헤링본 마루 10 · 벽 도장 미장 · 창 1 · 연결: 주방',
      '  가구: 소파 1, 엄마 소파 1, 책 1 · 붙박이장 2.4m(블랙)',
    ])
    expect(text).toContain(
      '  가구: 식탁 의자 2, Clock 1 · 주방가구: 하부장 2.0m(화이트, 싱크·쿡탑 포함), 상부장 1.8m(아이보리) · 조명 1',
    )
    expect(text).toContain('- 공간 3 약 11㎡')
    expect(text).toContain('## 2층\n- 구역 1 약 9㎡')
  })

  test('scope: none says nothing, rooms leaves out furniture', () => {
    expect(formatSceneFactsKo(facts, 'none')).toBe('')
    const rooms = formatSceneFactsKo(facts, 'rooms')
    expect(rooms).toContain('- 주방 약 20㎡')
    expect(rooms).not.toContain('가구')
  })

  test('the same facts give the same bytes', () => {
    expect(formatSceneFactsKo(facts, 'rooms-furniture')).toBe(
      formatSceneFactsKo(collectSceneFacts(house().nodes, names), 'rooms-furniture'),
    )
  })

  test('past the cap, furniture lines go first, then rooms from the end', () => {
    const full = formatSceneFactsKo(facts, 'rooms-furniture')
    const roomsOnly = formatSceneFactsKo(facts, 'rooms')
    expect(formatSceneFactsKo(facts, 'rooms-furniture', roomsOnly.length)).toBe(roomsOnly)
    const withSome = formatSceneFactsKo(facts, 'rooms-furniture', full.length - 1)
    expect(withSome).toContain('가구: 소파 1')
    expect(withSome.length).toBeLessThan(full.length)
    const cut = formatSceneFactsKo(facts, 'rooms-furniture', 120)
    expect(cut.length).toBeLessThanOrEqual(120)
    expect(cut.startsWith('[집 정보]')).toBe(true)
    expect(cut.endsWith('- …(이하 생략)')).toBe(true)
  })

  test('a scene without rooms says so', () => {
    const empty = collectSceneFacts({}, names)
    expect(formatSceneFactsKo(empty, 'rooms')).toBe('[집 정보]\n- 등록된 방 정보가 없습니다.')
  })
})
