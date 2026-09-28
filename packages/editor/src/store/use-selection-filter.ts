import type { AnyNode } from '@pascal-app/core'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { resolveNodeSelectionTarget } from '../lib/selection-routing'

export type SelectionFilterKey = 'furniture' | 'structure'

type SelectionFilterState = Record<SelectionFilterKey, boolean> & {
  toggle: (key: SelectionFilterKey) => void
}

/** inZOI's selection filter: which kinds of object a click may pick up. */
export const useSelectionFilter = create<SelectionFilterState>()(
  persist(
    (set) => ({
      furniture: true,
      structure: true,
      toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SelectionFilterState>),
    }),
    { name: 'mmm-selection-filter', storage: createJSONStorage(() => localStorage) },
  ),
)

export function passesSelectionFilter(node: AnyNode | undefined): boolean {
  if (!node || node.type === 'zone') return true
  const { furniture, structure } = useSelectionFilter.getState()
  if (furniture && structure) return true
  const phase = resolveNodeSelectionTarget(node)?.phase
  if (phase === 'furnish') return furniture
  if (phase === 'structure') return structure
  return true
}
