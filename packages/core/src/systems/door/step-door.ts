import type { AnyNode, AnyNodeId, DoorNode, StepDoorProduct, WallNode } from '../../schema'
import { DEFAULT_WALL_HEIGHT } from '../wall/wall-footprint'
import { HIDDEN_HANDLE } from './hidden-door'

/**
 * mmmcraft 스텝도어 기본형 (`stepDoorModel.ts`, `StepDoor3D.tsx`,
 * docs/room/step-door-sources.md): a moving leaf under a fixed header
 * (상부 인방) inside a full-height frame. Values are mm. Public manuals:
 * 예림 2024-08-12 시공설명서 p1 — 문틀 25T, MDF 마감 15T, ABS 문/헤더 35T, 매지 3.
 * 영림 NEW COLLECTION p12–13 — 문틀 30T, 마감 18T, ABS 문/인방 35T, 문높이 2050/2200.
 * 영림 publishes no 매지; 3 is mmmcraft's display value, not a spec.
 */
export const STEP_DOOR_PRODUCTS = {
  'yerim-inshow': {
    label: '예림·인쇼',
    jamb: 25,
    finish: 15,
    leaf: 35,
    defaultLeafHeight: 2100,
    source: 'https://www.yerim.net/upload/data/2039376550_GZ9WrT3M_20230523010920.pdf',
  },
  younglim: {
    label: '영림',
    jamb: 30,
    finish: 18,
    leaf: 35,
    defaultLeafHeight: 2050,
    source:
      'https://s3.ap-northeast-2.amazonaws.com/younglim-bucket/a5950178-0103-49b7-82a7-561584865442.pdf',
  },
} as const

export const STEP_DOOR_GAP_MM = 3
export const STEP_DOOR_MAX_DEGREES = 90
export const STEP_DOOR_MIN_DEPTH_MM = 110
/** 영림 frames are made to order between 110 and 240. */
export const STEP_DOOR_YOUNGLIM_MAX_DEPTH_MM = 240
/** 예림·인쇼 standard frame depths; others are made to order (mmmcraft docs). */
export const STEP_DOOR_YERIM_STANDARD_DEPTHS_MM = [110, 140, 170, 200] as const

const mm = (m: number) => Math.round(m * 10000) / 10

/** The initial leaf height that leaves a header within the product's range. */
export function stepDoorLeafHeightMm(product: StepDoorProduct, installationMm: number): number {
  const preferred = STEP_DOOR_PRODUCTS[product].defaultLeafHeight
  return product === 'younglim'
    ? installationMm - preferred - STEP_DOOR_GAP_MM > 600
      ? 2200
      : preferred
    : Math.max(2000, Math.min(preferred, installationMm - 203))
}

type FinishWall = Pick<WallNode, 'thickness' | 'bodyThickness'>

/** The shallowest frame the wall allows: 110, or the wall as built when thicker. */
export function stepDoorMinDepthMm(wall: FinishWall): number {
  return Math.max(STEP_DOOR_MIN_DEPTH_MM, mm(wall.bodyThickness ?? wall.thickness ?? 0.1))
}

/**
 * The step door frame is as deep as its wall is thick, so choosing a depth
 * finishes the wall out flush with both frame faces. The thickness it had
 * before is kept as `bodyThickness`.
 */
export function stepDoorWallFinish(
  wall: FinishWall,
  depthMm: number,
): Required<Pick<WallNode, 'thickness' | 'bodyThickness'>> {
  return {
    thickness: Math.max(depthMm, stepDoorMinDepthMm(wall)) / 1000,
    bodyThickness: wall.bodyThickness ?? wall.thickness ?? 0.1,
  }
}

/**
 * Undo the finish once `door` is deleted: the wall goes back to its body
 * thickness, unless another step door on it still sets the depth.
 */
export function stepDoorWallRestore(
  door: DoorNode,
  nodes: Record<AnyNodeId, AnyNode>,
): { id: AnyNodeId; data: Partial<WallNode> } | null {
  if (door.doorType !== 'step' || !door.parentId) return null
  const wall = nodes[door.parentId as AnyNodeId]
  if (wall?.type !== 'wall' || wall.bodyThickness === undefined) return null
  const stillFinished = (wall.children ?? []).some((id) => {
    const child = nodes[id as AnyNodeId]
    return id !== door.id && child?.type === 'door' && child.doorType === 'step'
  })
  if (stillFinished) return null
  return { id: wall.id, data: { thickness: wall.bodyThickness, bodyThickness: undefined } }
}

/**
 * mmmcraft placement: the frame runs floor to wall top, at least 110 deep.
 * `wall` is the finish the host wall needs (null when already 110 or more).
 */
export function stepDoorPlacement(
  product: StepDoorProduct,
  wall: Pick<WallNode, 'height' | 'thickness' | 'bodyThickness'>,
): {
  door: Pick<DoorNode, 'doorType' | 'height' | 'stepDoor'>
  wall: ReturnType<typeof stepDoorWallFinish> | null
} {
  const height = wall.height ?? DEFAULT_WALL_HEIGHT
  return {
    door: {
      doorType: 'step',
      height,
      stepDoor: { product, leafHeight: stepDoorLeafHeightMm(product, mm(height)) / 1000 },
    },
    wall:
      mm(wall.thickness ?? 0.1) < STEP_DOOR_MIN_DEPTH_MM
        ? stepDoorWallFinish(wall, STEP_DOOR_MIN_DEPTH_MM)
        : null,
  }
}

type StepDoor = Pick<DoorNode, 'width' | 'height' | 'hingesSide' | 'stepDoor'>
type HostWall = Pick<WallNode, 'thickness'>

function stepDimensions(door: StepDoor, wall: HostWall) {
  const selection = door.stepDoor
  if (!(selection && Object.hasOwn(STEP_DOOR_PRODUCTS, selection.product))) return null
  const product = STEP_DOOR_PRODUCTS[selection.product]
  const heightMm = mm(door.height)
  const leafHeight = mm(selection.leafHeight)
  return {
    selection,
    product,
    widthMm: mm(door.width),
    heightMm,
    depth: mm(wall.thickness ?? 0.1),
    leafWidth: mm(door.width) - product.jamb * 2 - STEP_DOOR_GAP_MM * 2,
    leafHeight,
    headerHeight: heightMm - leafHeight - STEP_DOOR_GAP_MM,
  }
}

/** mmmcraft's validation, message for message; null when the door is valid. */
export function stepDoorError(door: StepDoor, wall: HostWall): string | null {
  const d = stepDimensions(door, wall)
  if (!d) return '스텝도어 제품을 선택해 주세요.'
  const younglim = d.selection.product === 'younglim'
  if (
    ![d.leafWidth, d.leafHeight, d.depth, d.headerHeight].every(Number.isFinite) ||
    d.depth < STEP_DOOR_MIN_DEPTH_MM ||
    (younglim && d.depth > STEP_DOOR_YOUNGLIM_MAX_DEPTH_MM)
  ) {
    return younglim
      ? '영림 스텝 문틀 깊이는 110~240mm로 설정해 주세요.'
      : '예림·인쇼 스텝 문틀 깊이는 110mm 이상으로 설정해 주세요.'
  }
  if (younglim) {
    if (
      !(
        d.leafWidth > 0 &&
        d.leafWidth <= 1180 &&
        (d.leafHeight === 2050 || d.leafHeight === 2200) &&
        d.headerHeight >= 200 &&
        d.headerHeight <= 600 &&
        d.heightMm <= 2800
      )
    ) {
      return '영림 기본형은 문짝 폭 1180mm 이하, 높이 2050/2200mm, 인방 200~600mm입니다.'
    }
  } else if (
    !(
      d.leafWidth >= 494 &&
      d.leafWidth <= 1214 &&
      d.leafHeight >= 2000 &&
      d.leafHeight <= 2399 &&
      d.headerHeight >= 200 &&
      d.headerHeight <= 549 &&
      d.heightMm >= 2251 &&
      d.heightMm <= 2600
    )
  ) {
    return '예림·인쇼 헤더형은 문짝 폭 494~1214mm, 높이 2000~2399mm, 인방 200~549mm입니다.'
  }
  return null
}

/**
 * A valid step door in the door's frame: x along the wall from the centre,
 * y up from the floor, z across the wall from the centreline. The leaf and
 * header sit flush with the +z face (the side the door was placed from) and
 * the leaf swings out of that face; `amount` is 0…1 of the 90° swing.
 */
export function stepDoorModel(door: StepDoor, wall: HostWall, amount: number) {
  const d = stepDimensions(door, wall)
  const error = stepDoorError(door, wall)
  if (!d || error) throw new Error(error ?? '')
  const handed = door.hingesSide === 'left' ? 1 : -1
  const clamped = Math.max(0, Math.min(1, amount))
  const { product, depth, leafWidth } = d
  return {
    ...d,
    gap: STEP_DOOR_GAP_MM,
    handed,
    amount: clamped,
    hingeX: (-handed * leafWidth) / 2,
    hingeZ: depth / 2,
    angle: (handed * clamped * STEP_DOOR_MAX_DEGREES * Math.PI) / 180,
    leafZ: depth / 2 - product.leaf / 2,
    // The finish board stops one 매지 short of the leaf's back face.
    returnDepth: depth - product.leaf - STEP_DOOR_GAP_MM,
    headerWidth:
      d.selection.product === 'yerim-inshow' ? leafWidth + 2 * STEP_DOOR_GAP_MM : leafWidth,
  }
}

export type StepDoorModel = ReturnType<typeof stepDoorModel>

export type StepDoorBox = {
  name: string
  /** Centre (mm). Leaf boxes are relative to the hinge (hingeX, 0, hingeZ). */
  at: [number, number, number]
  size: [number, number, number]
  metal?: boolean
}

/**
 * mmmcraft `StepDoor3D`: separate jambs, finish returns and header, and the
 * leaf with the reference lever handle on both faces. Hinges and fixings
 * have no published dimensions and are not modelled.
 */
export function stepDoorBoxes(m: StepDoorModel): { fixed: StepDoorBox[]; leaf: StepDoorBox[] } {
  const p = m.product
  const fixed: StepDoorBox[] = []
  for (const side of [-1, 1]) {
    fixed.push({
      name: `step-door-jamb:${side}`,
      at: [(side * (m.widthMm - p.jamb)) / 2, m.heightMm / 2, 0],
      size: [p.jamb, m.heightMm, m.depth],
    })
    fixed.push({
      name: `step-door-return:${side}`,
      at: [side * (m.widthMm / 2 - p.jamb - p.finish / 2), m.heightMm / 2, -(p.leaf + m.gap) / 2],
      size: [p.finish, m.heightMm, m.returnDepth],
    })
  }
  fixed.push({
    name: 'step-door-header',
    at: [0, m.leafHeight + m.gap + m.headerHeight / 2, m.leafZ],
    size: [m.headerWidth, m.headerHeight, p.leaf],
  })
  const h = HIDDEN_HANDLE
  const handleX = m.handed * (m.leafWidth / 2 - h.edgeInset) - m.hingeX
  const leaf: StepDoorBox[] = [
    {
      name: 'step-door-leaf',
      at: [-m.hingeX, m.leafHeight / 2, -p.leaf / 2],
      size: [m.leafWidth, m.leafHeight, p.leaf],
    },
  ]
  for (const face of [-1, 1]) {
    leaf.push({
      name: 'step-door-handle-stem',
      at: [handleX, h.height, -p.leaf / 2 + face * (p.leaf / 2 + h.stemDepth / 2)],
      size: [h.stemDiameter, h.stemDiameter, h.stemDepth],
      metal: true,
    })
    leaf.push({
      name: 'step-door-handle-lever',
      at: [
        handleX + (m.handed * (h.leverMin + h.leverMax)) / 2,
        h.height,
        -p.leaf / 2 + face * (p.leaf / 2 + h.stemDepth + h.leverDepth / 2),
      ],
      size: [h.leverLength, h.leverHeight, h.leverDepth],
      metal: true,
    })
  }
  return { fixed, leaf }
}

/** A hinge-relative (x, z) point turned to the leaf's open angle, in the door frame. */
export function stepLeafPoint(m: StepDoorModel, x: number, z: number): [number, number] {
  // The leaf group turns by −angle about +y (three.js): +x swings towards +z.
  const t = -m.angle
  return [
    m.hingeX + x * Math.cos(t) + z * Math.sin(t),
    m.hingeZ - x * Math.sin(t) + z * Math.cos(t),
  ]
}
