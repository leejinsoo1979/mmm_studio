import { create } from 'zustand'

/**
 * What the NPC play overlay shows this player (never shared): the E menu's
 * NPC, the chase chip, a note or the photo just taken, the camera flash and
 * the "왁!" over the player.
 */

export type NpcPlayToast = {
  text: string
  /** A photo to save (PNG data URL). */
  photo?: string
  until: number
}

export type NpcPlayUiState = {
  /** The NPC whose E menu is open. */
  menuNpcId: string | null
  /** The chase chip ("도망쳐! 9.4m"). */
  hud: string | null
  toast: NpcPlayToast | null
  /** When (local ms) the camera flash went off. */
  flashAt: number
  /** When (local ms) the player shouted "왁!". */
  shoutAt: number
  openMenu(npcId: string): void
  closeMenu(): void
  setHud(text: string | null): void
  showToast(text: string, ms?: number, photo?: string): void
  hideToast(): void
  flash(): void
  shout(): void
}

const TOAST_MS = 3500

export const useNpcPlayUi = create<NpcPlayUiState>((set, get) => ({
  menuNpcId: null,
  hud: null,
  toast: null,
  flashAt: 0,
  shoutAt: 0,
  openMenu: (menuNpcId) => set({ menuNpcId }),
  closeMenu: () => {
    if (get().menuNpcId !== null) set({ menuNpcId: null })
  },
  setHud: (hud) => {
    if (get().hud !== hud) set({ hud })
  },
  showToast: (text, ms = TOAST_MS, photo) =>
    set({ toast: { text, photo, until: Date.now() + ms } }),
  hideToast: () => set({ toast: null }),
  flash: () => set({ flashAt: Date.now() }),
  shout: () => set({ shoutAt: Date.now() }),
}))
