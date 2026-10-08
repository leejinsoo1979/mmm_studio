import { describe, expect, test } from 'bun:test'
import type { AnyNodeId } from '@pascal-app/core'
import { liftedNpcIds } from './dirty-marks'

const id = (value: string) => value as AnyNodeId

const nodes = {
  npc_a: { type: 'npc' },
  npc_b: { type: 'npc' },
  item_a: { type: 'item' },
  spawn_a: { type: 'spawn' },
}

describe('liftedNpcIds', () => {
  test('takes the dirty NPCs whose marker is mounted', () => {
    const dirty = new Set([id('npc_a'), id('npc_b'), id('item_a')])
    const mounted = new Set(['npc_a', 'item_a'])
    expect(liftedNpcIds(dirty, nodes, mounted)).toEqual([id('npc_a')])
  })

  test('leaves other kinds’ marks to their own consumers', () => {
    const dirty = new Set([id('item_a'), id('spawn_a')])
    const mounted = new Set(['item_a', 'spawn_a'])
    expect(liftedNpcIds(dirty, nodes, mounted)).toEqual([])
  })

  test('keeps an NPC dirty until its marker mounts, so its floor lift still runs', () => {
    expect(liftedNpcIds(new Set([id('npc_b')]), nodes, new Set())).toEqual([])
  })

  test('skips marks of nodes that are gone', () => {
    expect(liftedNpcIds(new Set([id('npc_gone')]), nodes, new Set(['npc_gone']))).toEqual([])
  })
})
