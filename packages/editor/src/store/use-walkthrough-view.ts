import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type WalkthroughView = 'third' | 'first'
export type WalkthroughCharacterId = 'male' | 'female'

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
      character: 'male',
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
    },
  ),
)

export default useWalkthroughView
