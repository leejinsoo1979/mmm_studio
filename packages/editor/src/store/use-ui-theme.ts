import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type UiTheme = 'light' | 'dark'

/** Editor chrome light / dark mode; the viewer's scene theme is left alone. */
export const useUiTheme = create<{ theme: UiTheme; toggle: () => void }>()(
  persist(
    (set) => ({
      theme: 'light',
      toggle: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
    }),
    { name: 'mmm-ui-theme', storage: createJSONStorage(() => localStorage) },
  ),
)
