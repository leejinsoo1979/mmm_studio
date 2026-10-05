import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { buildNpcFloorplan } from '../floorplan'
import { NPC_ROLE_COLORS } from '../presets'
import { NpcNode } from '../schema'

const PALETTE = {
  selectedStroke: '#60a5fa',
  selectedFill: '#dbeafe',
  selectedHatch: '#60a5fa',
  wallHoverStroke: '#60a5fa',
  wallFill: '#111111',
  endpointHandleFill: '#fed7aa',
  endpointHandleStroke: '#f97316',
  endpointHandleHoverStroke: '#fb923c',
  endpointHandleActiveFill: '#fdba74',
  endpointHandleActiveStroke: '#ea580c',
  curveHandleFill: '#99f6e4',
  curveHandleStroke: '#14b8a6',
  curveHandleHoverStroke: '#2dd4bf',
  measurementStroke: '#6366f1',
  measurementLabelBackground: '#ffffff',
  measurementLabelText: '#111827',
}

function context(selected: boolean): GeometryContext {
  return {
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
    viewState: {
      selected,
      highlighted: false,
      hovered: false,
      moving: false,
      palette: PALETTE,
    },
  }
}

function flatten(geometry: FloorplanGeometry): FloorplanGeometry[] {
  if (geometry.kind !== 'group') return [geometry]
  return geometry.children.flatMap(flatten)
}

const npc = (fields: Parameters<typeof NpcNode.parse>[0] = {}) =>
  NpcNode.parse({
    id: 'npc_test1234567890ab',
    name: '지아',
    position: [1, 0, 2],
    rotation: Math.PI / 2,
    ...fields,
  })

describe('buildNpcFloorplan', () => {
  test('marker: role disc and facing wedge turned to the yaw, a transparent hit circle, the name', () => {
    const node = npc({ role: 'guide' })
    const geometry = buildNpcFloorplan(node, context(false))
    const flat = flatten(geometry)

    const marker =
      geometry.kind === 'group'
        ? geometry.children.find((child) => child.kind === 'group' && child.transform)
        : undefined
    expect(marker?.kind === 'group' && marker.transform).toEqual({
      translate: [1, 2],
      rotate: -Math.PI / 2,
    })

    const color = NPC_ROLE_COLORS.guide
    expect(flat.some((g) => g.kind === 'circle' && g.fill === color && g.r === 0.28)).toBe(true)
    expect(flat.some((g) => g.kind === 'polygon' && g.fill === color)).toBe(true)
    expect(
      flat.some(
        (g) => g.kind === 'circle' && g.fill === 'transparent' && g.pointerEvents === 'all',
      ),
    ).toBe(true)
    expect(flat.some((g) => g.kind === 'text' && g.text === '지아' && g.upright)).toBe(true)
  })

  test('unselected: no handles and no behaviour overlay', () => {
    const node = npc({
      behavior: {
        mode: 'patrol',
        patrol: [
          [0, 0],
          [3, 0],
        ],
      },
    })
    const kinds = flatten(buildNpcFloorplan(node, context(false))).map((g) => g.kind)
    expect(kinds).not.toContain('move-handle')
    expect(kinds).not.toContain('rotate-arrow')
    expect(kinds).not.toContain('endpoint-handle')
    expect(kinds).not.toContain('polyline')
  })

  test('selected: move handle and the npc-rotate arrow around the NPC', () => {
    const flat = flatten(buildNpcFloorplan(npc(), context(true)))
    expect(flat.some((g) => g.kind === 'move-handle' && g.point[0] === 1 && g.point[1] === 2)).toBe(
      true,
    )
    const arrow = flat.find((g) => g.kind === 'rotate-arrow')
    expect(arrow?.kind === 'rotate-arrow' && arrow.affordance).toBe('npc-rotate')
    expect(arrow?.kind === 'rotate-arrow' && arrow.pivot).toEqual([1, 2])
  })

  test('selected wanderer: a dashed, click-through ring of the wander radius', () => {
    const node = npc({ behavior: { mode: 'wander', wanderRadius: 5 } })
    const ring = flatten(buildNpcFloorplan(node, context(true))).find(
      (g) => g.kind === 'circle' && g.r === 5,
    )
    expect(ring?.kind).toBe('circle')
    if (ring?.kind !== 'circle') return
    expect([ring.cx, ring.cy]).toEqual([1, 2])
    expect(ring.strokeDasharray).toBeDefined()
    expect(ring.pointerEvents).toBe('none')
  })

  test('selected patroller: the path closes on loop, and every point is a numbered handle', () => {
    const patrol: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
    ]
    const flat = flatten(
      buildNpcFloorplan(npc({ behavior: { mode: 'patrol', patrol } }), context(true)),
    )

    const path = flat.find((g) => g.kind === 'polyline')
    expect(path?.kind === 'polyline' && path.points).toEqual([...patrol, patrol[0]!])

    const handles = flat.filter((g) => g.kind === 'endpoint-handle')
    expect(handles).toHaveLength(3)
    handles.forEach((handle, index) => {
      if (handle.kind !== 'endpoint-handle') return
      expect(handle.affordance).toBe('npc-patrol-point')
      expect(handle.payload).toEqual({ index })
      expect(handle.point).toEqual(patrol[index]!)
    })
    expect(flat.filter((g) => g.kind === 'text').map((g) => g.kind === 'text' && g.text)).toEqual([
      '지아',
      '1',
      '2',
      '3',
    ])
  })

  test('pingpong paths stay open', () => {
    const patrol: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
    ]
    const node = npc({ behavior: { mode: 'patrol', patrol, patrolLoop: 'pingpong' } })
    const path = flatten(buildNpcFloorplan(node, context(true))).find((g) => g.kind === 'polyline')
    expect(path?.kind === 'polyline' && path.points).toEqual(patrol)
  })

  test('the ring and the path belong to their mode only', () => {
    const node = npc({
      behavior: {
        mode: 'stand',
        wanderRadius: 5,
        patrol: [
          [0, 0],
          [3, 0],
        ],
      },
    })
    const flat = flatten(buildNpcFloorplan(node, context(true)))
    expect(flat.some((g) => g.kind === 'circle' && g.r === 5)).toBe(false)
    expect(flat.some((g) => g.kind === 'polyline' || g.kind === 'endpoint-handle')).toBe(false)
  })
})
