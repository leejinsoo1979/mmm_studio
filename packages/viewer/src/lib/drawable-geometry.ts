import { type BufferGeometry, Float32BufferAttribute, type Object3D } from 'three'

/**
 * True when `geometry` has a bound, non-empty `position` attribute — i.e. it is
 * safe to submit to the WebGPU renderer.
 *
 * A geometry whose `position` attribute has `count === 0` (or no `position` at
 * all) leaves WebGPU **vertex buffer slot 0 unbound**. The validator rejects the
 * draw with "Vertex buffer slot 0 … was not set", and — critically — that single
 * rejected draw **poisons the entire command encoder**: every other draw in the
 * frame (the whole scene + every editor overlay) is discarded on the next queue
 * submit ("Invalid CommandBuffer"). The visible result is the whole canvas
 * flickering/garbling, not just the offending mesh.
 *
 * Individual call-sites guard against *creating* empty geometry (see
 * `createPlaceholderGeometry`, the ceiling/door degenerate fallbacks, etc.), but
 * transient/derived geometries can still slip through. This predicate is the
 * renderer-level safety net: skipping a count-0 draw is a no-op visually (it
 * would draw nothing anyway) while keeping the command encoder healthy.
 */
export function hasDrawableGeometry(
  geometry: BufferGeometry | undefined | null,
  group?: { count?: number } | null,
): boolean {
  const position = geometry?.attributes?.position
  if (!geometry || !position || position.count <= 0) return false
  if (geometry.index && geometry.index.count <= 0) return false
  if (geometry.drawRange.count === 0) return false
  if (group?.count === 0) return false
  return true
}

/**
 * WebGPU materials sample AO/light maps from the secondary UV channel. Most
 * imported and generated geometry only has a primary `uv` attribute, so copy
 * it lazily before the renderer builds the material pipeline.
 */
export function ensureSecondaryUv(geometry: BufferGeometry | undefined | null): void {
  if (!geometry || geometry.getAttribute('uv2')) return
  const uv = geometry.getAttribute('uv')
  if (!uv || uv.count === 0) return

  const values = new Float32Array(uv.count * 2)
  for (let index = 0; index < uv.count; index += 1) {
    values[index * 2] = uv.getX(index)
    values[index * 2 + 1] = uv.getY(index)
  }
  geometry.setAttribute('uv2', new Float32BufferAttribute(values, 2))
}

export interface InUseDisposeGuard {
  /** Records that `object` drew `geometry`; call for every draw. */
  track(object: Object3D, geometry: BufferGeometry): void
  /** Settles every held-back `dispose()`; call before every render. */
  flush(): void
  /**
   * For a renderer that is going away: runs the held-back disposes, lets
   * every later one straight through and forgets the meshes it knew.
   */
  release(): void
}

/**
 * Holds back `dispose()` on a drawn geometry until the next render, and drops
 * it if a mesh in a scene still draws the geometry by then.
 *
 * Disposing frees the geometry's GPU vertex buffers, and the WebGPU renderer
 * re-uploads them only for a render object it refreshes. One that shares its
 * material state with an earlier draw in the same render is not refreshed: it
 * binds the freed buffer, the validator rejects the draw ("Vertex buffer slot
 * N … was not set") and drops the frame's whole command buffer, every frame
 * until something about that object changes. React StrictMode runs every
 * effect cleanup once right after mount in development, so the common
 * `useEffect(() => () => geometry.dispose(), [geometry])` disposes a memoised
 * geometry its mesh keeps drawing (the ceiling placeholder, the site ground, …).
 *
 * The dispose must not wait past a render, though. three frees the buffers of
 * whatever geometry the first render object that drew the disposed one holds
 * at that moment, and a render points that render object at its mesh's new
 * geometry. A `geometry.dispose(); mesh.geometry = next` settled after `next`
 * was drawn therefore frees `next`'s buffers (and leaks the old ones).
 * `flush()` runs before each render; a `schedule` tick flushes too when no
 * render comes first.
 *
 * A dispose that only arrives after the swap was rendered (a React cleanup
 * flushed after a frame) cannot be ordered. When one runs, the geometries its
 * meshes have since drawn are marked for upload, so their render objects
 * refresh and rebuild whatever buffers three freed by mistake.
 *
 * A geometry keeps the guard's `dispose` for good (it may be shared with
 * another renderer, which wraps it in turn), so `release()` — for a renderer
 * that is disposed while the geometries it drew live on — makes the guard
 * let disposes through and drops the meshes it held on to.
 */
export function createInUseDisposeGuard(
  schedule: (run: () => void) => void = (run) => {
    setTimeout(run, 0)
  },
): InUseDisposeGuard {
  let drawnBy = new WeakMap<BufferGeometry, Set<Object3D>>()
  const held = new Map<BufferGeometry, () => void>()
  let scheduled = false
  let released = false

  const settle = (geometry: BufferGeometry, dispose: () => void) => {
    const objects = drawnBy.get(geometry) ?? new Set<Object3D>()
    const geometryOf = (object: Object3D) => (object as { geometry?: BufferGeometry }).geometry
    for (const object of objects) {
      if (geometryOf(object) === geometry && isInScene(object)) return
    }
    // Every mesh that drew the geometry stays known until it is disposed: three
    // frees the buffers of the first one's current geometry, whichever it is.
    const drawnSince = new Set<BufferGeometry>()
    for (const object of objects) {
      const current = geometryOf(object)
      if (current && current !== geometry && drawnBy.get(current)?.has(object)) {
        drawnSince.add(current)
      }
    }
    objects.clear()
    dispose()
    for (const next of drawnSince) {
      for (const attribute of Object.values(next.attributes)) attribute.needsUpdate = true
    }
  }

  const run = (dispose: () => void) => {
    try {
      dispose()
    } catch (error) {
      console.error('[viewer] a geometry dispose listener threw', error)
    }
  }

  const flush = () => {
    for (const [geometry, dispose] of held) {
      held.delete(geometry)
      run(() => settle(geometry, dispose))
    }
  }

  const track = (object: Object3D, geometry: BufferGeometry) => {
    if (released) return
    const known = drawnBy.get(geometry)
    if (known) {
      known.add(object)
      return
    }
    drawnBy.set(geometry, new Set([object]))
    const dispose = geometry.dispose.bind(geometry)
    geometry.dispose = () => {
      if (released) return dispose()
      if (held.has(geometry)) return
      held.set(geometry, dispose)
      if (scheduled) return
      scheduled = true
      schedule(() => {
        scheduled = false
        flush()
      })
    }
  }

  const release = () => {
    released = true
    for (const [geometry, dispose] of held) {
      held.delete(geometry)
      run(dispose)
    }
    drawnBy = new WeakMap()
  }

  return { track, flush, release }
}

/**
 * Has `renderer.render` settle the guard's held-back disposes first, on every
 * call: pass renders nested inside a frame's render included.
 */
export function flushBeforeRender<A extends unknown[], R>(
  renderer: { render: (...args: A) => R },
  guard: Pick<InUseDisposeGuard, 'flush'>,
): void {
  const render = renderer.render.bind(renderer)
  renderer.render = (...args: A) => {
    guard.flush()
    return render(...args)
  }
}

function isInScene(object: Object3D): boolean {
  let root = object
  while (root.parent) root = root.parent
  return (root as { isScene?: boolean }).isScene === true
}
