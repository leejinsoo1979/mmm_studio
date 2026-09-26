import { create } from 'zustand'
import type { CabinetSpec } from './engine/presets'
import { CabinetNode } from './schema'

/** A cabinet the user saved from the editor to reuse (내 모듈). */
export type MyCabinetModule = {
  id: string
  label: string
  savedAt: string
  elevationMm: number
  spec: CabinetSpec
}

const STORAGE_KEY = 'mmm-studio.cabinet-modules.v1'

function read(): MyCabinetModule[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // Re-validate every saved spec through the schema so a module saved by an
    // older build still loads with today's defaults.
    return parsed.flatMap((entry) => {
      const e = entry as MyCabinetModule
      const check = CabinetNode.safeParse({ ...e.spec })
      if (!check.success || typeof e.id !== 'string') return []
      return [{ ...e, spec: specOf(check.data) }]
    })
  } catch {
    return []
  }
}

function write(modules: MyCabinetModule[]) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(modules))
  } catch {
    // Storage unavailable (private mode / quota): the list still works in memory.
  }
}

/** The design fields of a cabinet, without placement or identity. */
export function specOf(node: CabinetNode): CabinetSpec {
  return {
    family: node.family,
    variant: node.variant,
    widthMm: node.widthMm,
    heightMm: node.heightMm,
    depthMm: node.depthMm,
    interior: node.interior,
    frontReveal: node.frontReveal,
    toeKick: node.toeKick,
    endPanels: node.endPanels,
    top: node.top,
    topSetbackMm: node.topSetbackMm,
    topStretcher: node.topStretcher,
    channels: node.channels,
    bodyColor: node.bodyColor,
    frontColor: node.frontColor,
  }
}

type MyModulesState = {
  modules: MyCabinetModule[]
  loaded: boolean
  load(): void
  save(label: string, node: CabinetNode): MyCabinetModule
  remove(id: string): void
}

export const useMyCabinetModules = create<MyModulesState>((set, get) => ({
  modules: [],
  loaded: false,
  load: () => {
    if (get().loaded) return
    set({ modules: read(), loaded: true })
  },
  save: (label, node) => {
    const entry: MyCabinetModule = {
      id: `mod_${Date.now().toString(36)}`,
      label: label.trim() || node.name || '내 모듈',
      savedAt: new Date().toISOString(),
      elevationMm: Math.round(node.position[1] * 1000),
      spec: specOf(node),
    }
    const modules = [entry, ...get().modules]
    write(modules)
    set({ modules, loaded: true })
    return entry
  },
  remove: (id) => {
    const modules = get().modules.filter((m) => m.id !== id)
    write(modules)
    set({ modules })
  },
}))
