import { create } from 'zustand'

type UiHiddenState = {
  /** inZOI "UI 숨기기" (Ctrl+Shift+U): hide the editor chrome, keep the scene. */
  hidden: boolean
  toggle: () => void
  /**
   * inZOI "건축 커스터마이즈": while an object's paint card is open the build
   * panel, bottom card, hint line, action menu and filter row step aside.
   */
  customizing: boolean
  setCustomizing: (customizing: boolean) => void
  /** The top tool bar (and its filter row) folded into a small tab. */
  toolbarCollapsed: boolean
  toggleToolbar: () => void
}

export const useUiHidden = create<UiHiddenState>((set) => ({
  hidden: false,
  toggle: () => set((state) => ({ hidden: !state.hidden })),
  customizing: false,
  setCustomizing: (customizing) => set({ customizing }),
  toolbarCollapsed: false,
  toggleToolbar: () => set((state) => ({ toolbarCollapsed: !state.toolbarCollapsed })),
}))
