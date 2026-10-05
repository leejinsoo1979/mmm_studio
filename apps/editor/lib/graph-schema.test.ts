import { describe, expect, test } from 'bun:test'
import { CabinetNode, CountertopNode } from '@pascal-app/nodes/cabinet/schema'
import { NpcNode } from '@pascal-app/nodes/npc/schema'
import { apiGraphSchema } from './graph-schema'

const graphWith = (node: Record<string, unknown>) => ({
  nodes: { [node.id as string]: node },
  rootNodeIds: [node.id as string],
})

describe('apiGraphSchema', () => {
  test('accepts cabinet and countertop nodes', () => {
    const cabinet = CabinetNode.parse({ name: '옷장' })
    const top = CountertopNode.parse({
      cutouts: [{ id: 's', kind: 'sink', centerMm: 450, widthMm: 800, depthMm: 460 }],
    })
    expect(apiGraphSchema.safeParse(graphWith(cabinet)).success).toBe(true)
    expect(apiGraphSchema.safeParse(graphWith(top)).success).toBe(true)
  })

  test('rejects a cabinet with a non-hex colour', () => {
    const cabinet = { ...CabinetNode.parse({}), bodyColor: 'url(javascript:alert(1))' }
    expect(apiGraphSchema.safeParse(graphWith(cabinet)).success).toBe(false)
  })

  test('accepts an NPC and rejects one with a broken dialogue graph', () => {
    const npc = NpcNode.parse({
      name: '지아',
      dialogue: { start: 'hi', lines: [{ id: 'hi', text: '안녕하세요!' }] },
    })
    expect(apiGraphSchema.safeParse(graphWith(npc)).success).toBe(true)
    const broken = { ...npc, dialogue: { start: 'missing', lines: npc.dialogue?.lines } }
    expect(apiGraphSchema.safeParse(graphWith(broken)).success).toBe(false)
  })

  test('still rejects unknown node types', () => {
    expect(apiGraphSchema.safeParse(graphWith({ id: 'x_1', type: 'mystery' })).success).toBe(false)
  })
})

describe('apiGraphSchema level children', () => {
  test('a level may hold cabinet, countertop and NPC ids', () => {
    const cabinet = CabinetNode.parse({ parentId: 'level_a' })
    const top = CountertopNode.parse({ parentId: 'level_a' })
    const npc = NpcNode.parse({ parentId: 'level_a' })
    const level = {
      object: 'node',
      id: 'level_a',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      level: 0,
      children: [cabinet.id, top.id, npc.id],
    }
    const graph = {
      nodes: { level_a: level, [cabinet.id]: cabinet, [top.id]: top, [npc.id]: npc },
      rootNodeIds: ['level_a'],
    }
    const result = apiGraphSchema.safeParse(graph)
    expect(result.error?.issues ?? []).toEqual([])
  })
})

describe('apiGraphSchema scene materials', () => {
  const cabinet = CabinetNode.parse({})
  const material = (url?: string) => ({
    id: 'mat_a',
    name: '사용자 색',
    material: {
      preset: 'custom',
      properties: { color: '#1e8449', roughness: 0.4 },
      ...(url ? { texture: { url } } : {}),
    },
  })

  test('keeps the materials that painted slots refer to', () => {
    const result = apiGraphSchema.safeParse({
      ...graphWith(cabinet),
      materials: { mat_a: material() },
    })
    expect(result.success).toBe(true)
    expect(result.data?.materials?.mat_a?.material.properties?.color).toBe('#1e8449')
  })

  test('drops a material with a disallowed texture URL without rejecting the save', () => {
    const result = apiGraphSchema.safeParse({
      ...graphWith(cabinet),
      materials: { mat_a: material('/material/wood/a.webp'), mat_b: material('javascript:x') },
    })
    expect(result.success).toBe(true)
    expect(Object.keys(result.data?.materials ?? {})).toEqual(['mat_a'])
  })
})
