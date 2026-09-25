import type { CabinetNode } from '../schema'
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

/** Panel list for one cabinet: identical panels are merged with a quantity. */
export function cabinetPanelRows(node: CabinetNode, label = node.name ?? '가구'): PanelRow[] {
  const rows = new Map<string, PanelRow>()
  for (const part of buildCabinetParts(node).parts) {
    if (!part.isPanel) continue
    const face = panelFace(part)
    const notes = (part.notches ?? [])
      .map((n) => `따내기 ${n.height}×${n.depth} @${n.fromBottom}`)
      .join(', ')
    const key = [part.name, part.material, face.thickness, face.length, face.width, notes].join('|')
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
    if (part.role === 'handle') add('손잡이')
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
    .parts.filter((part) => part.role === 'door' && part.hinge)
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
  const header = ['가구', '부재', '재질', '두께', '길이', '폭', '수량', '비고']
  const lines = [header.join(',')]
  for (const { node, label } of cabinets) {
    for (const row of cabinetPanelRows(node, label)) {
      lines.push(
        [
          row.cabinet,
          row.name,
          row.material,
          row.thicknessMm,
          row.lengthMm,
          row.widthMm,
          row.quantity,
          row.notes,
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }
  return `﻿${lines.join('\n')}\n`
}
