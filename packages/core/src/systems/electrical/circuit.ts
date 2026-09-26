import type { AnyNode } from '../../schema'
import type { ElectricPanelNode, LightSwitchNode, WireNode } from '../../schema/nodes/electrical'

/**
 * Lighting circuit solver. Terminals are `<nodeId>:<terminal>`; wires join
 * two terminals; a switch joins its `line` to `gang:<n>` while that gang is
 * on; a panel circuit is live while its breaker is on. A light that has a
 * wire is lit only when its `in` terminal is live; unwired lights keep their
 * own on/off.
 */

export type DeviceTerminal = { terminal: string; label: string; point: [number, number] }

const SWITCH_TERMINAL_SPACING = 0.12
const PANEL_TERMINAL_SPACING = 0.15
/** Terminals sit this far in front of the wall so they can be picked. */
const TERMINAL_OFFSET = 0.18

type Positioned = { position: [number, number, number]; rotation: [number, number, number] }

/** Plan points a wire can attach to on a device (level-local metres). */
export function deviceTerminals(node: AnyNode): DeviceTerminal[] {
  if (node.type === 'light') {
    const [x, , z] = (node as unknown as Positioned).position
    return [{ terminal: 'in', label: node.name ?? '조명', point: [x, z] }]
  }
  if (node.type !== 'light-switch' && node.type !== 'electric-panel') return []
  const { position, rotation } = node as unknown as Positioned
  const ry = rotation[1] ?? 0
  // Local +X (along the wall) and +Z (into the room) in plan.
  const t = [Math.cos(ry), -Math.sin(ry)]
  const n = [Math.sin(ry), Math.cos(ry)]
  const base = [
    position[0] + (n[0] as number) * TERMINAL_OFFSET,
    position[2] + (n[1] as number) * TERMINAL_OFFSET,
  ]
  const at = (offset: number): [number, number] => [
    (base[0] as number) + (t[0] as number) * offset,
    (base[1] as number) + (t[1] as number) * offset,
  ]
  if (node.type === 'light-switch') {
    const sw = node as unknown as LightSwitchNode
    const count = sw.gangs + 1
    return Array.from({ length: count }, (_, i) => ({
      terminal: i === 0 ? 'line' : `gang:${i - 1}`,
      label: i === 0 ? '전원(L)' : `${i}구`,
      point: at((i - (count - 1) / 2) * SWITCH_TERMINAL_SPACING),
    }))
  }
  const panel = node as unknown as ElectricPanelNode
  return panel.circuits.map((c, i) => ({
    terminal: `circuit:${c.id}`,
    label: c.name,
    point: at((i - (panel.circuits.length - 1) / 2) * PANEL_TERMINAL_SPACING),
  }))
}

export type ElectricalState = {
  wires: Map<string, { circuitId: string | null; energized: boolean }>
  lights: Map<string, { wired: boolean; powered: boolean; circuitId: string | null }>
  switches: Map<string, { circuitId: string | null; live: boolean }>
  circuits: {
    panelId: string
    circuitId: string
    key: string
    name: string
    on: boolean
    lights: number
    switches: number
  }[]
  issues: string[]
}

const key = (nodeId: string, terminal: string) => `${nodeId}:${terminal}`

const cache = new WeakMap<object, ElectricalState>()

export function solveElectrical(nodes: Readonly<Record<string, AnyNode>>): ElectricalState {
  const hit = cache.get(nodes)
  if (hit) return hit
  const all = Object.values(nodes).filter(Boolean) as AnyNode[]
  const wires = all.filter(
    (n): n is WireNode & AnyNode => n.type === 'wire',
  ) as unknown as WireNode[]
  const switches = all.filter((n) => n.type === 'light-switch') as unknown as LightSwitchNode[]
  const panels = all.filter((n) => n.type === 'electric-panel') as unknown as ElectricPanelNode[]
  const lights = all.filter((n) => n.type === 'light')

  type Edge = { to: string; wireId?: string; switchId?: string; gang?: number }
  const adj = new Map<string, Edge[]>()
  const link = (a: string, b: string, e: Omit<Edge, 'to'>) => {
    adj.set(a, [...(adj.get(a) ?? []), { to: b, ...e }])
    adj.set(b, [...(adj.get(b) ?? []), { to: a, ...e }])
  }
  for (const w of wires) {
    if (!nodes[w.from.nodeId] || !nodes[w.to.nodeId]) continue
    link(key(w.from.nodeId, w.from.terminal), key(w.to.nodeId, w.to.terminal), { wireId: w.id })
  }
  for (const s of switches) {
    for (let g = 0; g < s.gangs; g += 1) {
      link(key(s.id, 'line'), key(s.id, `gang:${g}`), { switchId: s.id, gang: g })
    }
  }

  // Reach from a circuit terminal; `closed` decides whether a switch gang conducts.
  const reach = (start: string, closed: (s: string, g: number) => boolean) => {
    const seen = new Set<string>([start])
    const wireIds = new Set<string>()
    const stack = [start]
    while (stack.length) {
      const k = stack.pop() as string
      for (const e of adj.get(k) ?? []) {
        if (e.switchId !== undefined && !closed(e.switchId, e.gang as number)) continue
        if (e.wireId) wireIds.add(e.wireId)
        if (!seen.has(e.to)) {
          seen.add(e.to)
          stack.push(e.to)
        }
      }
    }
    return { seen, wireIds }
  }
  const switchById = new Map<string, LightSwitchNode>(switches.map((s) => [s.id, s]))
  const gangOn = (id: string, g: number) => switchById.get(id)?.on[g] === true

  const state: ElectricalState = {
    wires: new Map(wires.map((w) => [w.id, { circuitId: null, energized: false }])),
    lights: new Map(),
    switches: new Map(switches.map((s) => [s.id, { circuitId: null, live: false }])),
    circuits: [],
    issues: [],
  }
  const lightCircuit = new Map<string, string>()
  const live = new Set<string>()
  for (const p of panels) {
    for (const c of p.circuits) {
      const start = key(p.id, `circuit:${c.id}`)
      const circuitKey = `${p.id}/${c.id}`
      // Topology: which parts belong to this circuit (all switches closed).
      const topo = reach(start, () => true)
      let lightCount = 0
      let switchCount = 0
      for (const wId of topo.wireIds) {
        const w = state.wires.get(wId)
        if (!w) continue
        if (w.circuitId && w.circuitId !== circuitKey) {
          state.issues.push(`회로가 서로 연결되어 있습니다: ${c.name}`)
        }
        w.circuitId = circuitKey
      }
      for (const l of lights) {
        if (topo.seen.has(key(l.id, 'in'))) {
          lightCircuit.set(l.id, circuitKey)
          lightCount += 1
        }
      }
      for (const s of switches) {
        if (topo.seen.has(key(s.id, 'line'))) {
          const sw = state.switches.get(s.id)
          if (sw) sw.circuitId = circuitKey
          switchCount += 1
        }
      }
      state.circuits.push({
        panelId: p.id,
        circuitId: c.id,
        key: circuitKey,
        name: c.name,
        on: c.on,
        lights: lightCount,
        switches: switchCount,
      })
      if (!c.on) continue
      const energized = reach(start, gangOn)
      for (const k of energized.seen) live.add(k)
      for (const wId of energized.wireIds) {
        const w = state.wires.get(wId)
        if (w) w.energized = true
      }
    }
  }
  const wiredTerminals = new Set<string>()
  for (const w of wires) {
    wiredTerminals.add(key(w.from.nodeId, w.from.terminal))
    wiredTerminals.add(key(w.to.nodeId, w.to.terminal))
  }
  for (const l of lights) {
    const wired = wiredTerminals.has(key(l.id, 'in'))
    const circuitId = lightCircuit.get(l.id) ?? null
    state.lights.set(l.id, { wired, powered: live.has(key(l.id, 'in')), circuitId })
    if (wired && !circuitId)
      state.issues.push(`${l.name ?? '조명'}: 분전반 회로에 연결되지 않았습니다`)
  }
  for (const s of switches) {
    const sw = state.switches.get(s.id)
    if (sw) sw.live = live.has(key(s.id, 'line'))
    const gangWired = Array.from({ length: s.gangs }, (_, g) =>
      wiredTerminals.has(key(s.id, `gang:${g}`)),
    )
    if (gangWired.some(Boolean) && !wiredTerminals.has(key(s.id, 'line'))) {
      state.issues.push(`${s.name ?? '스위치'}: 전원(L) 배선이 없습니다`)
    }
  }
  state.issues = Array.from(new Set(state.issues))
  cache.set(nodes, state)
  return state
}

/** Whether a light shows as on: wired lights follow the circuit. */
export function isLightLit(nodes: Readonly<Record<string, AnyNode>>, lightId: string): boolean {
  const light = nodes[lightId] as { enabled?: boolean; visible?: boolean } | undefined
  if (!light || light.visible === false || light.enabled === false) return false
  const s = solveElectrical(nodes).lights.get(lightId)
  return !s?.wired || s.powered
}
