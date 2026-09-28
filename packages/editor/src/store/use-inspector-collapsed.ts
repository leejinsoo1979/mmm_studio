import { create } from 'zustand'

/**
 * Whether the desktop inspector shows only its header. Shared across
 * inspector swaps (roof ↔ segment, …) and settable from outside, e.g. the
 * paint palette's 외형 tab opens it.
 */
export const useInspectorCollapsed = create<{
  collapsed: boolean
  setCollapsed: (next: boolean | ((previous: boolean) => boolean)) => void
}>((set) => ({
  collapsed: true,
  setCollapsed: (next) =>
    set((s) => ({ collapsed: typeof next === 'function' ? next(s.collapsed) : next })),
}))
