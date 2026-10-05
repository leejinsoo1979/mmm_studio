import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { NPC_ROLE_COLORS } from './presets'
import type { NpcNode } from './schema'

const MARKER_RADIUS = 0.28
const HIT_RADIUS = 0.5
const NAME_FONT_SIZE = 0.18
const NAME_OFFSET = 0.62
const PATROL_LABEL_FONT_SIZE = 0.16
const PATROL_LABEL_OFFSET = 0.24
const ROTATE_ARROW_CORNER_OFFSET = 0.22
/** The marker's nose on local +Y, which the group turns to the NPC's facing (yaw 0 faces +Z). */
const FACING_WEDGE: FloorplanPoint[] = [
  [-0.14, 0.2],
  [0.14, 0.2],
  [0, 0.46],
]

/** Payload of the `npc-patrol-point` handles: which patrol point is dragged. */
export type NpcPatrolPointPayload = { index: number }

/**
 * 2D floor-plan marker for an NPC: a role-coloured disc with a facing wedge,
 * a transparent hit circle and an upright name. Selected, it adds the move
 * and rotate handles plus what the NPC will do in play: the dashed wander
 * ring, or the patrol path with draggable, numbered points.
 *
 * Coordinates are level-local metres; plan x = world X, plan y = world Z.
 */
export function buildNpcFloorplan(node: NpcNode, ctx: GeometryContext): FloorplanGeometry {
  const [px, , pz] = node.position
  const planRotation = -node.rotation
  const color = NPC_ROLE_COLORS[node.role]
  const view = ctx.viewState
  const selected = view?.selected ?? false
  const children: FloorplanGeometry[] = []

  if (selected) children.push(...behaviorOverlay(node, color))

  children.push(
    {
      kind: 'group',
      transform: { translate: [px, pz], rotate: planRotation },
      children: [
        {
          kind: 'circle',
          cx: 0,
          cy: 0,
          r: HIT_RADIUS,
          fill: 'transparent',
          pointerEvents: 'all',
        },
        {
          kind: 'polygon',
          points: FACING_WEDGE,
          fill: color,
          stroke: '#ffffff',
          strokeWidth: 1.5,
          vectorEffect: 'non-scaling-stroke',
          strokeLinejoin: 'round',
        },
        {
          kind: 'circle',
          cx: 0,
          cy: 0,
          r: MARKER_RADIUS,
          fill: color,
          stroke: selected && view ? view.palette.selectedStroke : '#ffffff',
          strokeWidth: selected ? 2.5 : 1.5,
          vectorEffect: 'non-scaling-stroke',
        },
      ],
    },
    {
      kind: 'text',
      x: px,
      y: pz + NAME_OFFSET,
      text: node.name,
      fontSize: NAME_FONT_SIZE,
      fill: '#1f2937',
      stroke: '#ffffff',
      strokeWidth: NAME_FONT_SIZE * 0.3,
      paintOrder: 'stroke',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontWeight: 600,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      upright: true,
    },
  )

  if (selected) {
    children.push({ kind: 'move-handle', point: [px, pz] })
    const corner = MARKER_RADIUS + ROTATE_ARROW_CORNER_OFFSET
    const [cornerX, cornerZ] = rotatePlanVector(corner, corner, planRotation)
    const [radialX, radialZ] = rotatePlanVector(1, 1, planRotation)
    children.push({
      kind: 'rotate-arrow',
      point: [px + cornerX, pz + cornerZ],
      angle: Math.atan2(radialZ, radialX),
      affordance: 'npc-rotate',
      pivot: [px, pz],
    })
    if (node.behavior.mode === 'patrol') children.push(...patrolHandles(node.behavior.patrol))
  }

  return { kind: 'group', children }
}

/** Drawn under the marker and click-through, so the ring never steals a pick from the room. */
function behaviorOverlay(node: NpcNode, color: string): FloorplanGeometry[] {
  const { behavior } = node
  if (behavior.mode === 'wander') {
    return [
      {
        kind: 'circle',
        cx: node.position[0],
        cy: node.position[2],
        r: behavior.wanderRadius,
        fill: color,
        fillOpacity: 0.06,
        stroke: color,
        strokeWidth: 1.5,
        strokeDasharray: '6 4',
        vectorEffect: 'non-scaling-stroke',
        pointerEvents: 'none',
      },
    ]
  }
  if (behavior.mode === 'patrol' && behavior.patrol.length > 1) {
    const closes = behavior.patrolLoop === 'loop' && behavior.patrol.length > 2
    return [
      {
        kind: 'polyline',
        points: closes ? [...behavior.patrol, behavior.patrol[0]!] : behavior.patrol,
        fill: 'none',
        stroke: color,
        strokeWidth: 2,
        strokeDasharray: '6 4',
        vectorEffect: 'non-scaling-stroke',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        pointerEvents: 'none',
      },
    ]
  }
  return []
}

function patrolHandles(patrol: readonly (readonly [number, number])[]): FloorplanGeometry[] {
  return patrol.flatMap(([x, z], index): FloorplanGeometry[] => [
    {
      kind: 'endpoint-handle',
      point: [x, z],
      state: 'idle',
      affordance: 'npc-patrol-point',
      payload: { index } satisfies NpcPatrolPointPayload,
    },
    {
      kind: 'text',
      x: x + PATROL_LABEL_OFFSET,
      y: z - PATROL_LABEL_OFFSET,
      text: String(index + 1),
      fontSize: PATROL_LABEL_FONT_SIZE,
      fill: '#1f2937',
      stroke: '#ffffff',
      strokeWidth: PATROL_LABEL_FONT_SIZE * 0.3,
      paintOrder: 'stroke',
      fontWeight: 700,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      upright: true,
    },
  ])
}

function rotatePlanVector(x: number, y: number, rotation: number): FloorplanPoint {
  const c = Math.cos(rotation)
  const s = Math.sin(rotation)
  return [x * c - y * s, x * s + y * c]
}
