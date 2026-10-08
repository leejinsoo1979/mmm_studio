import type { ViewMode } from '../store/use-editor'

/**
 * Whether a 3D viewer is laid out, and so will report its scene ready. R3F
 * starts a canvas only once its container has a size, and the 2D-only view
 * hides the editor's 3D pane, so there no renderer starts and no ready
 * signal ever comes. Preview mode always shows its own 3D viewer.
 */
export function isViewerLaidOut(viewMode: ViewMode, isPreviewMode: boolean): boolean {
  return isPreviewMode || viewMode !== '2d'
}

export type SceneLoadState = {
  isLoading: boolean
  isSceneLoading: boolean
  hasLoadedInitialScene: boolean
  isViewerSceneReady: boolean
  /** See {@link isViewerLaidOut}. */
  viewerLaidOut: boolean
}

/**
 * What keeps the editor shell behind its loader: the scene graph still
 * loading, or a laid-out 3D viewer that has not settled the scene yet.
 */
export function sceneLoadWait(state: SceneLoadState): 'scene' | 'viewer' | null {
  if (state.isLoading || state.isSceneLoading || !state.hasLoadedInitialScene) return 'scene'
  if (state.viewerLaidOut && !state.isViewerSceneReady) return 'viewer'
  return null
}
