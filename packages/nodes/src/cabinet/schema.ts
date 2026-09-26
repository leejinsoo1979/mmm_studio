import { BaseNode, nodeType, objectId } from '@pascal-app/core/schema'
import { z } from 'zod'

/**
 * Built-in wardrobe (붙박이장) / kitchen cabinet (주방가구) schema.
 *
 * Manufacturing sizes are integer-friendly millimetres (`*Mm` fields); only the
 * scene placement (`position`, `rotation`) is in metres like every other node.
 * Keeping mm here means the panel list comes out exactly as a factory cuts it
 * — no float drift from repeated m↔mm conversion.
 *
 * Local frame (used by the part engine and the 3D/2D builders): origin at the
 * footprint centre on the cabinet's bottom, +X right, +Y up, +Z towards the
 * front (doors face +Z).
 */

/** `#rrggbb` only — these strings reach material constructors and cross the
 *  scene API boundary. */
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/** mmmcraft 폭확장 of the 걸레받이 / 상단몰딩 strips (mm, + widens). */
const FrameWidthAdjust = z.object({
  enabled: z.boolean().default(false),
  leftMm: z.number().min(-500).max(500).default(0),
  rightMm: z.number().min(-500).max(500).default(0),
})

export const CabinetFamily = z.enum(['tall', 'base', 'upper'])
export type CabinetFamily = z.infer<typeof CabinetFamily>

/** Construction exceptions, declared explicitly instead of being inferred
 *  from an id or name. */
export const CabinetVariant = z.enum(['standard', 'sink', 'dishwasher', 'cooktop', 'appliance'])
export type CabinetVariant = z.infer<typeof CabinetVariant>

export const CellContent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('empty') }),
  z.object({
    type: z.literal('shelves'),
    count: z.number().int().min(0).max(12).default(2),
    kind: z.enum(['dowel', 'fixed']).default('dowel'),
    /** mmmcraft 칸 내경: shelf centres (mm above the compartment floor),
     *  one per shelf. Absent (or the wrong length) = evenly spaced. */
    positionsMm: z.array(z.number()).optional(),
    /** mmmcraft 다보보링 추가: extra pin holes 32 mm apart above and below
     *  each movable shelf. */
    extraDowels: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    type: z.literal('hanging'),
    rod: z.enum(['rod', 'pants']).default('rod'),
    /** mmmcraft 옷봉선반: a fixed shelf this far (mm) below the compartment
     *  top, the rod hanging under it. Absent = rod on the top panel. */
    shelfTopGapMm: z.number().min(0).max(2000).optional(),
  }),
  z.object({
    type: z.literal('drawers'),
    count: z.number().int().min(1).max(8).default(2),
    /** `inner` sits behind a door on side fillers; `external` carries its
     *  own drawer fronts (마이다) and replaces any door over the cell. */
    style: z.enum(['inner', 'external']).default('inner'),
    /** Inner drawers only: drawer front pitch (mm). */
    stepMm: z.number().min(80).max(600).default(250),
    /** Inner drawers only: individual front heights, bottom → top (mmmcraft
     *  `drawerHeights`, e.g. 255/255/176/176). Overrides `stepMm`. */
    heightsMm: z.array(z.number().min(60).max(600)).optional(),
    /** External drawers only: explicit front ranges [bottom, top] in mm from
     *  the carcass bottom, bottom → top (mmmcraft 마이다 ranges; a front may
     *  run past the carcass, e.g. −5 or up to the countertop). */
    frontsMm: z.array(z.tuple([z.number(), z.number()])).optional(),
    /** External drawers only: drawer box [bottom, height] in mm from the
     *  carcass bottom, one per front. */
    boxesMm: z.array(z.tuple([z.number(), z.number().positive()])).optional(),
  }),
])
export type CellContent = z.infer<typeof CellContent>

export const CellFront = z.object({
  /** `panel` = a fixed / appliance front without hinges (dishwasher door,
   *  fridge panel). */
  type: z.enum(['door', 'flap', 'panel', 'none']).default('door'),
  /** `auto` = two leaves when the front is wider than 600 mm. */
  leaves: z.enum(['auto', '1', '2']).default('auto'),
  hinge: z.enum(['auto', 'left', 'right']).default('auto'),
  /** mmmcraft 경첩 위치 변경: hinge heights on the side panel, mm from the
   *  carcass body bottom. Absent = the automatic layout. */
  hingesMm: z.array(z.number()).optional(),
})
export type CellFront = z.infer<typeof CellFront>

export type CabinetCell =
  | { id: string; kind: 'leaf'; content: CellContent; front?: CellFront; hasBack?: boolean }
  | {
      id: string
      kind: 'split'
      /** `x` = side-by-side columns split by vertical dividers; `y` = stacked
       *  (bottom → top) compartments split by fixed shelves. */
      axis: 'x' | 'y'
      children: CabinetCell[]
      /** Clear (inner) size of each child in mm; `null` shares what is left. */
      sizesMm: (number | null)[]
      /** Root `y` split only: `stack` builds every child as its own carcass
       *  ((하)/(상) sides, bottom and top per section, two panels at each
       *  joint), as mmmcraft does for wardrobes. Default one shared shelf. */
      joint?: 'shelf' | 'stack'
      front?: CellFront
      hasBack?: boolean
    }

export const CabinetCell: z.ZodType<CabinetCell> = z.lazy(() =>
  z.union([
    z.object({
      id: z.string(),
      kind: z.literal('leaf'),
      content: CellContent,
      front: CellFront.optional(),
      /** Stacked sections only: `false` drops that section's back panel
       *  (e.g. the fridge space of a 냉장고장). */
      hasBack: z.boolean().optional(),
    }),
    z.object({
      id: z.string(),
      kind: z.literal('split'),
      axis: z.enum(['x', 'y']),
      children: z.array(CabinetCell).min(2),
      sizesMm: z.array(z.number().positive().nullable()),
      joint: z.enum(['shelf', 'stack']).optional(),
      front: CellFront.optional(),
      hasBack: z.boolean().optional(),
    }),
  ]),
)

export const CabinetNode = BaseNode.extend({
  id: objectId('cabinet'),
  type: nodeType('cabinet'),
  /** Level-local metres. `y` is the cabinet bottom (floor for tall/base, the
   *  mounting height for upper cabinets). */
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /** Catalog preset this cabinet was placed from (mmmcraft moduleId); 속성
   *  이식 only copies the interior between cabinets of the same preset. */
  presetId: z.string().optional(),
  family: CabinetFamily.default('tall'),
  variant: CabinetVariant.default('standard'),

  /** Overall carcass box including the toe kick; excludes fronts and top. */
  widthMm: z.number().min(150).max(2400).default(900),
  heightMm: z.number().min(200).max(2800).default(2300),
  depthMm: z.number().min(250).max(900).default(600),

  panelThicknessMm: z
    .union([z.literal(15), z.literal(15.5), z.literal(18), z.literal(18.5)])
    .default(18),
  backThicknessMm: z.union([z.literal(3), z.literal(4.5), z.literal(6), z.literal(9)]).default(9),

  toeKick: z
    .object({
      enabled: z.boolean().default(true),
      heightMm: z.number().min(30).max(200).default(65),
      setbackMm: z.number().min(0).max(120).default(20),
      /** mmmcraft 걸레받이 옵셋: + pushes the board back (inward). */
      offsetMm: z.number().min(-200).max(200).default(0),
      /** mmmcraft 걸레받이 갭: cut from the bottom, the top line stays. */
      gapMm: z.number().min(0).max(199).default(0),
      widthAdjust: FrameWidthAdjust.default({ enabled: false, leftMm: 0, rightMm: 0 }),
    })
    .default({
      enabled: true,
      heightMm: 65,
      setbackMm: 20,
      offsetMm: 0,
      gapMm: 0,
      widthAdjust: { enabled: false, leftMm: 0, rightMm: 0 },
    }),

  /** mmmcraft 상단몰딩 (tall and upper cabinets): a PET strip on the carcass
   *  top, flush with the carcass front. Off unless switched on. */
  topMoulding: z
    .object({
      enabled: z.boolean().default(false),
      heightMm: z.number().min(0).max(9999).default(30),
      /** + pushes the moulding back (inward). */
      offsetMm: z.number().min(-200).max(200).default(0),
      /** Cut from the top (ceiling side). */
      gapMm: z.number().min(0).max(2000).default(0),
      widthAdjust: FrameWidthAdjust.default({ enabled: false, leftMm: 0, rightMm: 0 }),
    })
    .default({
      enabled: false,
      heightMm: 30,
      offsetMm: 0,
      gapMm: 0,
      widthAdjust: { enabled: false, leftMm: 0, rightMm: 0 },
    }),

  /** mmmcraft 뒷벽 이격: gap between the back and the wall (mm). The panel
   *  moves the cabinet by the positive part; upper cabinets ignore it. */
  backWallGapMm: z.number().min(-500).max(500).default(0),
  /** mmmcraft 뒤고정 / 앞고정: which face stays put when the depth changes. */
  depthAnchor: z.enum(['back', 'front']).default('back'),

  /** Finished end panels (EP, 18 PET) on the outside of each side. They sit
   *  inside `widthMm`: the carcass narrows so the overall size is kept. */
  endPanels: z
    .object({ left: z.boolean().default(false), right: z.boolean().default(false) })
    .default({ left: false, right: false }),
  /** mmmcraft 엔드패널 options. `null` gaps follow the 상단몰딩 / 걸레받이
   *  (the EP runs alongside them); offsets extend the EP forward / back. */
  endPanelOptions: z
    .object({
      /** 내치: inside the width (the carcass narrows); 외치: added outside. */
      mode: z.enum(['inside', 'outside']).default('inside'),
      thicknessMm: z.number().min(10).max(200).default(18),
      topGapMm: z.number().min(-500).max(500).nullable().default(null),
      bottomGapMm: z.number().min(-500).max(500).nullable().default(null),
      leftFrontMm: z.number().min(-580).max(1180).default(0),
      leftBackMm: z.number().min(-580).max(1180).default(0),
      rightFrontMm: z.number().min(-580).max(1180).default(0),
      rightBackMm: z.number().min(-580).max(1180).default(0),
    })
    .default({
      mode: 'inside',
      thicknessMm: 18,
      topGapMm: null,
      bottomGapMm: null,
      leftFrontMm: 0,
      leftBackMm: 0,
      rightFrontMm: 0,
      rightBackMm: 0,
    }),
  /** Upper cabinets: 하부 EP under the body (전면갭 insets from the front,
   *  후면갭 from the back — stored negative, mmmcraft default −35). */
  bottomEndPanel: z
    .object({
      enabled: z.boolean().default(false),
      frontGapMm: z.number().min(-580).max(200).default(0),
      backGapMm: z.number().min(-580).max(0).default(-35),
    })
    .default({ enabled: false, frontGapMm: 0, backGapMm: -35 }),
  /** Base cabinets: 상부 EP on the body (instead of a stone top), with an
   *  optional 뒷턱 at its back edge. */
  topEndPanel: z
    .object({
      enabled: z.boolean().default(false),
      frontOffsetMm: z.number().min(-580).max(200).default(20),
      backOffsetMm: z.number().min(-580).max(200).default(0),
      backLip: z
        .object({
          heightMm: z.number().min(1).max(2000).default(100),
          thicknessMm: z.number().min(1).max(100).default(18),
        })
        .nullable()
        .default(null),
    })
    .default({ enabled: false, frontOffsetMm: 20, backOffsetMm: 0, backLip: null }),
  /** Base cabinets: 인조대리석 상판 (0 = none) with an optional 뒷턱. */
  stoneTop: z
    .object({
      thicknessMm: z.union([z.literal(0), z.literal(10), z.literal(20), z.literal(30)]).default(0),
      frontMm: z.number().min(-200).max(200).default(0),
      backMm: z.number().min(-200).max(200).default(0),
      leftMm: z.number().min(-200).max(200).default(0),
      rightMm: z.number().min(-200).max(200).default(0),
      backLip: z
        .object({
          thicknessMm: z.union([z.literal(10), z.literal(20), z.literal(30)]),
          heightMm: z.number().min(1).max(2000).default(100),
        })
        .nullable()
        .default(null),
    })
    .default({ thicknessMm: 0, frontMm: 0, backMm: 0, leftMm: 0, rightMm: 0, backLip: null }),
  /** Upper cabinets: 상판 따내기, a 140 deep notch at a back corner of the top. */
  topNotch: z
    .object({
      widthMm: z.union([z.literal(340), z.literal(680)]),
      side: z.enum(['left', 'right']).default('right'),
    })
    .nullable()
    .default(null),

  /** Front reveals (mm). Positive = the front stops short of the carcass edge,
   *  negative = it overhangs (e.g. an upper cabinet's finger-pull lip). */
  frontReveal: z
    .object({
      top: z.number().min(-200).max(200).default(1.5),
      bottom: z.number().min(-200).max(200).default(1.5),
      side: z.number().min(0).max(20).default(1.5),
      /** Half of this gap sits on each side of a divider between fronts. */
      between: z.number().min(0).max(20).default(3),
    })
    .default({ top: 1.5, bottom: 1.5, side: 1.5, between: 3 }),

  /** mmmcraft 도어 확장/축소 (+ widens, − narrows) on the side away from the
   *  hinge; `mm` −1.5 is the unadjusted width. */
  doorWidthAdjust: z
    .object({
      enabled: z.boolean().default(false),
      mm: z.number().min(-500).max(500).default(-1.5),
    })
    .default({ enabled: false, mm: -1.5 }),

  interior: CabinetCell.default({
    id: 'root',
    kind: 'leaf',
    content: { type: 'shelves', count: 4, kind: 'dowel' },
    front: { type: 'door', leaves: 'auto', hinge: 'auto' },
  }),

  /** `auto` keeps the family default (solid; base cabinets use bands).
   *  mmmcraft kitchen bases are `none` (open top under a top channel) or
   *  `solid` (도어올림 / 상판내림). */
  top: z.enum(['auto', 'solid', 'none']).default('auto'),
  /** Solid top pulled back from the front (상판내림: 18.5). */
  topSetbackMm: z.number().min(0).max(200).default(0),
  /** Stretcher across the top front (상판내림 가로전대(상), 55 for a 20 mm stone). */
  topStretcher: z
    .object({ heightMm: z.number().min(20).max(200), setbackMm: z.number().min(0).max(60) })
    .nullable()
    .default(null),
  /** Handleless channels (목찬넬): notches cut into the front of both sides,
   *  measured from the carcass bottom, with an optional PET L-frame and a
   *  PB rail (가로전대) behind. */
  channels: z
    .array(
      z.object({
        fromBottomMm: z.number().min(0),
        heightMm: z.number().min(10).max(300),
        depthMm: z.number().min(5).max(100).default(40),
        frame: z.boolean().default(true),
        /** Height of the rail behind the notch; `null` = no rail. */
        railHeightMm: z.number().min(10).max(300).nullable().default(null),
      }),
    )
    .default([]),

  /** 패널 목록: panel names left out of the cut list / MPR / DXF. */
  panelExclusions: z.array(z.string()).default([]),
  /** 패널 목록 보링숨김: door names whose hinge borings are left out. */
  hingeBoringExclusions: z.array(z.string()).default([]),
  /** 패널 목록 결 방향 overrides by panel name. */
  panelGrain: z.record(z.string(), z.enum(['horizontal', 'vertical'])).default({}),

  bodyColor: HexColor.default('#f1ede4'),
  frontColor: HexColor.default('#e4ddd0'),
})
export type CabinetNode = z.infer<typeof CabinetNode>

const resolved = new WeakMap<object, CabinetNode>()
/**
 * Scene nodes are stored as saved, so a cabinet saved before a field existed
 * lacks it. Fill the schema defaults (cached per node object; the raw node
 * if it does not parse) before reading it.
 */
export function resolveCabinetNode(node: CabinetNode): CabinetNode {
  const hit = resolved.get(node)
  if (hit) return hit
  const parsed = CabinetNode.safeParse(node)
  const out = parsed.success ? ({ ...node, ...parsed.data } as CabinetNode) : node
  resolved.set(node, out)
  return out
}

export const CountertopCutout = z.object({
  id: z.string(),
  kind: z.enum(['sink', 'cooktop']),
  /** Cutout centre measured from the countertop's left end (mm). */
  centerMm: z.number(),
  widthMm: z.number().min(200).max(1500),
  depthMm: z.number().min(200).max(700),
})
export type CountertopCutout = z.infer<typeof CountertopCutout>

/**
 * A straight countertop segment (인조대리석 상판). An L-shaped kitchen is two
 * segments meeting at the corner. Local frame: origin at the slab's centre on
 * its underside, length along X, front towards +Z.
 */
export const CountertopNode = BaseNode.extend({
  id: objectId('countertop'),
  type: nodeType('countertop'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  lengthMm: z.number().min(300).max(6000).default(2400),
  depthMm: z.number().min(300).max(1200).default(620),
  thicknessMm: z.union([z.literal(10), z.literal(20), z.literal(30)]).default(20),
  /** Up-stand along the back edge (뒷턱); 0 = none. */
  backsplashMm: z.number().min(0).max(200).default(0),
  /** Vertical stone apron down the front edge (상판내림 앞판, 80 high overall). */
  frontDropMm: z.number().min(0).max(200).default(0),
  cutouts: z.array(CountertopCutout).default([]),
  color: HexColor.default('#e9e6e0'),
})
export type CountertopNode = z.infer<typeof CountertopNode>
