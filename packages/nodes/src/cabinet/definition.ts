import type { HandleDescriptor, NodeDefinition } from '@pascal-app/core'
import { buildCountertopGeometry } from './countertop-geometry'
import { buildCabinetFloorplan, buildCountertopFloorplan } from './floorplan'
import {
  cabinetResizeAffordance,
  cabinetRotateAffordance,
  countertopResizeAffordance,
} from './floorplan-affordances'
import { positionedFloorplanMoveTarget } from './floorplan-move'
import { buildCabinetGeometry } from './geometry'
import { CabinetNode, CountertopNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.18
const MOVE_FRONT_OFFSET = 0.35
const ROTATE_RING_OFFSET = 0.05

type Positioned = { position: [number, number, number]; rotation: [number, number, number] }

/** Width handle on +X that keeps the −X face in place (a cabinet against a
 *  neighbour keeps that edge); the centre shifts by half the change. */
function widthHandle<N extends Positioned>(
  getMm: (n: N) => number,
  patch: (mm: number) => Partial<N>,
  minMm: number,
  maxMm: number,
  y: (n: N) => number,
): HandleDescriptor<N> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'min',
    min: minMm / 1000,
    max: maxMm / 1000,
    currentValue: (n) => getMm(n) / 1000,
    apply: (n, value) => {
      const mm = Math.round(value * 1000)
      const shift = (mm - getMm(n)) / 2000
      const ry = n.rotation[1] ?? 0
      return {
        ...patch(mm),
        position: [
          n.position[0] + Math.cos(ry) * shift,
          n.position[1],
          n.position[2] - Math.sin(ry) * shift,
        ],
      } as Partial<N>
    },
    placement: { position: (n) => [getMm(n) / 2000 + SIDE_HANDLE_OFFSET, y(n), 0] },
  }
}

function rotateHandle<N extends Positioned>(
  radius: (n: N) => number,
  y: (n: N) => number,
): HandleDescriptor<N> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => {
      const r = initial.rotation
      return { rotation: [r[0], (r[1] ?? 0) - delta, r[2]] } as Partial<N>
    },
    placement: {
      position: (n) => [radius(n) * Math.SQRT1_2, y(n), radius(n) * Math.SQRT1_2],
      rotationY: () => -Math.PI / 4,
    },
    decoration: { kind: 'ring', radius, y },
  }
}

function moveHandle<N extends Positioned>(frontM: (n: N) => number): HandleDescriptor<N> {
  return {
    kind: 'translate',
    placement: { position: (n) => [0, 0.02, frontM(n) + MOVE_FRONT_OFFSET] },
    apply: (_n, pos) => ({ position: [pos[0], pos[1], pos[2]] }) as Partial<N>,
  }
}

const cabinetHandles = (): HandleDescriptor<CabinetNode>[] => [
  widthHandle<CabinetNode>(
    (n) => n.widthMm,
    (widthMm) => ({ widthMm }),
    150,
    2400,
    (n) => n.heightMm / 2000,
  ),
  rotateHandle<CabinetNode>(
    (n) => Math.hypot(n.widthMm, n.depthMm) / 2000 + ROTATE_RING_OFFSET,
    () => 0.05,
  ),
  moveHandle<CabinetNode>((n) => n.depthMm / 2000),
]

export const cabinetDefinition: NodeDefinition<typeof CabinetNode> = {
  kind: 'cabinet',
  schemaVersion: 1,
  schema: CabinetNode,
  category: 'furnish',
  snapProfile: 'item',
  facingIndicator: true,

  defaults: () => {
    const { id: _id, ...fields } = CabinetNode.parse({})
    return fields
  },

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
    },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    floorPlaced: {
      footprint: (node) => {
        const n = node as unknown as CabinetNode
        return {
          dimensions: [n.widthMm / 1000, n.heightMm / 1000, n.depthMm / 1000] as [
            number,
            number,
            number,
          ],
          rotation: n.rotation,
        }
      },
      collides: true,
    },
  },

  // Everything is edited in the custom panel (cell tree, fronts, sizes);
  // the descriptor keeps the MCP/AI surface bounded.
  parametrics: {
    groups: [
      {
        label: 'Cabinet',
        fields: [
          { key: 'family', kind: 'enum', options: ['tall', 'base', 'upper'] },
          {
            key: 'variant',
            kind: 'enum',
            options: ['standard', 'sink', 'dishwasher', 'cooktop', 'appliance'],
          },
          { key: 'widthMm', kind: 'number', unit: 'mm', min: 150, max: 2400, step: 1 },
          { key: 'heightMm', kind: 'number', unit: 'mm', min: 200, max: 2800, step: 1 },
          { key: 'depthMm', kind: 'number', unit: 'mm', min: 250, max: 900, step: 1 },
        ],
      },
    ],
    customPanel: () => import('./panel'),
  },
  handles: cabinetHandles,

  geometry: buildCabinetGeometry,
  geometryKey: (n) => {
    const c = n as unknown as CabinetNode
    return JSON.stringify([
      c.family,
      c.variant,
      c.widthMm,
      c.heightMm,
      c.depthMm,
      c.panelThicknessMm,
      c.backThicknessMm,
      c.toeKick,
      c.endPanels,
      c.frontReveal,
      c.interior,
      c.handle,
      c.bodyColor,
      c.frontColor,
      c.handleColor,
    ])
  },
  floorplan: buildCabinetFloorplan,
  floorplanMoveTarget: positionedFloorplanMoveTarget as never,
  floorplanAffordances: {
    'cabinet-resize': cabinetResizeAffordance,
    'cabinet-rotate': cabinetRotateAffordance,
  },

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place cabinet (snaps to walls)' },
    { key: 'R', label: 'Rotate (away from walls)' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Cabinet',
    description: 'Built-in wardrobe / kitchen cabinet with a configurable interior.',
    icon: { kind: 'iconify', name: 'lucide:archive' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'A built-in wardrobe or kitchen cabinet (mm sizes). family tall/base/upper, variant standard/sink/dishwasher/cooktop/appliance, and an interior cell tree (x/y splits; leaves hold shelves, hanging rods, inner or external drawers; nodes carry door/flap/panel fronts).',
  },
}

const countertopHandles = (): HandleDescriptor<CountertopNode>[] => [
  widthHandle<CountertopNode>(
    (n) => n.lengthMm,
    (lengthMm) => ({ lengthMm }),
    300,
    6000,
    (n) => n.thicknessMm / 1000,
  ),
  moveHandle<CountertopNode>((n) => n.depthMm / 2000),
]

export const countertopDefinition: NodeDefinition<typeof CountertopNode> = {
  kind: 'countertop',
  schemaVersion: 1,
  schema: CountertopNode,
  category: 'furnish',
  snapProfile: 'item',

  defaults: () => {
    const { id: _id, ...fields } = CountertopNode.parse({})
    return fields
  },

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2] },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: {
    groups: [
      {
        label: 'Countertop',
        fields: [
          { key: 'lengthMm', kind: 'number', unit: 'mm', min: 300, max: 6000, step: 1 },
          { key: 'depthMm', kind: 'number', unit: 'mm', min: 300, max: 1200, step: 1 },
          { key: 'backsplashMm', kind: 'number', unit: 'mm', min: 0, max: 200, step: 1 },
        ],
      },
    ],
    customPanel: () => import('./countertop-panel'),
  },
  handles: countertopHandles,

  geometry: buildCountertopGeometry,
  geometryKey: (n) => {
    const c = n as unknown as CountertopNode
    return JSON.stringify([
      c.lengthMm,
      c.depthMm,
      c.thicknessMm,
      c.backsplashMm,
      c.cutouts,
      c.color,
    ])
  },
  floorplan: buildCountertopFloorplan,
  floorplanMoveTarget: positionedFloorplanMoveTarget as never,
  floorplanAffordances: {
    'countertop-resize': countertopResizeAffordance,
  },

  tool: () => import('./countertop-tool'),
  toolHints: [
    { key: 'Left click', label: 'Place countertop (snaps to walls)' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Countertop',
    description: 'Kitchen countertop with sink and cooktop cutouts.',
    icon: { kind: 'iconify', name: 'lucide:rectangle-horizontal' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'A straight kitchen countertop (mm): length, depth, thickness 10/20/30, back up-stand, and sink / cooktop cutouts positioned from the left end.',
  },
}
