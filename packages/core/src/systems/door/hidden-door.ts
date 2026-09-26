import type { DoorNode, WallConstruction, WallNode } from '../../schema'
import {
  CAD_BOARD_BACK_MM,
  finishDepthToOffsetMm,
  normalizeWallConstruction,
} from '../wall/wall-construction'

/**
 * mmmcraft 히든도어 (hidden door on a 목상 / 떡가베 wall), ported from mmmcraft
 * `hiddenDoorCad.ts`, `hiddenDoorModel.ts`, `domusHiddenHinge.ts` and
 * `hiddenDoorRearFinish.ts`. All values are mm. Section points are
 * (x = distance from the opening edge towards the door, y = depth from the
 * closed door's front face into the wall); `offset` converts a depth to the
 * signed distance from the wall centreline along the wall's left normal.
 */

export type CadPoint = { x: number; y: number; bulge?: number }
export type SectionPoint = { x: number; y: number }

const R = CAD_BOARD_BACK_MM - 18 // the DWG's 0.0077 residual, kept on purpose

/** Jamb section (DWG handles 13837 / 133BF). */
export const HIDDEN_JAMB_PROFILE: readonly CadPoint[] = [
  { x: 32, y: 17.7 + R },
  { x: 32, y: 18 + R },
  { x: 14, y: 18 + R },
  { x: 14, y: 9 + R },
  { x: 23, y: 9 + R },
  { x: 24, y: 10 + R },
  { x: 25, y: 9 + R },
  { x: 60.5, y: 9 + R },
  { x: 60.5, y: 42 + R, bulge: 0.414213562373095 },
  { x: 58.5, y: 44 + R },
  { x: 37, y: 44 + R },
  { x: 37, y: 41 + R },
  { x: 34, y: 41 + R },
  { x: 34, y: 20 + R },
  { x: 34.3, y: 20 + R },
  { x: 34.3, y: 17.7 + R },
]

/** Header section: the jamb without the residual, shifted −5 on 목상. */
function headerProfile(shift: number): CadPoint[] {
  return HIDDEN_JAMB_PROFILE.map((p) => ({
    ...p,
    x: p.x - shift,
    y: Math.round((p.y - R) * 1000) / 1000,
  }))
}

export const HIDDEN_DOOR_CAD = {
  timber: { label: '목상', headerInset: 58.5, headerProfile: headerProfile(5) },
  bonded: { label: '떡가베', headerInset: 63.5, headerProfile: headerProfile(0) },
} as const

export const HIDDEN_LEAF = {
  sideInset: 64,
  thickness: 45,
  rebateWidth: 9,
  rebateDepth: 12,
} as const
export const HIDDEN_REAR_FINISH = {
  boardThickness: 9,
  exposedWrappedFrame: 9,
  projection: 5,
} as const
export const HIDDEN_HANDLE = {
  edgeInset: 70,
  height: 945,
  plateDiameter: 70,
  plateDepth: 10,
  stemDiameter: 26,
  stemDepth: 17,
  leverLength: 137,
  leverDepth: 15,
  leverHeight: 20.326814789892524,
  leverMin: -124,
  leverMax: 13,
} as const

/** 도무스 3D 히든경첩 150 (outline, pocket and limits from its manual). */
export const DOMUS_150 = {
  label: '도무스 3D 히든경첩 150',
  length: 150,
  width: 25,
  bodyDepth: 21.5,
  pocket: { length: 150, innerLength: 123, width: 25, depth: 23, shoulderDepth: 7.2 },
  faceMargin: 4,
  minDoorThickness: 35,
  maxDoorWidth: 900,
} as const

/** mmmcraft limits the preview swing to 90°. */
export const HIDDEN_DOOR_MAX_DEGREES = 90

/** Sample a DWG bulge arc with the same centre and radius. */
export function cadSectionPoints(profile: readonly CadPoint[]): SectionPoint[] {
  return profile.flatMap((a, i) => {
    const b = profile[(i + 1) % profile.length] as CadPoint
    const bulge = a.bulge ?? 0
    if (Math.abs(bulge) < 1e-12) return [{ x: a.x, y: a.y }]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const chord = Math.hypot(dx, dy)
    const offset = (chord * (1 - bulge * bulge)) / (4 * bulge)
    const cx = (a.x + b.x) / 2 - (dy / chord) * offset
    const cy = (a.y + b.y) / 2 + (dx / chord) * offset
    const start = Math.atan2(a.y - cy, a.x - cx)
    const angle = 4 * Math.atan(bulge)
    const radius = Math.hypot(a.x - cx, a.y - cy)
    const segments = Math.max(2, Math.ceil(Math.abs(angle) / (Math.PI / 32)))
    return Array.from({ length: segments }, (_, j) => ({
      x: cx + radius * Math.cos(start + (angle * j) / segments),
      y: cy + radius * Math.sin(start + (angle * j) / segments),
    }))
  })
}

type HostWall = Pick<WallNode, 'thickness' | 'construction'>
type HiddenDoor = Pick<DoorNode, 'width' | 'height' | 'hingesSide' | 'hiddenHingeHeights'>

/** Default hinge heights from the leaf bottom: 150, middle, top − 150. */
export function defaultHiddenHingeHeightsMm(leafHeightMm: number): number[] {
  return [DOMUS_150.length, leafHeightMm / 2, leafHeightMm - DOMUS_150.length]
}

/** mmmcraft's validation, message for message; null when the door is valid. */
export function hiddenDoorError(door: HiddenDoor, wall: HostWall | undefined): string | null {
  const c = normalizeWallConstruction(wall?.construction)
  // mmmcraft's CAD sections exist for 목상 and 떡가베 only.
  if (!wall || !c || c.kind === 'steel') return '히든도어는 목상 또는 떡가베 벽에 배치해 주세요.'
  const T = (wall.thickness ?? 0.1) * 1000
  const width = door.width * 1000 - 2 * HIDDEN_LEAF.sideInset
  const height = door.height * 1000 - HIDDEN_DOOR_CAD[c.kind].headerInset
  const h = HIDDEN_HANDLE
  if (
    !(
      width > h.edgeInset - h.leverMin + HIDDEN_LEAF.rebateWidth &&
      height > h.height + h.plateDiameter / 2 &&
      T > 45
    )
  ) {
    return '개구부와 벽 두께가 첨부 CAD의 히든도어 단면보다 작습니다.'
  }
  if (!(width > 0 && width <= DOMUS_150.maxDoorWidth)) {
    return '도무스 150 경첩은 문짝 폭 900mm 이하에 적용해 주세요.'
  }
  const hinges =
    door.hiddenHingeHeights?.map((v) => v * 1000) ?? defaultHiddenHingeHeightsMm(height)
  if (
    hinges.length !== 3 ||
    hinges.some(
      (v) => !Number.isFinite(v) || v < DOMUS_150.length / 2 || v > height - DOMUS_150.length / 2,
    ) ||
    hinges.some((v, i) => i > 0 && v - (hinges[i - 1] ?? 0) < DOMUS_150.length)
  ) {
    return '경첩 표시 위치는 문 안에 아래부터 위로, 서로 150mm 이상 떨어지게 입력해 주세요.'
  }
  return null
}

/**
 * Leaf size, handing and swing of a valid hidden door. The leaf opens away
 * from the finished face only; `amount` is 0…1 of the 90° preview swing.
 */
export function hiddenDoorModel(door: HiddenDoor, wall: HostWall, amount: number) {
  // Only called once hiddenDoorError passed: a 목상 or 떡가베 wall.
  const c = normalizeWallConstruction(wall.construction) as WallConstruction & {
    kind: 'timber' | 'bonded'
  }
  const cad = HIDDEN_DOOR_CAD[c.kind]
  const T = (wall.thickness ?? 0.1) * 1000
  const width = door.width * 1000 - 2 * HIDDEN_LEAF.sideInset
  const height = door.height * 1000 - cad.headerInset
  const handed = door.hingesSide === 'left' ? 1 : -1
  const sign = c.side === 'left' ? -1 : 1
  const clamped = Math.max(0, Math.min(1, amount))
  const offset = (depth: number) => finishDepthToOffsetMm(T, c.side, depth)
  return {
    construction: c,
    thicknessMm: T,
    widthMm: door.width * 1000,
    heightMm: door.height * 1000,
    leafWidth: width,
    leafHeight: height,
    handed,
    sign,
    amount: clamped,
    hingeX: (-handed * width) / 2,
    hingeOffset: offset(HIDDEN_LEAF.thickness),
    angle: (sign * handed * clamped * HIDDEN_DOOR_MAX_DEGREES * Math.PI) / 180,
    hingeHeights:
      door.hiddenHingeHeights?.map((v) => v * 1000) ?? defaultHiddenHingeHeightsMm(height),
    frame: cadSectionPoints(HIDDEN_JAMB_PROFILE),
    header: cadSectionPoints(cad.headerProfile),
    offset,
  }
}

export type HiddenDoorModel = ReturnType<typeof hiddenDoorModel>

export type HiddenSectionRow = {
  id: string
  material: 'frame' | 'timber' | 'finish'
  points: SectionPoint[]
  /** The same row as used across the header (mmmcraft's side-view shift). */
  header: SectionPoint[]
}

/** Jamb / header section rows (mmmcraft `hiddenDoorSections`). */
export function hiddenDoorSections(m: HiddenDoorModel): HiddenSectionRow[] {
  const T = m.thicknessMm
  const rectangle = (x1: number, x2: number, y1: number, y2: number): SectionPoint[] => [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ]
  const headerShift = m.construction.kind === 'timber' ? 5 : 0
  const backFinish = m.construction.kind === 'bonded' && m.construction.bothFaces
  const returnInside = Math.max(...m.frame.map((p) => p.x)) - HIDDEN_REAR_FINISH.exposedWrappedFrame
  const returnOutside = returnInside - HIDDEN_REAR_FINISH.boardThickness
  const returnStart = Math.max(...m.frame.map((p) => p.y))
  const backCapDepth = backFinish ? CAD_BOARD_BACK_MM : HIDDEN_REAR_FINISH.boardThickness
  const rows: (Omit<HiddenSectionRow, 'header'> & { headerShift: number })[] = [
    { id: 'frame', material: 'frame', points: m.frame, headerShift },
    {
      id: 'backing',
      material: 'timber',
      points: rectangle(10, 34, CAD_BOARD_BACK_MM, T - backCapDepth),
      headerShift,
    },
    {
      id: 'return',
      material: 'finish',
      points: rectangle(
        returnOutside,
        returnInside,
        returnStart,
        T + HIDDEN_REAR_FINISH.projection,
      ),
      headerShift,
    },
    {
      id: 'finish-1p',
      material: 'finish',
      points: rectangle(0, 14, 9, CAD_BOARD_BACK_MM),
      headerShift,
    },
    {
      id: 'finish-2p',
      material: 'finish',
      points: rectangle(0, 70, 0, 9),
      headerShift: headerShift + 0.5,
    },
  ]
  if (T - backCapDepth > returnStart) {
    rows.push({
      id: 'rear-packing',
      material: 'timber',
      points: rectangle(34, returnOutside, returnStart, T - backCapDepth),
      headerShift,
    })
  }
  if (backFinish) {
    rows.push(
      {
        id: 'back-finish-1p',
        material: 'finish',
        points: rectangle(0, returnOutside, T - CAD_BOARD_BACK_MM, T - 9),
        headerShift,
      },
      {
        id: 'back-finish-2p',
        material: 'finish',
        points: rectangle(0, returnOutside, T - 9, T),
        headerShift,
      },
    )
  } else {
    rows.push({
      id: 'back-finish-cap',
      material: 'finish',
      points: rectangle(0, returnOutside, T - 9, T),
      headerShift,
    })
  }
  if (m.construction.kind === 'timber') {
    rows.push({
      id: 'stud',
      material: 'timber',
      points: rectangle(-20, 10, CAD_BOARD_BACK_MM, CAD_BOARD_BACK_MM + 30),
      headerShift,
    })
  }
  return rows.map(({ headerShift: shift, ...row }) => ({
    ...row,
    header:
      row.id === 'frame'
        ? m.header
        : row.points.map((p) => ({
            x: p.x - shift,
            y:
              p.y === CAD_BOARD_BACK_MM
                ? 18
                : p.y === CAD_BOARD_BACK_MM + 26
                  ? 44
                  : p.y === CAD_BOARD_BACK_MM + 30
                    ? 48
                    : p.y,
          })),
  }))
}

/** Leaf plan outline (x across the leaf centred, y depth): 45T with the
 *  front 12 mm stepped in 9 mm at both sides. */
export function hiddenLeafOutline(m: HiddenDoorModel): SectionPoint[] {
  const w = m.leafWidth
  return [
    { x: -w / 2, y: 12 },
    { x: -w / 2, y: 45 },
    { x: w / 2, y: 45 },
    { x: w / 2, y: 12 },
    { x: w / 2 - 9, y: 12 },
    { x: w / 2 - 9, y: 0 },
    { x: -w / 2 + 9, y: 0 },
    { x: -w / 2 + 9, y: 12 },
  ]
}

/** Front 2P panels around the leaf and the 3 mm reveal slits
 *  (mmmcraft `hiddenDoorFrontPanels`). x centred on the opening, y from the floor. */
export function hiddenDoorFrontPanels(m: HiddenDoorModel) {
  const sideFinishInset = 70
  const faceHalfWidth = m.leafWidth / 2 - HIDDEN_LEAF.rebateWidth
  const outer = m.widthMm / 2 - sideFinishInset
  const gap = outer - faceHalfWidth
  const bottom = m.leafHeight - HIDDEN_LEAF.rebateWidth + gap
  return {
    gap,
    panels: [
      {
        id: 'left',
        x: -m.widthMm / 2 + sideFinishInset / 2,
        bottom: 0,
        width: sideFinishInset,
        height: m.heightMm,
      },
      {
        id: 'right',
        x: m.widthMm / 2 - sideFinishInset / 2,
        bottom: 0,
        width: sideFinishInset,
        height: m.heightMm,
      },
      { id: 'header', x: 0, bottom, width: faceHalfWidth * 2, height: m.heightMm - bottom },
    ],
  }
}
