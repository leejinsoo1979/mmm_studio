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

/**
 * Holds back `dispose()` on a drawn geometry while a mesh in a scene still
 * draws it.
 *
 * Disposing frees the geometry's GPU vertex buffers. Unlike WebGL, the WebGPU
 * renderer does not reliably rebuild them when the geometry is drawn again: a
 * render object that shares its material state with an earlier draw in the
 * same pass skips the geometry upload and binds the freed buffer, so the
 * validator rejects the draw ("Vertex buffer slot 1 … was not set") and drops
 * the frame's whole command buffer. React StrictMode runs every effect cleanup
 * once right after mount in development, so the common
 * `useEffect(() => () => geometry.dispose(), [geometry])` disposes a memoised
 * geometry its mesh keeps drawing (the ceiling placeholder, the site ground, …).
 *
 * Returns `track(object, geometry)`, called for every draw. A tracked
 * geometry's `dispose()` is deferred one `schedule` tick and then dropped if a
 * mesh that drew it still holds it and is still attached to a scene; otherwise
 * it runs. A geometry swapped out (`dispose()` then `mesh.geometry = next`) or
 * unmounted is therefore still freed.
 */
export function createInUseDisposeGuard(
  schedule: (run: () => void) => void = (run) => {
    setTimeout(run, 0)
  },
): (object: Object3D, geometry: BufferGeometry) => void {
  const drawnBy = new WeakMap<BufferGeometry, Set<Object3D>>()

  const stillDrawn = (geometry: BufferGeometry, objects: Set<Object3D>) => {
    for (const object of objects) {
      if ((object as { geometry?: unknown }).geometry === geometry && isInScene(object)) {
        return true
      }
      objects.delete(object)
    }
    return false
  }

  return (object, geometry) => {
    const known = drawnBy.get(geometry)
    if (known) {
      known.add(object)
      return
    }
    const objects = new Set<Object3D>([object])
    drawnBy.set(geometry, objects)
    const dispose = geometry.dispose
    let pending = false
    geometry.dispose = () => {
      if (pending) return
      pending = true
      schedule(() => {
        pending = false
        if (!stillDrawn(geometry, objects)) dispose.call(geometry)
      })
    }
  }
}

function isInScene(object: Object3D): boolean {
  let root = object
  while (root.parent) root = root.parent
  return (root as { isScene?: boolean }).isScene === true
}
