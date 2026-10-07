// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { BufferGeometry, Group, Mesh, Scene } from 'three'
import { createInUseDisposeGuard } from './drawable-geometry'

function setup() {
  const queue: Array<() => void> = []
  const track = createInUseDisposeGuard((run) => queue.push(run))
  const flush = () => {
    for (const run of queue.splice(0)) run()
  }
  const scene = new Scene()
  const geometry = new BufferGeometry()
  const mesh = new Mesh(geometry)
  scene.add(mesh)
  let disposed = 0
  geometry.addEventListener('dispose', () => {
    disposed++
  })
  return { track, flush, scene, geometry, mesh, disposed: () => disposed }
}

describe('createInUseDisposeGuard', () => {
  test('drops the dispose of a geometry a mesh in the scene still draws', () => {
    const { track, flush, geometry, mesh, disposed } = setup()
    track(mesh, geometry)
    // StrictMode's extra effect cleanup, right after mount.
    geometry.dispose()
    flush()
    expect(disposed()).toBe(0)
  })

  test('disposes a geometry swapped out of its mesh', () => {
    const { track, flush, geometry, mesh, disposed } = setup()
    track(mesh, geometry)
    geometry.dispose()
    mesh.geometry = new BufferGeometry()
    flush()
    expect(disposed()).toBe(1)
  })

  test('disposes a geometry whose mesh left the scene', () => {
    const { track, flush, scene, geometry, mesh, disposed } = setup()
    track(mesh, geometry)
    scene.remove(mesh)
    geometry.dispose()
    flush()
    expect(disposed()).toBe(1)
  })

  test('a mesh under a detached group no longer holds the geometry', () => {
    const { track, flush, scene, geometry, mesh, disposed } = setup()
    const group = new Group()
    scene.add(group)
    group.add(mesh)
    track(mesh, geometry)
    scene.remove(group)
    geometry.dispose()
    flush()
    expect(disposed()).toBe(1)
  })

  test('keeps the geometry while any mesh sharing it is still in the scene', () => {
    const { track, flush, scene, geometry, mesh, disposed } = setup()
    const twin = new Mesh(geometry)
    scene.add(twin)
    track(mesh, geometry)
    track(twin, geometry)
    scene.remove(mesh)
    geometry.dispose()
    flush()
    expect(disposed()).toBe(0)
    scene.remove(twin)
    geometry.dispose()
    flush()
    expect(disposed()).toBe(1)
  })

  test('disposes a geometry that was never drawn at once', () => {
    const { geometry, disposed } = setup()
    geometry.dispose()
    expect(disposed()).toBe(1)
  })

  test('runs repeated dispose calls once', () => {
    const { track, flush, geometry, mesh, disposed } = setup()
    track(mesh, geometry)
    mesh.geometry = new BufferGeometry()
    geometry.dispose()
    geometry.dispose()
    flush()
    expect(disposed()).toBe(1)
  })
})
