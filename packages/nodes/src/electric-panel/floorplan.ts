import {
  deviceTerminals,
  type ElectricPanelNode,
  type FloorplanGeometry,
  type GeometryContext,
} from '@pascal-app/core'
import { PANEL_BOX } from './geometry'

/** 분전반: a filled box on the wall plus one terminal per circuit. */
export function buildElectricPanelFloorplan(
  node: ElectricPanelNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const [x, , z] = node.position
  const ry = node.rotation[1] ?? 0
  const t: [number, number] = [Math.cos(ry), -Math.sin(ry)]
  const n: [number, number] = [Math.sin(ry), Math.cos(ry)]
  const hw = PANEL_BOX.width / 2
  const hd = PANEL_BOX.depth / 2
  const corner = (a: number, b: number): [number, number] => [
    x + t[0] * a + n[0] * b,
    z + t[1] * a + n[1] * b,
  ]
  const selected = ctx.viewState?.selected ?? false
  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)],
      fill: '#343a40',
      stroke: selected ? '#f97316' : '#171717',
      strokeWidth: selected ? 2 : 1,
      vectorEffect: 'non-scaling-stroke',
      pointerEvents: 'all',
    },
    {
      kind: 'text',
      x,
      y: z,
      text: '분전반',
      fontSize: 0.07,
      fill: '#ffffff',
      textAnchor: 'middle',
      dominantBaseline: 'central',
      upright: true,
    },
  ]
  node.circuits.forEach((c, i) => {
    const term = deviceTerminals(node as never)[i]
    if (!term) return
    children.push(
      {
        kind: 'circle',
        cx: term.point[0],
        cy: term.point[1],
        r: 0.04,
        fill: c.on ? '#ffd166' : '#adb5bd',
        stroke: '#171717',
        strokeWidth: 1,
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'text',
        x: term.point[0],
        y: term.point[1] + 0.11,
        text: c.name,
        fontSize: 0.07,
        fill: '#374151',
        textAnchor: 'middle',
        upright: true,
      },
    )
  })
  if (selected) children.push({ kind: 'move-handle', point: [x, z] })
  return { kind: 'group', children }
}
