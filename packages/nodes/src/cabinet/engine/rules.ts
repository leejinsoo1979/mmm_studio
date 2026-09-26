/**
 * Factory rules for the cabinet engine, in millimetres. Values come from the
 * mmmcraft Configurator code (the factory-rule source of truth there), not
 * from its docs, which are partly stale.
 */

/** Groove for the back panel: its rear face sits this far in from the carcass back. */
export const BACK_GROOVE_OFFSET_MM = 16.5
/** How far the back panel reaches into each side's groove. */
export const BACK_GROOVE_DEPTH_MM = 7
/** Horizontal panels stop this far in front of the carcass back
 *  (groove offset + back thickness + 0.5 clearance): 26 for a 9 mm back. */
export function backReductionMm(backThicknessMm: number): number {
  return BACK_GROOVE_OFFSET_MM + backThicknessMm + 0.5
}
/** Clearance subtracted from horizontal panels that sit between two sides:
 *  0.5 mm per side for 15 / 18 mm board, none for 15.5 / 18.5 (mmmcraft
 *  `sidePanelGap`). */
export function horizontalClearanceMm(panelThicknessMm: number): number {
  return panelThicknessMm === 15.5 || panelThicknessMm === 18.5 ? 0 : 1
}

export const END_PANEL_THICKNESS_MM = 18
/** 걸레받이 / 상단몰딩 strip thickness (mmmcraft END_PANEL_THICKNESS). */
export const FRAME_THICKNESS_MM = 18
export const FRONT_THICKNESS_MM = 18
/** Air gap between the carcass front edge and the back of a front. */
export const FRONT_GAP_MM = 1

export const REAR_RAIL_HEIGHT_MM = 60
export const REAR_RAIL_THICKNESS_MM = 15

/** Base-cabinet top bands (front / back strips instead of a solid top). */
export const TOP_BAND_DEPTH_MM = 60
/** Sink-cabinet front stretcher (전대) height. */
export const SINK_FRONT_RAIL_HEIGHT_MM = 150

/** Dowel (adjustable) shelves stop short of the front and are narrower. */
export const DOWEL_SHELF_FRONT_INSET_MM = 20
export const DOWEL_SHELF_WIDTH_CLEARANCE_MM = 2

/** Clothes rod: centre this far below the compartment top. */
export const ROD_DROP_MM = 55
export const ROD_DIAMETER_MM = 25
export const PANTS_HANGER_DROP_MM = 140
export const PANTS_HANGER_HEIGHT_MM = 70

/** Inner drawer system (서랍속장 + 마이다). */
export const INNER_DRAWER = {
  fillerWidthMm: 50,
  fillerThicknessMm: 15,
  fillerSetbackMm: 85,
  overlayProjectionMm: 20,
  sideGapMm: 24,
  gapMm: 24,
  railClearanceMm: 11,
  boxSideThicknessMm: 15,
  boxBottomThicknessMm: 9,
  boxHeightReductionMm: 30,
} as const

/** External (full-front) drawer boxes. */
export const EXTERNAL_DRAWER = {
  runnerClearanceMm: 13,
  boxHeightReductionMm: 60,
  minBoxHeightMm: 60,
  boxSideThicknessMm: 15,
} as const

/** Blum-style runner lengths, longest first. */
export const DRAWER_RAIL_LENGTHS_MM = [550, 500, 450, 400, 350, 300, 250] as const

/** Doors wider than this default to two leaves. */
export const DOUBLE_DOOR_MIN_WIDTH_MM = 600

/** Hinge rule: count by leaf length, cups 120 mm from each end. */
export const HINGE_END_OFFSET_MM = 120
/** mmmcraft sink cabinet: the top hinge sits 300 below the body top. */
export const SINK_TOP_HINGE_INSET_MM = 300
export const HINGE_CUP_DIAMETER_MM = 35
export const HINGE_CUP_DEPTH_MM = 13
export const HINGE_CUP_EDGE_OFFSET_MM = 22.5

export const FOOT_INSET_MM = 50
export const FOOT_FRONT_INSET_MM = 70

/** Smallest clear size a compartment may shrink to. */
export const MIN_CELL_MM = 50

/** Standard slot widths when filling a run (Configurator equal division). */
export const SLOT_MIN_MM = 400
export const SLOT_MAX_MM = 600

export function hingeCount(leafLengthMm: number): number {
  if (leafLengthMm < 900) return 2
  if (leafLengthMm < 1600) return 3
  if (leafLengthMm < 2400) return 4
  return 5
}

/** Hinge cup centres along a leaf, measured from its start (bottom, or left
 *  for a flap). Evenly spaced between the two end hinges. */
export function hingePositionsMm(leafLengthMm: number): number[] {
  const count = hingeCount(leafLengthMm)
  const first = HINGE_END_OFFSET_MM
  const last = leafLengthMm - HINGE_END_OFFSET_MM
  if (last <= first) return [leafLengthMm / 2]
  const step = (last - first) / (count - 1)
  return Array.from({ length: count }, (_, i) => round1(first + step * i))
}

/** Longest runner that fits the available depth (runner + 5 mm). */
export function drawerRailLengthMm(availableDepthMm: number): number | null {
  for (const rail of DRAWER_RAIL_LENGTHS_MM) {
    if (rail + 5 <= availableDepthMm) return rail
  }
  return null
}

export function round1(value: number): number {
  // `+ 0` turns −0 (from negated zero offsets) into 0.
  return Math.round(value * 10) / 10 + 0
}

/** mmmcraft 상판 따내기 (upper cabinets): 340×140 or 680×140. */
export const TOP_NOTCH_DEPTH_MM = 140

/** mmmcraft 인조대리석 상판: 600 deep base + 23 front offset = 623. */
export const COUNTERTOP_DEPTH_MM = 623
