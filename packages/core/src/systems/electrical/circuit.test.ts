import { describe, expect, test } from 'bun:test'
import { ElectricPanelNode, LightNode, LightSwitchNode, WireNode } from '../../schema'
import { deviceTerminals, isLightLit, solveElectrical } from './circuit'

function scene(opts: { gangOn?: boolean[]; breaker?: boolean; lineWired?: boolean } = {}) {
  const panel = ElectricPanelNode.parse({
    circuits: [{ id: 'c1', name: '전등 1', on: opts.breaker ?? true }],
  })
  const sw = LightSwitchNode.parse({ gangs: 2, on: opts.gangOn ?? [true, false] })
  const a = LightNode.parse({ name: '거실등' })
  const b = LightNode.parse({ name: '주방등' })
  const c = LightNode.parse({ name: '복도등' })
  const free = LightNode.parse({ name: '스탠드' })
  const wire = (from: [string, string], to: [string, string]) =>
    WireNode.parse({
      path: [
        [0, 0],
        [1, 0],
      ],
      from: { nodeId: from[0], terminal: from[1] },
      to: { nodeId: to[0], terminal: to[1] },
    })
  const wires = [
    ...(opts.lineWired === false ? [] : [wire([panel.id, 'circuit:c1'], [sw.id, 'line'])]),
    wire([sw.id, 'gang:0'], [a.id, 'in']),
    wire([a.id, 'in'], [b.id, 'in']), // chained on gang 1
    wire([sw.id, 'gang:1'], [c.id, 'in']),
  ]
  const nodes = Object.fromEntries(
    [panel, sw, a, b, c, free, ...wires].map((n) => [n.id, n]),
  ) as never
  return { nodes, panel, sw, a, b, c, free, wires }
}

describe('lighting circuits', () => {
  test('a gang lights its wired lights, chained lights included', () => {
    const { nodes, a, b, c } = scene()
    expect([isLightLit(nodes, a.id), isLightLit(nodes, b.id), isLightLit(nodes, c.id)]).toEqual([
      true,
      true,
      false,
    ])
  })

  test('the breaker cuts the whole circuit; unwired lights keep their own state', () => {
    const { nodes, a, free } = scene({ breaker: false, gangOn: [true, true] })
    expect(isLightLit(nodes, a.id)).toBe(false)
    expect(isLightLit(nodes, free.id)).toBe(true)
  })

  test('circuit membership ignores switch positions; energized follows them', () => {
    const { nodes, c, wires } = scene()
    const s = solveElectrical(nodes)
    expect(s.lights.get(c.id)?.circuitId).not.toBeNull()
    expect(s.circuits[0]).toMatchObject({ name: '전등 1', lights: 3, switches: 1 })
    expect(wires.map((w) => s.wires.get(w.id)?.energized)).toEqual([true, true, true, false])
  })

  test('a switch without its line wire is reported', () => {
    const { nodes, a } = scene({ lineWired: false })
    const s = solveElectrical(nodes)
    expect(isLightLit(nodes, a.id)).toBe(false)
    expect(s.issues).toContain('스위치: 전원(L) 배선이 없습니다')
    expect(s.issues).toContain('거실등: 분전반 회로에 연결되지 않았습니다')
  })

  test('terminals sit in front of the device, one per gang plus the line', () => {
    const sw = LightSwitchNode.parse({ gangs: 3, position: [1, 1.2, 0], rotation: [0, 0, 0] })
    const t = deviceTerminals(sw as never)
    expect(t.map((x) => x.terminal)).toEqual(['line', 'gang:0', 'gang:1', 'gang:2'])
    expect(t.every((x) => Math.abs(x.point[1] - 0.18) < 1e-9)).toBe(true)
  })
})
