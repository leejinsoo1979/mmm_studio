'use client'

import {
  type AnyNode,
  type ElectricPanelNode,
  type LightSwitchNode,
  solveElectrical,
  useScene,
} from '@pascal-app/core'
import { triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import {
  Cable,
  Circle,
  Flashlight,
  Lamp,
  PanelTop,
  RectangleHorizontal,
  ToggleLeft,
} from 'lucide-react'

type ToolEntry = {
  id: string
  tool: string
  defaults?: Record<string, unknown>
  label: string
  detail: string
  icon: typeof Circle
}

const LIGHTS: ToolEntry[] = [
  {
    id: 'ceiling',
    tool: 'light',
    defaults: { kind: 'point', ceiling: true },
    label: '천장등',
    detail: '천장 높이에 붙는 조명',
    icon: Lamp,
  },
  {
    id: 'point',
    tool: 'light',
    defaults: { kind: 'point', height: 2.4 },
    label: 'Point Light',
    detail: 'Omnidirectional bulb',
    icon: Circle,
  },
  {
    id: 'spot',
    tool: 'light',
    defaults: { kind: 'spot', height: 2.4 },
    label: 'Spot Light',
    detail: 'Focused cone light',
    icon: Flashlight,
  },
  {
    id: 'area',
    tool: 'light',
    defaults: { kind: 'area', height: 2.2 },
    label: 'Area Light',
    detail: 'Soft rectangular light',
    icon: RectangleHorizontal,
  },
]

const WIRING: ToolEntry[] = [
  ...[1, 2, 3].map((gangs) => ({
    id: `switch-${gangs}`,
    tool: 'light-switch',
    defaults: { gangs },
    label: `스위치 ${gangs}구`,
    detail: '벽을 클릭해 설치',
    icon: ToggleLeft,
  })),
  {
    id: 'panel',
    tool: 'electric-panel',
    label: '분전반',
    detail: '회로별 차단기',
    icon: PanelTop,
  },
  {
    id: 'wire',
    tool: 'wire',
    label: '배선',
    detail: '단자 → 단자 클릭',
    icon: Cable,
  },
]

function ToolGrid({ entries }: { entries: ToolEntry[] }) {
  const activeTool = useEditor((s) => s.tool)
  const activeDefaults = useEditor((s) =>
    s.tool ? JSON.stringify(s.toolDefaults[s.tool] ?? {}) : '',
  )
  const activate = (e: ToolEntry) => {
    const editor = useEditor.getState()
    editor.setPhase('furnish')
    editor.setCatalogCategory(null)
    if (e.defaults) editor.setToolDefaults(e.tool, e.defaults)
    editor.setMode('build')
    editor.setTool(e.tool)
    triggerSFX('sfx:menu-click')
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {entries.map((e) => {
        const Icon = e.icon
        const selected =
          activeTool === e.tool && (!e.defaults || activeDefaults === JSON.stringify(e.defaults))
        return (
          <button
            className={`group rounded-xl border p-3 text-left transition ${selected ? 'border-[#7779ff] bg-[#7779ff]/12' : 'border-[#383838] bg-[#222] hover:border-[#555] hover:bg-[#282828]'}`}
            key={e.id}
            onClick={() => activate(e)}
            type="button"
          >
            <span
              className={`grid h-9 w-9 place-items-center rounded-lg ${selected ? 'bg-[#7779ff] text-white' : 'bg-[#303030] text-[#d4d4d4]'}`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="mt-2 block font-semibold text-sm">{e.label}</span>
            <span className="mt-0.5 block text-[#858585] text-[11px]">{e.detail}</span>
          </button>
        )
      })}
    </div>
  )
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      className={`rounded-md border px-2 py-1 text-[11px] ${on ? 'border-[#ffd166]/70 bg-[#ffd166]/15 text-[#ffe39a]' : 'border-[#3a3a3a] bg-[#262626] text-[#9a9a9a]'}`}
      onClick={onClick}
      type="button"
    >
      {label} {on ? 'ON' : 'OFF'}
    </button>
  )
}

/** Every breaker and switch gang on the level, the lights they light, and
 *  the wiring check — the simulation's control desk. */
function WiringSimulation() {
  const levelId = useViewer((s) => s.selection.levelId)
  const nodes = useScene((s) => s.nodes)
  const state = solveElectrical(nodes)
  const onLevel = Object.values(nodes).filter((n) => n && n.parentId === levelId) as AnyNode[]
  const panels = onLevel.filter(
    (n) => n.type === 'electric-panel',
  ) as unknown as ElectricPanelNode[]
  const switches = onLevel.filter((n) => n.type === 'light-switch') as unknown as LightSwitchNode[]
  const lights = onLevel.filter((n) => n.type === 'light')
  const wired = lights.filter((l) => state.lights.get(l.id)?.wired)
  const lit = wired.filter((l) => state.lights.get(l.id)?.powered)
  const update = (id: string, patch: Record<string, unknown>) =>
    useScene.getState().updateNode(id as AnyNode['id'], patch as Partial<AnyNode>)
  if (panels.length === 0 && switches.length === 0) {
    return (
      <p className="text-[#777] text-[11px] leading-5">
        분전반과 스위치를 설치하고 배선하면 여기서 차단기와 스위치를 켜고 끌 수 있습니다.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="text-[#9a9a9a]">
        배선된 조명 {wired.length}개 중 {lit.length}개 켜짐
      </div>
      {panels.map((p) => (
        <div className="flex flex-col gap-1.5" key={p.id}>
          <div className="font-semibold">{p.name ?? '분전반'}</div>
          <div className="flex flex-wrap gap-1.5">
            {p.circuits.map((c) => (
              <Toggle
                key={c.id}
                label={c.name}
                on={c.on}
                onClick={() =>
                  update(p.id, {
                    circuits: p.circuits.map((x) => (x.id === c.id ? { ...x, on: !x.on } : x)),
                  })
                }
              />
            ))}
          </div>
        </div>
      ))}
      {switches.map((s) => (
        <div className="flex flex-col gap-1.5" key={s.id}>
          <div className="flex justify-between">
            <span className="font-semibold">{s.name ?? '스위치'}</span>
            <span className="text-[#777]">
              {state.switches.get(s.id)?.live ? '전원 있음' : '전원 없음'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: s.gangs }, (_, g) => (
              <Toggle
                key={g}
                label={`${g + 1}구`}
                on={s.on[g] === true}
                onClick={() =>
                  update(s.id, {
                    on: Array.from({ length: s.gangs }, (_, i) =>
                      i === g ? s.on[i] !== true : s.on[i] === true,
                    ),
                  })
                }
              />
            ))}
          </div>
        </div>
      ))}
      {state.issues.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-[#6b4b2a] bg-[#2a2118] p-2 text-[#f5c48a]">
          {state.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LightingTab() {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#1b1b1b] text-[#efefef]">
      <div className="border-[#343434] border-b px-6 py-6">
        <p className="text-[#8a8a8a] text-[10px] uppercase tracking-[0.16em]">Real-time</p>
        <h1 className="mt-1 font-bold text-3xl tracking-[-0.03em]">Lighting</h1>
        <p className="mt-2 text-[#9b9b9b] text-xs leading-5">
          조명을 고른 뒤 바닥(천장등은 천장 아래)을 클릭해 배치합니다. 배치·배선 도구는 3D 또는
          분할(Split) 화면에서 동작합니다.
        </p>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="text-[#9a9a9a] text-xs">조명</div>
        <ToolGrid entries={LIGHTS} />
      </div>
      <div className="flex flex-col gap-2 border-[#343434] border-t p-4">
        <div className="text-[#9a9a9a] text-xs">스위치 · 분전반 · 배선</div>
        <ToolGrid entries={WIRING} />
        <p className="text-[#777] text-[11px] leading-5">
          배선: 분전반 회로 → 스위치 L, 스위치 각 구 → 조명, 조명 → 조명(병렬) 순서로 단자를 두 번
          클릭해 연결합니다.
        </p>
      </div>
      <div className="flex flex-col gap-2 border-[#343434] border-t p-4">
        <div className="text-[#9a9a9a] text-xs">배선 시뮬레이션</div>
        <WiringSimulation />
      </div>
    </div>
  )
}
