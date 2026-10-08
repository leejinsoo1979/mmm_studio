import { describe, expect, test } from 'bun:test'
import { isViewerLaidOut, type SceneLoadState, sceneLoadWait } from './scene-readiness'

const loaded: SceneLoadState = {
  isLoading: false,
  isSceneLoading: false,
  hasLoadedInitialScene: true,
  isViewerSceneReady: false,
  viewerLaidOut: true,
}

describe('isViewerLaidOut', () => {
  test('the 3D and split views lay out the editor viewer', () => {
    expect(isViewerLaidOut('3d', false)).toBe(true)
    expect(isViewerLaidOut('split', false)).toBe(true)
  })

  test('the 2D-only view hides it, so it never reports', () => {
    expect(isViewerLaidOut('2d', false)).toBe(false)
  })

  test('preview mode shows its own 3D viewer whatever the editor view', () => {
    expect(isViewerLaidOut('2d', true)).toBe(true)
  })
})

describe('sceneLoadWait', () => {
  test('waits on the scene graph first', () => {
    expect(sceneLoadWait({ ...loaded, isLoading: true })).toBe('scene')
    expect(sceneLoadWait({ ...loaded, isSceneLoading: true })).toBe('scene')
    expect(sceneLoadWait({ ...loaded, hasLoadedInitialScene: false })).toBe('scene')
  })

  test('then on a laid-out viewer until it reports ready', () => {
    expect(sceneLoadWait(loaded)).toBe('viewer')
    expect(sceneLoadWait({ ...loaded, isViewerSceneReady: true })).toBeNull()
  })

  test('does not wait on a viewer that cannot report', () => {
    expect(sceneLoadWait({ ...loaded, viewerLaidOut: false })).toBeNull()
  })
})
