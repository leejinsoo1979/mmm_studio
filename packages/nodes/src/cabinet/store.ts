import { create } from 'zustand'
import { type CabinetSpec, getCabinetPreset, instantiateSpec } from './engine/presets'
import { CabinetNode } from './schema'

/** What the cabinet placement tool drops on the next click. */
export type CabinetBrush =
  | { kind: 'preset'; presetId: string }
  | { kind: 'custom'; label: string; spec: CabinetSpec; elevationMm: number }

type CabinetBrushState = {
  brush: CabinetBrush
  /** Free-standing rotation (used when the cursor is not near a wall). */
  freeRotationY: number
  setBrush(brush: CabinetBrush): void
  rotateFree(delta: number): void
}

export const useCabinetBrush = create<CabinetBrushState>((set) => ({
  brush: { kind: 'preset', presetId: 'single-2drawer-hanging' },
  freeRotationY: 0,
  setBrush: (brush) => set({ brush }),
  rotateFree: (delta) => set((s) => ({ freeRotationY: s.freeRotationY + delta })),
}))

/** Resolve a brush into a fresh, unplaced cabinet node. */
export function cabinetFromBrush(brush: CabinetBrush): { node: CabinetNode; elevationMm: number } {
  if (brush.kind === 'custom') {
    return {
      node: CabinetNode.parse({ ...instantiateSpec(brush.spec), name: brush.label }),
      elevationMm: brush.elevationMm,
    }
  }
  const preset = getCabinetPreset(brush.presetId) ?? getCabinetPreset('single-2drawer-hanging')
  if (!preset) throw new Error('cabinet presets missing')
  return {
    node: CabinetNode.parse({
      ...instantiateSpec(preset.spec()),
      name: preset.label,
      presetId: preset.id,
    }),
    elevationMm: preset.elevationMm,
  }
}
