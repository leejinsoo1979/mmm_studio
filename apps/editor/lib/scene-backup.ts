import type { SceneGraph } from '@pascal-app/editor'

/** localStorage key prefix for the editor's per-scene autosave copy. */
export const SCENE_BACKUP_PREFIX = 'mmm-scene-backup:'

export type SceneBackup = { graph: SceneGraph; savedAt: string }

export function readSceneBackup(sceneId: string): SceneBackup | null {
  try {
    const raw = localStorage.getItem(`${SCENE_BACKUP_PREFIX}${sceneId}`)
    const backup = raw ? (JSON.parse(raw) as Partial<SceneBackup>) : null
    return backup?.graph ? (backup as SceneBackup) : null
  } catch {
    return null
  }
}
