import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { buildCabinetParts } from './engine/parts'
import type { CabinetResizePayload } from './floorplan-affordances'
import type { CabinetNode, CountertopNode } from './schema'

const MM = 0.001
const RESIZE_ARROW_OFFSET = 0.12
const ROTATE_ARROW_CORNER_OFFSET = 0.22

const BODY_FILL = '#e7e2d8'
const OUTLINE = '#1f2937'

/**
 * Plan symbol for a cabinet: carcass footprint, the front line, and a quarter
 * swing arc per hinged door (drawn as in a furniture plan). Upper cabinets are
 * dashed — they hang above whatever is drawn under them.
 */
export function buildCabinetFloorplan(node: CabinetNode, ctx?: GeometryContext): FloorplanGeometry {
  const [px, , pz] = node.position
  const planRy = -(node.rotation[1] ?? 0)
  const W = node.widthMm * MM
  const D = node.depthMm * MM
  const halfW = W / 2
  const halfD = D / 2
  const upper = node.family === 'upper'
  const isSelected = ctx?.viewState?.selected ?? false

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -halfW,
      y: -halfD,
      width: W,
      height: D,
      fill: upper ? 'none' : BODY_FILL,
      stroke: OUTLINE,
      strokeWidth: 0.012,
      strokeDasharray: upper ? '0.06 0.04' : undefined,
      opacity: 0.95,
    },
  ]

  const { parts } = buildCabinetParts(node)
  // Divider lines so the columns read from above.
  for (const part of parts) {
    if (part.role !== 'divider') continue
    const x = (part.box.x + part.box.w / 2) * MM - halfW
    children.push({
      kind: 'line',
      x1: x,
      y1: -halfD + part.box.z * MM,
      x2: x,
      y2: halfD,
      stroke: OUTLINE,
      strokeWidth: 0.008,
      opacity: 0.6,
      strokeDasharray: upper ? '0.04 0.03' : undefined,
    })
  }

  // Fronts: a thin slab in front of the carcass + swing arcs for doors.
  for (const part of parts) {
    if (part.role !== 'door' && part.role !== 'drawer-front') continue
    if (part.role === 'drawer-front' && part.box.z < node.depthMm) continue // inner drawers
    const x0 = part.box.x * MM - halfW
    const x1 = (part.box.x + part.box.w) * MM - halfW
    const zf = (part.box.z + part.box.d) * MM - halfD
    children.push({
      kind: 'rect',
      x: x0,
      y: part.box.z * MM - halfD,
      width: x1 - x0,
      height: part.box.d * MM,
      fill: '#cfc6b6',
      stroke: OUTLINE,
      strokeWidth: 0.006,
      strokeDasharray: upper ? '0.04 0.03' : undefined,
    })
    if (part.role === 'door' && (part.hinge === 'left' || part.hinge === 'right') && !upper) {
      const r = x1 - x0
      const hx = part.hinge === 'left' ? x0 : x1
      const tipX = part.hinge === 'left' ? x1 : x0
      const sweep = part.hinge === 'left' ? 1 : 0
      children.push({
        kind: 'path',
        d: `M ${tipX} ${zf} A ${r} ${r} 0 0 ${sweep} ${hx} ${zf + r} L ${hx} ${zf}`,
        fill: 'none',
        stroke: '#6b7280',
        strokeWidth: 0.006,
        strokeDasharray: '0.03 0.02',
        opacity: 0.8,
      })
    }
  }

  const footprint: FloorplanGeometry = {
    kind: 'group',
    transform: { translate: [px, pz], rotate: planRy },
    children,
  }
  if (!isSelected) return footprint
  return { kind: 'group', children: [footprint, ...selectionChrome(node, W, D)] }
}

/** Resize arrows (width on +X, depth on +Z) and a rotate arrow, in plan
 *  coordinates so the affordances project the cursor in the same frame. */
function selectionChrome(
  node: { position: [number, number, number]; rotation: [number, number, number] },
  W: number,
  D: number,
): FloorplanGeometry[] {
  const [px, , pz] = node.position
  const planRy = -(node.rotation[1] ?? 0)
  const cosR = Math.cos(planRy)
  const sinR = Math.sin(planRy)
  const toPlan = (lx: number, lz: number): [number, number] => [
    lx * cosR - lz * sinR,
    lx * sinR + lz * cosR,
  ]
  const out: FloorplanGeometry[] = []
  const arrow = (dim: CabinetResizePayload['dim'], local: [number, number], offset: number) => {
    const axis = toPlan(local[0], local[1])
    out.push({
      kind: 'move-arrow',
      point: [px + axis[0] * offset, pz + axis[1] * offset],
      angle: Math.atan2(axis[1], axis[0]),
      affordance: 'cabinet-resize',
      payload: { dim, planAxis: axis } satisfies CabinetResizePayload,
    })
  }
  arrow('width', [1, 0], W / 2 + RESIZE_ARROW_OFFSET)
  arrow('depth', [0, 1], D / 2 + RESIZE_ARROW_OFFSET)
  const corner = toPlan(W / 2 + ROTATE_ARROW_CORNER_OFFSET, D / 2 + ROTATE_ARROW_CORNER_OFFSET)
  const radial = toPlan(1, 1)
  out.push({
    kind: 'rotate-arrow',
    point: [px + corner[0], pz + corner[1]],
    angle: Math.atan2(radial[1], radial[0]),
    affordance: 'cabinet-rotate',
    pivot: [px, pz],
  })
  return out
}

/** Countertop plan: slab outline, sink bowl and cooktop cutouts. */
export function buildCountertopFloorplan(
  node: CountertopNode,
  ctx?: GeometryContext,
): FloorplanGeometry {
  const [px, , pz] = node.position
  const planRy = -(node.rotation[1] ?? 0)
  const L = node.lengthMm * MM
  const D = node.depthMm * MM
  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -L / 2,
      y: -D / 2,
      width: L,
      height: D,
      fill: '#f4f2ee',
      stroke: OUTLINE,
      strokeWidth: 0.01,
      opacity: 0.9,
    },
  ]
  for (const cut of node.cutouts) {
    const cx = cut.centerMm * MM - L / 2
    const w = cut.widthMm * MM
    const d = cut.depthMm * MM
    const cz = countertopCutoutCenterZ(node, cut.depthMm) * MM
    if (cut.kind === 'sink') {
      children.push({
        kind: 'rect',
        x: cx - w / 2,
        y: cz - d / 2,
        width: w,
        height: d,
        rx: 0.04,
        fill: '#d1d5db',
        stroke: OUTLINE,
        strokeWidth: 0.008,
      })
      children.push({
        kind: 'circle',
        cx,
        cy: cz,
        r: 0.025,
        fill: 'none',
        stroke: OUTLINE,
        strokeWidth: 0.006,
      })
    } else {
      children.push({
        kind: 'rect',
        x: cx - w / 2,
        y: cz - d / 2,
        width: w,
        height: d,
        rx: 0.01,
        fill: '#374151',
        stroke: OUTLINE,
        strokeWidth: 0.008,
      })
      for (const [ox, oz, r] of [
        [-0.13, 0.1, 0.09],
        [0.13, 0.1, 0.09],
        [0, -0.1, 0.1],
      ] as const) {
        children.push({
          kind: 'circle',
          cx: cx + ox,
          cy: cz + oz,
          r,
          fill: 'none',
          stroke: '#9ca3af',
          strokeWidth: 0.006,
        })
      }
    }
  }
  const footprint: FloorplanGeometry = {
    kind: 'group',
    transform: { translate: [px, pz], rotate: planRy },
    children,
  }
  if (!(ctx?.viewState?.selected ?? false)) return footprint
  const [cpx, , cpz] = node.position
  const cosR = Math.cos(planRy)
  const sinR = Math.sin(planRy)
  const axis: [number, number] = [cosR, sinR]
  return {
    kind: 'group',
    children: [
      footprint,
      {
        kind: 'move-arrow',
        point: [
          cpx + axis[0] * (L / 2 + RESIZE_ARROW_OFFSET),
          cpz + axis[1] * (L / 2 + RESIZE_ARROW_OFFSET),
        ],
        angle: Math.atan2(axis[1], axis[0]),
        affordance: 'countertop-resize',
        payload: { dim: 'width', planAxis: axis } satisfies CabinetResizePayload,
      },
    ],
  }
}

/** Cutouts sit centred in the depth left in front of the backsplash, nudged
 *  forward so a sink keeps a faucet deck behind it. */
export function countertopCutoutCenterZ(node: CountertopNode, cutDepthMm: number): number {
  const deck = 60
  const available = node.depthMm - deck
  return -node.depthMm / 2 + deck + Math.max(cutDepthMm / 2, available / 2)
}
