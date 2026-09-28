import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** Per-viewer catalogue panel conveniences (the hero band's collapse). */
export const useBuildPanelPrefs = create<{
  heroCollapsed: boolean
  toggleHero: () => void
}>()(
  persist(
    (set) => ({
      heroCollapsed: false,
      toggleHero: () => set((s) => ({ heroCollapsed: !s.heroCollapsed })),
    }),
    {
      name: 'mmm-studio.build-panel.v1',
      storage: createJSONStorage(() => {
        try {
          return window.localStorage
        } catch {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          }
        }
      }),
    },
  ),
)
