import { type CabinetNode, type CellFront, resolveCabinetNode } from '../schema'
import { resolveDoorHinges, type ShelfRange } from './hinges'
import {
  BACK_GROOVE_DEPTH_MM,
  BACK_GROOVE_OFFSET_MM,
  backReductionMm,
  DOUBLE_DOOR_MIN_WIDTH_MM,
  DOWEL_SHELF_FRONT_INSET_MM,
  DOWEL_SHELF_WIDTH_CLEARANCE_MM,
  drawerRailLengthMm,
  END_PANEL_THICKNESS_MM,
  EXTERNAL_DRAWER,
  FOOT_FRONT_INSET_MM,
  FOOT_INSET_MM,
  FRAME_THICKNESS_MM,
  FRONT_GAP_MM,
  FRONT_THICKNESS_MM,
  HINGE_CUP_EDGE_OFFSET_MM,
  HINGE_END_OFFSET_MM,
  hingePositionsMm,
  horizontalClearanceMm,
  INNER_DRAWER,
  PANTS_HANGER_DROP_MM,
  PANTS_HANGER_HEIGHT_MM,
  REAR_RAIL_HEIGHT_MM,
  REAR_RAIL_THICKNESS_MM,
  ROD_DIAMETER_MM,
  ROD_DROP_MM,
  round1,
  SINK_FRONT_RAIL_HEIGHT_MM,
  SINK_TOP_HINGE_INSET_MM,
  TOP_BAND_DEPTH_MM,
  TOP_NOTCH_DEPTH_MM,
} from './rules'
import {
  type CellRect,
  collectFrontOwners,
  isStackedRoot,
  type ResolvedLeaf,
  type ResolvedTree,
  resolveCellTree,
} from './tree'

export type PartRole =
  | 'side'
  | 'bottom'
  | 'top'
  | 'top-band'
  | 'front-rail'
  | 'back'
  | 'rear-rail'
  | 'divider'
  | 'fixed-shelf'
  | 'shelf'
  | 'end-panel'
  | 'toe-kick'
  | 'door'
  | 'drawer-front'
  | 'drawer-side'
  | 'drawer-back'
  | 'drawer-bottom'
  | 'drawer-filler'
  | 'rod'
  | 'pants-hanger'
  | 'foot'
  | 'appliance'
  | 'channel-frame'
  | 'top-moulding'
  | 'stone-top'

export type PartMaterial = 'PB' | 'MDF' | 'PET' | 'metal' | 'appliance' | 'stone'

/** Which colour a part takes in 3D (carcass, fronts, or hardware). */
export type PartFinish = 'body' | 'front' | 'hardware' | 'appliance' | 'stone'

/** Min-corner box in cabinet-local mm: x from the left, y from the floor,
 *  z from the back (0) towards the front (depth). */
export type PartBox = { x: number; y: number; z: number; w: number; h: number; d: number }

export type CabinetPart = {
  id: string
  role: PartRole
  /** Korean panel-list label (좌측판, 우측판, …). */
  name: string
  material: PartMaterial
  finish: PartFinish
  box: PartBox
  /** Cut from sheet stock (appears in the panel list / cutlist). */
  isPanel: boolean
  /** Rendered as a cylinder along X (rods) instead of a box. */
  shape?: 'box' | 'rod-x' | 'foot'
  cellId?: string
  /** Doors / flaps: which edge carries the hinges. */
  hinge?: 'left' | 'right' | 'top'
  /** Hinge cup centres along the hinge edge (mm from the leaf's bottom, or
   *  from its left end for a flap). */
  hingePositionsMm?: number[]
  /** Side panels: front notches (목찬넬 따내기), mm from the part's bottom. */
  notches?: { fromBottom: number; height: number; depth: number }[]
  /** Movable shelves: 다보보링 추가 — extra pin rows 32 mm apart above and below. */
  extraDowels?: number
  /** Top panels: 상판 따내기, a rectangle cut from the back corner on `side`. */
  cornerNotch?: { width: number; depth: number; side: 'left' | 'right' }
}

export type CabinetBuild = {
  parts: CabinetPart[]
  issues: string[]
  /** Interior clear rectangle and each compartment's rectangle (front plane). */
  interior: CellRect
  leaves: ResolvedLeaf[]
  cellRects: Map<string, CellRect>
  frontRects: { id: string; rect: CellRect }[]
}

/** Carcass layout numbers shared by the part builder and the editors. */
export function cabinetFrame(raw: CabinetNode) {
  const node = resolveCabinetNode(raw)
  const T = node.panelThicknessMm
  const W = node.widthMm
  const H = node.heightMm
  const D = node.depthMm
  const ep = node.endPanelOptions
  const inside = ep.mode === 'inside'
  // 내치: the EP sits inside the width and the carcass narrows; 외치: the
  // carcass keeps the width and the EP is added outside it.
  const epL = node.endPanels.left && inside ? ep.thicknessMm : 0
  const epR = node.endPanels.right && inside ? ep.thicknessMm : 0
  const hasToeKick =
    node.family !== 'upper' && node.variant !== 'dishwasher' && node.toeKick.enabled
  const toe = hasToeKick ? node.toeKick.heightMm : 0
  const backReduction = backReductionMm(node.backThicknessMm)
  const carcassX0 = epL
  const carcassX1 = W - epR
  const mouldingH =
    node.family !== 'base' && node.topMoulding.enabled ? node.topMoulding.heightMm : 0
  // EP gaps default to running alongside the 상단몰딩 / 걸레받이.
  const epTopGap = ep.topGapMm ?? mouldingH
  const epBottomGap = ep.bottomGapMm ?? toe
  const interior: CellRect = {
    x0: carcassX0 + T,
    x1: carcassX1 - T,
    y0: toe + (hasBottom(node) ? T : 0),
    y1: H - (hasSolidTop(node) || isBandedTop(node) ? T : 0),
  }
  return {
    T,
    W,
    H,
    D,
    epL,
    epR,
    toe,
    hasToeKick,
    backReduction,
    carcassX0,
    carcassX1,
    interior,
    epTopGap,
    epBottomGap,
  }
}

function hasBottom(node: CabinetNode): boolean {
  return node.variant !== 'dishwasher'
}
function hasBack(node: CabinetNode): boolean {
  return node.variant !== 'dishwasher' && node.variant !== 'sink'
}
/** `top: 'auto'` base cabinets use front/back bands under the countertop. */
function isBandedTop(node: CabinetNode): boolean {
  return node.top === 'auto' && node.family === 'base'
}
function hasSolidTop(node: CabinetNode): boolean {
  return node.top === 'solid' || (node.top === 'auto' && node.family !== 'base')
}
/** Appliance housings (dishwasher, built-in appliance) have no interior. */
function hasInterior(node: CabinetNode): boolean {
  return node.variant !== 'dishwasher' && node.variant !== 'appliance'
}

/**
 * Turn a cabinet node into its parts: carcass panels, interior, fronts and
 * hardware. Single source of truth for the 3D mesh, the 2D plan and the
 * panel list — nothing else recomputes panel sizes.
 */
export function buildCabinetParts(raw: CabinetNode): CabinetBuild {
  const node = resolveCabinetNode(raw)
  const f = cabinetFrame(node)
  const { T, W, H, D, toe, backReduction, carcassX0, carcassX1, interior } = f
  const parts: CabinetPart[] = []
  const issues: string[] = []
  const push = (part: Omit<CabinetPart, 'isPanel'> & { isPanel?: boolean }) => {
    parts.push({
      isPanel:
        part.material === 'PB' ||
        part.material === 'MDF' ||
        part.material === 'PET' ||
        part.material === 'stone',
      ...part,
      box: roundBox(part.box),
    })
  }
  const bodyY0 = toe
  const bodyH = H - toe
  const clearance = horizontalClearanceMm(T)
  const horizontalW = carcassX1 - carcassX0 - 2 * T - clearance
  const horizontalX = carcassX0 + T + clearance / 2
  const horizontalD = D - backReduction

  if (bodyH <= 2 * T) issues.push('높이가 너무 낮습니다')
  if (interior.x1 - interior.x0 < 100) issues.push('폭이 너무 좁습니다')

  // ── Carcass ────────────────────────────────────────────────────────
  // One carcass, or one per section when the root is a stacked split
  // (mmmcraft (하)/(상) bodies: own sides, bottom, top, back and rails).
  const tree = resolveCellTree(node.interior, interior, T)
  issues.push(...tree.issues)
  const bodies = carcassBodies(node, f, tree)
  const stacked = bodies.length > 1
  const railZ = BACK_GROOVE_OFFSET_MM - REAR_RAIL_THICKNESS_MM
  bodies.forEach((body, bi) => {
    const p = body.prefix
    const key = stacked ? `-${bi}` : ''
    const isFirst = bi === 0
    const isLast = bi === bodies.length - 1
    const sideH = body.y1 - body.y0
    const notches = sideNotches(node, bodyY0, body.y0, body.y1)
    push({
      id: `side-left${key}`,
      role: 'side',
      name: stacked ? `${p}좌측` : '좌측판',
      material: 'PB',
      finish: 'body',
      box: { x: carcassX0, y: body.y0, z: 0, w: T, h: sideH, d: D },
      ...(notches.length > 0 ? { notches } : {}),
    })
    push({
      id: `side-right${key}`,
      role: 'side',
      name: stacked ? `${p}우측` : '우측판',
      material: 'PB',
      finish: 'body',
      box: { x: carcassX1 - T, y: body.y0, z: 0, w: T, h: sideH, d: D },
      ...(notches.length > 0 ? { notches } : {}),
    })
    if (hasBottom(node) || !isFirst) {
      push({
        id: `bottom${key}`,
        role: 'bottom',
        name: stacked ? `${p}바닥` : '바닥판',
        material: 'PB',
        finish: 'body',
        box: { x: horizontalX, y: body.y0, z: backReduction, w: horizontalW, h: T, d: horizontalD },
      })
    }
    if (hasSolidTop(node) || !isLast) {
      push({
        id: `top${key}`,
        role: 'top',
        name: stacked ? `${p}상판` : '상판',
        material: 'PB',
        finish: 'body',
        box: {
          x: horizontalX,
          y: body.y1 - T,
          z: backReduction,
          w: horizontalW,
          h: T,
          d: horizontalD - (isLast ? node.topSetbackMm : 0),
        },
        // 상판 따내기 (upper cabinets): a 140 deep notch at a back corner.
        ...(isLast && node.family === 'upper' && node.topNotch
          ? {
              cornerNotch: {
                width: Math.min(node.topNotch.widthMm, horizontalW),
                depth: Math.min(TOP_NOTCH_DEPTH_MM, horizontalD),
                side: node.topNotch.side,
              },
            }
          : {}),
      })
    } else if (isBandedTop(node)) {
      pushTopBands(node, push, horizontalX, horizontalW, H, D, T, backReduction)
    }
    if (hasBack(node) && body.hasBack) {
      const backW = carcassX1 - carcassX0 - 2 * T + 2 * BACK_GROOVE_DEPTH_MM - clearance
      const backX = carcassX0 + T - BACK_GROOVE_DEPTH_MM + clearance / 2
      push({
        id: `back${key}`,
        role: 'back',
        name: stacked ? `${p}뒷판` : '뒷판',
        material: 'MDF',
        finish: 'body',
        box: {
          x: backX,
          y: body.y0 + 0.5,
          z: BACK_GROOVE_OFFSET_MM,
          w: backW,
          h: sideH - 1,
          d: node.backThicknessMm,
        },
      })
      if (backW > 1220) issues.push(`뒷판 폭 ${round1(backW)}mm가 원장 폭(1220mm)을 넘습니다`)
      if (sideH - 1 > 2440)
        issues.push(`뒷판 높이 ${round1(sideH - 1)}mm가 원장 길이(2440mm)를 넘습니다`)
      // Rear rails (보강대) behind the back: base cabinets only need the top one.
      if (node.family !== 'base') {
        push({
          id: `rear-rail-bottom${key}`,
          role: 'rear-rail',
          name: `${p}후면 보강대(하)`,
          material: 'PB',
          finish: 'body',
          box: {
            x: horizontalX,
            y: body.y0 + T,
            z: railZ,
            w: horizontalW,
            h: REAR_RAIL_HEIGHT_MM,
            d: REAR_RAIL_THICKNESS_MM,
          },
        })
      }
      push({
        id: `rear-rail-top${key}`,
        role: 'rear-rail',
        name: `${p}후면 보강대(상)`,
        material: 'PB',
        finish: 'body',
        box: {
          x: horizontalX,
          y: body.y1 - T - REAR_RAIL_HEIGHT_MM,
          z: railZ,
          w: horizontalW,
          h: REAR_RAIL_HEIGHT_MM,
          d: REAR_RAIL_THICKNESS_MM,
        },
      })
    }
  })

  // 상판내림: stretcher across the top front (가로전대(상)).
  if (node.topStretcher) {
    const st = node.topStretcher
    push({
      id: 'top-stretcher',
      role: 'front-rail',
      name: '가로전대(상)',
      material: 'PB',
      finish: 'body',
      box: {
        x: horizontalX,
        y: H - st.heightMm,
        z: D - st.setbackMm - T,
        w: horizontalW,
        h: st.heightMm,
        d: T,
      },
    })
  }

  // 목찬넬: PET L-frame in each notch, PB rail (가로전대) behind it.
  node.channels.forEach((ch, i) => {
    const nb = bodyY0 + ch.fromBottomMm
    const nt = Math.min(H, nb + ch.heightMm)
    const n = i + 1
    if (ch.frame) {
      push({
        id: `channel-frame-h-${i}`,
        role: 'channel-frame',
        name: `목찬넬프레임수평${n}`,
        material: 'PET',
        finish: 'front',
        box: { x: 0, y: nb, z: D - ch.depthMm, w: W, h: FRONT_THICKNESS_MM, d: ch.depthMm },
      })
      push({
        id: `channel-frame-v-${i}`,
        role: 'channel-frame',
        name: `목찬넬프레임수직${n}`,
        material: 'PET',
        finish: 'front',
        box: {
          x: 0,
          y: nb + FRONT_THICKNESS_MM,
          z: D - ch.depthMm,
          w: W,
          h: Math.max(1, nt - nb - FRONT_THICKNESS_MM),
          d: FRONT_THICKNESS_MM,
        },
      })
    }
    if (ch.railHeightMm != null) {
      push({
        id: `channel-rail-${i}`,
        role: 'front-rail',
        name: `가로전대${n}`,
        material: 'PB',
        finish: 'body',
        box: {
          x: horizontalX,
          y: nt - ch.railHeightMm,
          z: D - ch.depthMm - T,
          w: horizontalW,
          h: ch.railHeightMm,
          d: T,
        },
      })
    }
  })

  // End panels (EP): flush with the fronts, from the body bottom − 하단 갭
  // to its top + 상단 갭, extended by the front / back offsets.
  if (node.endPanels.left) pushEndPanels(node, f, 'left', push)
  if (node.endPanels.right) pushEndPanels(node, f, 'right', push)
  // A frame strip stops at the EPs only where they reach down / up to it.
  const frameX = (gap: number): [number, number] =>
    gap > 0 ? [carcassX0, carcassX1] : [Math.min(carcassX0, 0), Math.max(carcassX1, W)]
  const [toeX0, toeX1] = frameX(f.epBottomGap)
  const [topX0, topX1] = frameX(f.epTopGap)

  // Toe kick (걸레받이) + adjustable feet. mmmcraft: runs between the end
  // panels (they reach the floor), 옵셋 pushes it back, 갭 is cut from the
  // bottom, 폭확장 widens either end.
  if (f.hasToeKick) {
    const kick = node.toeKick
    const gap = Math.min(kick.gapMm, toe)
    const [x0, x1] = frameSpan(kick.widthAdjust, toeX0, toeX1)
    if (toe - gap > 0) {
      push({
        id: 'toe-kick',
        role: 'toe-kick',
        name: '걸레받이',
        material: 'PET',
        finish: 'front',
        box: {
          x: x0,
          y: gap,
          z: D - kick.setbackMm - kick.offsetMm - T,
          w: x1 - x0,
          h: toe - gap,
          d: T,
        },
      })
    }
    const footXs = [carcassX0 + FOOT_INSET_MM, carcassX1 - FOOT_INSET_MM]
    const footZs = [FOOT_INSET_MM, D - FOOT_FRONT_INSET_MM]
    let i = 0
    for (const fx of footXs) {
      for (const fz of footZs) {
        i += 1
        push({
          id: `foot-${i}`,
          role: 'foot',
          name: '조절발',
          material: 'metal',
          finish: 'hardware',
          shape: 'foot',
          box: { x: fx - 15, y: 0, z: fz - 15, w: 30, h: toe, d: 30 },
        })
      }
    }
  }

  // 상단몰딩 (tall / upper): on the carcass top, flush with its front; 옵셋
  // pushes it back, 갭 is cut from the top.
  const moulding = node.topMoulding
  if (moulding.enabled && node.family !== 'base') {
    const h = moulding.heightMm - Math.min(moulding.gapMm, moulding.heightMm)
    const [x0, x1] = frameSpan(moulding.widthAdjust, topX0, topX1)
    if (h > 0) {
      push({
        id: 'top-moulding',
        role: 'top-moulding',
        name: '상단몰딩',
        material: 'PET',
        finish: 'front',
        box: {
          x: x0,
          y: H,
          z: D - moulding.offsetMm - FRAME_THICKNESS_MM,
          w: x1 - x0,
          h,
          d: FRAME_THICKNESS_MM,
        },
      })
    }
  }

  pushTopAndBottomExtras(node, f, push)

  // ── Interior ───────────────────────────────────────────────────────
  if (hasInterior(node)) {
    for (const divider of tree.dividers) {
      if (divider.stacked) continue // built as the two carcasses' top and bottom
      const r = divider.rect
      if (divider.axis === 'x') {
        push({
          id: `divider-${divider.splitId}-${divider.index}`,
          role: 'divider',
          name: '칸막이',
          material: 'PB',
          finish: 'body',
          cellId: divider.splitId,
          box: { x: r.x0, y: r.y0, z: backReduction, w: T, h: r.y1 - r.y0, d: horizontalD },
        })
      } else {
        push({
          id: `fixed-shelf-${divider.splitId}-${divider.index}`,
          role: 'fixed-shelf',
          name: '고정선반',
          material: 'PB',
          finish: 'body',
          cellId: divider.splitId,
          box: {
            x: r.x0 + clearance / 2,
            y: r.y0,
            z: backReduction,
            w: r.x1 - r.x0 - clearance,
            h: T,
            d: horizontalD,
          },
        })
      }
    }
    for (const leaf of tree.leaves) buildLeafContent(node, leaf, f, push, issues)
  } else {
    const r = interior
    push({
      id: 'appliance',
      role: 'appliance',
      name: node.variant === 'dishwasher' ? '식기세척기' : '가전',
      material: 'appliance',
      finish: 'appliance',
      isPanel: false,
      box: {
        x: r.x0 + 2,
        y: node.variant === 'dishwasher' ? 0 : r.y0,
        z: 30,
        w: r.x1 - r.x0 - 4,
        h: (node.variant === 'dishwasher' ? H - T : r.y1 - r.y0) - 2,
        d: D - 40,
      },
    })
  }

  // ── Fronts ─────────────────────────────────────────────────────────
  const frontRects: { id: string; rect: CellRect }[] = []
  // A front edge that meets another front stops half the gap short of the
  // joint's centre line (a divider, a fixed shelf, or two stacked panels).
  const jointCentre = (edge: 'x0' | 'x1' | 'y0' | 'y1', rect: CellRect): number | null => {
    for (const d of tree.dividers) {
      const r = d.rect
      if ((edge === 'x0' || edge === 'x1') !== (d.axis === 'x')) continue
      if (edge === 'x0' && Math.abs(r.x1 - rect.x0) < 0.01 && r.y0 < rect.y1 && r.y1 > rect.y0)
        return (r.x0 + r.x1) / 2
      if (edge === 'x1' && Math.abs(r.x0 - rect.x1) < 0.01 && r.y0 < rect.y1 && r.y1 > rect.y0)
        return (r.x0 + r.x1) / 2
      if (edge === 'y0' && Math.abs(r.y1 - rect.y0) < 0.01 && r.x0 < rect.x1 && r.x1 > rect.x0)
        return (r.y0 + r.y1) / 2
      if (edge === 'y1' && Math.abs(r.y0 - rect.y1) < 0.01 && r.x0 < rect.x1 && r.x1 > rect.x0)
        return (r.y0 + r.y1) / 2
    }
    return null
  }
  const frontRectFor = (rect: CellRect): CellRect => {
    const rev = node.frontReveal
    const halfBetween = rev.between / 2
    const atLeft = Math.abs(rect.x0 - interior.x0) < 0.01
    const atRight = Math.abs(rect.x1 - interior.x1) < 0.01
    const atBottom = Math.abs(rect.y0 - interior.y0) < 0.01
    const atTop = Math.abs(rect.y1 - interior.y1) < 0.01
    return {
      x0: atLeft
        ? carcassX0 + rev.side
        : (jointCentre('x0', rect) ?? rect.x0 - T / 2) + halfBetween,
      x1: atRight
        ? carcassX1 - rev.side
        : (jointCentre('x1', rect) ?? rect.x1 + T / 2) - halfBetween,
      y0: atBottom
        ? bodyY0 + rev.bottom
        : (jointCentre('y0', rect) ?? rect.y0 - T / 2) + halfBetween,
      y1: atTop ? H - rev.top : (jointCentre('y1', rect) ?? rect.y1 + T / 2) - halfBetween,
    }
  }

  const frontZ = D + FRONT_GAP_MM
  const owners = hasInterior(node)
    ? collectFrontOwners(node.interior, tree.rects)
    : [
        {
          id: node.interior.id,
          rect: interior,
          front: node.interior.front ?? defaultFront(),
          hasExternalDrawers: false,
        },
      ]
  // Shelves and joints a hinge must keep clear of (side coordinates).
  const shelfRanges = parts
    .filter(
      (p) =>
        p.role === 'shelf' ||
        p.role === 'fixed-shelf' ||
        ((p.role === 'top' || p.role === 'bottom') &&
          p.box.y > bodyY0 + 0.5 &&
          p.box.y + p.box.h < H - 0.5),
    )
    .map((p) => ({
      x0: p.box.x,
      x1: p.box.x + p.box.w,
      bottomMm: p.box.y - bodyY0,
      topMm: p.box.y + p.box.h - bodyY0,
    }))
  for (const owner of owners) {
    if (owner.front.type === 'none') continue
    if (owner.hasExternalDrawers) {
      issues.push('겉서랍이 있는 칸에는 문을 달 수 없어 문을 생략했습니다')
      continue
    }
    const rect = frontRectFor(owner.rect)
    frontRects.push({ id: owner.id, rect })
    // mmmcraft side anchors: 120 above the section bottom, 120 below its top
    // (300 under a sink cabinet's top).
    const atTop = Math.abs(owner.rect.y1 - interior.y1) < 0.01
    const sectionBottom =
      Math.abs(owner.rect.y0 - interior.y0) < 0.01
        ? bodyY0
        : (jointCentre('y0', owner.rect) ?? owner.rect.y0 - T / 2)
    const sectionTop = atTop ? H : (jointCentre('y1', owner.rect) ?? owner.rect.y1 + T / 2)
    buildDoorLeaves(node, owner.id, rect, owner.front, frontZ, push, {
      bodyY0,
      firstSideMm: sectionBottom - bodyY0 + HINGE_END_OFFSET_MM,
      lastSideMm:
        sectionTop -
        bodyY0 -
        (atTop && node.variant === 'sink' ? SINK_TOP_HINGE_INSET_MM : HINGE_END_OFFSET_MM),
      shelves: shelfRanges.filter((r) => r.x1 > rect.x0 && r.x0 < rect.x1),
      carcassX0,
      carcassX1,
    })
  }

  // External drawer fronts.
  for (const leaf of tree.leaves) {
    if (!hasInterior(node)) break
    if (leaf.content.type !== 'drawers' || leaf.content.style !== 'external') continue
    const rect = frontRectFor(leaf.rect)
    frontRects.push({ id: leaf.id, rect })
    // Explicit mmmcraft 마이다 ranges (from the carcass bottom), or equal
    // fronts over the compartment.
    const gap = node.frontReveal.between
    const ranges: [number, number][] = leaf.content.frontsMm?.length
      ? leaf.content.frontsMm.map(([a, b]) => [bodyY0 + a, bodyY0 + b])
      : Array.from({ length: leaf.content.count }, (_, i) => {
          const count = leaf.content.type === 'drawers' ? leaf.content.count : 1
          const h = (rect.y1 - rect.y0 - gap * (count - 1)) / count
          const y = rect.y0 + i * (h + gap)
          return [y, y + h]
        })
    for (let i = 0; i < ranges.length; i += 1) {
      const [y0, y1] = ranges[i] as [number, number]
      const frontH = y1 - y0
      push({
        id: `drawer-front-${leaf.id}-${i}`,
        role: 'drawer-front',
        name: `서랍${i + 1} 앞판`,
        material: 'PET',
        finish: 'front',
        cellId: leaf.id,
        box: {
          x: rect.x0,
          y: y0,
          z: frontZ,
          w: rect.x1 - rect.x0,
          h: frontH,
          d: FRONT_THICKNESS_MM,
        },
      })
    }
  }

  return {
    parts,
    issues: dedupe(issues),
    interior,
    leaves: tree.leaves,
    cellRects: tree.rects,
    frontRects,
  }
}

/** The cabinet's channels that cut into a side spanning [y0, y1], relative
 *  to that side's bottom. */
function sideNotches(node: CabinetNode, carcassBottom: number, y0: number, y1: number) {
  return node.channels
    .map((ch) => {
      const nb = Math.max(y0, carcassBottom + ch.fromBottomMm)
      const nt = Math.min(y1, carcassBottom + ch.fromBottomMm + ch.heightMm)
      return { fromBottom: round1(nb - y0), height: round1(nt - nb), depth: ch.depthMm }
    })
    .filter((n) => n.height > 0)
}

type Body = { y0: number; y1: number; prefix: string; hasBack: boolean }

/**
 * Carcass bodies bottom → top. One body normally; one per root child for a
 * stacked root, split at the middle of each two-panel joint. Prefixes follow
 * mmmcraft: (하)/(상) for two bodies, (1단)/(2단)/… beyond that.
 */
function carcassBodies(node: CabinetNode, f: Frame, tree: ResolvedTree): Body[] {
  const sideY0 = node.variant === 'dishwasher' ? 0 : f.toe
  const root = node.interior
  if (!isStackedRoot(root) || root.kind !== 'split') {
    return [{ y0: sideY0, y1: f.H, prefix: '', hasBack: true }]
  }
  const joints = tree.dividers.filter((d) => d.stacked).sort((a, b) => a.index - b.index)
  const n = root.children.length
  return root.children.map((child, i) => {
    const y0 = i === 0 ? sideY0 : (joints[i - 1]?.rect.y0 ?? 0) + f.T
    const y1 = i === n - 1 ? f.H : (joints[i]?.rect.y0 ?? 0) + f.T
    const prefix = n === 2 ? (i === 0 ? '(하)' : '(상)') : `(${i + 1}단)`
    return { y0, y1, prefix, hasBack: child.hasBack !== false }
  })
}

function pushTopBands(
  node: CabinetNode,
  push: Push,
  x: number,
  w: number,
  H: number,
  D: number,
  T: number,
  backReduction: number,
) {
  // Back band always; the front band becomes a vertical stretcher on a sink
  // cabinet (room for the bowl and trap).
  push({
    id: 'top-band-back',
    role: 'top-band',
    name: '상판 뒤띠',
    material: 'PB',
    finish: 'body',
    box: { x, y: H - T, z: backReduction, w, h: T, d: TOP_BAND_DEPTH_MM },
  })
  if (node.variant === 'sink') {
    push({
      id: 'front-rail',
      role: 'front-rail',
      name: '전대',
      material: 'PB',
      finish: 'body',
      box: { x, y: H - SINK_FRONT_RAIL_HEIGHT_MM, z: D - T, w, h: SINK_FRONT_RAIL_HEIGHT_MM, d: T },
    })
  } else {
    push({
      id: 'top-band-front',
      role: 'top-band',
      name: '상판 앞띠',
      material: 'PB',
      finish: 'body',
      box: { x, y: H - T, z: D - TOP_BAND_DEPTH_MM, w, h: T, d: TOP_BAND_DEPTH_MM },
    })
  }
}

/**
 * One side's EP. Up to 18 mm it is a single board; thicker, mmmcraft builds
 * a ㄷ frame: an 18 mm 측판 on the outside plus front and back 연결판 of
 * (thickness − 18) closing it against the carcass.
 */
function pushEndPanels(node: CabinetNode, f: Frame, side: 'left' | 'right', push: Push) {
  const ep = node.endPanelOptions
  const t = ep.thicknessMm
  const front = side === 'left' ? ep.leftFrontMm : ep.rightFrontMm
  const back = side === 'left' ? ep.leftBackMm : ep.rightBackMm
  const y0 = f.toe - f.epBottomGap
  const h = f.H - y0 + f.epTopGap
  const z0 = -back
  const d = Math.max(0, f.D + FRONT_GAP_MM + FRONT_THICKNESS_MM + front + back)
  if (h <= 0 || d <= 0) return
  const inside = ep.mode === 'inside'
  // Outer face of the EP.
  const outer = side === 'left' ? (inside ? 0 : -t) : inside ? f.W : f.W + t
  const dir = side === 'left' ? 1 : -1
  const label = side === 'left' ? '좌' : '우'
  const board = (id: string, name: string, xFrom: number, w: number, z: number, depth: number) =>
    push({
      id: `end-panel-${side}${id}`,
      role: 'end-panel',
      name,
      material: 'PET',
      finish: 'front',
      box: { x: dir > 0 ? xFrom : xFrom - w, y: y0, z, w, h, d: depth },
    })
  if (t <= END_PANEL_THICKNESS_MM) {
    board('', `엔드패널(${label})`, outer, t, z0, d)
    return
  }
  const inner = outer + dir * END_PANEL_THICKNESS_MM
  board('', `EP(${label})측판`, outer, END_PANEL_THICKNESS_MM, z0, d)
  board(
    '-front',
    `EP(${label})전면연결판`,
    inner,
    t - END_PANEL_THICKNESS_MM,
    z0 + d - END_PANEL_THICKNESS_MM,
    END_PANEL_THICKNESS_MM,
  )
  board(
    '-back',
    `EP(${label})후면연결판`,
    inner,
    t - END_PANEL_THICKNESS_MM,
    z0,
    END_PANEL_THICKNESS_MM,
  )
}

/** 하부 EP (upper), 상부 EP / 인조대리석 상판 (base). */
function pushTopAndBottomExtras(node: CabinetNode, f: Frame, push: Push) {
  const { H, D, carcassX0, carcassX1 } = f
  if (node.family === 'upper' && node.bottomEndPanel.enabled) {
    const b = node.bottomEndPanel
    const z0 = Math.abs(b.backGapMm)
    const d = D - b.frontGapMm - z0
    if (d > 0) {
      push({
        id: 'bottom-end-panel',
        role: 'end-panel',
        name: '하부 EP',
        material: 'PET',
        finish: 'front',
        box: {
          x: carcassX0,
          y: -END_PANEL_THICKNESS_MM,
          z: z0,
          w: carcassX1 - carcassX0,
          h: END_PANEL_THICKNESS_MM,
          d,
        },
      })
    }
  }
  if (node.family !== 'base') return
  const t = node.endPanelOptions.thicknessMm
  if (node.topEndPanel.enabled) {
    const top = node.topEndPanel
    // Over the side EPs too when they stop at the body top.
    const [x0, x1] =
      f.epTopGap <= 0 ? [Math.min(0, carcassX0), Math.max(f.W, carcassX1)] : [carcassX0, carcassX1]
    const z0 = -top.backOffsetMm
    push({
      id: 'top-end-panel',
      role: 'end-panel',
      name: '상부 EP',
      material: 'PET',
      finish: 'front',
      box: { x: x0, y: H, z: z0, w: x1 - x0, h: t, d: D + top.frontOffsetMm + top.backOffsetMm },
    })
    if (top.backLip) {
      push({
        id: 'top-end-panel-lip',
        role: 'end-panel',
        name: '상부 EP 뒷턱',
        material: 'PET',
        finish: 'front',
        box: {
          x: x0,
          y: H + t,
          z: z0,
          w: x1 - x0,
          h: top.backLip.heightMm,
          d: top.backLip.thicknessMm,
        },
      })
    }
    return
  }
  const stone = node.stoneTop
  if (stone.thicknessMm > 0) {
    const x0 = carcassX0 - stone.leftMm
    const w = carcassX1 + stone.rightMm - x0
    const z0 = -stone.backMm
    push({
      id: 'stone-top',
      role: 'stone-top',
      name: '인조대리석 상판',
      material: 'stone',
      finish: 'stone',
      box: { x: x0, y: H, z: z0, w, h: stone.thicknessMm, d: D + stone.frontMm + stone.backMm },
    })
    if (stone.backLip) {
      push({
        id: 'stone-top-lip',
        role: 'stone-top',
        name: '인조대리석 뒷턱',
        material: 'stone',
        finish: 'stone',
        box: {
          x: x0,
          y: H + stone.thicknessMm,
          z: z0,
          w,
          h: stone.backLip.heightMm,
          d: stone.backLip.thicknessMm,
        },
      })
    }
  }
}

/** A frame strip's x span: between the end panels, widened by 폭확장. */
function frameSpan(
  adjust: CabinetNode['toeKick']['widthAdjust'],
  x0: number,
  x1: number,
): [number, number] {
  return adjust.enabled ? [x0 - adjust.leftMm, x1 + adjust.rightMm] : [x0, x1]
}

function defaultFront(): CellFront {
  return { type: 'door', leaves: 'auto', hinge: 'auto' }
}

type Push = (part: Omit<CabinetPart, 'isPanel'> & { isPanel?: boolean }) => void
type Frame = ReturnType<typeof cabinetFrame>

function buildLeafContent(
  node: CabinetNode,
  leaf: ResolvedLeaf,
  f: Frame,
  push: Push,
  issues: string[],
) {
  const { T, D, backReduction } = f
  const r = leaf.rect
  const clearW = r.x1 - r.x0
  const clearH = r.y1 - r.y0
  const c = leaf.content
  if (c.type === 'shelves' && c.count > 0) {
    const gap = (clearH - c.count * T) / (c.count + 1)
    // 칸 내경: explicit shelf centres, else evenly spaced.
    const centres =
      c.positionsMm?.length === c.count
        ? c.positionsMm
        : Array.from({ length: c.count }, (_, i) => gap * (i + 1) + i * T + T / 2)
    const gaps = centres.map(
      (y, i) => y - T / 2 - (i === 0 ? 0 : (centres[i - 1] as number) + T / 2),
    )
    gaps.push(clearH - ((centres.at(-1) as number) + T / 2))
    if (Math.min(...gaps) < 60) issues.push('선반 간격이 60mm보다 좁습니다')
    const dowel = c.kind === 'dowel'
    const w = clearW - (dowel ? DOWEL_SHELF_WIDTH_CLEARANCE_MM : horizontalClearanceMm(T))
    const d = D - backReduction - (dowel ? DOWEL_SHELF_FRONT_INSET_MM : 0)
    for (let i = 0; i < c.count; i += 1) {
      push({
        id: `shelf-${leaf.id}-${i}`,
        role: dowel ? 'shelf' : 'fixed-shelf',
        name: dowel ? '이동선반' : '고정선반',
        material: 'PB',
        finish: 'body',
        cellId: leaf.id,
        ...(dowel && c.extraDowels ? { extraDowels: c.extraDowels } : {}),
        box: {
          x: r.x0 + (clearW - w) / 2,
          y: r.y0 + (centres[i] as number) - T / 2,
          z: backReduction,
          w,
          h: T,
          d,
        },
      })
    }
  } else if (c.type === 'hanging') {
    const zMid = (backReduction + D) / 2
    // 옷봉선반: a fixed shelf under the compartment top; the rod hangs from it.
    let hangFrom = r.y1
    if (c.shelfTopGapMm !== undefined) {
      const topGap = Math.min(c.shelfTopGapMm, Math.max(0, clearH - T))
      const w = clearW - horizontalClearanceMm(T)
      hangFrom = r.y1 - topGap - T
      push({
        id: `rod-shelf-${leaf.id}`,
        role: 'fixed-shelf',
        name: '옷봉선반',
        material: 'PB',
        finish: 'body',
        cellId: leaf.id,
        box: {
          x: r.x0 + (clearW - w) / 2,
          y: hangFrom,
          z: backReduction,
          w,
          h: T,
          d: D - backReduction,
        },
      })
    }
    if (c.rod === 'rod') {
      push({
        id: `rod-${leaf.id}`,
        role: 'rod',
        name: '옷봉',
        material: 'metal',
        finish: 'hardware',
        shape: 'rod-x',
        cellId: leaf.id,
        box: {
          x: r.x0 + 1,
          y: hangFrom - ROD_DROP_MM - ROD_DIAMETER_MM / 2,
          z: zMid - ROD_DIAMETER_MM / 2,
          w: clearW - 2,
          h: ROD_DIAMETER_MM,
          d: ROD_DIAMETER_MM,
        },
      })
    } else {
      push({
        id: `pants-${leaf.id}`,
        role: 'pants-hanger',
        name: '바지걸이',
        material: 'metal',
        finish: 'hardware',
        cellId: leaf.id,
        box: {
          x: r.x0 + 20,
          y: hangFrom - PANTS_HANGER_DROP_MM,
          z: backReduction + 20,
          w: clearW - 40,
          h: PANTS_HANGER_HEIGHT_MM,
          d: D - backReduction - 60,
        },
      })
    }
    if (clearH < 800) issues.push('옷봉 칸 높이가 800mm보다 낮습니다')
  } else if (c.type === 'drawers') {
    if (c.style === 'inner') buildInnerDrawers(node, leaf, f, push, issues)
    else buildExternalDrawerBoxes(leaf, f, c.count, c.boxesMm, push, issues)
  }
}

function buildInnerDrawers(
  node: CabinetNode,
  leaf: ResolvedLeaf,
  f: Frame,
  push: Push,
  issues: string[],
) {
  if (leaf.content.type !== 'drawers') return
  const { D, backReduction, T } = f
  const r = leaf.rect
  const cfg = INNER_DRAWER
  const clearW = r.x1 - r.x0
  const clearH = r.y1 - r.y0
  // Front heights bottom → top: the individual list (mmmcraft drawerHeights,
  // gap below each front, none above the last) or a uniform pitch.
  const requested =
    leaf.content.heightsMm && leaf.content.heightsMm.length > 0
      ? leaf.content.heightsMm
      : Array.from({ length: leaf.content.count }, () =>
          leaf.content.type === 'drawers' ? leaf.content.stepMm : 0,
        )
  const heights: number[] = []
  let used = 0
  for (const h of requested) {
    if (used + cfg.gapMm + h > clearH + 0.01) break
    heights.push(h)
    used += cfg.gapMm + h
  }
  const count = heights.length
  if (count < requested.length) {
    issues.push(`서랍 ${requested.length}개가 칸에 들어가지 않아 ${count}개만 만들었습니다`)
  }
  if (count === 0) return
  const stackH = used
  const innerD = D - backReduction
  const frontZ0 = D - cfg.fillerSetbackMm + cfg.overlayProjectionMm - FRONT_THICKNESS_MM
  // Side fillers (서랍속장): a rail board on each side, set in from the wall.
  const fillerBoardX = [r.x0 + cfg.fillerWidthMm - cfg.fillerThicknessMm, r.x1 - cfg.fillerWidthMm]
  fillerBoardX.forEach((x, i) => {
    push({
      id: `filler-${leaf.id}-${i}`,
      role: 'drawer-filler',
      name: '서랍속장',
      material: 'PB',
      finish: 'body',
      cellId: leaf.id,
      box: {
        x,
        y: r.y0,
        z: backReduction,
        w: cfg.fillerThicknessMm,
        h: stackH,
        d: innerD - cfg.fillerSetbackMm,
      },
    })
  })
  const railAvail = innerD - 17 - node.backThicknessMm - cfg.fillerSetbackMm
  const rail = drawerRailLengthMm(railAvail)
  // Same as mmmcraft `resolveDrawerDepthMm`: a listed runner gives rail + 2T − 10;
  // shallower than the shortest runner, the box takes what is left minus 10.
  const sideDepth = rail != null ? rail + 26 : railAvail - 10
  if (sideDepth < 100) {
    issues.push('깊이가 부족해 내부 서랍을 만들 수 없습니다')
    return
  }
  const boxW = clearW - 2 * cfg.fillerWidthMm - cfg.railClearanceMm
  const boxX = r.x0 + (clearW - boxW) / 2
  const boxZ1 = frontZ0
  let y0 = r.y0
  for (let i = 0; i < count; i += 1) {
    const step = heights[i] ?? 0
    y0 += cfg.gapMm
    push({
      id: `inner-drawer-front-${leaf.id}-${i}`,
      role: 'drawer-front',
      name: `서랍${i + 1}(마이다)`,
      material: 'PET',
      finish: 'front',
      cellId: leaf.id,
      box: {
        x: r.x0 + cfg.sideGapMm,
        y: y0,
        z: frontZ0,
        w: clearW - 2 * cfg.sideGapMm,
        h: step,
        d: FRONT_THICKNESS_MM,
      },
    })
    pushDrawerBox(
      push,
      `${leaf.id}-${i}`,
      leaf.id,
      boxX,
      y0 + 12,
      boxZ1 - sideDepth,
      boxW,
      step - cfg.boxHeightReductionMm,
      sideDepth,
      cfg.boxSideThicknessMm,
      cfg.boxBottomThicknessMm,
    )
    y0 += step
  }
  // Cover shelf over the stack when there is room above it.
  if (clearH - stackH > T + 60) {
    push({
      id: `drawer-cover-${leaf.id}`,
      role: 'fixed-shelf',
      name: '서랍 상단 선반',
      material: 'PB',
      finish: 'body',
      cellId: leaf.id,
      box: {
        x: r.x0 + horizontalClearanceMm(T) / 2,
        y: r.y0 + stackH,
        z: backReduction,
        w: clearW - horizontalClearanceMm(T),
        h: T,
        d: innerD,
      },
    })
  }
}

function buildExternalDrawerBoxes(
  leaf: ResolvedLeaf,
  f: Frame,
  count: number,
  boxesMm: [number, number][] | undefined,
  push: Push,
  issues: string[],
) {
  const { D, backReduction } = f
  const r = leaf.rect
  const cfg = EXTERNAL_DRAWER
  const clearW = r.x1 - r.x0
  const slotH = (r.y1 - r.y0) / count
  const rail = drawerRailLengthMm(D - backReduction - 10)
  if (rail == null) {
    issues.push('깊이가 부족해 서랍 레일을 고를 수 없습니다')
    return
  }
  const boxW = clearW - 2 * cfg.runnerClearanceMm
  // Explicit boxes (mmmcraft wood / Legrabox positions from the carcass
  // bottom) or one box per equal slot.
  const boxes: [number, number][] = boxesMm?.length
    ? boxesMm.map(([y, h]) => [f.toe + y, h])
    : Array.from({ length: count }, (_, i) => [
        r.y0 + i * slotH + 15,
        Math.max(cfg.minBoxHeightMm, slotH - cfg.boxHeightReductionMm),
      ])
  for (let i = 0; i < boxes.length; i += 1) {
    const [y0, boxH] = boxes[i] as [number, number]
    pushDrawerBox(
      push,
      `${leaf.id}-${i}`,
      leaf.id,
      r.x0 + cfg.runnerClearanceMm,
      y0,
      D - rail - 2,
      boxW,
      boxH,
      rail,
      cfg.boxSideThicknessMm,
      9,
    )
  }
}

function pushDrawerBox(
  push: Push,
  key: string,
  cellId: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  sideT: number,
  bottomT: number,
) {
  push({
    id: `drawer-side-l-${key}`,
    role: 'drawer-side',
    name: '서랍 옆판',
    material: 'PB',
    finish: 'body',
    cellId,
    box: { x, y, z, w: sideT, h, d },
  })
  push({
    id: `drawer-side-r-${key}`,
    role: 'drawer-side',
    name: '서랍 옆판',
    material: 'PB',
    finish: 'body',
    cellId,
    box: { x: x + w - sideT, y, z, w: sideT, h, d },
  })
  push({
    id: `drawer-back-${key}`,
    role: 'drawer-back',
    name: '서랍 뒷판',
    material: 'PB',
    finish: 'body',
    cellId,
    box: { x: x + sideT, y: y + bottomT, z, w: w - 2 * sideT, h: h - bottomT - 10, d: sideT },
  })
  push({
    id: `drawer-inner-front-${key}`,
    role: 'drawer-back',
    name: '서랍 앞판(속)',
    material: 'PB',
    finish: 'body',
    cellId,
    box: {
      x: x + sideT,
      y: y + bottomT,
      z: z + d - sideT,
      w: w - 2 * sideT,
      h: h - bottomT - 10,
      d: sideT,
    },
  })
  push({
    id: `drawer-bottom-${key}`,
    role: 'drawer-bottom',
    name: '서랍 바닥',
    material: 'MDF',
    finish: 'body',
    cellId,
    box: { x: x + sideT - 7, y, z: z + 1, w: w - 2 * sideT + 14, h: bottomT, d: d - 2 },
  })
}

type DoorContext = {
  bodyY0: number
  firstSideMm: number
  lastSideMm: number
  shelves: ShelfRange[]
  carcassX0: number
  carcassX1: number
}

function buildDoorLeaves(
  node: CabinetNode,
  ownerId: string,
  rect: CellRect,
  front: CellFront,
  frontZ: number,
  push: Push,
  ctx: DoorContext,
) {
  const width = rect.x1 - rect.x0
  const height = rect.y1 - rect.y0
  if (front.type === 'panel') {
    push({
      id: `door-${ownerId}`,
      role: 'door',
      name: '전판',
      material: 'PET',
      finish: 'front',
      cellId: ownerId,
      box: { x: rect.x0, y: rect.y0, z: frontZ, w: width, h: height, d: FRONT_THICKNESS_MM },
    })
    return
  }
  if (front.type === 'flap') {
    push({
      id: `door-${ownerId}`,
      role: 'door',
      name: '플랩문',
      material: 'PET',
      finish: 'front',
      cellId: ownerId,
      hinge: 'top',
      hingePositionsMm: hingePositionsMm(width),
      box: { x: rect.x0, y: rect.y0, z: frontZ, w: width, h: height, d: FRONT_THICKNESS_MM },
    })
    return
  }
  const leaves =
    front.leaves === 'auto' ? (width > DOUBLE_DOOR_MIN_WIDTH_MM ? 2 : 1) : Number(front.leaves)
  const gap = node.frontReveal.between
  const leafW = leaves === 2 ? (width - gap) / 2 : width
  const cabinetMid = node.widthMm / 2
  const hinges = resolveDoorHinges({
    doorHeightMm: height,
    doorBottomOnSideMm: rect.y0 - ctx.bodyY0,
    firstSideMm: ctx.firstSideMm,
    lastSideMm: ctx.lastSideMm,
    shelves: ctx.shelves,
    ...(front.hingesMm?.length ? { customSideMm: front.hingesMm } : {}),
  })
  const adjust = node.doorWidthAdjust
  for (let i = 0; i < leaves; i += 1) {
    let x0 = rect.x0 + i * (leafW + gap)
    let x1 = x0 + leafW
    const hinge: 'left' | 'right' =
      leaves === 2
        ? i === 0
          ? 'left'
          : 'right'
        : front.hinge === 'auto'
          ? (rect.x0 + rect.x1) / 2 > cabinetMid + 1
            ? 'right'
            : 'left'
          : front.hinge
    // 도어 확장/축소 (mmmcraft): a single leaf's edge away from the hinge
    // moves to the carcass edge + v; a double door's right leaf widens by
    // v + 3 at its outer edge. Only edges on the carcass side are moved.
    if (adjust.enabled) {
      if (
        leaves === 1 &&
        hinge === 'left' &&
        Math.abs(x1 - (ctx.carcassX1 - node.frontReveal.side)) < 0.01
      )
        x1 = ctx.carcassX1 + adjust.mm
      if (
        leaves === 1 &&
        hinge === 'right' &&
        Math.abs(x0 - (ctx.carcassX0 + node.frontReveal.side)) < 0.01
      )
        x0 = ctx.carcassX0 - adjust.mm
      if (leaves === 2 && i === 1 && Math.abs(x1 - (ctx.carcassX1 - node.frontReveal.side)) < 0.01)
        x1 += adjust.mm + 3
    }
    push({
      id: `door-${ownerId}-${i}`,
      role: 'door',
      name: leaves === 2 ? `양문(${i === 0 ? '좌' : '우'})` : '도어',
      material: 'PET',
      finish: 'front',
      cellId: ownerId,
      hinge,
      hingePositionsMm: hinges,
      box: { x: x0, y: rect.y0, z: frontZ, w: x1 - x0, h: height, d: FRONT_THICKNESS_MM },
    })
  }
}

/** Hinge cup centre on the door leaf (leaf-local mm, from its left/bottom). */
export function hingeCupCentres(part: CabinetPart): { x: number; y: number }[] {
  if (part.role !== 'door' || !part.hinge || !part.hingePositionsMm) return []
  const { w, h } = part.box
  if (part.hinge === 'top') {
    return part.hingePositionsMm.map((x) => ({ x, y: h - HINGE_CUP_EDGE_OFFSET_MM }))
  }
  const x = part.hinge === 'left' ? HINGE_CUP_EDGE_OFFSET_MM : w - HINGE_CUP_EDGE_OFFSET_MM
  return part.hingePositionsMm.map((y) => ({ x, y }))
}

function roundBox(b: PartBox): PartBox {
  return {
    x: round1(b.x),
    y: round1(b.y),
    z: round1(b.z),
    w: round1(b.w),
    h: round1(b.h),
    d: round1(b.d),
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values))
}
