import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type WalkthroughView = 'third' | 'first'
/** A Rocketbox avatar id, e.g. `Female_Adult_05` (see first-person/avatar-catalog.ts). */
export type WalkthroughCharacterId = string

/** Saves from before the avatar library stored just a gender. */
const LEGACY_CHARACTERS: Record<string, WalkthroughCharacterId> = {
  male: 'Male_Adult_01',
  female: 'Female_Adult_01',
}

/** Third-person camera distance (m) from the character's head. */
export const THIRD_PERSON_DISTANCE = { min: 1.2, max: 6, default: 3.4 } as const

type WalkthroughViewState = {
  view: WalkthroughView
  character: WalkthroughCharacterId
  distance: number
  /** Crouching in place; any step or jump stands the walker back up. */
  crouching: boolean
  setView: (view: WalkthroughView) => void
  toggleView: () => void
  setCharacter: (character: WalkthroughCharacterId) => void
  setDistance: (distance: number) => void
  setCrouching: (crouching: boolean) => void
  toggleCrouch: () => void
}

const clampDistance = (distance: number) =>
  Math.min(THIRD_PERSON_DISTANCE.max, Math.max(THIRD_PERSON_DISTANCE.min, distance))

const useWalkthroughView = create<WalkthroughViewState>()(
  persist(
    (set) => ({
      view: 'third',
      character: 'Male_Adult_01',
      distance: THIRD_PERSON_DISTANCE.default,
      setView: (view) => set({ view }),
      toggleView: () => set((state) => ({ view: state.view === 'third' ? 'first' : 'third' })),
      setCharacter: (character) => set({ character }),
      setDistance: (distance) => set({ distance: clampDistance(distance) }),
      crouching: false,
      setCrouching: (crouching) => set({ crouching }),
      toggleCrouch: () => set((state) => ({ crouching: !state.crouching })),
    }),
    {
      name: 'mmm-walkthrough-view',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ view, character, distance }) => ({ view, character, distance }),
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Partial<WalkthroughViewState>
        const character = state.character && LEGACY_CHARACTERS[state.character]
        return (character ? { ...state, character } : state) as WalkthroughViewState
      },
    },
  ),
)

export default useWalkthroughView
