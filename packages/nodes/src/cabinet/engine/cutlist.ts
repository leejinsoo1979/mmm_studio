import type { CabinetNode } from '../schema'
import { defaultGrain, type Grain } from './grain'
import { buildCabinetParts, type CabinetPart, hingeCupCentres, type PartMaterial } from './parts'
import { HINGE_CUP_DEPTH_MM, HINGE_CUP_DIAMETER_MM, round1 } from './rules'

export type PanelRow = {
  name: string
  material: PartMaterial
  thicknessMm: number
  /** Longest face dimension. */
  lengthMm: number
  widthMm: number
  quantity: number
  cabinet: string
  /** Machining notes, e.g. 목찬넬 따내기 positions on a side panel. */
  notes: string
  /** Wood grain: vertical = along the length's height direction (mmmcraft). */
  grain: Grain
}

/** A panel's grain: the 패널 목록 override, else mmmcraft's name rule. */
export function panelGrain(node: CabinetNode, name: string): Grain {
  return node.panelGrain[name] ?? defaultGrain(name)
}

export type HardwareRow = { name: string; quantity: number; note?: string }

export type HingeBoring = {
  cabinet: string
  door: string
  hinge: 'left' | 'right' | 'top'
  cups: { x: number; y: number }[]
  diameterMm: number
  depthMm: number
}

/** Face size of a panel: drop the thinnest dimension (the board thickness). */
export function panelFace(part: CabinetPart): { thickness: number; length: number; width: number } {
  const dims = [part.box.w, part.box.h, part.box.d].sort((a, b) => a - b)
  return { thickness: dims[0] ?? 0, width: dims[1] ?? 0, length: dims[2] ?? 0 }
}

/** Panel list for one cabinet: identical panels are merged with a quantity.
 *  `cutting` drops the panels unticked in the 패널 목록. */
export function cabinetPanelRows(
  node: CabinetNode,
  label = node.name ?? '가구',
  { cutting = false }: { cutting?: boolean } = {},
): PanelRow[] {
  const rows = new Map<string, PanelRow>()
  for (const part of buildCabinetParts(node).parts) {
    if (!part.isPanel) continue
    if (cutting && node.panelExclusions.includes(part.name)) continue
    const face = panelFace(part)
    const notes = [
      ...(part.notches ?? []).map((n) => `따내기 ${n.height}×${n.depth} @${n.fromBottom}`),
      ...(part.cornerNotch
        ? [
            `따내기 ${part.cornerNotch.width}×${part.cornerNotch.depth}(${part.cornerNotch.side === 'left' ? '좌' : '우'})`,
          ]
        : []),
    ].join(', ')
    const grain = panelGrain(node, part.name)
    const key = [
      part.name,
      part.material,
      face.thickness,
      face.length,
      face.width,
      notes,
      grain,
    ].join('|')
    const existing = rows.get(key)
    if (existing) existing.quantity += 1
    else
      rows.set(key, {
        name: part.name,
        material: part.material,
        thicknessMm: face.thickness,
        lengthMm: face.length,
        widthMm: face.width,
        quantity: 1,
        cabinet: label,
        notes,
        grain,
      })
  }
  return Array.from(rows.values())
}

export function cabinetHardwareRows(node: CabinetNode): HardwareRow[] {
  const counts = new Map<string, HardwareRow>()
  const add = (name: string, n = 1, note?: string) => {
    const row = counts.get(name)
    if (row) row.quantity += n
    else counts.set(name, { name, quantity: n, note })
  }
  for (const part of buildCabinetParts(node).parts) {
    if (part.role === 'door' && part.hingePositionsMm && part.hinge) {
      add('경첩', part.hingePositionsMm.length, 'Ø35 컵')
    }
    if (part.role === 'foot') add('조절발')
    if (part.role === 'rod') add('옷봉', 1, `${round1(part.box.w)}mm`)
    if (part.role === 'pants-hanger') add('바지걸이')
    if (part.role === 'drawer-side' && part.id.startsWith('drawer-side-l-')) {
      add('서랍 레일(쌍)')
    }
  }
  return Array.from(counts.values())
}

export function cabinetHingeBorings(node: CabinetNode, label = node.name ?? '가구'): HingeBoring[] {
  return buildCabinetParts(node)
    .parts.filter(
      (part) =>
        part.role === 'door' &&
        part.hinge &&
        !node.panelExclusions.includes(part.name) &&
        !node.hingeBoringExclusions.includes(part.name),
    )
    .map((part) => ({
      cabinet: label,
      door: part.name,
      hinge: part.hinge as HingeBoring['hinge'],
      cups: hingeCupCentres(part).map((c) => ({ x: round1(c.x), y: round1(c.y) })),
      diameterMm: HINGE_CUP_DIAMETER_MM,
      depthMm: HINGE_CUP_DEPTH_MM,
    }))
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Cutlist CSV for a set of cabinets (UTF-8 with BOM so Excel reads Korean). */
export function cutlistCsv(cabinets: { node: CabinetNode; label: string }[]): string {
  const header = ['가구', '부재', '재질', '두께', '길이', '폭', '수량', '결', '비고']
  const lines = [header.join(',')]
  for (const { node, label } of cabinets) {
    // Stone is cut by the stone supplier, not the panel saw (mmmcraft drops
    // 인조대리석 from its CNC list).
    for (const row of cabinetPanelRows(node, label, { cutting: true })) {
      if (row.material === 'stone') continue
      lines.push(
        [
          row.cabinet,
          row.name,
          row.material,
          row.thicknessMm,
          row.lengthMm,
          row.widthMm,
          row.quantity,
          row.grain === 'vertical' ? '세로' : '가로',
          row.notes,
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }
  return `﻿${lines.join('\n')}\n`
}
