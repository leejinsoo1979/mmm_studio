import { constructionBuildUpMm, type WallConstruction } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { create } from 'zustand'

/** Core thickness a new wall is drawn with (mmmcraft draws a 100 mm core). */
const DRAW_CORE_THICKNESS = 0.1

/** mm-studio wall height presets (m): 온벽 floor to ceiling, 부분벽 half walls. */
export const FULL_WALL_HEIGHTS = [2.4, 2.7, 3.0]
export const PARTIAL_WALL_HEIGHTS = [0.9, 1.2, 1.5]

/**
 * The construction (mmmcraft `wallConstructionDefault`) and height new walls
 * are drawn with. Walls already drawn are not changed. No height = the
 * wall's default.
 */
export const useWallDrawingDefaults = create<{
  construction: WallConstruction | undefined
  height: number | undefined
  setConstruction: (construction: WallConstruction | undefined) => void
  setHeight: (height: number | undefined) => void
}>((set) => ({
  construction: undefined,
  height: undefined,
  setConstruction: (construction) => {
    set({ construction })
    reseedActiveWallTool()
  },
  setHeight: (height) => {
    set({ height })
    reseedActiveWallTool()
  },
}))

/** Re-seed an active wall tool so the next segment uses the new choice. */
function reseedActiveWallTool() {
  const ed = useEditor.getState()
  const tool = ed.tool
  if (tool === 'wall' || tool === 'wall-arc' || tool === 'rectangle-room') {
    const { height: _height, ...rest } = (ed.toolDefaults.wall ?? {}) as Record<string, unknown>
    ed.setToolDefaults('wall', { ...rest, ...wallDrawingToolDefaults() })
  }
}

/** `toolDefaults.wall` fields for the chosen construction and height: total
 *  thickness = core + finish build-up, and the construction copied onto new walls. */
export function wallDrawingToolDefaults() {
  const { construction, height } = useWallDrawingDefaults.getState()
  return {
    thickness: DRAW_CORE_THICKNESS + constructionBuildUpMm(construction) / 1000,
    construction,
    ...(height === undefined ? {} : { height }),
  }
}
