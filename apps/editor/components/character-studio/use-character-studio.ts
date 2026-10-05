import type { AvatarLook } from '@pascal-app/editor'
import { create } from 'zustand'

/** Whose look the studio edits: the player's own, or an NPC's in the scene. */
export type StudioTarget =
  | { kind: 'player' }
  | { kind: 'npc'; nodeId: string; name: string; avatar: string; look: AvatarLook | null }

const PLAYER: StudioTarget = { kind: 'player' }

/** Whether the character studio is open (from the lobby, the game's panel, or an NPC's inspector). */
export const useCharacterStudio = create<{
  open: boolean
  target: StudioTarget
  /** Opens the studio on `target`, the player when none is given. */
  show: (target?: StudioTarget) => void
  hide: () => void
}>((set) => ({
  open: false,
  target: PLAYER,
  show: (target = PLAYER) => set({ open: true, target }),
  hide: () => set({ open: false, target: PLAYER }),
}))
