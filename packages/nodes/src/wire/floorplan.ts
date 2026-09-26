import type {
  AnyNode,
  ElectricalState,
  FloorplanGeometry,
  GeometryContext,
  WireNode,
} from '@pascal-app/core'
import { arcControl, circuitColor, wireEnds } from './route'

/** A wiring-plan arc between two terminals: circuit colour, solid while
 *  live, dashed while dead. */
export function buildWireFloorplan(node: WireNode, ctx: GeometryContext): FloorplanGeometry | null {
  const state = ctx.levelData as ElectricalState | undefined
  const { a, b } = wireEnds(node, (id) => ctx.resolve<AnyNode>(id as never))
  const c = arcControl(a, b)
  const d = `M ${a[0]} ${a[1]} Q ${c[0]} ${c[1]} ${b[0]} ${b[1]}`
  const info = state?.wires.get(node.id)
  const color = state ? circuitColor(state, info?.circuitId ?? null) : '#868e96'
  const selected = ctx.viewState?.selected ?? false
  return {
    kind: 'group',
    children: [
      {
        kind: 'path',
        d,
        fill: 'none',
        stroke: 'transparent',
        strokeWidth: 10,
        vectorEffect: 'non-scaling-stroke',
        pointerEvents: 'stroke',
      },
      {
        kind: 'path',
        d,
        fill: 'none',
        stroke: selected ? '#f97316' : color,
        strokeWidth: info?.energized ? 2.5 : 1.5,
        ...(info?.energized ? {} : { strokeDasharray: '6 4' }),
        vectorEffect: 'non-scaling-stroke',
      },
    ],
  }
}
