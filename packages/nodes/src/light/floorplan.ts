import type { FloorplanGeometry, GeometryContext, LightNode } from '@pascal-app/core'

export function buildLightFloorplan(node: LightNode, ctx: GeometryContext): FloorplanGeometry {
  const [x, , z] = node.position
  const color = node.enabled ? node.color : '#777777'
  const children: FloorplanGeometry[] = [
    {
      kind: 'circle',
      cx: x,
      cy: z,
      r: 0.18,
      fill: color,
      stroke: '#171717',
      strokeWidth: 1.5,
      vectorEffect: 'non-scaling-stroke',
      pointerEvents: 'all',
    },
    {
      kind: 'circle',
      cx: x,
      cy: z,
      r: 0.34,
      fill: 'transparent',
      stroke: color,
      strokeWidth: 1,
      strokeDasharray: '4 3',
      vectorEffect: 'non-scaling-stroke',
    },
    {
      kind: 'line',
      x1: x - 0.12,
      y1: z,
      x2: x + 0.12,
      y2: z,
      stroke: '#171717',
      strokeWidth: 1,
      vectorEffect: 'non-scaling-stroke',
    },
    {
      kind: 'line',
      x1: x,
      y1: z - 0.12,
      x2: x,
      y2: z + 0.12,
      stroke: '#171717',
      strokeWidth: 1,
      vectorEffect: 'non-scaling-stroke',
    },
  ]
  if (ctx.viewState?.selected) children.push({ kind: 'move-handle', point: [x, z] })
  return { kind: 'group', children }
}
