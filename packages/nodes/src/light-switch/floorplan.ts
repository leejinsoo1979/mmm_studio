import {
  deviceTerminals,
  type FloorplanGeometry,
  type GeometryContext,
  type LightSwitchNode,
} from '@pascal-app/core'

/** KS-style switch mark (● with the gang count) plus its wiring terminals:
 *  L (line) and one per gang, yellow while that gang is on. */
export function buildLightSwitchFloorplan(
  node: LightSwitchNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const [x, , z] = node.position
  const selected = ctx.viewState?.selected ?? false
  const children: FloorplanGeometry[] = [
    {
      kind: 'circle',
      cx: x,
      cy: z,
      r: 0.07,
      fill: '#171717',
      stroke: selected ? '#f97316' : '#171717',
      strokeWidth: selected ? 2 : 1,
      vectorEffect: 'non-scaling-stroke',
      pointerEvents: 'all',
    },
  ]
  if (node.gangs > 1) {
    children.push({
      kind: 'text',
      x: x + 0.1,
      y: z - 0.08,
      text: String(node.gangs),
      fontSize: 0.11,
      fontWeight: 700,
      fill: '#171717',
      upright: true,
    })
  }
  for (const t of deviceTerminals(node as never)) {
    const gang = t.terminal.startsWith('gang:') ? Number(t.terminal.slice(5)) : -1
    const on = gang >= 0 && node.on[gang] === true
    children.push(
      {
        kind: 'circle',
        cx: t.point[0],
        cy: t.point[1],
        r: 0.035,
        fill: gang < 0 ? '#e03131' : on ? '#ffd166' : '#ffffff',
        stroke: '#171717',
        strokeWidth: 1,
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'text',
        x: t.point[0],
        y: t.point[1] + 0.1,
        text: gang < 0 ? 'L' : String(gang + 1),
        fontSize: 0.07,
        fill: '#374151',
        textAnchor: 'middle',
        upright: true,
      },
    )
  }
  if (selected) children.push({ kind: 'move-handle', point: [x, z] })
  return { kind: 'group', children }
}
