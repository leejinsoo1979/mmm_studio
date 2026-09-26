import { describe, expect, test } from 'bun:test'
import { CabinetNode, CountertopNode } from '@pascal-app/nodes/cabinet/schema'
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

  test('still rejects unknown node types', () => {
    expect(apiGraphSchema.safeParse(graphWith({ id: 'x_1', type: 'mystery' })).success).toBe(false)
  })
})

describe('apiGraphSchema level children', () => {
  test('a level may hold cabinet and countertop ids', () => {
    const cabinet = CabinetNode.parse({ parentId: 'level_a' })
    const top = CountertopNode.parse({ parentId: 'level_a' })
    const level = {
      object: 'node',
      id: 'level_a',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      level: 0,
      children: [cabinet.id, top.id],
    }
    const graph = {
      nodes: { level_a: level, [cabinet.id]: cabinet, [top.id]: top },
      rootNodeIds: ['level_a'],
    }
    const result = apiGraphSchema.safeParse(graph)
    expect(result.error?.issues ?? []).toEqual([])
  })
})
