import type { CabinetNode } from '../schema'
import { panelFace } from './cutlist'
import { buildCabinetParts, type CabinetPart } from './parts'
import { HINGE_CUP_DEPTH_MM, HINGE_CUP_DIAMETER_MM, HINGE_CUP_EDGE_OFFSET_MM } from './rules'

/**
 * Machining data per panel in mmmcraft's MPR/DXF frame (ported from
 * mmmcraft `domain/boring` + `CNCOptimizer/utils/mprPanelConversion`).
 *
 * Frames, all in mm:
 * - Carcass sides: X = side height measured from the TOP (X = width is the
 *   bottom edge), Y = depth. The left side has its front edge at Y = 0, the
 *   right side at Y = height (it is loaded inner face up, mirrored).
 * - Horizontal panels: X = width, Y = depth; side bores on the X = 0 / X = W
 *   edges.
 * - Doors: X = width, Y = height measured from the TOP, inner face up.
 */
export type BoringType = 'hinge-cup' | 'hinge-screw' | 'shelf-pin'
export type BoringFace = 'top' | 'left' | 'right'

export type Boring = {
  id: string
  type: BoringType
  face: BoringFace
  x: number
  y: number
  diameter: number
  depth: number
  note?: 'fixed-panel-through' | 'movable-shelf-pin' | 'fixed-panel-side-bore' | 'door-fixing-screw'
}

export type PanelType =
  | 'side-left'
  | 'side-right'
  | 'top'
  | 'bottom'
  | 'shelf'
  | 'door'
  | 'drawer-front'
  | 'back-panel'
  | 'partition'
  | 'other'

export type PanelBoringData = {
  panelId: string
  furnitureName: string
  panelType: PanelType
  panelName: string
  width: number
  height: number
  thickness: number
  material: string
  borings: Boring[]
  /** 목찬넬 따내기: notch height (y), depth from the front (z), mm from the side's bottom. */
  sideNotches?: { y: number; z: number; fromBottom: number }[]
  /** Back panel groove: offset from the rear edge, width and cut depth. */
  backPanelGroove?: { offset: number; width: number; depth: number }
}

/** mmmcraft BACK_PANEL_GROOVE_CUT_DEPTH_MM. */
const BACK_GROOVE_CUT_DEPTH_MM = 7.5
/** mmmcraft DEFAULT_HINGE_SETTINGS.screwRowDistance / hinge type A spacing. */
const HINGE_SCREW_ROW_MM = 9.5
const HINGE_SCREW_SPACING_MM = 45
/** Mounting-plate screws on the carcass side, mm from the front edge. */
const BRACKET_FROM_FRONT_MM = [20, 52]
/** Parts meeting a side within this gap (clearances are 0.5–1 mm) are joined to it. */
const JOIN_TOLERANCE_MM = 2.5

const roundCoord = (value: number) => Math.round(value * 10) / 10

/** mmmcraft getBoringDepthPositions / resolveFixedHorizontalSideBoringPositions:
 *  fixed panels take 3 holes, movable shelves 2, none on panels ≤ 60 deep. */
function depthPositions(depthMm: number, fixed: boolean): number[] {
  if (depthMm <= 60) return []
  const positions = fixed ? [30, depthMm / 2, Math.max(30, depthMm - 30)] : [30, depthMm - 30]
  return Array.from(new Set(positions.map(roundCoord))).sort((a, b) => a - b)
}

const isFixedHorizontal = (part: CabinetPart) =>
  part.role === 'bottom' || part.role === 'top' || part.role === 'fixed-shelf'

function joinsSide(side: CabinetPart, part: CabinetPart, left: boolean): boolean {
  const s = side.box
  const b = part.box
  const edgeGap = left ? b.x - (s.x + s.w) : s.x - (b.x + b.w)
  return Math.abs(edgeGap) <= JOIN_TOLERANCE_MM && b.y >= s.y - 0.5 && b.y + b.h <= s.y + s.h + 0.5
}

function sidePanel(
  node: CabinetNode,
  side: CabinetPart,
  parts: CabinetPart[],
  furnitureName: string,
): PanelBoringData {
  const left = side.box.x < node.widthMm / 2
  const s = side.box
  const sideFront = s.z + s.d
  const borings: Boring[] = []
  let index = 0
  // Height from the side's bottom and depth from its front → MPR point.
  const point = (fromBottom: number, fromFront: number) => ({
    x: roundCoord(s.h - fromBottom),
    y: roundCoord(left ? fromFront : s.d - fromFront),
  })

  for (const part of parts) {
    const fixed = isFixedHorizontal(part)
    if (!(fixed || part.role === 'shelf') || !joinsSide(side, part, left)) continue
    // Fixed panels are bored on their centre line; a movable shelf rests on
    // pins at its underside.
    const row = fixed ? part.box.y + part.box.h / 2 - s.y : part.box.y - s.y
    const frontInset = sideFront - (part.box.z + part.box.d)
    for (const d of depthPositions(part.box.d, fixed)) {
      const p = point(row, frontInset + d)
      borings.push(
        fixed
          ? {
              id: `shelf-${index++}`,
              type: 'shelf-pin',
              face: 'top',
              ...p,
              diameter: 6,
              depth: side.box.w,
              note: 'fixed-panel-through',
            }
          : {
              id: `shelf-${index++}`,
              type: 'shelf-pin',
              face: 'top',
              ...p,
              diameter: 5,
              depth: 12,
              note: 'movable-shelf-pin',
            },
      )
    }
  }

  // Hinge mounting plates: every door hinged on this side's edge.
  for (const door of parts) {
    if (door.role !== 'door' || !door.hingePositionsMm) continue
    if (door.hinge !== (left ? 'left' : 'right')) continue
    const hingeEdge = left ? door.box.x : door.box.x + door.box.w
    const sideOuter = left ? s.x : s.x + s.w
    if (Math.abs(hingeEdge - sideOuter) > s.w + JOIN_TOLERANCE_MM) continue
    for (const cupY of door.hingePositionsMm) {
      const fromBottom = door.box.y + cupY - s.y
      if (fromBottom < 0 || fromBottom > s.h) continue
      for (const d of BRACKET_FROM_FRONT_MM) {
        borings.push({
          id: `bracket-${index++}`,
          type: 'hinge-screw',
          face: 'top',
          ...point(fromBottom, d),
          diameter: 3,
          depth: 3,
          note: 'door-fixing-screw',
        })
      }
    }
  }

  const back = parts.find(
    (p) => p.role === 'back' && p.box.y < s.y + s.h && p.box.y + p.box.h > s.y,
  )
  return {
    panelId: `${node.id}-${side.id}`,
    furnitureName,
    panelType: left ? 'side-left' : 'side-right',
    panelName: side.name,
    width: s.h,
    height: s.d,
    thickness: s.w,
    material: side.material,
    borings,
    ...(side.notches?.length
      ? {
          sideNotches: side.notches.map((n) => ({
            y: n.height,
            z: n.depth,
            fromBottom: n.fromBottom,
          })),
        }
      : {}),
    ...(back
      ? {
          backPanelGroove: {
            offset: back.box.z - s.z - 0.5,
            width: back.box.d + 1,
            depth: BACK_GROOVE_CUT_DEPTH_MM,
          },
        }
      : {}),
  }
}

function horizontalPanel(node: CabinetNode, part: CabinetPart, furnitureName: string) {
  const b = part.box
  const borings: Boring[] = []
  if (isFixedHorizontal(part)) {
    depthPositions(b.d, true).forEach((y, i) => {
      for (const face of ['left', 'right'] as const) {
        borings.push({
          id: `fixed-side-${face}-${i}`,
          type: 'shelf-pin',
          face,
          x: face === 'left' ? 0 : b.w,
          y,
          diameter: 5,
          depth: 30,
          note: 'fixed-panel-side-bore',
        })
      }
    })
  }
  return {
    panelId: `${node.id}-${part.id}`,
    furnitureName,
    panelType: part.role === 'bottom' ? 'bottom' : part.role === 'top' ? 'top' : 'shelf',
    panelName: part.name,
    width: b.w,
    height: b.d,
    thickness: b.h,
    material: part.material,
    borings,
  } satisfies PanelBoringData
}

/**
 * Hinge cups (Ø35 × 13) and fixing screws (Ø3 × 3) on the door's inner face.
 * mmmcraft puts the cup on the side opposite the hinge when seen from inside,
 * then mirrors the left leaf of a pair (its "좌측 도어"), so a pair's leaves
 * both carry their cups at X = 22.5 while a single left-hinged door has them
 * at X = W − 22.5.
 */
function doorPanel(
  node: CabinetNode,
  part: CabinetPart,
  parts: CabinetPart[],
  furnitureName: string,
) {
  const { w, h, d } = part.box
  const borings: Boring[] = []
  if ((part.hinge === 'left' || part.hinge === 'right') && part.hingePositionsMm) {
    const pairedLeft =
      part.hinge === 'left' &&
      parts.some(
        (p) =>
          p.role === 'door' &&
          p.cellId === part.cellId &&
          p.hinge === 'right' &&
          Math.abs(p.box.x - (part.box.x + part.box.w)) < 10,
      )
    const insideHingeOnLeft = part.hinge === 'right'
    let cupX = insideHingeOnLeft ? HINGE_CUP_EDGE_OFFSET_MM : w - HINGE_CUP_EDGE_OFFSET_MM
    let screwX = insideHingeOnLeft ? cupX + HINGE_SCREW_ROW_MM : cupX - HINGE_SCREW_ROW_MM
    if (pairedLeft) {
      cupX = w - cupX
      screwX = w - screwX
    }
    let index = 0
    for (const cupY of part.hingePositionsMm) {
      borings.push({
        id: `hinge-cup-${index++}`,
        type: 'hinge-cup',
        face: 'top',
        x: roundCoord(cupX),
        y: roundCoord(h - cupY),
        diameter: HINGE_CUP_DIAMETER_MM,
        depth: HINGE_CUP_DEPTH_MM,
      })
    }
    for (const cupY of part.hingePositionsMm) {
      for (const dy of [-HINGE_SCREW_SPACING_MM / 2, HINGE_SCREW_SPACING_MM / 2]) {
        borings.push({
          id: `hinge-screw-${index++}`,
          type: 'hinge-screw',
          face: 'top',
          x: roundCoord(screwX),
          y: roundCoord(h - (cupY + dy)),
          diameter: 3,
          depth: 3,
          note: 'door-fixing-screw',
        })
      }
    }
  }
  return {
    panelId: `${node.id}-${part.id}`,
    furnitureName,
    panelType: 'door',
    panelName: part.name,
    width: w,
    height: h,
    thickness: d,
    material: part.material,
    borings,
  } satisfies PanelBoringData
}

function plainPanel(node: CabinetNode, part: CabinetPart, furnitureName: string): PanelBoringData {
  const face = panelFace(part)
  return {
    panelId: `${node.id}-${part.id}`,
    furnitureName,
    panelType:
      part.role === 'back'
        ? 'back-panel'
        : part.role === 'door'
          ? 'door'
          : part.role === 'drawer-front'
            ? 'drawer-front'
            : part.role === 'divider'
              ? 'partition'
              : part.role === 'shelf'
                ? 'shelf'
                : 'other',
    panelName: part.name,
    width: face.length,
    height: face.width,
    thickness: face.thickness,
    material: part.material,
    borings: [],
  }
}

/**
 * Every sheet panel of a cabinet with its machining. Covered, per mmmcraft:
 * carcass sides (shelf/fixed-panel bores, hinge plate screws, 목찬넬 notches,
 * back groove), fixed horizontals (edge bores), hinged doors (cups, screws).
 * Other panels are exported as plain outlines.
 */
export function cabinetBoringPanels(node: CabinetNode, furnitureName: string): PanelBoringData[] {
  const { parts } = buildCabinetParts(node)
  return parts
    .filter((part) => part.isPanel)
    .map((part) => {
      if (part.role === 'side') return sidePanel(node, part, parts, furnitureName)
      if (isFixedHorizontal(part)) return horizontalPanel(node, part, furnitureName)
      if (part.role === 'door' && part.hinge !== 'top')
        return doorPanel(node, part, parts, furnitureName)
      return plainPanel(node, part, furnitureName)
    })
}
