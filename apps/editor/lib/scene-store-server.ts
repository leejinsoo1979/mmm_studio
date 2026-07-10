import path from 'node:path'
import type { SceneOperations } from '@pascal-app/mcp/operations'
import type { SceneStore } from '@pascal-app/mcp/storage'
import { MemorySceneStore } from './memory-scene-store'

/**
 * Per-process singleton. The factory is async because backend modules are
 * dynamically imported — we cache the in-flight promise so concurrent calls
 * during a cold start share a single instantiation.
 */
let cachedStore: Promise<SceneStore> | null = null
let cachedOperations: Promise<SceneOperations> | null = null

export function getSceneStore(): Promise<SceneStore> {
  if (!cachedStore) {
    cachedStore = (async () => {
      if (process.env.PASCAL_SCENE_STORE === 'memory') {
        return new MemorySceneStore()
      }

      const mod = (await import('@pascal-app/mcp/storage')) as {
        createSceneStore: (env?: NodeJS.ProcessEnv) => Promise<SceneStore>
      }
      try {
        const store = await mod.createSceneStore({
          ...process.env,
          PASCAL_DB_PATH:
            process.env.PASCAL_DB_PATH ?? path.join(process.cwd(), 'data', 'pascal.db'),
        })
        await store.list({ limit: 0 })
        return store
      } catch (error) {
        console.warn(
          '[scene-store] Falling back to in-memory store:',
          error instanceof Error ? error.message : error,
        )
        return new MemorySceneStore()
      }
    })()
  }
  return cachedStore
}

export function getSceneOperations(): Promise<SceneOperations> {
  if (!cachedOperations) {
    cachedOperations = (async () => {
      const store = await getSceneStore()
      const mod = (await import('@pascal-app/mcp/operations')) as {
        createSceneOperations: (options: { store: SceneStore }) => SceneOperations
      }
      return mod.createSceneOperations({ store })
    })()
  }
  return cachedOperations
}

/**
 * Test-only helper to reset the cached singleton. Not exported for production
 * callers.
 */
export function __resetSceneStoreForTests(): void {
  cachedStore = null
  cachedOperations = null
}
