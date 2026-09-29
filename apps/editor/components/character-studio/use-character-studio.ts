import { create } from 'zustand'

/** Whether the character studio is open (from the lobby or the game's panel). */
export const useCharacterStudio = create<{ open: boolean; show: () => void; hide: () => void }>(
  (set) => ({
    open: false,
    show: () => set({ open: true }),
    hide: () => set({ open: false }),
  }),
)
