import { type BufferGeometry, Float32BufferAttribute } from 'three'

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
