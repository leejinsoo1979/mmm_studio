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
  }),
  z.object({
    type: z.literal('hanging'),
    rod: z.enum(['rod', 'pants']).default('rod'),
  }),
  z.object({
    type: z.literal('drawers'),
    count: z.number().int().min(1).max(8).default(2),
    /** `inner` sits behind a door on side fillers; `external` carries its
     *  own drawer fronts (마이다) and replaces any door over the cell. */
    style: z.enum(['inner', 'external']).default('inner'),
    /** Inner drawers only: drawer front pitch (mm). */
    stepMm: z.number().min(80).max(600).default(250),
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
})
export type CellFront = z.infer<typeof CellFront>

export type CabinetCell =
  | { id: string; kind: 'leaf'; content: CellContent; front?: CellFront }
  | {
      id: string
      kind: 'split'
      /** `x` = side-by-side columns split by vertical dividers; `y` = stacked
       *  (bottom → top) compartments split by fixed shelves. */
      axis: 'x' | 'y'
      children: CabinetCell[]
      /** Clear (inner) size of each child in mm; `null` shares what is left. */
      sizesMm: (number | null)[]
      front?: CellFront
    }

export const CabinetCell: z.ZodType<CabinetCell> = z.lazy(() =>
  z.union([
    z.object({
      id: z.string(),
      kind: z.literal('leaf'),
      content: CellContent,
      front: CellFront.optional(),
    }),
    z.object({
      id: z.string(),
      kind: z.literal('split'),
      axis: z.enum(['x', 'y']),
      children: z.array(CabinetCell).min(2),
      sizesMm: z.array(z.number().positive().nullable()),
      front: CellFront.optional(),
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
    })
    .default({ enabled: true, heightMm: 65, setbackMm: 20 }),

  /** Finished end panels (EP, 18 PET) on the outside of each side. They sit
   *  inside `widthMm`: the carcass narrows so the overall size is kept. */
  endPanels: z
    .object({ left: z.boolean().default(false), right: z.boolean().default(false) })
    .default({ left: false, right: false }),

  /** Front reveals (mm). Positive = the front stops short of the carcass edge,
   *  negative = it overhangs (e.g. an upper cabinet's finger-pull lip). */
  frontReveal: z
    .object({
      top: z.number().min(-60).max(60).default(1.5),
      bottom: z.number().min(-60).max(60).default(1.5),
      side: z.number().min(0).max(20).default(1.5),
      /** Half of this gap sits on each side of a divider between fronts. */
      between: z.number().min(0).max(20).default(3),
    })
    .default({ top: 1.5, bottom: 1.5, side: 1.5, between: 3 }),

  interior: CabinetCell.default({
    id: 'root',
    kind: 'leaf',
    content: { type: 'shelves', count: 4, kind: 'dowel' },
    front: { type: 'door', leaves: 'auto', hinge: 'auto' },
  }),

  handle: z.enum(['none', 'bar', 'knob']).default('bar'),
  bodyColor: HexColor.default('#f1ede4'),
  frontColor: HexColor.default('#e4ddd0'),
  handleColor: HexColor.default('#8c8c8c'),
})
export type CabinetNode = z.infer<typeof CabinetNode>

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
  cutouts: z.array(CountertopCutout).default([]),
  color: HexColor.default('#e9e6e0'),
})
export type CountertopNode = z.infer<typeof CountertopNode>
