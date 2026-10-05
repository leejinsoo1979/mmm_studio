import { create } from 'zustand'

type WalkthroughFacingState = {
  /**
   * A world heading (rad about +Y, 0 = +Z) the walker's body turns to and
   * holds while something is choreographed with it, like a high five; `null`
   * leaves the heading to the walk. Any step the player asks for releases it,
   * so a subscriber seeing it go back to `null` knows they walked off.
   */
  yaw: number | null
  face: (yaw: number) => void
  release: () => void
}

const useWalkthroughFacing = create<WalkthroughFacingState>((set) => ({
  yaw: null,
  face: (yaw) => set({ yaw }),
  release: () => set({ yaw: null }),
}))

export default useWalkthroughFacing
