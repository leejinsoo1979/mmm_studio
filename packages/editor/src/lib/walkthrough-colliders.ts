import type { Mesh } from 'three'

/**
 * Colliders that move about — people walking the house. Node kinds register a
 * provider from their system, so the walkthrough controls stay unaware of
 * them: the walker bumps into every mesh a provider returns, as it does into
 * an elevator's cab. The provider owns its meshes: it gives their geometry a
 * bounds tree, keeps each `matrixWorld` current every frame, and hides one
 * (`visible = false`) to take it out for a while. `userData.excludeFloatHit`
 * and a no-op `raycast` (the controller's fallback ground ray tests every
 * collider) keep the walker from standing on top of one.
 *
 * Asked once a frame before the walker steps; returning other meshes (someone
 * came or went) changes what the walker collides with from that frame on.
 */
export type WalkthroughColliderProvider = () => readonly Mesh[]

const providers = new Map<string, WalkthroughColliderProvider>()

/** Registers `provider` under `key`; the returned function unregisters it. */
export function registerWalkthroughDynamicCollider(
  key: string,
  provider: WalkthroughColliderProvider,
) {
  providers.set(key, provider)
  return () => {
    if (providers.get(key) === provider) providers.delete(key)
  }
}

/**
 * Every provider's meshes — `current` itself while they are the same meshes in
 * the same order, so the walker's collider set only changes when they do.
 */
export function collectWalkthroughDynamicColliders(current: readonly Mesh[]): readonly Mesh[] {
  let next: Mesh[] | null = null
  let count = 0
  for (const provider of providers.values()) {
    for (const mesh of provider()) {
      if (!next && current[count] !== mesh) next = current.slice(0, count)
      next?.push(mesh)
      count++
    }
  }
  if (next) return next
  return count === current.length ? current : current.slice(0, count)
}
