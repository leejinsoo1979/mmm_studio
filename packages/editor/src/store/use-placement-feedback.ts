import { create } from 'zustand'

/** The held ghost's projected screen box edges (client px). */
export type PlacementAnchor = { left: number; right: number; top: number }

const moved = (a: PlacementAnchor | null, b: PlacementAnchor | null): boolean =>
  !(a && b) ||
  Math.abs(a.left - b.left) > 0.5 ||
  Math.abs(a.right - b.right) > 0.5 ||
  Math.abs(a.top - b.top) > 0.5

/**
 * Live feedback from the item placement coordinator: whether the held item
 * can't drop where it is (it overlaps), and where its ghost sits on screen so
 * the key list can ride beside it.
 */
export const usePlacementFeedback = create<{
  blocked: boolean
  setBlocked: (blocked: boolean) => void
  anchor: PlacementAnchor | null
  setAnchor: (anchor: PlacementAnchor | null) => void
}>((set, get) => ({
  blocked: false,
  setBlocked: (blocked) => {
    if (get().blocked !== blocked) set({ blocked })
  },
  anchor: null,
  setAnchor: (anchor) => {
    const current = get().anchor
    if (current === anchor || (current === null && anchor === null)) return
    if (moved(current, anchor)) set({ anchor })
  },
}))
