import type { AnyNode, WallConstruction, WallNode, WallSheetId } from '../../schema'
import { normalizeWallConstruction } from './wall-construction'
import { getWallFaceLines } from './wall-face-measurement'
import { DEFAULT_WALL_HEIGHT } from './wall-footprint'
import { calculateLevelMiters } from './wall-mitering'

/**
 * Wall finish area and material takeoff (자재 산출) for constructed walls:
 * net finished-face area (openings removed), finish sheets per layer and
 * framing lengths. Sizes are mm; areas m²; lengths m.
 */

export type WallSheet = {
  label: string
  material: 'gypsum' | 'mdf'
  widthMm: number
  heightMm: number
  thicknessMm: number
}

/** Sheets the takeoff can use: 석고보드 3×6 and MDF 4×8. */
export const WALL_SHEETS: Record<WallSheetId, WallSheet> = {
  'gypsum-9.5': {
    label: '석고보드 일반 9.5T',
    material: 'gypsum',
    widthMm: 900,
    heightMm: 1800,
    thicknessMm: 9.5,
  },
  'gypsum-12.5': {
    label: '석고보드 일반 12.5T',
    material: 'gypsum',
    widthMm: 900,
    heightMm: 1800,
    thicknessMm: 12.5,
  },
  'gypsum-water-9.5': {
    label: '방수 석고보드 9.5T',
    material: 'gypsum',
    widthMm: 900,
    heightMm: 1800,
    thicknessMm: 9.5,
  },
  'gypsum-water-12.5': {
    label: '방수 석고보드 12.5T',
    material: 'gypsum',
    widthMm: 900,
    heightMm: 1800,
    thicknessMm: 12.5,
  },
  'gypsum-fire-9.5': {
    label: '방화 석고보드 9.5T',
    material: 'gypsum',
    widthMm: 900,
    heightMm: 1800,
    thicknessMm: 9.5,
  },
  'gypsum-fire-12.5': {
    label: '방화 석고보드 12.5T',
    material: 'gypsum',
    widthMm: 900,
    heightMm: 1800,
    thicknessMm: 12.5,
  },
  'mdf-9': { label: 'MDF 9T', material: 'mdf', widthMm: 1220, heightMm: 2440, thicknessMm: 9 },
}

/** Framing defaults: 목상 30×30 @303, 경량 C-stud 50형 @450 with runners. */
export const WALL_FRAMING = {
  timber: { label: '목상 30×30', spacingMm: 303 },
  steel: { label: '경량 스터드 50형', spacingMm: 450 },
} as const

export function wallSheetsFor(c: WallConstruction): { p1: WallSheetId; p2: WallSheetId } {
  // 목상 / 경량: 석고 then MDF on the face; 떡가베: 석고 2PLY (mmmcraft note).
  const p2Default: WallSheetId = c.kind === 'bonded' ? 'gypsum-9.5' : 'mdf-9'
  return { p1: c.sheets?.p1 ?? 'gypsum-9.5', p2: c.sheets?.p2 ?? p2Default }
}

export type Rect = { x0: number; x1: number; y0: number; y1: number }

/** The wall face minus the openings, as disjoint rectangles (wall-local mm). */
export function facePieces(lengthMm: number, heightMm: number, openings: Rect[]): Rect[] {
  const holes = openings
    .map((o) => ({
      x0: Math.max(0, o.x0),
      x1: Math.min(lengthMm, o.x1),
      y0: Math.max(0, o.y0),
      y1: Math.min(heightMm, o.y1),
    }))
    .filter((o) => o.x1 > o.x0 && o.y1 > o.y0)
  const xs = Array.from(new Set([0, lengthMm, ...holes.flatMap((h) => [h.x0, h.x1])])).sort(
    (a, b) => a - b,
  )
  const pieces: Rect[] = []
  for (let i = 0; i < xs.length - 1; i += 1) {
    const x0 = xs[i] as number
    const x1 = xs[i + 1] as number
    if (x1 - x0 < 1e-6) continue
    const mid = (x0 + x1) / 2
    const cuts = holes
      .filter((h) => h.x0 <= mid && h.x1 >= mid)
      .map((h) => [h.y0, h.y1] as const)
      .sort((a, b) => a[0] - b[0])
    let y = 0
    for (const [a, b] of cuts) {
      if (a > y) pieces.push({ x0, x1, y0: y, y1: a })
      y = Math.max(y, b)
    }
    if (y < heightMm) pieces.push({ x0, x1, y0: y, y1: heightMm })
  }
  return pieces
}

/**
 * Sheets to cover the pieces. Sheets stand upright with their joints on a
 * grid from the wall start; each cut is (grid column ∩ piece) split into
 * sheet-height rows. Cuts of one width are packed first-fit-decreasing into
 * sheet-height strips, a sheet giving ⌊sheet width / cut width⌋ strips.
 */
export function sheetsForPieces(
  pieces: Rect[],
  sheet: Pick<WallSheet, 'widthMm' | 'heightMm'>,
): number {
  const sw = sheet.widthMm
  const sh = sheet.heightMm
  const byWidth = new Map<number, number[]>()
  for (const p of pieces) {
    for (let c = Math.floor(p.x0 / sw); c * sw < p.x1 - 1e-6; c += 1) {
      const w = Math.round(Math.min(p.x1, (c + 1) * sw) - Math.max(p.x0, c * sw))
      if (w <= 0) continue
      let h = p.y1 - p.y0
      const list = byWidth.get(w) ?? []
      while (h > 1e-6) {
        list.push(Math.min(sh, h))
        h -= sh
      }
      byWidth.set(w, list)
    }
  }
  let total = 0
  for (const [w, heights] of byWidth) {
    const strips: number[] = []
    for (const h of heights.sort((a, b) => b - a)) {
      const i = strips.findIndex((used) => used + h <= sh + 1e-6)
      if (i >= 0) strips[i] = (strips[i] as number) + h
      else strips.push(h)
    }
    total += Math.ceil(strips.length / Math.max(1, Math.floor(sw / w)))
  }
  return total
}

export type FramingTakeoff = {
  kind: 'timber' | 'steel'
  spacingMm: number
  studs: number
  /** Vertical members (m). */
  studM: number
  /** 목상 상하 가로재 / 경량 런너 (m); doors break the bottom one. */
  plateM: number
  /** Jambs, headers and sills around openings (m). */
  openingM: number
}

/** Vertical studs every `spacing` (plus the end one), cut short across
 *  openings; top/bottom plates; jambs, headers and sills at openings. */
export function framingTakeoff(
  kind: 'timber' | 'steel',
  spacingMm: number,
  lengthMm: number,
  heightMm: number,
  openings: Rect[],
): FramingTakeoff {
  const xs: number[] = []
  for (let x = 0; x < lengthMm - 1e-6; x += spacingMm) xs.push(x)
  xs.push(lengthMm)
  let studMm = 0
  for (const x of xs) {
    const blocked = openings
      .filter((o) => o.x0 < x && o.x1 > x)
      .reduce((sum, o) => sum + (Math.min(heightMm, o.y1) - Math.max(0, o.y0)), 0)
    studMm += Math.max(0, heightMm - blocked)
  }
  const doorWidths = openings.filter((o) => o.y0 <= 1e-6).reduce((sum, o) => sum + (o.x1 - o.x0), 0)
  const plateMm = lengthMm + Math.max(0, lengthMm - doorWidths)
  let openingMm = 0
  for (const o of openings) {
    openingMm += 2 * heightMm // jambs
    if (o.y1 < heightMm) openingMm += o.x1 - o.x0 // header
    if (o.y0 > 1e-6) openingMm += o.x1 - o.x0 // sill
  }
  return {
    kind,
    spacingMm,
    studs: xs.length,
    studM: round2(studMm / 1000),
    plateM: round2(plateMm / 1000),
    openingM: round2(openingMm / 1000),
  }
}

export type FaceTakeoff = {
  wallId: string
  face: 'front' | 'back'
  lengthMm: number
  heightMm: number
  grossM2: number
  openingM2: number
  netM2: number
  boards: { layer: '1P' | '2P'; sheet: WallSheetId; sheets: number; areaM2: number }[]
  framing: FramingTakeoff | null
}

/** Door / window openings of a wall, wall-local mm from its start. */
export function wallOpenings(wall: WallNode, nodes: Readonly<Record<string, AnyNode>>): Rect[] {
  const out: Rect[] = []
  for (const id of wall.children ?? []) {
    const n = nodes[id] as
      | (AnyNode & { position: number[]; width: number; height: number })
      | undefined
    if (!n || (n.type !== 'door' && n.type !== 'window')) continue
    const x = n.position[0] ?? 0
    const y = n.position[1] ?? 0
    out.push({
      x0: (x - n.width / 2) * 1000,
      x1: (x + n.width / 2) * 1000,
      y0: (y - n.height / 2) * 1000,
      y1: (y + n.height / 2) * 1000,
    })
  }
  return out
}

/** One finished face: areas, sheets per layer and framing. */
export function faceTakeoff(
  wall: WallNode,
  face: 'front' | 'back',
  lengthMm: number,
  openings: Rect[],
): FaceTakeoff | null {
  const c = normalizeWallConstruction(wall.construction)
  if (!c) return null
  const heightMm = (wall.height ?? DEFAULT_WALL_HEIGHT) * 1000
  const pieces = facePieces(lengthMm, heightMm, openings)
  const netMm2 = pieces.reduce((s, p) => s + (p.x1 - p.x0) * (p.y1 - p.y0), 0)
  const grossMm2 = lengthMm * heightMm
  const sheets = wallSheetsFor(c)
  return {
    wallId: wall.id,
    face,
    lengthMm: Math.round(lengthMm),
    heightMm: Math.round(heightMm),
    grossM2: round2(grossMm2 / 1e6),
    openingM2: round2((grossMm2 - netMm2) / 1e6),
    netM2: round2(netMm2 / 1e6),
    boards: (['1P', '2P'] as const).map((layer) => {
      const sheet = layer === '1P' ? sheets.p1 : sheets.p2
      return {
        layer,
        sheet,
        sheets: sheetsForPieces(pieces, WALL_SHEETS[sheet]),
        areaM2: round2(netMm2 / 1e6),
      }
    }),
    framing:
      c.kind === 'bonded'
        ? null
        : framingTakeoff(
            c.kind,
            c.studSpacing ?? WALL_FRAMING[c.kind].spacingMm,
            lengthMm,
            heightMm,
            openings,
          ),
  }
}

/**
 * Every finished face of the constructed walls among `walls` (one level):
 * the face length is the mitered finished face, so corners are not
 * double-counted; 떡가베 finishes both faces.
 */
export function levelWallTakeoff(
  walls: WallNode[],
  nodes: Readonly<Record<string, AnyNode>>,
): FaceTakeoff[] {
  const miters = calculateLevelMiters(walls)
  const out: FaceTakeoff[] = []
  for (const wall of walls) {
    const c = normalizeWallConstruction(wall.construction)
    if (!c) continue
    const lines = getWallFaceLines(wall, miters)
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const centre = Math.hypot(dx, dz)
    // Face lines are named by the +normal (−dz, dx); construction sides by
    // the left normal (dz, −dx) — so they swap. `shift` moves the openings
    // (measured from the wall start) onto the face's own start.
    const faceOf = (side: 'left' | 'right') => {
      const line = lines?.[side === 'left' ? 'right' : 'left']
      if (!line || centre < 1e-9) return { len: centre * 1000, shift: 0 }
      const along =
        ((line.start.x - wall.start[0]) * dx + (line.start.y - wall.start[1]) * dz) / centre
      return {
        len: Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) * 1000,
        shift: -along * 1000,
      }
    }
    const openings = wallOpenings(wall, nodes)
    const faces: ['front' | 'back', 'left' | 'right'][] = [['front', c.side]]
    if (c.kind === 'bonded' && c.bothFaces)
      faces.push(['back', c.side === 'left' ? 'right' : 'left'])
    for (const [face, side] of faces) {
      const { len, shift } = faceOf(side)
      const t = faceTakeoff(
        wall,
        face,
        len,
        openings.map((o) => ({ ...o, x0: o.x0 + shift, x1: o.x1 + shift })),
      )
      if (t) out.push(t)
    }
  }
  return out
}

export type TakeoffSummary = {
  netM2: number
  sheets: { sheet: WallSheetId; label: string; count: number; areaM2: number }[]
  framing: {
    kind: 'timber' | 'steel'
    label: string
    studM: number
    plateM: number
    openingM: number
  }[]
}

export function summarizeTakeoff(faces: FaceTakeoff[]): TakeoffSummary {
  const sheets = new Map<WallSheetId, { count: number; areaM2: number }>()
  const framing = new Map<'timber' | 'steel', { studM: number; plateM: number; openingM: number }>()
  let net = 0
  for (const f of faces) {
    net += f.netM2
    for (const b of f.boards) {
      const s = sheets.get(b.sheet) ?? { count: 0, areaM2: 0 }
      sheets.set(b.sheet, { count: s.count + b.sheets, areaM2: s.areaM2 + b.areaM2 })
    }
    if (f.framing) {
      const g = framing.get(f.framing.kind) ?? { studM: 0, plateM: 0, openingM: 0 }
      framing.set(f.framing.kind, {
        studM: g.studM + f.framing.studM,
        plateM: g.plateM + f.framing.plateM,
        openingM: g.openingM + f.framing.openingM,
      })
    }
  }
  return {
    netM2: round2(net),
    sheets: Array.from(sheets, ([sheet, v]) => ({
      sheet,
      label: WALL_SHEETS[sheet].label,
      count: v.count,
      areaM2: round2(v.areaM2),
    })),
    framing: Array.from(framing, ([kind, v]) => ({
      kind,
      label: WALL_FRAMING[kind].label,
      studM: round2(v.studM),
      plateM: round2(v.plateM),
      openingM: round2(v.openingM),
    })),
  }
}

/** CSV (UTF-8 BOM): one row per face and layer, then the totals. */
export function takeoffCsv(faces: FaceTakeoff[], wallLabel: (id: string) => string): string {
  const cell = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    [
      '벽',
      '면',
      '길이(mm)',
      '높이(mm)',
      '전체(m²)',
      '개구부(m²)',
      '마감(m²)',
      '층',
      '자재',
      '규격',
      '수량(장)',
      '골조',
      '간격',
      '스터드(m)',
      '상하재/런너(m)',
      '개구부 보강(m)',
    ].join(','),
  ]
  for (const f of faces) {
    for (const b of f.boards) {
      const s = WALL_SHEETS[b.sheet]
      lines.push(
        [
          wallLabel(f.wallId),
          f.face === 'front' ? '앞면' : '뒷면',
          f.lengthMm,
          f.heightMm,
          f.grossM2,
          f.openingM2,
          f.netM2,
          b.layer,
          s.label,
          `${s.widthMm}×${s.heightMm}`,
          b.sheets,
          b.layer === '1P' && f.framing ? WALL_FRAMING[f.framing.kind].label : '',
          b.layer === '1P' && f.framing ? f.framing.spacingMm : '',
          b.layer === '1P' && f.framing ? f.framing.studM : '',
          b.layer === '1P' && f.framing ? f.framing.plateM : '',
          b.layer === '1P' && f.framing ? f.framing.openingM : '',
        ]
          .map(cell)
          .join(','),
      )
    }
  }
  const sum = summarizeTakeoff(faces)
  lines.push('')
  lines.push(['합계', '', '', '', '', '', sum.netM2].map(cell).join(','))
  for (const s of sum.sheets) {
    const sheet = WALL_SHEETS[s.sheet]
    lines.push(
      ['', '', '', '', '', '', s.areaM2, '', s.label, `${sheet.widthMm}×${sheet.heightMm}`, s.count]
        .map(cell)
        .join(','),
    )
  }
  for (const g of sum.framing) {
    lines.push(
      ['', '', '', '', '', '', '', '', '', '', '', g.label, '', g.studM, g.plateM, g.openingM]
        .map(cell)
        .join(','),
    )
  }
  return `﻿${lines.join('\n')}\n`
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
