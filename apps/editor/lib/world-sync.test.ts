import { describe, expect, test } from 'bun:test'
import { changedEntries, sameWorldValue, type WorldEntries, WorldSync } from './world-sync'

/** A player's world: `apply` writes what the others did straight into it. */
function player(initial: WorldEntries = {}) {
  const world: WorldEntries = { ...initial }
  const applied: [string, unknown][] = []
  const sync = new WorldSync(
    () => ({ ...world }),
    (key, value) => {
      applied.push([key, value])
      if (value === null) delete world[key]
      else world[key] = value
    },
  )
  return { world, applied, sync }
}

describe('sameWorldValue', () => {
  test('maps compare whatever their key order', () => {
    expect(sameWorldValue({ k: 'slides', index: 1 }, { index: 1, k: 'slides' })).toBe(true)
    expect(sameWorldValue({ k: 'slides', index: 1 }, { k: 'slides', index: 2 })).toBe(false)
  })

  test('missing reads as null', () => {
    expect(sameWorldValue(undefined, null)).toBe(true)
    expect(sameWorldValue(undefined, false)).toBe(false)
  })
})

describe('changedEntries', () => {
  test('lists changed, added and removed entries (removed as null)', () => {
    expect(changedEntries({ a: 1, b: true, c: 'x' }, { a: 2, c: 'x', d: [1, 2] })).toEqual({
      a: 2,
      b: null,
      d: [1, 2],
    })
  })
})

describe('WorldSync', () => {
  test('nothing is published before the shared world is read', () => {
    const { world, sync } = player()
    world.clock = 9
    expect(sync.tick()).toEqual({})
  })

  test('joining applies the whole shared world, and it is not published back', () => {
    const { world, applied, sync } = player({ clock: 12 })
    sync.receive({ clock: 20, 'door:a': 1.57 })
    expect(applied).toEqual([
      ['clock', 20],
      ['door:a', 1.57],
    ])
    expect(world).toEqual({ clock: 20, 'door:a': 1.57 })
    expect(sync.tick()).toEqual({})
  })

  test("this player's changes are published once", () => {
    const { world, sync } = player()
    sync.receive({})
    world['door:a'] = 1.57
    world.weather = 'rain'
    expect(sync.tick()).toEqual({ 'door:a': 1.57, weather: 'rain' })
    expect(sync.tick()).toEqual({})
    delete world['door:a']
    expect(sync.tick()).toEqual({ 'door:a': null })
  })

  test('only what the others changed is applied', () => {
    const { world, applied, sync } = player()
    sync.receive({ 'door:a': 0, clock: 12 })
    applied.length = 0
    // This player opens door a; before their write lands, someone moves the clock.
    world['door:a'] = 1.57
    sync.receive({ 'door:a': 0, clock: 18 })
    expect(applied).toEqual([['clock', 18]])
    expect(world['door:a']).toBe(1.57)
    expect(sync.tick()).toEqual({ 'door:a': 1.57 })
  })

  test('a change already in the shared world is not published again', () => {
    const { world, sync } = player()
    sync.receive({ weather: 'snow' })
    world.weather = 'clear'
    sync.receive({ weather: 'clear' })
    expect(sync.tick()).toEqual({})
  })

  test('two players converge through a shared store', () => {
    const shared: WorldEntries = {}
    const a = player()
    const b = player()
    const deliver = (from: ReturnType<typeof player>) => {
      Object.assign(shared, from.sync.tick())
      a.sync.receive({ ...shared })
      b.sync.receive({ ...shared })
    }
    a.sync.receive({})
    b.sync.receive({})
    a.world['cabinet:k'] = true
    deliver(a)
    b.world.clock = 21
    deliver(b)
    expect(a.world).toEqual({ 'cabinet:k': true, clock: 21 })
    expect(b.world).toEqual({ 'cabinet:k': true, clock: 21 })
    expect(a.sync.tick()).toEqual({})
    expect(b.sync.tick()).toEqual({})
  })

  test("an entry the player cannot show (another player's video) is not overwritten", () => {
    // b's TV can only go on for a video it can't play: it reads back as idle.
    const shared: WorldEntries = {}
    const a = player()
    const b = new WorldSync(
      () => (shared['screen:tv'] ? { 'screen:tv': { k: 'idle' } } : {}),
      () => {},
    )
    a.sync.receive({})
    b.receive({})
    a.world['screen:tv'] = { k: 'video', label: 'clip.mp4' }
    Object.assign(shared, a.sync.tick())
    b.receive({ ...shared })
    expect(b.tick()).toEqual({})
  })
})
