import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { create } from 'zustand'
import { type CabinetNode, resolveCabinetNode } from './schema'

/**
 * mmmcraft 도어설치: modules are placed as bare carcasses and the doors are
 * hung afterwards, on every module at once. Once doors are on, modules placed
 * later come with doors too. Open / closed is a view state for all doors.
 * Neither is saved; `hasDoor` on each cabinet is.
 */
export const useCabinetDoors = create<{
  /** 도어설치 pressed and not undone: new cabinets get doors. */
  installIntent: boolean
  open: boolean
  setOpen: (open: boolean) => void
}>((set) => ({
  installIntent: false,
  open: false,
  setOpen: (open) => set({ open }),
}))

function cabinets(nodes: Record<string, AnyNode>): CabinetNode[] {
  return Object.values(nodes)
    .filter((n) => (n.type as string) === 'cabinet')
    .map((n) => resolveCabinetNode(n as unknown as CabinetNode))
}

export function anyCabinetHasDoor(nodes: Record<string, AnyNode>): boolean {
  return cabinets(nodes).some((c) => c.hasDoor)
}

/** Whether a cabinet placed now comes with its doors hung. */
export function newCabinetHasDoor(): boolean {
  return useCabinetDoors.getState().installIntent || anyCabinetHasDoor(useScene.getState().nodes)
}

/** 도어설치 / 도어제거 on every cabinet in the scene, as one undo step. */
export function setAllCabinetDoors(hasDoor: boolean) {
  const updates = cabinets(useScene.getState().nodes)
    .filter((c) => c.hasDoor !== hasDoor)
    .map((c) => ({ id: c.id as AnyNodeId, data: { hasDoor } as Partial<AnyNode> }))
  if (updates.length > 0) useScene.getState().updateNodes(updates)
  // Doors are hung closed.
  useCabinetDoors.setState({ installIntent: hasDoor, open: false })
}
