import { create } from 'zustand'

/** Whether the item being placed or moved can't drop where it is (it overlaps). */
export const usePlacementFeedback = create<{
  blocked: boolean
  setBlocked: (blocked: boolean) => void
}>((set, get) => ({
  blocked: false,
  setBlocked: (blocked) => {
    if (get().blocked !== blocked) set({ blocked })
  },
}))
