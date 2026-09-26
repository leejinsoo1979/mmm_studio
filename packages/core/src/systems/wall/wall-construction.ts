import type { WallConstruction, WallNode } from '../../schema'

/**
 * mmmcraft wall construction (시공 방식), ported from mmmcraft
 * `wallConstruction.ts` / `hiddenDoorCad.ts`. Depths are mm from the
 * finished face into the wall; `thickness` (m) includes the finish.
 */

/** Board back face in the CAD section (its 0.0077 residual is intentional). */
export const CAD_BOARD_BACK_MM = 18.00773151634348
export const CAD_STUD_SIZE_MM = 30

/** 경량 50형 C-stud web depth. */
export const STEEL_STUD_DEPTH_MM = 50

export const WALL_CONSTRUCTION_KINDS = {
  timber: { label: '목상', buildUpMm: 58.00773151634348 },
  /** The same 1P + 2P board zone as 목상, on a 50 mm steel stud. */
  steel: { label: '경량', buildUpMm: CAD_BOARD_BACK_MM + STEEL_STUD_DEPTH_MM },
  bonded: { label: '떡가베', buildUpMm: 29 },
} as const

export type WallConstructionLayer = {
  id: 'core' | 'finish-2p' | 'finish-1p' | 'back-finish-1p' | 'back-finish-2p'
  fromMm: number
  toMm: number
  color: string
}

/** 떡가베 always carries boards on both faces; 목상 never does. */
export function normalizeWallConstruction(
  construction: WallConstruction | undefined,
): WallConstruction | undefined {
  if (!construction) return undefined
  const { bothFaces: _bothFaces, ...rest } = construction
  return construction.kind === 'bonded' ? { ...rest, bothFaces: true } : rest
}

/** Finish build-up added to the core, mm (목상 58.0077, 떡가베 29 × 2). */
export function constructionBuildUpMm(construction: WallConstruction | undefined): number {
  const c = normalizeWallConstruction(construction)
  if (!c) return 0
  const base = WALL_CONSTRUCTION_KINDS[c.kind].buildUpMm
  return c.kind === 'bonded' && c.bothFaces ? base * 2 : base
}

/** Total thickness in mm (wall.thickness is metres). */
export function wallThicknessMm(wall: Pick<WallNode, 'thickness'>, fallbackM = 0.1): number {
  return (wall.thickness ?? fallbackM) * 1000
}

/** The structural core without the finish build-up, mm. */
export function wallCoreThicknessMm(wall: Pick<WallNode, 'thickness' | 'construction'>): number {
  return wallThicknessMm(wall) - constructionBuildUpMm(wall.construction)
}

/**
 * Change the construction keeping the core and the centreline: the new
 * total is core + new build-up (mmmcraft `withWallConstruction`).
 */
export function withWallConstruction(
  wall: Pick<WallNode, 'thickness' | 'construction'>,
  next: WallConstruction | undefined,
): { thickness: number; construction: WallConstruction | undefined } {
  const normalized = normalizeWallConstruction(next)
  const coreMm = wallCoreThicknessMm(wall)
  return {
    thickness: (coreMm + constructionBuildUpMm(normalized)) / 1000,
    construction: normalized,
  }
}

/** mmmcraft's validation messages, or null when the wall is valid. */
export function wallConstructionError(
  wall: Pick<WallNode, 'thickness' | 'construction'>,
): string | null {
  const c = wall.construction
  if (!c) return null
  if (!(c.kind in WALL_CONSTRUCTION_KINDS) || (c.side !== 'left' && c.side !== 'right')) {
    return '벽 시공 방식과 마감 방향을 확인해 주세요.'
  }
  if (!(wallCoreThicknessMm(wall) > 0)) return '마감 두께를 제외한 벽체 두께는 0보다 커야 합니다.'
  if (c.studSpacing !== undefined && !(c.studSpacing >= CAD_STUD_SIZE_MM)) {
    return '목상 간격은 목상 폭 30mm 이상으로 지정해 주세요.'
  }
  return null
}

/**
 * Layer bands across the thickness, depth measured from the finished face
 * (mmmcraft `wallConstructionLayers`). Gaps are left unfilled on purpose:
 * 목상 has the stud cavity behind the boards, 떡가베 the adhesive-dab cavity.
 */
export function wallConstructionLayers(
  thicknessMm: number,
  construction: WallConstruction | undefined,
): WallConstructionLayer[] {
  const c = normalizeWallConstruction(construction)
  if (!c) return [{ id: 'core', fromMm: 0, toMm: thicknessMm, color: '#d2ccc1' }]
  const buildUp = WALL_CONSTRUCTION_KINDS[c.kind].buildUpMm
  const bonded = c.kind === 'bonded'
  const layers: WallConstructionLayer[] = [
    { id: 'finish-2p', fromMm: 0, toMm: 9, color: '#ede5d6' },
    { id: 'finish-1p', fromMm: 9, toMm: CAD_BOARD_BACK_MM, color: '#d8c5a7' },
    { id: 'core', fromMm: buildUp, toMm: thicknessMm - (bonded ? buildUp : 0), color: '#c4c4bd' },
  ]
  if (bonded) {
    layers.push(
      {
        id: 'back-finish-1p',
        fromMm: thicknessMm - CAD_BOARD_BACK_MM,
        toMm: thicknessMm - 9,
        color: '#d8c5a7',
      },
      { id: 'back-finish-2p', fromMm: thicknessMm - 9, toMm: thicknessMm, color: '#ede5d6' },
    )
  }
  return layers
}

/**
 * Signed offset (mm) from the wall centreline along the wall's left normal
 * for a finish depth: the finished face is on `side` (mmmcraft
 * `finishDepthToWallZ`).
 */
export function finishDepthToOffsetMm(
  thicknessMm: number,
  side: WallConstruction['side'],
  depthMm: number,
): number {
  return (side === 'left' ? 1 : -1) * (thicknessMm / 2 - depthMm)
}

/**
 * 목상 stud centres along the wall (mm from the start): every `studSpacing`
 * from 15, skipping those that would clash with a hidden door opening.
 */
export function timberStudCentresMm(
  lengthMm: number,
  construction: WallConstruction | undefined,
  hiddenDoors: { centreMm: number; widthMm: number }[] = [],
): number[] {
  if (construction?.kind !== 'timber' || !construction.studSpacing) return []
  const half = CAD_STUD_SIZE_MM / 2
  const out: number[] = []
  for (let x = half; x < lengthMm; x += construction.studSpacing) {
    if (hiddenDoors.some((d) => Math.abs(x - d.centreMm) < d.widthMm / 2 + 20 + half)) continue
    out.push(x)
  }
  return out
}

/** Unit left normal of a wall in plan coordinates (x, z): left of start → end
 *  as drawn on the floor plan (plan y grows downward on screen). */
export function wallLeftNormal(wall: Pick<WallNode, 'start' | 'end'>): [number, number] {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const len = Math.hypot(dx, dz) || 1
  return [dz / len, -dx / len]
}
