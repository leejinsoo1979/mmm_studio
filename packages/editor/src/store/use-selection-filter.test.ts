import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import {
  passesSelectionFilter,
  STRUCTURE_KINDS,
  structureKindOf,
  useSelectionFilter,
} from './use-selection-filter'

const node = (type: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${type}_1`, type, ...extra }) as unknown as AnyNode

describe('selection filter structure kinds', () => {
  beforeEach(() => {
    useSelectionFilter.setState({
      furniture: true,
      structure: true,
      structureKinds: Object.fromEntries(STRUCTURE_KINDS.map((k) => [k, true])) as never,
    })
  })

  test('maps node types onto the inZOI structure chips', () => {
    expect(structureKindOf(node('slab'))).toBe('floor')
    expect(structureKindOf(node('ceiling'))).toBe('floor')
    expect(structureKindOf(node('wall'))).toBe('wall')
    expect(structureKindOf(node('fence'))).toBe('wall')
    expect(structureKindOf(node('roof'))).toBe('roof')
    expect(structureKindOf(node('stair'))).toBe('stair')
    expect(structureKindOf(node('door'))).toBe('opening')
    expect(structureKindOf(node('window'))).toBe('opening')
    expect(structureKindOf(node('item', { asset: { category: 'door' } }))).toBe('opening')
    expect(structureKindOf(node('column'))).toBe('other')
  })

  test('a switched-off kind blocks only that kind', () => {
    useSelectionFilter.getState().toggleKind('wall')
    expect(passesSelectionFilter(node('wall'))).toBe(false)
    expect(passesSelectionFilter(node('door'))).toBe(true)
    expect(passesSelectionFilter(node('slab'))).toBe(true)
    useSelectionFilter.getState().toggleKind('wall')
    expect(passesSelectionFilter(node('wall'))).toBe(true)
  })

  test('the structure switch still gates every structure kind', () => {
    useSelectionFilter.getState().toggle('structure')
    expect(passesSelectionFilter(node('slab'))).toBe(false)
    expect(passesSelectionFilter(node('item', { asset: { category: 'chair' } }))).toBe(true)
  })
})
