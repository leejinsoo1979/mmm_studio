import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { create } from 'zustand'
import { type CabinetNode, resolveCabinetNode } from './schema'

/**
 * mmmcraft 도어설치: modules are placed as bare carcasses and the doors are
 * hung afterwards, on every module at once. Once doors are on, modules placed
 * later come with doors too. Open / closed is a view state: all doors at
 * once, or one cabinet at a time (walking through in first person).
 * Neither is saved; `hasDoor` on each cabinet is.
 */
export const useCabinetDoors = create<{
  /** 도어설치 pressed and not undone: new cabinets get doors. */
  installIntent: boolean
  open: boolean
  /** Cabinets opened / closed on their own since the last open-all. */
  cabinetOpen: Record<string, boolean>
  setOpen: (open: boolean) => void
  toggleCabinet: (id: string) => void
}>((set, get) => ({
  installIntent: false,
  open: false,
  cabinetOpen: {},
  setOpen: (open) => set({ open, cabinetOpen: {} }),
  toggleCabinet: (id) => set({ cabinetOpen: { ...get().cabinetOpen, [id]: !isCabinetOpen(id) } }),
}))

export function isCabinetOpen(id: string): boolean {
  const { open, cabinetOpen } = useCabinetDoors.getState()
  return cabinetOpen[id] ?? open
}

function cabinets(nodes: Record<string, AnyNode>): CabinetNode[] {
  return Object.values(nodes)
    .filter((n) => (n.type as string) === 'cabinet')
    .map((n) => resolveCabinetNode(n as unknown as CabinetNode))
}

export function anyCabinetHasDoor(nodes: Record<string, AnyNode>): boolean {
  return cabinets(nodes).some((c) => c.hasDoor)
}

/**
 * Whether a cabinet placed now comes with its doors hung: after 도어설치, or
 * when the scene has doors hung by 도어설치. A cabinet saved before doors
 * were hung separately shows its doors but doesn't count, so placing next to
 * it still gives a bare carcass.
 */
export function newCabinetHasDoor(): boolean {
  if (useCabinetDoors.getState().installIntent) return true
  return Object.values(useScene.getState().nodes).some(
    (n) => (n.type as string) === 'cabinet' && (n as { hasDoor?: boolean }).hasDoor === true,
  )
}

/** 도어설치 / 도어제거 on every cabinet in the scene, as one undo step. */
export function setAllCabinetDoors(hasDoor: boolean) {
  const updates = cabinets(useScene.getState().nodes)
    .filter((c) => c.hasDoor !== hasDoor)
    .map((c) => ({ id: c.id as AnyNodeId, data: { hasDoor } as Partial<AnyNode> }))
  if (updates.length > 0) useScene.getState().updateNodes(updates)
  // Doors are hung closed.
  useCabinetDoors.setState({ installIntent: hasDoor, open: false, cabinetOpen: {} })
}
