import { constructionBuildUpMm, type WallConstruction } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { create } from 'zustand'

/** Core thickness a new wall is drawn with (mmmcraft draws a 100 mm core). */
const DRAW_CORE_THICKNESS = 0.1

/**
 * The construction new walls are drawn with (mmmcraft
 * `wallConstructionDefault`). Walls already drawn are not changed.
 */
export const useWallDrawingDefaults = create<{
  construction: WallConstruction | undefined
  setConstruction: (construction: WallConstruction | undefined) => void
}>((set) => ({
  construction: undefined,
  setConstruction: (construction) => {
    set({ construction })
    // Re-seed an active wall tool so the next segment uses the new choice.
    const ed = useEditor.getState()
    const tool = ed.tool
    if (tool === 'wall' || tool === 'wall-arc' || tool === 'rectangle-room') {
      ed.setToolDefaults('wall', {
        ...(ed.toolDefaults.wall ?? {}),
        ...wallDrawingToolDefaults(construction),
      })
    }
  },
}))

/** `toolDefaults.wall` fields for the chosen construction: total thickness =
 *  core + finish build-up, and the construction copied onto new walls. */
export function wallDrawingToolDefaults(construction: WallConstruction | undefined) {
  return {
    thickness: DRAW_CORE_THICKNESS + constructionBuildUpMm(construction) / 1000,
    construction,
  }
}
