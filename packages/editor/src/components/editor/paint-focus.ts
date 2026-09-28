import type { AnyNodeId } from '@pascal-app/core'
import { create } from 'zustand'

/**
 * The surface the host's paint card is working on, so the canvas can trace
 * it: the painted node, the part (null = the card's first part) and whether
 * the whole room is in scope. Null while no paint card is open.
 */
export type PaintFocus = {
  nodeId: AnyNodeId
  role: string | null
  roomScope: boolean
}

export const usePaintFocus = create<{
  focus: PaintFocus | null
  setFocus: (focus: PaintFocus | null) => void
}>((set) => ({
  focus: null,
  setFocus: (focus) => set({ focus }),
}))
