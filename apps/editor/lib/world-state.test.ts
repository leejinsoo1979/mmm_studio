import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, useInteractive, useScene } from '@pascal-app/core'
import {
  type NpcEngagement,
  useCabinetDoors,
  useItemScreens,
  useNpcRuntime,
} from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { applyWorldEntry, readWorld } from './world-state'

// Scene updates flush on the next frame.
globalThis.requestAnimationFrame ??= (callback) => setTimeout(() => callback(0), 0) as never
globalThis.cancelAnimationFrame ??= (handle) => clearTimeout(handle)

const noDecks = () => Promise.reject(new Error('no decks here'))

const nodes = {
  door_a: { id: 'door_a', type: 'door', doorType: 'hinged', swingAngle: 0 },
  window_a: { id: 'window_a', type: 'window', windowType: 'casement', operationState: 0 },
  'light-switch_a': { id: 'light-switch_a', type: 'light-switch', gangs: 2, on: [false, false] },
  item_lamp: {
    id: 'item_lamp',
    type: 'item',
    asset: {
      interactive: {
        controls: [{ kind: 'toggle', label: 'Power', default: false }],
        effects: [],
      },
    },
  },
} as unknown as Record<string, AnyNode>

beforeEach(() => {
  useScene.setState({ nodes } as never)
  useInteractive.setState({
    items: {},
    doors: {},
    doorAnimations: {},
    windows: {},
    windowAnimations: {},
  })
  useCabinetDoors.setState({ open: false, cabinetOpen: {} })
  useItemScreens.setState({ screens: {}, activeId: null })
  useViewer.getState().setWeather('clear')
  useNpcRuntime.setState({ epoch: null, localPlayerId: 'uid-me', engagements: {}, bubbles: {} })
})

/** Applies an entry as another player's change, and reads it back. */
function roundTrip(key: string, value: Parameters<typeof applyWorldEntry>[1]) {
  applyWorldEntry(key, value, noDecks)
  return readWorld()[key]
}

describe('world entries round-trip through the stores', () => {
  test('time and weather', () => {
    expect(roundTrip('clock', 21.5)).toBe(21.5)
    expect(roundTrip('weather', 'snow')).toBe('snow')
    expect(roundTrip('weather', 'hail')).toBe('snow')
  })

  test('a door swings and a window opens to the shared target', () => {
    expect(roundTrip('door:door_a', { f: 'swingAngle', v: Math.PI / 2 })).toEqual({
      f: 'swingAngle',
      v: Math.PI / 2,
    })
    expect(roundTrip('window:window_a', 1)).toBe(1)
  })

  test('a cabinet opens', () => {
    expect(roundTrip('cabinet:cabinet_k', true)).toBe(true)
  })

  test('a lamp is switched on before its model loads', () => {
    expect(roundTrip('item:item_lamp', [true])).toEqual([true])
  })

  test('a light switch flips its gangs', () => {
    expect(roundTrip('switch:light-switch_a', [false, true])).toEqual([false, true])
  })

  test("a TV switched on elsewhere stands by and doesn't take this player's remote", () => {
    expect(roundTrip('screen:item_tv', { k: 'idle', p: null })).toEqual({ k: 'idle', p: null })
    expect(useItemScreens.getState().activeId).toBeNull()
    // Another player's video can't play here: the TV stands by.
    expect(roundTrip('screen:item_tv', { k: 'video', label: 'clip.mp4', p: null })).toEqual({
      k: 'idle',
      p: null,
    })
    expect(roundTrip('screen:item_tv', null)).toBeUndefined()
  })

  test('a projection is thrown, moved and taken off with its screen', () => {
    const p = [0, 1.5, -2.996, 0, 0, 0, 1, 2.4]
    expect(roundTrip('screen:projector', { k: 'idle', p })).toEqual({ k: 'idle', p })
    expect(useItemScreens.getState().screens.projector?.projection).toEqual({
      position: [0, 1.5, -2.996],
      quaternion: [0, 0, 0, 1],
      width: 2.4,
    })
    const moved = [1, 1.2, -2.996, 0, 0, 0, 1, 3]
    expect(roundTrip('screen:projector', { k: 'idle', p: moved })).toEqual({ k: 'idle', p: moved })
    expect(roundTrip('screen:projector', { k: 'idle', p: null })).toEqual({ k: 'idle', p: null })
    expect(useItemScreens.getState().activeId).toBeNull()
  })

  test('a shared deck is downloaded once, then its pages turn', async () => {
    let downloads = 0
    const loadDeck = async (_deck: string, count: number) => {
      downloads++
      return Array.from({ length: count }, (_, n) => `data:image/jpeg;base64,${n}`)
    }
    const slides = { k: 'slides', deck: 'deck1', count: 3, index: 1, label: 'plan.pdf', p: null }
    applyWorldEntry('screen:item_tv', slides, loadDeck)
    await Promise.resolve()
    await Promise.resolve()
    expect(readWorld()['screen:item_tv']).toEqual(slides)
    applyWorldEntry('screen:item_tv', { ...slides, index: 2 }, loadDeck)
    expect(readWorld()['screen:item_tv']).toEqual({ ...slides, index: 2 })
    expect(downloads).toBe(1)
    expect(useItemScreens.getState().activeId).toBeNull()
  })
})

/** Merges `patch` into `stored` the way Firestore's set-with-merge does: maps field by field. */
function mergeInto(stored: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    const current = stored[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      mergeInto(current as Record<string, unknown>, value as Record<string, unknown>)
    } else stored[key] = value
  }
}

describe('a projection through a store that merges maps key by key (as Firestore does)', () => {
  test('taking a projection off stays off after the write comes back', async () => {
    const { WorldSync } = await import('./world-sync')
    const stored: Record<string, unknown> = {}
    const sync = new WorldSync(readWorld, (key, value) => applyWorldEntry(key, value, noDecks))
    const echo = () => sync.receive(structuredClone(stored) as never)
    echo()
    const screens = useItemScreens.getState()
    screens.setOn('projector', true)
    screens.setProjection('projector', {
      position: [0, 1.5, -3],
      quaternion: [0, 0, 0, 1],
      width: 2,
    })
    mergeInto(stored, sync.tick())
    echo()
    useItemScreens.getState().setProjection('projector', null)
    mergeInto(stored, sync.tick())
    echo()
    expect(useItemScreens.getState().screens.projector?.projection).toBeUndefined()
    expect((stored['screen:projector'] as { p: unknown }).p).toBeNull()
  })
})

describe('NPCs in the shared world', () => {
  const AT = 1_700_000_000_000
  const talk: NpcEngagement = {
    m: 'talk',
    by: 'uid-other',
    at: AT,
    p: [1.234, 2],
    yaw: 0.5,
    line: '여기는 거실이에요.',
  }

  test('the epoch and an engagement round-trip, every field written', () => {
    expect(roundTrip('npcEpoch', AT)).toBe(AT)
    expect(useNpcRuntime.getState().epoch).toBe(AT)
    expect(roundTrip('npc:npc_a', talk as never)).toEqual({
      m: 'talk',
      by: 'uid-other',
      at: AT,
      p: [1.23, 2],
      yaw: 0.5,
      line: '여기는 거실이에요.',
      room: null,
      act: null,
      ph: null,
      pt: null,
      won: null,
    })
    expect(useNpcRuntime.getState().engagements.npc_a).toEqual({ ...talk, p: [1.23, 2] })
    // Another player's line shows over the NPC.
    expect(useNpcRuntime.getState().bubbles.npc_a?.text).toBe('여기는 거실이에요.')
    expect(roundTrip('npc:npc_a', null)).toBeUndefined()
    expect(useNpcRuntime.getState().engagements.npc_a).toBeUndefined()
  })

  test("this player's engagement is shared; a malformed one is ignored", () => {
    useNpcRuntime
      .getState()
      .setEngagement('npc_b', { m: 'follow', by: 'uid-me', at: AT, p: [0, 0] })
    expect(readWorld()['npc:npc_b']).toMatchObject({ m: 'follow', by: 'uid-me', line: null })
    applyWorldEntry('npc:npc_b', { m: 'wrestle', at: AT, p: [0, 0] }, noDecks)
    expect(useNpcRuntime.getState().engagements.npc_b?.m).toBe('follow')
  })

  test('a field one engagement left out is not kept from the one before', async () => {
    const { WorldSync } = await import('./world-sync')
    const stored: Record<string, unknown> = {}
    const sync = new WorldSync(readWorld, (key, value) => applyWorldEntry(key, value, noDecks))
    const echo = () => sync.receive(structuredClone(stored) as never)
    echo()
    const runtime = useNpcRuntime.getState()
    runtime.setEpoch(AT)
    runtime.setEngagement('npc_a', { ...talk, by: 'uid-me' })
    mergeInto(stored, sync.tick())
    echo()
    expect(stored.npcEpoch).toBe(AT)
    // A new conversation that has said nothing yet, then the chase game.
    useNpcRuntime
      .getState()
      .setEngagement('npc_a', { m: 'talk', by: 'uid-me', at: AT + 5, p: [1, 2], yaw: 0 })
    mergeInto(stored, sync.tick())
    echo()
    expect((stored['npc:npc_a'] as { line: unknown }).line).toBeNull()
    useNpcRuntime.getState().setEngagement('npc_a', {
      m: 'chase',
      by: 'uid-me',
      at: AT + 9,
      p: [1, 2],
      ph: 'end',
      pt: AT + 9,
      won: 'player',
    })
    mergeInto(stored, sync.tick())
    echo()
    useNpcRuntime.getState().setEngagement('npc_a', {
      m: 'chase',
      by: 'uid-me',
      at: AT + 20,
      p: [1, 2],
      ph: 'startle',
      pt: AT + 20,
    })
    mergeInto(stored, sync.tick())
    echo()

    // Another player joining reads the doc as it now stands.
    useNpcRuntime.setState({ epoch: null, engagements: {}, localPlayerId: 'uid-late' })
    const late = new WorldSync(readWorld, (key, value) => applyWorldEntry(key, value, noDecks))
    late.receive(structuredClone(stored) as never)
    expect(useNpcRuntime.getState().epoch).toBe(AT)
    expect(useNpcRuntime.getState().engagements.npc_a).toEqual({
      m: 'chase',
      by: 'uid-me',
      at: AT + 20,
      p: [1, 2],
      ph: 'startle',
      pt: AT + 20,
    })
    expect(late.tick()).toEqual({})
  })

  test('an epoch set after joining is shared; one already shared is taken', async () => {
    const { WorldSync } = await import('./world-sync')
    const stored: Record<string, unknown> = {}
    const sync = new WorldSync(readWorld, (key, value) => applyWorldEntry(key, value, noDecks))
    sync.receive({})
    useNpcRuntime.getState().setEpoch(AT)
    expect(sync.tick()).toEqual({ npcEpoch: AT })

    useNpcRuntime.setState({ epoch: null })
    mergeInto(stored, { npcEpoch: AT - 60_000 })
    const joiner = new WorldSync(readWorld, (key, value) => applyWorldEntry(key, value, noDecks))
    joiner.receive(structuredClone(stored) as never)
    expect(useNpcRuntime.getState().epoch).toBe(AT - 60_000)
  })
})
