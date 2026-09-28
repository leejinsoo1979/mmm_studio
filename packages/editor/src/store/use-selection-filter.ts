import type { AnyNode, ItemNode } from '@pascal-app/core'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { resolveNodeSelectionTarget } from '../lib/selection-routing'

export type SelectionFilterKey = 'furniture' | 'structure'

/** inZOI's structure chips: floor · wall · roof · stairs · door & window · the rest. */
export type StructureKind = 'floor' | 'wall' | 'roof' | 'stair' | 'opening' | 'other'

export const STRUCTURE_KINDS: StructureKind[] = [
  'floor',
  'wall',
  'roof',
  'stair',
  'opening',
  'other',
]

const KIND_BY_TYPE: Partial<Record<AnyNode['type'], StructureKind>> = {
  slab: 'floor',
  ceiling: 'floor',
  wall: 'wall',
  fence: 'wall',
  roof: 'roof',
  'roof-segment': 'roof',
  stair: 'stair',
  'stair-segment': 'stair',
  door: 'opening',
  window: 'opening',
}

export function structureKindOf(node: AnyNode): StructureKind {
  if (node.type === 'item') {
    const category = (node as ItemNode).asset.category
    return category === 'door' || category === 'window' ? 'opening' : 'other'
  }
  return KIND_BY_TYPE[node.type] ?? 'other'
}

type SelectionFilterState = Record<SelectionFilterKey, boolean> & {
  structureKinds: Record<StructureKind, boolean>
  toggle: (key: SelectionFilterKey) => void
  toggleKind: (kind: StructureKind) => void
}

const ALL_KINDS_ON = Object.fromEntries(STRUCTURE_KINDS.map((kind) => [kind, true])) as Record<
  StructureKind,
  boolean
>

/** inZOI's selection filter: which kinds of object a click may pick up. */
export const useSelectionFilter = create<SelectionFilterState>()(
  persist(
    (set) => ({
      furniture: true,
      structure: true,
      structureKinds: ALL_KINDS_ON,
      toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SelectionFilterState>),
      toggleKind: (kind) =>
        set((s) => ({ structureKinds: { ...s.structureKinds, [kind]: !s.structureKinds[kind] } })),
    }),
    {
      name: 'mmm-selection-filter',
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SelectionFilterState>
        return {
          ...current,
          ...saved,
          structureKinds: { ...ALL_KINDS_ON, ...saved.structureKinds },
        }
      },
    },
  ),
)

export function passesSelectionFilter(node: AnyNode | undefined): boolean {
  if (!node || node.type === 'zone') return true
  const { furniture, structure, structureKinds } = useSelectionFilter.getState()
  const phase = resolveNodeSelectionTarget(node)?.phase
  if (phase === 'furnish') return furniture
  if (phase === 'structure') return structure && structureKinds[structureKindOf(node)]
  return true
}
