// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, spyOn, test } from 'bun:test'
import {
  type BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  type InterleavedBufferAttribute,
  Mesh,
  type Object3D,
  Scene,
} from 'three'
import {
  createInUseDisposeGuard,
  flushBeforeRender,
  type InUseDisposeGuard,
} from './drawable-geometry'

const position = (geometry: BufferGeometry) => geometry.getAttribute('position') as BufferAttribute

function triangle() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  return geometry
}

function setup() {
  const queue: Array<() => void> = []
  const guard = createInUseDisposeGuard((run) => queue.push(run))
  const tick = () => {
    for (const run of queue.splice(0)) run()
  }
  const scene = new Scene()
  const geometry = triangle()
  const mesh = new Mesh(geometry)
  scene.add(mesh)
  let disposed = 0
  geometry.addEventListener('dispose', () => {
    disposed++
  })
  return { guard, queue, tick, scene, geometry, mesh, disposed: () => disposed }
}

describe('createInUseDisposeGuard', () => {
  test('drops the dispose of a geometry a mesh in the scene still draws', () => {
    const { guard, geometry, mesh, disposed } = setup()
    guard.track(mesh, geometry)
    // StrictMode's extra effect cleanup, right after mount.
    geometry.dispose()
    guard.flush()
    expect(disposed()).toBe(0)
  })

  test('disposes a geometry swapped out of its mesh', () => {
    const { guard, geometry, mesh, disposed } = setup()
    guard.track(mesh, geometry)
    geometry.dispose()
    mesh.geometry = triangle()
    guard.flush()
    expect(disposed()).toBe(1)
  })

  test('holds the dispose back until the next flush', () => {
    const { guard, geometry, mesh, disposed } = setup()
    guard.track(mesh, geometry)
    geometry.dispose()
    mesh.geometry = triangle()
    expect(disposed()).toBe(0)
    guard.flush()
    expect(disposed()).toBe(1)
    guard.flush()
    expect(disposed()).toBe(1)
  })

  test('the scheduled tick settles a dispose when no render comes first', () => {
    const { guard, tick, geometry, mesh, disposed } = setup()
    guard.track(mesh, geometry)
    geometry.dispose()
    mesh.geometry = triangle()
    tick()
    expect(disposed()).toBe(1)
  })

  test('schedules one tick for any number of held disposes', () => {
    const { guard, queue, tick, scene, geometry, mesh, disposed } = setup()
    const other = triangle()
    const twin = new Mesh(other)
    scene.add(twin)
    guard.track(mesh, geometry)
    guard.track(twin, other)
    geometry.dispose()
    other.dispose()
    expect(queue.length).toBe(1)
    mesh.geometry = triangle()
    tick()
    expect(disposed()).toBe(1)
    expect(queue.length).toBe(0)
  })

  test('disposes a geometry whose mesh left the scene', () => {
    const { guard, scene, geometry, mesh, disposed } = setup()
    guard.track(mesh, geometry)
    scene.remove(mesh)
    geometry.dispose()
    guard.flush()
    expect(disposed()).toBe(1)
  })

  test('a mesh under a detached group no longer holds the geometry', () => {
    const { guard, scene, geometry, mesh, disposed } = setup()
    const group = new Group()
    scene.add(group)
    group.add(mesh)
    guard.track(mesh, geometry)
    scene.remove(group)
    geometry.dispose()
    guard.flush()
    expect(disposed()).toBe(1)
  })

  test('keeps the geometry while any mesh sharing it is still in the scene', () => {
    const { guard, scene, geometry, mesh, disposed } = setup()
    const twin = new Mesh(geometry)
    scene.add(twin)
    guard.track(mesh, geometry)
    guard.track(twin, geometry)
    scene.remove(mesh)
    geometry.dispose()
    guard.flush()
    expect(disposed()).toBe(0)
    scene.remove(twin)
    geometry.dispose()
    guard.flush()
    expect(disposed()).toBe(1)
  })

  test('disposes a geometry that was never drawn at once', () => {
    const { geometry, disposed } = setup()
    geometry.dispose()
    expect(disposed()).toBe(1)
  })

  test('runs repeated dispose calls once', () => {
    const { guard, geometry, mesh, disposed } = setup()
    guard.track(mesh, geometry)
    mesh.geometry = triangle()
    geometry.dispose()
    geometry.dispose()
    guard.flush()
    expect(disposed()).toBe(1)
  })

  test('marks the geometry a mesh already drew for upload when its old one is disposed late', () => {
    const { guard, geometry, mesh, disposed } = setup()
    guard.track(mesh, geometry)
    const next = triangle()
    mesh.geometry = next
    guard.track(mesh, next)
    const version = position(next).version
    geometry.dispose()
    guard.flush()
    expect(disposed()).toBe(1)
    expect(position(next).version).toBe(version + 1)
  })

  test('leaves a swapped-in geometry alone until it has been drawn', () => {
    const { guard, geometry, mesh } = setup()
    guard.track(mesh, geometry)
    const next = triangle()
    geometry.dispose()
    mesh.geometry = next
    const version = position(next).version
    guard.flush()
    expect(position(next).version).toBe(version)
  })

  test('a dropped dispose keeps every mesh that drew the geometry', () => {
    const { guard, scene, geometry, mesh } = setup()
    const twin = new Mesh(geometry)
    scene.add(twin)
    guard.track(mesh, geometry)
    guard.track(twin, geometry)
    const next = triangle()
    mesh.geometry = next
    guard.track(mesh, next)
    geometry.dispose()
    guard.flush()
    scene.remove(twin)
    const version = position(next).version
    geometry.dispose()
    guard.flush()
    expect(position(next).version).toBe(version + 1)
  })

  test('a throwing dispose listener neither escapes the flush nor stops the others', () => {
    const { guard, geometry, mesh, disposed } = setup()
    const other = triangle()
    const twin = new Mesh(other)
    let otherDisposed = 0
    geometry.addEventListener('dispose', () => {
      throw new Error('listener')
    })
    other.addEventListener('dispose', () => {
      otherDisposed++
    })
    guard.track(mesh, geometry)
    guard.track(twin, other)
    mesh.geometry = triangle()
    geometry.dispose()
    other.dispose()
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => guard.flush()).not.toThrow()
      expect(error).toHaveBeenCalledTimes(1)
    } finally {
      error.mockRestore()
    }
    expect(disposed()).toBe(1)
    expect(otherDisposed).toBe(1)
  })
})

describe('createInUseDisposeGuard release', () => {
  test('runs the held disposes, even of a geometry a mesh in the scene still draws', () => {
    const { guard, geometry, mesh, disposed } = setup()
    guard.track(mesh, geometry)
    geometry.dispose()
    expect(disposed()).toBe(0)
    guard.release()
    expect(disposed()).toBe(1)
  })

  test('lets every later dispose straight through', () => {
    const { guard, queue, geometry, mesh, disposed } = setup()
    guard.track(mesh, geometry)
    guard.release()
    geometry.dispose()
    expect(disposed()).toBe(1)
    expect(queue.length).toBe(0)
    geometry.dispose()
    expect(disposed()).toBe(2)
  })

  test('tracks nothing more', () => {
    const { guard, scene, disposed } = setup()
    guard.release()
    const other = triangle()
    const twin = new Mesh(other)
    scene.add(twin)
    let otherDisposed = 0
    other.addEventListener('dispose', () => {
      otherDisposed++
    })
    guard.track(twin, other)
    other.dispose()
    expect(otherDisposed).toBe(1)
    expect(disposed()).toBe(0)
  })

  test('a second guard wrapping the same geometry still holds its own draws', () => {
    const { guard, geometry, mesh, disposed } = setup()
    const queue: Array<() => void> = []
    const game = createInUseDisposeGuard((run) => queue.push(run))
    game.track(mesh, geometry)
    guard.track(mesh, geometry)
    guard.release()
    geometry.dispose()
    game.flush()
    expect(disposed()).toBe(0)
    mesh.geometry = triangle()
    geometry.dispose()
    game.flush()
    expect(disposed()).toBe(1)
  })
})

describe('flushBeforeRender', () => {
  test('settles the held disposes before every render, nested ones included', () => {
    const calls: string[] = []
    const renderer = {
      render(pass: string) {
        calls.push(`render ${pass}`)
        if (pass === 'frame') this.render('shadow')
        return pass.length
      },
    }
    flushBeforeRender(renderer, { flush: () => calls.push('flush') })
    expect(renderer.render('frame')).toBe(5)
    expect(calls).toEqual(['flush', 'render frame', 'flush', 'render shadow'])
  })
})

type Attribute = BufferAttribute | InterleavedBufferAttribute

/**
 * The two pieces of three's WebGPU bookkeeping (r184) the guard works around:
 * - the first render object to draw a geometry frees, when that geometry is
 *   disposed, the buffers of whatever geometry it holds at that moment, and is
 *   pointed at its mesh's current geometry by every render;
 * - a render object re-uploads freed buffers only when it is refreshed (a new
 *   geometry, or a changed attribute version). Here no render object is the
 *   first of its material in the pass, so none is refreshed for free.
 */
function threeLikeRenderer(guard: InUseDisposeGuard | null) {
  const freed = new Set<Attribute>()
  const renderObjects = new Map<Object3D, { geometry: BufferGeometry; versions: number[] }>()
  const watched = new WeakSet<BufferGeometry>()
  let freedDraws = 0
  const versionsOf = (geometry: BufferGeometry) =>
    Object.values(geometry.attributes).map((attribute) => (attribute as BufferAttribute).version)

  const render = (scene: Scene) => {
    guard?.flush()
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const geometry = object.geometry as BufferGeometry
      guard?.track(object, geometry)
      const versions = versionsOf(geometry)
      let renderObject = renderObjects.get(object)
      const refresh =
        !renderObject ||
        renderObject.geometry !== geometry ||
        renderObject.versions.some((version, index) => version !== versions[index])
      if (!renderObject) {
        renderObject = { geometry, versions }
        renderObjects.set(object, renderObject)
      }
      renderObject.geometry = geometry
      renderObject.versions = versions
      if (!watched.has(geometry)) {
        watched.add(geometry)
        const owner = renderObject
        geometry.addEventListener('dispose', () => {
          for (const attribute of Object.values(owner.geometry.attributes)) freed.add(attribute)
        })
      }
      if (refresh)
        for (const attribute of Object.values(geometry.attributes)) freed.delete(attribute)
      if (Object.values(geometry.attributes).some((attribute) => freed.has(attribute))) {
        freedDraws++
      }
    })
  }
  return { render, freed, freedDraws: () => freedDraws }
}

describe('createInUseDisposeGuard against three-like bookkeeping', () => {
  // Each frame renders, then lets pending timers fire: on a busy main thread
  // a `setTimeout(0)` set before a frame can run after it.
  function world(guarded: boolean) {
    const timers: Array<() => void> = []
    const guard = guarded ? createInUseDisposeGuard((run) => timers.push(run)) : null
    const scene = new Scene()
    const mesh = new Mesh(triangle())
    scene.add(mesh)
    const renderer = threeLikeRenderer(guard)
    const frame = () => {
      renderer.render(scene)
      for (const run of timers.splice(0)) run()
    }
    return { mesh, renderer, frame }
  }

  test('a StrictMode dispose of a drawn geometry never reaches its draws', () => {
    const { mesh, renderer, frame } = world(true)
    frame()
    mesh.geometry.dispose()
    frame()
    frame()
    expect(renderer.freedDraws()).toBe(0)
  })

  test('without the guard, a StrictMode dispose of a drawn geometry reaches its draws', () => {
    const { mesh, renderer, frame } = world(false)
    frame()
    mesh.geometry.dispose()
    frame()
    expect(renderer.freedDraws()).toBe(1)
  })

  test('dispose then swap frees the old buffers before the new geometry is drawn', () => {
    const { mesh, renderer, frame } = world(true)
    frame()
    const old = mesh.geometry
    old.dispose()
    const next = triangle()
    mesh.geometry = next
    const version = position(next).version
    frame()
    frame()
    expect(renderer.freedDraws()).toBe(0)
    expect(renderer.freed.has(position(old))).toBe(true)
    expect(position(next).version).toBe(version)
  })

  test('a dispose that arrives after the swap was drawn does not break the new geometry', () => {
    const { mesh, renderer, frame } = world(true)
    frame()
    const old = mesh.geometry
    mesh.geometry = triangle()
    frame()
    old.dispose()
    frame()
    frame()
    expect(renderer.freedDraws()).toBe(0)
  })

  test('a geometry shared by two meshes is settled against the mesh three tied it to', () => {
    // three ties the dispose to the first mesh that drew it, here the one that
    // moves on first; the second keeps the first dispose from running.
    const timers: Array<() => void> = []
    const guard = createInUseDisposeGuard((run) => timers.push(run))
    const scene = new Scene()
    const shared = triangle()
    const first = new Mesh(shared)
    const second = new Mesh(shared)
    scene.add(first, second)
    const renderer = threeLikeRenderer(guard)
    const frame = () => {
      renderer.render(scene)
      for (const run of timers.splice(0)) run()
    }
    frame()
    first.geometry = triangle()
    frame()
    shared.dispose()
    frame()
    scene.remove(second)
    shared.dispose()
    frame()
    frame()
    expect(renderer.freedDraws()).toBe(0)
  })

  test('without the guard, a dispose run after the swap was drawn frees the new geometry', () => {
    // What the previous guard did to `dispose(); mesh.geometry = next` when
    // its timer fired after the next render.
    const { mesh, renderer, frame } = world(false)
    frame()
    const old = mesh.geometry
    mesh.geometry = triangle()
    frame()
    old.dispose()
    frame()
    expect(renderer.freedDraws()).toBe(1)
    expect(renderer.freed.has(position(old))).toBe(false)
  })
})
