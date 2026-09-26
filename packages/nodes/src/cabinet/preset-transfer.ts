import { create } from 'zustand'
import { cloneWithFreshIds } from './engine/tree'
import { backWallGapPatch } from './placement-updates'
import type { CabinetNode } from './schema'

/**
 * mmmcraft 속성 저장 / 속성 이식 (furniturePresetTransfer.ts): one saved
 * property set per category, kept for the session only. Width and position
 * are never copied.
 */

export type PresetCategory = CabinetNode['family']
export const CATEGORY_LABEL: Record<PresetCategory, string> = {
  tall: '키큰장',
  upper: '상부장',
  base: '하부장',
}

export const PRESET_GROUPS = [
  { key: 'depth', label: '깊이 (가구 깊이, 앞고정/뒤고정)' },
  { key: 'door', label: '도어 설정 (갭, 확장량)' },
  { key: 'topBottom', label: '높이 / 상단몰딩 / 걸레받이 (사이즈, 옵셋, 갭, 띄움)' },
  { key: 'backPanel', label: '백패널 (두께, 뒷벽 이격)' },
  { key: 'endPanel', label: '엔드패널 (좌/우 EP, 두께, 깊이, 옵셋, 상·하부 EP)' },
  { key: 'shelfRod', label: '섹션 / 선반 / 내부 구성 (칸, 선반, 옷봉, 서랍, 도어·경첩)' },
  { key: 'topNotch', label: '상판 따내기 / 상판설치 (인조대리석)' },
  { key: 'materialColor', label: '재질 / 색상 (몸통/도어/결방향/패널 제외)' },
] as const
export type PresetGroup = (typeof PRESET_GROUPS)[number]['key']

const GROUP_FIELDS: Record<PresetGroup, (keyof CabinetNode)[]> = {
  depth: ['depthMm', 'depthAnchor'],
  door: ['frontReveal', 'doorWidthAdjust'],
  topBottom: ['heightMm', 'topMoulding', 'toeKick'],
  backPanel: ['backThicknessMm', 'backWallGapMm'],
  endPanel: ['endPanels', 'endPanelOptions', 'bottomEndPanel', 'topEndPanel'],
  shelfRod: ['interior'],
  topNotch: ['topNotch', 'stoneTop'],
  materialColor: ['bodyColor', 'frontColor', 'panelGrain', 'panelExclusions'],
}

export type CabinetPreset = {
  savedAt: number
  sourcePresetId?: string
  /** 띄움 of the source when its toe kick is off (mm). */
  floatMm?: number
  props: Partial<CabinetNode>
}

export function savePresetFrom(node: CabinetNode): CabinetPreset {
  const props: Partial<CabinetNode> = {}
  for (const fields of Object.values(GROUP_FIELDS)) {
    for (const f of fields) (props as Record<string, unknown>)[f] = structuredClone(node[f])
  }
  return {
    savedAt: Date.now(),
    ...(node.presetId ? { sourcePresetId: node.presetId } : {}),
    ...(!node.toeKick.enabled && node.family !== 'upper'
      ? { floatMm: Math.round(node.position[1] * 1000) }
      : {}),
    props,
  }
}

function hasDoor(node: CabinetNode): boolean {
  const walk = (c: CabinetNode['interior']): boolean =>
    c.front?.type === 'door' ||
    c.front?.type === 'flap' ||
    c.front?.type === 'panel' ||
    (c.kind === 'split' && c.children.some(walk))
  return walk(node.interior)
}

/** Groups that mean something on `target` (mmmcraft hides the rest). */
export function applicableGroups(target: CabinetNode, preset: CabinetPreset): PresetGroup[] {
  return PRESET_GROUPS.map((g) => g.key).filter((g) => {
    if (g === 'door') return hasDoor(target)
    if (g === 'topNotch') return target.family !== 'tall'
    if (g === 'shelfRod')
      return !!preset.sourcePresetId && preset.sourcePresetId === target.presetId
    return true
  })
}

/** The node patch for `target` from the chosen groups. */
export function presetPatch(
  target: CabinetNode,
  preset: CabinetPreset,
  groups: PresetGroup[],
): Partial<CabinetNode> {
  const allowed = new Set(applicableGroups(target, preset))
  const patch: Partial<CabinetNode> = {}
  for (const g of groups) {
    if (!allowed.has(g)) continue
    for (const f of GROUP_FIELDS[g]) {
      const value = preset.props[f]
      if (value === undefined) continue
      ;(patch as Record<string, unknown>)[f] =
        f === 'interior'
          ? cloneWithFreshIds(value as CabinetNode['interior'])
          : structuredClone(value)
    }
  }
  // 뒷벽 이격 moves the body; apply it as a move, not a bare value.
  if (patch.backWallGapMm !== undefined) {
    Object.assign(patch, backWallGapPatch(target, patch.backWallGapMm))
  }
  if (
    groups.includes('topBottom') &&
    preset.floatMm !== undefined &&
    patch.toeKick?.enabled === false
  ) {
    const position = patch.position ?? target.position
    patch.position = [position[0], preset.floatMm / 1000, position[2]]
  }
  return patch
}

type PresetState = {
  presets: Partial<Record<PresetCategory, CabinetPreset>>
  save(node: CabinetNode): void
}

/** Session-only, like mmmcraft's uiStore.furniturePresets. */
export const useCabinetPresets = create<PresetState>((set) => ({
  presets: {},
  save: (node) => set((s) => ({ presets: { ...s.presets, [node.family]: savePresetFrom(node) } })),
}))
