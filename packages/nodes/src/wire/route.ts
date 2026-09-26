import {
  type AnyNode,
  deviceTerminals,
  type ElectricalState,
  type WireNode,
} from '@pascal-app/core'

/** Circuit colours in panel order; unassigned wires are grey. */
const CIRCUIT_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599']
export const UNASSIGNED_COLOR = '#868e96'

export function circuitColor(state: ElectricalState, circuitKey: string | null): string {
  if (!circuitKey) return UNASSIGNED_COLOR
  const i = state.circuits.findIndex((c) => c.key === circuitKey)
  return i < 0 ? UNASSIGNED_COLOR : (CIRCUIT_COLORS[i % CIRCUIT_COLORS.length] as string)
}

/** The live end points of a wire: its devices' terminals (so wires follow
 *  moved devices), else the stored path ends. */
export function wireEnds(
  wire: WireNode,
  resolve: (id: string) => AnyNode | undefined,
): { a: [number, number]; b: [number, number] } {
  const end = (e: WireNode['from'], fallback: [number, number]): [number, number] => {
    const device = resolve(e.nodeId)
    const t = device ? deviceTerminals(device).find((x) => x.terminal === e.terminal) : undefined
    return t ? t.point : fallback
  }
  return {
    a: end(wire.from, wire.path[0] as [number, number]),
    b: end(wire.to, wire.path[wire.path.length - 1] as [number, number]),
  }
}

/** Wiring-plan arc: a quadratic bow of 20 % of the span to the left. */
export function arcControl(a: [number, number], b: [number, number]): [number, number] {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  return [(a[0] + b[0]) / 2 + dz * 0.2, (a[1] + b[1]) / 2 - dx * 0.2]
}

export function arcPoints(
  a: [number, number],
  b: [number, number],
  steps = 16,
): [number, number][] {
  const c = arcControl(a, b)
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const u = 1 - t
    return [
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
    ] as [number, number]
  })
}
