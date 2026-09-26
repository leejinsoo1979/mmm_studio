import type { CabinetCell, CabinetNode, CellContent, CellFront } from '../schema'
import { cloneWithFreshIds, newCellId } from './tree'

/** Everything a preset decides; placement (position/rotation/parent) is added
 *  by the tool. */
export type CabinetSpec = Pick<
  CabinetNode,
  'family' | 'variant' | 'widthMm' | 'heightMm' | 'depthMm' | 'interior' | 'frontReveal' | 'toeKick'
> &
  Partial<
    Pick<
      CabinetNode,
      | 'endPanels'
      | 'bodyColor'
      | 'frontColor'
      | 'top'
      | 'topSetbackMm'
      | 'topStretcher'
      | 'channels'
    >
  >

/**
 * Catalog entry. Ids, names, thumbnails and section layouts follow the
 * mmmcraft module catalog (`src/data/modules/shelving.ts` and the gallery
 * thumbnails in `public/images/furniture-thumbnails`), so a user sees the
 * same modules in both programs. 반통 = one slot, 한통 = two slots.
 */
export type CabinetPreset = {
  id: string
  group:
    | 'wardrobe'
    | 'shoe'
    | 'kitchen-base'
    | 'kitchen-lift'
    | 'kitchen-top-down'
    | 'kitchen-upper'
    | 'kitchen-tall'
  label: string
  description: string
  /** Gallery image served from the editor's public folder, when mmmcraft has one. */
  thumbnail?: string
  /** Bottom of the cabinet above the floor (mm) when placed. */
  elevationMm: number
  spec: () => CabinetSpec
}

const thumb = (file: string) => `/furniture-thumbnails/${file}`

const door = (leaves: CellFront['leaves'] = 'auto'): CellFront => ({
  type: 'door',
  leaves,
  hinge: 'auto',
})
const leaf = (content: CellContent, front?: CellFront): CabinetCell =>
  front
    ? { id: newCellId(), kind: 'leaf', content, front }
    : { id: newCellId(), kind: 'leaf', content }
const stackY = (
  children: CabinetCell[],
  sizesMm: (number | null)[],
  front?: CellFront,
): CabinetCell =>
  front
    ? { id: newCellId(), kind: 'split', axis: 'y', children, sizesMm, front }
    : { id: newCellId(), kind: 'split', axis: 'y', children, sizesMm }
const rowX = (children: CabinetCell[], sizesMm?: (number | null)[]): CabinetCell => ({
  id: newCellId(),
  kind: 'split',
  axis: 'x',
  children,
  sizesMm: sizesMm ?? children.map(() => null),
})

const hanging: CellContent = { type: 'hanging', rod: 'rod' }
const pants: CellContent = { type: 'hanging', rod: 'pants' }
const empty: CellContent = { type: 'empty' }
const shelves = (count: number, kind: 'dowel' | 'fixed' = 'dowel'): CellContent => ({
  type: 'shelves',
  count,
  kind,
})
const innerDrawers = (count: number, stepMm: number): CellContent => ({
  type: 'drawers',
  count,
  style: 'inner',
  stepMm,
})
const innerDrawerFronts = (heightsMm: number[]): CellContent => ({
  type: 'drawers',
  count: heightsMm.length,
  style: 'inner',
  stepMm: heightsMm[0] ?? 250,
  heightsMm,
})
/**
 * Two carcasses stacked (mmmcraft 하부장 / 상부장 bodies). `lowerOuterMm` is
 * mmmcraft's section height — the whole lower body, its bottom and top
 * panels included — so the lower compartment is that minus two boards.
 */
const bodies = (
  lowerOuterMm: number,
  lower: CabinetCell,
  upper: CabinetCell,
  front?: CellFront,
): CabinetCell => {
  const cell: CabinetCell = {
    id: newCellId(),
    kind: 'split',
    axis: 'y',
    joint: 'stack',
    children: [lower, upper],
    sizesMm: [lowerOuterMm - 2 * T, null],
  }
  return front ? { ...cell, front } : cell
}
/** Hanging space with the safety shelf's top box above it. */
const hangingWithSafetyShelf = () => stackY([leaf(hanging), leaf(empty)], [null, SAFETY_TOP_BOX])
const externalDrawers = (count: number): CellContent => ({
  type: 'drawers',
  count,
  style: 'external',
  stepMm: 250,
})

// mmmcraft FURNITURE_SPECS
const SINGLE_W = 600
const DUAL_W = 1200
const TALL_H = 2300
const DEPTH = 600
const ENTRYWAY_DEPTH = 380
/** Board thickness the section heights below are converted with. */
const T = 18
/** Drawer section heights (outer, panels included): 2-drawer 600, 4-drawer 1000. */
const DRAWER2_SECTION = 600
const DRAWER4_SECTION = 1000
/** mmmcraft DRAWER_HEIGHTS_2TIER / _4TIER, bottom → top. */
const DRAWER2_HEIGHTS = [255, 255]
const DRAWER4_HEIGHTS = [255, 255, 176, 176]
/** Short hanging section of 붙박이장 B. */
const TYPE2_BOTTOM = 1000
/** Safety shelf: 2050 mm, but at least 200 mm clear above it → a 200 mm top box at 2300. */
const SAFETY_TOP_BOX = 200
const STYLER_W = 694
const PANTSHANGER_W = 586
const ENTRYWAY_BOTTOM = 1200
const ENTRYWAY_DRAWER_ZONE = 206
const PANTRY_SECTION1 = 1825
/** Base cabinets: 785 body on 65 feet/toe kick = 850 before the top. */
const BASE_BODY = 785
const TOE_H = 65
const UPPER_H = 785
const UPPER_DEPTH = 300
/** Upper cabinets hang with their top on the tall-cabinet line. */
const UPPER_ELEVATION = TALL_H - UPPER_H

const FRAME_WIDTH = { enabled: false, leftMm: 0, rightMm: 0 }
const TOE = {
  enabled: true,
  heightMm: TOE_H,
  setbackMm: 20,
  offsetMm: 0,
  gapMm: 0,
  widthAdjust: FRAME_WIDTH,
}
const NO_TOE = { ...TOE, enabled: false }
const REVEAL = { top: 1.5, bottom: 1.5, side: 1.5, between: 3 }
/** Upper-cabinet doors are H + 5 + 28: 5 above the carcass, 28 below as a finger pull. */
const UPPER_REVEAL = { top: -5, bottom: -28, side: 1.5, between: 3 }

function tall(width: number, interior: CabinetCell, depth = DEPTH): CabinetSpec {
  return {
    family: 'tall',
    variant: 'standard',
    widthMm: width,
    heightMm: TALL_H,
    depthMm: depth,
    interior,
    frontReveal: REVEAL,
    toeKick: TOE,
  }
}

type Channel = CabinetNode['channels'][number]
/** A 40-deep 목찬넬 notch, from the carcass bottom; the rail behind it
 *  defaults to the notch height, `null` = no rail. */
const channel = (
  fromBottomMm: number,
  heightMm: number,
  railHeightMm: number | null = heightMm,
): Channel => ({
  fromBottomMm,
  heightMm,
  depthMm: 40,
  frame: true,
  railHeightMm,
})
/** External drawers with mmmcraft's front ranges and box positions (mm from
 *  the carcass bottom). */
const drawerFronts = (frontsMm: [number, number][], boxesMm: [number, number][]): CellContent => ({
  type: 'drawers',
  count: frontsMm.length,
  style: 'external',
  stepMm: 250,
  frontsMm,
  boxesMm,
})

/** mmmcraft 기본하부장: open top under a 60×40 top channel (L-frame + rail),
 *  doors 20 short of the top and 5 past the bottom. Handleless. */
function base(width: number, interior: CabinetCell, topRailMm = 60): CabinetSpec {
  return {
    family: 'base',
    variant: 'standard',
    widthMm: width,
    heightMm: BASE_BODY + TOE_H,
    depthMm: DEPTH,
    interior,
    frontReveal: { top: 20, bottom: -5, side: 1.5, between: 3 },
    toeKick: TOE,
    top: 'none',
    channels: [channel(BASE_BODY - 60, 60, topRailMm)],
  }
}

/** mmmcraft 기본장 서랍장: 65-high channels between the drawers under the
 *  60 top channel; each front runs from 5 below the channel under it to 40
 *  into the one above, each box sits 15 above the board or channel below. */
function drawerBase(width: number, tiers: 2 | 3): CabinetSpec {
  const fronts: [number, number][] =
    tiers === 3
      ? [
          [-5, 335],
          [355, 550],
          [570, 765],
        ]
      : [
          [-5, 370],
          [390, 765],
        ]
  const boxes: [number, number][] =
    tiers === 3
      ? [
          [33, 240],
          [375, 130],
          [590, 130],
        ]
      : [
          [33, 240],
          [410, 240],
        ]
  const mid = tiers === 3 ? [channel(295, 65), channel(510, 65)] : [channel(330, 65)]
  const spec = base(width, leaf(drawerFronts(fronts, boxes)))
  return { ...spec, channels: [...mid, ...(spec.channels ?? [])] }
}

/** 도어올림: solid top, fronts rise 30 above the carcass (lift gap under the
 *  countertop), 65×40 channels between drawer fronts. */
function doorLift(width: number, interior: CabinetCell, channels: Channel[] = []): CabinetSpec {
  return {
    ...base(width, interior),
    frontReveal: { top: -30, bottom: -5, side: 1.5, between: 3 },
    top: 'solid',
    channels,
  }
}

/** 상판내림 (20 mm stone): top set back 18.5 behind a 55 stretcher, fronts end
 *  80 below the carcass top under the stone's front apron, and a 665 channel
 *  (L-frame only — the stretcher sits where its rail would be). */
function topDown(width: number, interior: CabinetCell, lowerChannels: Channel[] = []): CabinetSpec {
  return {
    ...base(width, interior),
    frontReveal: { top: 80, bottom: -5, side: 1.5, between: 3 },
    top: 'solid',
    topSetbackMm: 18.5,
    topStretcher: { heightMm: 55, setbackMm: 0 },
    channels: [...lowerChannels, channel(665, 65, null)],
  }
}

function upper(width: number, interior: CabinetCell): CabinetSpec {
  return {
    family: 'upper',
    variant: 'standard',
    widthMm: width,
    heightMm: UPPER_H,
    depthMm: UPPER_DEPTH,
    interior,
    frontReveal: UPPER_REVEAL,
    toeKick: NO_TOE,
  }
}

// Section layouts (bottom → top), one per mmmcraft module family.
const coat = () =>
  bodies(
    DRAWER2_SECTION,
    leaf(innerDrawerFronts(DRAWER2_HEIGHTS)),
    hangingWithSafetyShelf(),
    door(),
  )
const typeB = () => bodies(TYPE2_BOTTOM, leaf(hanging), hangingWithSafetyShelf(), door())
const typeD = () =>
  bodies(
    DRAWER4_SECTION,
    leaf(innerDrawerFronts(DRAWER4_HEIGHTS)),
    hangingWithSafetyShelf(),
    door(),
  )
const shelfCabinet = () => bodies(TYPE2_BOTTOM, leaf(shelves(2)), leaf(shelves(3)), door())
const shelfWithDrawers = (count: 2 | 4) =>
  bodies(
    count === 2 ? DRAWER2_SECTION : DRAWER4_SECTION,
    leaf(innerDrawerFronts(count === 2 ? DRAWER2_HEIGHTS : DRAWER4_HEIGHTS)),
    leaf(shelves(3)),
    door(),
  )
/** 현관장 H: lower body 1200 (shoe shelves under a 206 drawer zone — the
 *  support board plus the drawer), upper body with shelves. */
const entrywayH = () =>
  bodies(
    ENTRYWAY_BOTTOM,
    stackY(
      [leaf(shelves(3)), leaf(innerDrawers(1, ENTRYWAY_DRAWER_ZONE - T - 24))],
      [null, ENTRYWAY_DRAWER_ZONE - T],
    ),
    leaf(shelves(4)),
    door(),
  )

export const CABINET_PRESETS: CabinetPreset[] = [
  // ── 옷장 ────────────────────────────────────────────────────────────
  {
    id: 'single-2drawer-hanging',
    group: 'wardrobe',
    label: '코트장 반통',
    description: '하단 2단 서랍 + 상단 옷장',
    thumbnail: thumb('single-2drawer-hanging.png'),
    elevationMm: 0,
    spec: () => tall(SINGLE_W, coat()),
  },
  {
    id: 'dual-2drawer-hanging',
    group: 'wardrobe',
    label: '코트장 한통',
    description: '하단 2단 서랍 + 상단 옷장',
    thumbnail: thumb('dual-2drawer-hanging.png'),
    elevationMm: 0,
    spec: () => tall(DUAL_W, coat()),
  },
  {
    id: 'single-2hanging',
    group: 'wardrobe',
    label: '붙박이장 B 반통',
    description: '하단 짧은옷 + 상단 긴옷',
    thumbnail: thumb('single-2hanging.png'),
    elevationMm: 0,
    spec: () => tall(SINGLE_W, typeB()),
  },
  {
    id: 'dual-2hanging',
    group: 'wardrobe',
    label: '붙박이장 B 한통',
    description: '하단 짧은옷 + 상단 긴옷',
    thumbnail: thumb('dual-2hanging.png'),
    elevationMm: 0,
    spec: () => tall(DUAL_W, typeB()),
  },
  {
    id: 'single-4drawer-hanging',
    group: 'wardrobe',
    label: '붙박이장 D 반통',
    description: '4단 서랍 + 옷장',
    thumbnail: thumb('single-4drawer-hanging.png'),
    elevationMm: 0,
    spec: () => tall(SINGLE_W, typeD()),
  },
  {
    id: 'dual-4drawer-hanging',
    group: 'wardrobe',
    label: '붙박이장 D 한통',
    description: '4단 서랍 + 옷장',
    thumbnail: thumb('dual-4drawer-hanging.png'),
    elevationMm: 0,
    spec: () => tall(DUAL_W, typeD()),
  },
  {
    id: 'dual-2drawer-styler',
    group: 'wardrobe',
    label: '스타일러장',
    description: '2단 서랍·옷장 + 스타일러 자리(내경 694)',
    thumbnail: thumb('dual-2drawer-styler.png'),
    elevationMm: 0,
    spec: () =>
      tall(
        DUAL_W,
        rowX(
          [
            {
              ...stackY(
                [leaf(innerDrawerFronts(DRAWER2_HEIGHTS)), leaf(hanging), leaf(empty)],
                [DRAWER2_SECTION - 2 * T, null, SAFETY_TOP_BOX],
              ),
              front: door('1'),
            },
            { ...stackY([leaf(empty), leaf(empty)], [null, SAFETY_TOP_BOX]), front: door('1') },
          ],
          [null, STYLER_W],
        ),
      ),
  },
  {
    id: 'dual-4drawer-pantshanger',
    group: 'wardrobe',
    label: '바지걸이장',
    description: '하부 4단 서랍 + 바지걸이(내경 586), 상부 옷장',
    thumbnail: thumb('dual-4drawer-pantshanger.png'),
    elevationMm: 0,
    spec: () =>
      tall(
        DUAL_W,
        // mmmcraft DualType6: lower body 1000 (4 drawers | pants hanger 586),
        // upper body hanging on both sides under one shared safety shelf.
        bodies(
          DRAWER4_SECTION,
          rowX([leaf(innerDrawerFronts(DRAWER4_HEIGHTS)), leaf(pants)], [null, PANTSHANGER_W]),
          stackY(
            [rowX([leaf(hanging), leaf(hanging)], [null, PANTSHANGER_W]), leaf(empty)],
            [null, SAFETY_TOP_BOX],
          ),
          door('2'),
        ),
      ),
  },

  // ── 선반장 · 현관장 ──────────────────────────────────────────────────
  {
    id: 'single-shelf',
    group: 'shoe',
    label: '선반장 반통',
    description: '하단 선반 2 + 상단 선반 3',
    thumbnail: thumb('9.png'),
    elevationMm: 0,
    spec: () => tall(SINGLE_W, shelfCabinet()),
  },
  {
    id: 'dual-shelf',
    group: 'shoe',
    label: '선반장 한통',
    description: '하단 선반 2 + 상단 선반 3',
    thumbnail: thumb('20.png'),
    elevationMm: 0,
    spec: () => tall(DUAL_W, shelfCabinet()),
  },
  {
    id: 'single-2drawer-shelf',
    group: 'shoe',
    label: '선반장+2단서랍 반통',
    description: '2단 서랍 + 선반',
    thumbnail: thumb('7.png'),
    elevationMm: 0,
    spec: () => tall(SINGLE_W, shelfWithDrawers(2)),
  },
  {
    id: 'dual-2drawer-shelf',
    group: 'shoe',
    label: '선반장+2단서랍 한통',
    description: '2단 서랍 + 선반',
    thumbnail: thumb('19.png'),
    elevationMm: 0,
    spec: () => tall(DUAL_W, shelfWithDrawers(2)),
  },
  {
    id: 'single-4drawer-shelf',
    group: 'shoe',
    label: '선반장+4단서랍 반통',
    description: '4단 서랍 + 선반',
    thumbnail: thumb('8.png'),
    elevationMm: 0,
    spec: () => tall(SINGLE_W, shelfWithDrawers(4)),
  },
  {
    id: 'dual-4drawer-shelf',
    group: 'shoe',
    label: '선반장+4단서랍 한통',
    description: '4단 서랍 + 선반',
    thumbnail: thumb('18.png'),
    elevationMm: 0,
    spec: () => tall(DUAL_W, shelfWithDrawers(4)),
  },
  {
    id: 'single-entryway-h',
    group: 'shoe',
    label: '현관장 H 반통',
    description: '하단 신발장(1200) + 서랍 + 상단 다보선반, 깊이 380',
    thumbnail: thumb('entrance_single-H.png'),
    elevationMm: 0,
    spec: () => tall(SINGLE_W, entrywayH(), ENTRYWAY_DEPTH),
  },
  {
    id: 'dual-entryway-h',
    group: 'shoe',
    label: '현관장 H 한통',
    description: '하단 신발장(1200) + 서랍 + 상단 다보선반, 깊이 380',
    thumbnail: thumb('entrance_duel-H.png'),
    elevationMm: 0,
    spec: () => tall(DUAL_W, entrywayH(), ENTRYWAY_DEPTH),
  },

  // ── 주방 하부장 ─────────────────────────────────────────────────────
  {
    id: 'lower-half-cabinet',
    group: 'kitchen-base',
    label: '기본하부장 반통',
    description: 'H785 D600, 선반 2, 상단 목찬넬',
    thumbnail: thumb('lower-half-cabinet.png'),
    elevationMm: 0,
    spec: () => base(SINGLE_W, leaf(shelves(2), door())),
  },
  {
    id: 'dual-lower-half-cabinet',
    group: 'kitchen-base',
    label: '기본하부장 한통',
    description: 'H785 D600, 선반 2, 상단 목찬넬',
    thumbnail: thumb('dual-lower-half-cabinet.png'),
    elevationMm: 0,
    spec: () => base(DUAL_W, leaf(shelves(2), door())),
  },
  {
    id: 'lower-sink-cabinet',
    group: 'kitchen-base',
    label: '싱크장 반통',
    description: '내부 오픈, 뒷판 없음, 전대 150',
    thumbnail: thumb('lower-sink-cabinet.png'),
    elevationMm: 0,
    spec: () => ({ ...base(SINGLE_W, leaf(empty, door()), 150), variant: 'sink' }),
  },
  {
    id: 'dual-lower-sink-cabinet',
    group: 'kitchen-base',
    label: '싱크장 한통',
    description: '내부 오픈, 뒷판 없음, 전대 150',
    thumbnail: thumb('dual-lower-sink-cabinet.png'),
    elevationMm: 0,
    spec: () => ({ ...base(DUAL_W, leaf(empty, door()), 150), variant: 'sink' }),
  },
  {
    id: 'lower-induction-cabinet',
    group: 'kitchen-base',
    label: '인덕션장 반통',
    description: '겉서랍 2단, 전대 150',
    thumbnail: thumb('lower-induction-cabinet.png'),
    elevationMm: 0,
    spec: () => ({ ...base(SINGLE_W, leaf(externalDrawers(2)), 150), variant: 'cooktop' }),
  },
  {
    id: 'dual-lower-induction-cabinet',
    group: 'kitchen-base',
    label: '인덕션장 한통',
    description: '겉서랍 2단, 전대 150',
    thumbnail: thumb('dual-lower-induction-cabinet.png'),
    elevationMm: 0,
    spec: () => ({ ...base(DUAL_W, leaf(externalDrawers(2)), 150), variant: 'cooktop' }),
  },
  {
    id: 'lower-drawer-2tier',
    group: 'kitchen-base',
    label: '2단서랍장 반통',
    description: '목찬넬 330, 앞판 375·375',
    thumbnail: thumb('lower-drawer-2tier.png'),
    elevationMm: 0,
    spec: () => drawerBase(SINGLE_W, 2),
  },
  {
    id: 'dual-lower-drawer-2tier',
    group: 'kitchen-base',
    label: '2단서랍장 한통',
    description: '목찬넬 330, 앞판 375·375',
    thumbnail: thumb('dual-lower-drawer-2tier.png'),
    elevationMm: 0,
    spec: () => drawerBase(DUAL_W, 2),
  },
  {
    id: 'lower-drawer-3tier',
    group: 'kitchen-base',
    label: '3단서랍장 반통',
    description: '목찬넬 295·510, 앞판 340·195·195',
    thumbnail: thumb('lower-drawer-3tier.png'),
    elevationMm: 0,
    spec: () => drawerBase(SINGLE_W, 3),
  },
  {
    id: 'dual-lower-drawer-3tier',
    group: 'kitchen-base',
    label: '3단서랍장 한통',
    description: '목찬넬 295·510, 앞판 340·195·195',
    thumbnail: thumb('dual-lower-drawer-3tier.png'),
    elevationMm: 0,
    spec: () => drawerBase(DUAL_W, 3),
  },
  {
    id: 'lower-dishwasher-cabinet',
    group: 'kitchen-base',
    label: '식세기장 반통',
    description: '조절발·바닥판·백패널 없음',
    elevationMm: 0,
    spec: () => ({
      ...base(SINGLE_W, leaf(empty, { type: 'panel', leaves: '1', hinge: 'auto' })),
      variant: 'dishwasher',
    }),
  },
  {
    id: 'lower-door-lift-half',
    group: 'kitchen-lift',
    label: '도어올림 반통',
    description: '도어가 상판 쪽으로 30 올라옴, 선반 2',
    thumbnail: thumb('lower-door-lift-half.png'),
    elevationMm: 0,
    spec: () => doorLift(SINGLE_W, leaf(shelves(2), door())),
  },
  {
    id: 'dual-lower-door-lift-half',
    group: 'kitchen-lift',
    label: '도어올림 한통',
    description: '도어가 상판 쪽으로 30 올라옴, 선반 2',
    thumbnail: thumb('dual-lower-door-lift-half.png'),
    elevationMm: 0,
    spec: () => doorLift(DUAL_W, leaf(shelves(2), door())),
  },
  {
    id: 'lower-door-lift-2tier',
    group: 'kitchen-lift',
    label: '도어올림 2단 반통',
    description: '목찬넬 355, 앞판 400·400',
    thumbnail: thumb('lower-door-lift-2tier.png'),
    elevationMm: 0,
    spec: () =>
      doorLift(
        SINGLE_W,
        leaf(
          drawerFronts(
            [
              [-5, 395],
              [415, 815],
            ],
            [
              [33, 240],
              [435, 240],
            ],
          ),
        ),
        [channel(355, 65)],
      ),
  },
  {
    id: 'dual-lower-door-lift-2tier',
    group: 'kitchen-lift',
    label: '도어올림 2단 한통',
    description: '목찬넬 355, 앞판 400·400',
    thumbnail: thumb('dual-lower-door-lift-2tier.png'),
    elevationMm: 0,
    spec: () =>
      doorLift(
        DUAL_W,
        leaf(
          drawerFronts(
            [
              [-5, 395],
              [415, 815],
            ],
            [
              [33, 240],
              [435, 240],
            ],
          ),
        ),
        [channel(355, 65)],
      ),
  },
  {
    id: 'lower-door-lift-3tier',
    group: 'kitchen-lift',
    label: '도어올림 3단 반통',
    description: '목찬넬 315·545, 앞판 360·210·210',
    thumbnail: thumb('lower-door-lift-3tier.png'),
    elevationMm: 0,
    spec: () =>
      doorLift(
        SINGLE_W,
        leaf(
          drawerFronts(
            [
              [-5, 355],
              [375, 585],
              [605, 815],
            ],
            [
              [33, 240],
              [395, 130],
              [625, 130],
            ],
          ),
        ),
        [channel(315, 65), channel(545, 65)],
      ),
  },
  {
    id: 'dual-lower-door-lift-3tier',
    group: 'kitchen-lift',
    label: '도어올림 3단 한통',
    description: '목찬넬 315·545, 앞판 360·210·210',
    thumbnail: thumb('dual-lower-door-lift-3tier.png'),
    elevationMm: 0,
    spec: () =>
      doorLift(
        DUAL_W,
        leaf(
          drawerFronts(
            [
              [-5, 355],
              [375, 585],
              [605, 815],
            ],
            [
              [33, 240],
              [395, 130],
              [625, 130],
            ],
          ),
        ),
        [channel(315, 65), channel(545, 65)],
      ),
  },
  {
    id: 'lower-door-lift-touch-2tier-a',
    group: 'kitchen-lift',
    label: '도어올림터치2단A 반통',
    description: '푸시 오픈, 앞판 409·408',
    thumbnail: thumb('lower-door-lift-touch-2tier-a.png'),
    elevationMm: 0,
    spec: () =>
      doorLift(
        SINGLE_W,
        leaf(
          drawerFronts(
            [
              [-5, 404],
              [407, 815],
            ],
            [
              [46, 228],
              [424, 228],
            ],
          ),
        ),
      ),
  },
  {
    id: 'dual-lower-door-lift-touch-2tier-a',
    group: 'kitchen-lift',
    label: '도어올림터치2단A 한통',
    description: '푸시 오픈, 앞판 409·408',
    thumbnail: thumb('dual-lower-door-lift-touch-2tier-a.png'),
    elevationMm: 0,
    spec: () =>
      doorLift(
        DUAL_W,
        leaf(
          drawerFronts(
            [
              [-5, 404],
              [407, 815],
            ],
            [
              [46, 228],
              [424, 228],
            ],
          ),
        ),
      ),
  },
  {
    id: 'lower-door-lift-touch-2tier-b',
    group: 'kitchen-lift',
    label: '도어올림터치2단B 반통',
    description: '푸시 오픈, 서랍 228·164',
    thumbnail: thumb('lower-door-lift-touch-2tier-b.png'),
    elevationMm: 0,
    spec: () =>
      doorLift(
        SINGLE_W,
        leaf(
          drawerFronts(
            [
              [-5, 404],
              [407, 815],
            ],
            [
              [46, 228],
              [424, 164],
            ],
          ),
        ),
      ),
  },
  {
    id: 'dual-lower-door-lift-touch-2tier-b',
    group: 'kitchen-lift',
    label: '도어올림터치2단B 한통',
    description: '푸시 오픈, 서랍 228·164',
    thumbnail: thumb('dual-lower-door-lift-touch-2tier-b.png'),
    elevationMm: 0,
    spec: () =>
      doorLift(
        DUAL_W,
        leaf(
          drawerFronts(
            [
              [-5, 404],
              [407, 815],
            ],
            [
              [46, 228],
              [424, 164],
            ],
          ),
        ),
      ),
  },
  {
    id: 'lower-door-lift-touch-3tier',
    group: 'kitchen-lift',
    label: '도어올림터치3단 반통',
    description: '푸시 오픈, 앞판 360·227·227',
    thumbnail: thumb('lower-door-lift-touch-3tier.png'),
    elevationMm: 0,
    spec: () =>
      doorLift(
        SINGLE_W,
        leaf(
          drawerFronts(
            [
              [-5, 355],
              [358, 585],
              [588, 815],
            ],
            [
              [46, 228],
              [375, 117],
              [605, 117],
            ],
          ),
        ),
      ),
  },
  {
    id: 'dual-lower-door-lift-touch-3tier',
    group: 'kitchen-lift',
    label: '도어올림터치3단 한통',
    description: '푸시 오픈, 앞판 360·227·227',
    thumbnail: thumb('dual-lower-door-lift-touch-3tier.png'),
    elevationMm: 0,
    spec: () =>
      doorLift(
        DUAL_W,
        leaf(
          drawerFronts(
            [
              [-5, 355],
              [358, 585],
              [588, 815],
            ],
            [
              [46, 228],
              [375, 117],
              [605, 117],
            ],
          ),
        ),
      ),
  },
  {
    id: 'lower-top-down-half',
    group: 'kitchen-top-down',
    label: '상판내림 반통',
    description: '상판 앞판 아래 도어 710, 선반 2',
    thumbnail: thumb('lower-top-down-half.png'),
    elevationMm: 0,
    spec: () => topDown(SINGLE_W, leaf(shelves(2), door())),
  },
  {
    id: 'dual-lower-top-down-half',
    group: 'kitchen-top-down',
    label: '상판내림 한통',
    description: '상판 앞판 아래 도어 710, 선반 2',
    thumbnail: thumb('dual-lower-top-down-half.png'),
    elevationMm: 0,
    spec: () => topDown(DUAL_W, leaf(shelves(2), door())),
  },
  {
    id: 'lower-top-down-2tier',
    group: 'kitchen-top-down',
    label: '상판내림 2단 반통',
    description: '목찬넬 300·665, 앞판 345·345',
    thumbnail: thumb('lower-top-down-2tier.png'),
    elevationMm: 0,
    spec: () =>
      topDown(
        SINGLE_W,
        leaf(
          drawerFronts(
            [
              [-5, 340],
              [360, 705],
            ],
            [
              [33, 240],
              [380, 240],
            ],
          ),
        ),
        [channel(300, 65)],
      ),
  },
  {
    id: 'dual-lower-top-down-2tier',
    group: 'kitchen-top-down',
    label: '상판내림 2단 한통',
    description: '목찬넬 300·665, 앞판 345·345',
    thumbnail: thumb('dual-lower-top-down-2tier.png'),
    elevationMm: 0,
    spec: () =>
      topDown(
        DUAL_W,
        leaf(
          drawerFronts(
            [
              [-5, 340],
              [360, 705],
            ],
            [
              [33, 240],
              [380, 240],
            ],
          ),
        ),
        [channel(300, 65)],
      ),
  },
  {
    id: 'lower-top-down-3tier',
    group: 'kitchen-top-down',
    label: '상판내림 3단 반통',
    description: '목찬넬 225·445·665, 앞판 270·200·200',
    thumbnail: thumb('lower-top-down-3tier.png'),
    elevationMm: 0,
    spec: () =>
      topDown(
        SINGLE_W,
        leaf(
          drawerFronts(
            [
              [-5, 265],
              [285, 485],
              [505, 705],
            ],
            [
              [33, 180],
              [305, 130],
              [525, 130],
            ],
          ),
        ),
        [channel(225, 65), channel(445, 65)],
      ),
  },
  {
    id: 'dual-lower-top-down-3tier',
    group: 'kitchen-top-down',
    label: '상판내림 3단 한통',
    description: '목찬넬 225·445·665, 앞판 270·200·200',
    thumbnail: thumb('dual-lower-top-down-3tier.png'),
    elevationMm: 0,
    spec: () =>
      topDown(
        DUAL_W,
        leaf(
          drawerFronts(
            [
              [-5, 265],
              [285, 485],
              [505, 705],
            ],
            [
              [33, 180],
              [305, 130],
              [525, 130],
            ],
          ),
        ),
        [channel(225, 65), channel(445, 65)],
      ),
  },
  {
    id: 'lower-top-down-touch-2tier',
    group: 'kitchen-top-down',
    label: '상판내림터치2단 반통',
    description: '푸시 오픈, 앞판 354·353',
    thumbnail: thumb('lower-top-down-touch-2tier.png'),
    elevationMm: 0,
    spec: () =>
      topDown(
        SINGLE_W,
        leaf(
          drawerFronts(
            [
              [-5, 349],
              [352, 705],
            ],
            [
              [46, 228],
              [374, 228],
            ],
          ),
        ),
      ),
  },
  {
    id: 'dual-lower-top-down-touch-2tier',
    group: 'kitchen-top-down',
    label: '상판내림터치2단 한통',
    description: '푸시 오픈, 앞판 354·353',
    thumbnail: thumb('dual-lower-top-down-touch-2tier.png'),
    elevationMm: 0,
    spec: () =>
      topDown(
        DUAL_W,
        leaf(
          drawerFronts(
            [
              [-5, 349],
              [352, 705],
            ],
            [
              [46, 228],
              [374, 228],
            ],
          ),
        ),
      ),
  },
  {
    id: 'lower-top-down-touch-3tier',
    group: 'kitchen-top-down',
    label: '상판내림터치3단 반통',
    description: '푸시 오픈, 앞판 186·259·259',
    thumbnail: thumb('lower-top-down-touch-3tier.png'),
    elevationMm: 0,
    spec: () =>
      topDown(
        SINGLE_W,
        leaf(
          drawerFronts(
            [
              [-5, 181],
              [184, 443],
              [446, 705],
            ],
            [
              [46, 164],
              [184.4, 164],
              [456, 164],
            ],
          ),
        ),
      ),
  },
  {
    id: 'dual-lower-top-down-touch-3tier',
    group: 'kitchen-top-down',
    label: '상판내림터치3단 한통',
    description: '푸시 오픈, 앞판 186·259·259',
    thumbnail: thumb('dual-lower-top-down-touch-3tier.png'),
    elevationMm: 0,
    spec: () =>
      topDown(
        DUAL_W,
        leaf(
          drawerFronts(
            [
              [-5, 181],
              [184, 443],
              [446, 705],
            ],
            [
              [46, 164],
              [184.4, 164],
              [456, 164],
            ],
          ),
        ),
      ),
  },

  // ── 주방 상부장 ─────────────────────────────────────────────────────
  {
    id: 'upper-cabinet-open',
    group: 'kitchen-upper',
    label: '상부장 기본 반통',
    description: 'H785 D300',
    thumbnail: thumb('upper-cabinet-open.png'),
    elevationMm: UPPER_ELEVATION,
    spec: () => upper(SINGLE_W, leaf(empty, door())),
  },
  {
    id: 'upper-cabinet-2tier',
    group: 'kitchen-upper',
    label: '상부장 2단형 반통',
    description: '중간 선반 1',
    thumbnail: thumb('upper-cabinet-2tier.png'),
    elevationMm: UPPER_ELEVATION,
    spec: () => upper(SINGLE_W, leaf(shelves(1), door())),
  },
  {
    id: 'upper-cabinet-shelf',
    group: 'kitchen-upper',
    label: '상부장 3단형 반통',
    description: '선반 2',
    thumbnail: thumb('upper-cabinet-shelf.png'),
    elevationMm: UPPER_ELEVATION,
    spec: () => upper(SINGLE_W, leaf(shelves(2), door())),
  },
  {
    id: 'upper-cabinet-mixed',
    group: 'kitchen-upper',
    label: '상부장 혼합형 반통',
    description: '하단 선반 + 상단 오픈',
    thumbnail: thumb('upper-cabinet-mixed.png'),
    elevationMm: UPPER_ELEVATION,
    spec: () => upper(SINGLE_W, stackY([leaf(shelves(1)), leaf(empty)], [null, null])),
  },
  {
    id: 'dual-upper-cabinet-open',
    group: 'kitchen-upper',
    label: '상부장 기본 한통',
    description: 'H785 D300, 양문',
    thumbnail: thumb('dual-upper-cabinet-open.png'),
    elevationMm: UPPER_ELEVATION,
    spec: () => upper(DUAL_W, leaf(empty, door())),
  },
  {
    id: 'dual-upper-cabinet-2tier',
    group: 'kitchen-upper',
    label: '상부장 2단형 한통',
    description: '중간 선반 1, 양문',
    thumbnail: thumb('dual-upper-cabinet-2tier.png'),
    elevationMm: UPPER_ELEVATION,
    spec: () => upper(DUAL_W, leaf(shelves(1), door())),
  },
  {
    id: 'dual-upper-cabinet-shelf',
    group: 'kitchen-upper',
    label: '상부장 3단형 한통',
    description: '선반 2, 양문',
    thumbnail: thumb('dual-upper-cabinet-shelf.png'),
    elevationMm: UPPER_ELEVATION,
    spec: () => upper(DUAL_W, leaf(shelves(2), door())),
  },
  {
    id: 'dual-upper-cabinet-mixed',
    group: 'kitchen-upper',
    label: '상부장 혼합형 한통',
    description: '하단 선반 + 상단 오픈',
    thumbnail: thumb('dual-upper-cabinet-mixed.png'),
    elevationMm: UPPER_ELEVATION,
    spec: () => upper(DUAL_W, stackY([leaf(shelves(1)), leaf(empty)], [null, null])),
  },

  // ── 키큰장 ──────────────────────────────────────────────────────────
  {
    id: 'single-pantry-cabinet',
    group: 'kitchen-tall',
    label: '팬트리장',
    description: '1단 오픈(1825) + 2단 다보선반',
    thumbnail: thumb('pantry.png'),
    elevationMm: 0,
    spec: () => tall(SINGLE_W, bodies(PANTRY_SECTION1, leaf(empty), leaf(shelves(1)), door())),
  },
  {
    id: 'single-fridge-cabinet',
    group: 'kitchen-tall',
    label: '냉장고장',
    description: '1단 냉장고 자리(1825, 백패널 없음) + 2단 다보선반',
    thumbnail: thumb('single_builtin.png'),
    elevationMm: 0,
    spec: () =>
      tall(
        SINGLE_W,
        bodies(PANTRY_SECTION1, { ...leaf(empty), hasBack: false }, leaf(shelves(1), door())),
      ),
  },
]

export function getCabinetPreset(id: string): CabinetPreset | undefined {
  return CABINET_PRESETS.find((preset) => preset.id === id)
}

/** A spec with fresh cell ids and the root renamed `root` — use it whenever a
 *  spec is turned into a scene node (a saved module's ids may repeat). */
export function instantiateSpec(spec: CabinetSpec): CabinetSpec {
  return { ...spec, interior: cloneWithFreshIds(spec.interior, 'root') }
}
