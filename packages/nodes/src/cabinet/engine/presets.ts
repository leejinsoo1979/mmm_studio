import type { CabinetCell, CabinetNode, CellContent, CellFront } from '../schema'
import { cloneWithFreshIds, newCellId } from './tree'

/** Everything a preset decides; placement (position/rotation/parent) is added
 *  by the tool. */
export type CabinetSpec = Pick<
  CabinetNode,
  | 'family'
  | 'variant'
  | 'widthMm'
  | 'heightMm'
  | 'depthMm'
  | 'interior'
  | 'frontReveal'
  | 'toeKick'
  | 'handle'
> &
  Partial<Pick<CabinetNode, 'endPanels' | 'bodyColor' | 'frontColor' | 'handleColor'>>

/**
 * Catalog entry. Ids, names, thumbnails and section layouts follow the
 * mmmcraft module catalog (`src/data/modules/shelving.ts` and the gallery
 * thumbnails in `public/images/furniture-thumbnails`), so a user sees the
 * same modules in both programs. 반통 = one slot, 한통 = two slots.
 */
export type CabinetPreset = {
  id: string
  group: 'wardrobe' | 'shoe' | 'kitchen-base' | 'kitchen-upper' | 'kitchen-tall'
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

const TOE = { enabled: true, heightMm: TOE_H, setbackMm: 20 }
const NO_TOE = { enabled: false, heightMm: TOE_H, setbackMm: 20 }
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
    handle: 'bar',
  }
}

function base(width: number, interior: CabinetCell): CabinetSpec {
  return {
    family: 'base',
    variant: 'standard',
    widthMm: width,
    heightMm: BASE_BODY + TOE_H,
    depthMm: DEPTH,
    interior,
    frontReveal: REVEAL,
    toeKick: TOE,
    handle: 'bar',
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
    handle: 'bar',
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
    description: '4단 서랍·옷장 + 바지걸이(내경 586)',
    thumbnail: thumb('dual-4drawer-pantshanger.png'),
    elevationMm: 0,
    spec: () =>
      tall(
        DUAL_W,
        rowX(
          [
            {
              ...stackY(
                [leaf(innerDrawerFronts(DRAWER4_HEIGHTS)), leaf(hanging), leaf(empty)],
                [DRAWER4_SECTION - 2 * T, null, SAFETY_TOP_BOX],
              ),
              front: door('1'),
            },
            { ...stackY([leaf(pants), leaf(empty)], [null, SAFETY_TOP_BOX]), front: door('1') },
          ],
          [null, PANTSHANGER_W],
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
    description: 'H785 D600, 선반 2',
    thumbnail: thumb('lower-half-cabinet.png'),
    elevationMm: 0,
    spec: () => base(SINGLE_W, leaf(shelves(2), door())),
  },
  {
    id: 'dual-lower-half-cabinet',
    group: 'kitchen-base',
    label: '기본하부장 한통',
    description: 'H785 D600, 선반 2, 양문',
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
    spec: () => ({ ...base(SINGLE_W, leaf(empty, door())), variant: 'sink' }),
  },
  {
    id: 'dual-lower-sink-cabinet',
    group: 'kitchen-base',
    label: '싱크장 한통',
    description: '내부 오픈, 뒷판 없음, 전대 150',
    thumbnail: thumb('dual-lower-sink-cabinet.png'),
    elevationMm: 0,
    spec: () => ({ ...base(DUAL_W, leaf(empty, door())), variant: 'sink' }),
  },
  {
    id: 'lower-induction-cabinet',
    group: 'kitchen-base',
    label: '인덕션장 반통',
    description: '겉서랍 2단',
    thumbnail: thumb('lower-induction-cabinet.png'),
    elevationMm: 0,
    spec: () => ({ ...base(SINGLE_W, leaf(externalDrawers(2))), variant: 'cooktop' }),
  },
  {
    id: 'dual-lower-induction-cabinet',
    group: 'kitchen-base',
    label: '인덕션장 한통',
    description: '겉서랍 2단',
    thumbnail: thumb('dual-lower-induction-cabinet.png'),
    elevationMm: 0,
    spec: () => ({ ...base(DUAL_W, leaf(externalDrawers(2))), variant: 'cooktop' }),
  },
  {
    id: 'lower-drawer-2tier',
    group: 'kitchen-base',
    label: '2단서랍장 반통',
    description: '겉서랍 2단',
    thumbnail: thumb('lower-drawer-2tier.png'),
    elevationMm: 0,
    spec: () => base(SINGLE_W, leaf(externalDrawers(2))),
  },
  {
    id: 'dual-lower-drawer-2tier',
    group: 'kitchen-base',
    label: '2단서랍장 한통',
    description: '겉서랍 2단',
    thumbnail: thumb('dual-lower-drawer-2tier.png'),
    elevationMm: 0,
    spec: () => base(DUAL_W, leaf(externalDrawers(2))),
  },
  {
    id: 'lower-drawer-3tier',
    group: 'kitchen-base',
    label: '3단서랍장 반통',
    description: '겉서랍 3단',
    thumbnail: thumb('lower-drawer-3tier.png'),
    elevationMm: 0,
    spec: () => base(SINGLE_W, leaf(externalDrawers(3))),
  },
  {
    id: 'dual-lower-drawer-3tier',
    group: 'kitchen-base',
    label: '3단서랍장 한통',
    description: '겉서랍 3단',
    thumbnail: thumb('dual-lower-drawer-3tier.png'),
    elevationMm: 0,
    spec: () => base(DUAL_W, leaf(externalDrawers(3))),
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
