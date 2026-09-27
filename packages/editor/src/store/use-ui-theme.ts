import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type UiTheme = 'light' | 'dark'

const DARK_SCENE_THEME = 'studio-dark'

/** Editor chrome light / dark mode. */
export const useUiTheme = create<{
  theme: UiTheme
  lightSceneTheme: string
  toggle: () => void
}>()(
  persist(
    (set, get) => ({
      theme: 'light',
      lightSceneTheme: 'studio',
      // A light scene backdrop under dark chrome looks unfinished, so dark mode
      // also swaps a light scene theme for the dark studio one and restores it
      // on the way back. Dark scene themes the user picked are left alone.
      toggle: () => {
        const viewer = useViewer.getState()
        if (get().theme === 'dark') {
          if (viewer.sceneTheme === DARK_SCENE_THEME) viewer.setSceneTheme(get().lightSceneTheme)
          set({ theme: 'light' })
          return
        }
        if (getSceneTheme(viewer.sceneTheme).appearance === 'light') {
          set({ lightSceneTheme: viewer.sceneTheme })
          viewer.setSceneTheme(DARK_SCENE_THEME)
        }
        set({ theme: 'dark' })
      },
    }),
    { name: 'mmm-ui-theme', storage: createJSONStorage(() => localStorage) },
  ),
)
