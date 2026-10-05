import { afterEach, describe, expect, test } from 'bun:test'
import { Mesh } from 'three'
import {
  collectWalkthroughDynamicColliders,
  registerWalkthroughDynamicCollider,
} from './walkthrough-colliders'

const unregister: Array<() => void> = []
const register = (key: string, provider: () => Mesh[]) =>
  unregister.push(registerWalkthroughDynamicCollider(key, provider))

afterEach(() => {
  for (const off of unregister.splice(0)) off()
})

describe('collectWalkthroughDynamicColliders', () => {
  test('gathers every provider’s meshes', () => {
    const a = new Mesh()
    const b = new Mesh()
    const c = new Mesh()
    register('people', () => [a, b])
    register('carts', () => [c])
    expect(collectWalkthroughDynamicColliders([])).toEqual([a, b, c])
  })

  test('keeps the same set while the meshes are the same', () => {
    const meshes = [new Mesh(), new Mesh()]
    register('people', () => meshes)
    const first = collectWalkthroughDynamicColliders([])
    expect(collectWalkthroughDynamicColliders(first)).toBe(first)
  })

  test('someone coming or going makes a new set', () => {
    const a = new Mesh()
    const b = new Mesh()
    let present = [a]
    register('people', () => present)
    const alone = collectWalkthroughDynamicColliders([])
    present = [a, b]
    const both = collectWalkthroughDynamicColliders(alone)
    expect(both).not.toBe(alone)
    expect(both).toEqual([a, b])
    present = [a]
    expect(collectWalkthroughDynamicColliders(both)).toEqual([a])
    present = [b]
    expect(collectWalkthroughDynamicColliders([a])).toEqual([b])
  })

  test('unregistering takes the meshes out, but not a newer provider’s', () => {
    const old = new Mesh()
    const fresh = new Mesh()
    const offOld = registerWalkthroughDynamicCollider('people', () => [old])
    register('people', () => [fresh])
    offOld()
    expect(collectWalkthroughDynamicColliders([])).toEqual([fresh])
    for (const off of unregister.splice(0)) off()
    expect(collectWalkthroughDynamicColliders([fresh])).toEqual([])
  })
})
