import type { CabinetNode } from './schema'

/**
 * Node patches for the mmmcraft 엔드패널 / 상판설치 / 상판 따내기 options.
 */

type Patch = Partial<CabinetNode>
export type StoneThickness = CabinetNode['stoneTop']['thicknessMm']

/** mmmcraft resolvePetPanelThicknessMm: 18.5 and 15.5 are cut from 18 PET. */
export function petThicknessMm(value: number): number {
  return value === 18.5 || value === 15.5 ? 18 : value
}

/**
 * 인조대리석 두께 for one base cabinet. The total height stays put: the body
 * gives up (or takes back) the difference against a 20 mm top. A first
 * install brings the 23 mm front overhang; 없음 clears offsets and 뒷턱; a
 * stone top replaces a 상부 EP.
 */
export function stoneThicknessPatch(node: CabinetNode, next: StoneThickness): Patch {
  const current = node.stoneTop.thicknessMm
  const bodyMm = node.heightMm - (node.toeKick.enabled ? node.toeKick.heightMm : 0)
  const nextBody = Math.min(
    3000,
    Math.max(100, Math.round(bodyMm + (current || 20) - (next || 20))),
  )
  const heightMm = node.heightMm + (nextBody - bodyMm)
  const stoneTop: CabinetNode['stoneTop'] =
    next === 0
      ? { thicknessMm: 0, frontMm: 0, backMm: 0, leftMm: 0, rightMm: 0, backLip: null }
      : { ...node.stoneTop, thicknessMm: next, frontMm: current === 0 ? 23 : node.stoneTop.frontMm }
  return {
    stoneTop,
    heightMm,
    ...(next > 0 && node.topEndPanel.enabled
      ? { topEndPanel: { ...node.topEndPanel, enabled: false } }
      : {}),
  }
}

/** mmmcraft's warning when body + stone passes 800 mm. */
export function stoneHeightWarning(node: CabinetNode): string | null {
  const t = node.stoneTop.thicknessMm
  if (!t) return null
  const body = node.heightMm - (node.toeKick.enabled ? node.toeKick.heightMm : 0)
  const total = body + t
  return total > 800 ? `⚠ 총 높이 ${total}mm (본체 ${body} + 상판 ${t}) — 800mm 초과` : null
}

/** Switching a side EP; the last one off also drops 도어 확장/축소. */
export function endPanelTogglePatch(node: CabinetNode, side: 'left' | 'right', on: boolean): Patch {
  const endPanels = { ...node.endPanels, [side]: on }
  const opts = node.endPanelOptions
  return {
    endPanels,
    endPanelOptions: {
      ...opts,
      ...(on && side === 'left' ? { leftFrontMm: 0 } : {}),
      ...(on && side === 'right' ? { rightFrontMm: 0 } : {}),
    },
    ...(!endPanels.left && !endPanels.right
      ? { doorWidthAdjust: { enabled: false, mm: -1.5 } }
      : {}),
  }
}

/** 상부 EP on a base cabinet replaces its stone top. */
export function topEndPanelPatch(node: CabinetNode, enabled: boolean): Patch {
  return {
    topEndPanel: { ...node.topEndPanel, enabled },
    ...(enabled && node.stoneTop.thicknessMm > 0
      ? {
          stoneTop: {
            thicknessMm: 0,
            frontMm: 0,
            backMm: 0,
            leftMm: 0,
            rightMm: 0,
            backLip: null,
          },
        }
      : {}),
  }
}
