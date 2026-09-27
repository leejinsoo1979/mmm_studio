import { create } from 'zustand'

/** inZOI "UI 숨기기" (Ctrl+Shift+U): hide the editor chrome, keep the scene. */
export const useUiHidden = create<{ hidden: boolean; toggle: () => void }>((set) => ({
  hidden: false,
  toggle: () => set((state) => ({ hidden: !state.hidden })),
}))
