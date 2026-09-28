'use client'

import {
  type AnyNode,
  type ElectricPanelNode,
  type LightSwitchNode,
  solveElectrical,
  useScene,
} from '@pascal-app/core'
import { CATALOG_SCROLL, CatalogCard, CatalogSection, useEditor } from '@pascal-app/editor'
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
  /** Short card line; defaults to the label. */
  meta?: string
  detail: string
  icon: typeof Circle
}

const PLACE_HELP =
  '바닥(천장등은 천장 아래)을 클릭해 배치합니다. 배치·배선 도구는 3D 또는 분할 화면에서 동작합니다.'

const WIRING_HELP =
  '배선: 분전반 회로 → 스위치 L, 스위치 각 구 → 조명, 조명 → 조명(병렬) 순서로 단자를 두 번 클릭해 연결합니다.'

const LIGHTS: ToolEntry[] = [
  {
    id: 'ceiling',
    tool: 'light',
    defaults: { kind: 'point', ceiling: true },
    label: '천장등',
    detail: `천장 높이에 붙는 조명입니다. ${PLACE_HELP}`,
    icon: Lamp,
  },
  {
    id: 'point',
    tool: 'light',
    defaults: { kind: 'point', height: 2.4 },
    label: '포인트 조명',
    detail: `전방향 전구입니다. ${PLACE_HELP}`,
    icon: Circle,
  },
  {
    id: 'spot',
    tool: 'light',
    defaults: { kind: 'spot', height: 2.4 },
    label: '스포트 조명',
    detail: `집중형 원뿔 조명입니다. ${PLACE_HELP}`,
    icon: Flashlight,
  },
  {
    id: 'area',
    tool: 'light',
    defaults: { kind: 'area', height: 2.2 },
    label: '면 조명',
    detail: `부드러운 사각 면광원입니다. ${PLACE_HELP}`,
    icon: RectangleHorizontal,
  },
]

const WIRING: ToolEntry[] = [
  ...[1, 2, 3].map((gangs) => ({
    id: `switch-${gangs}`,
    tool: 'light-switch',
    defaults: { gangs },
    label: `스위치 ${gangs}구`,
    detail: `벽을 클릭해 설치합니다. ${WIRING_HELP}`,
    icon: ToggleLeft,
  })),
  {
    id: 'panel',
    tool: 'electric-panel',
    label: '분전반',
    detail: `회로별 차단기입니다. ${WIRING_HELP}`,
    icon: PanelTop,
  },
  {
    id: 'wire',
    tool: 'wire',
    label: '배선',
    detail: `단자 → 단자를 클릭합니다. ${WIRING_HELP}`,
    icon: Cable,
  },
]

function ToolCards({ entries }: { entries: ToolEntry[] }) {
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
  }
  return entries.map((e) => {
    const Icon = e.icon
    return (
      <CatalogCard
        active={
          activeTool === e.tool && (!e.defaults || activeDefaults === JSON.stringify(e.defaults))
        }
        hover={{ description: e.detail }}
        key={e.id}
        label={e.label}
        meta={e.meta ?? e.label}
        onClick={() => activate(e)}
        thumb={<Icon className="size-7 text-[#555] dark:text-neutral-300" strokeWidth={1.5} />}
      />
    )
  })
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      className={`rounded-md px-2 py-1 text-[11px] ${on ? 'bg-[#ffd166] font-semibold text-[#5a4300]' : 'bg-white/80 text-neutral-500 dark:bg-white/10 dark:text-neutral-300'}`}
      onClick={onClick}
      type="button"
    >
      {label} {on ? '켜짐' : '꺼짐'}
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
      <p className="text-muted-foreground/70 text-[11px] leading-5">
        분전반과 스위치를 설치하고 배선하면 여기서 차단기와 스위치를 켜고 끌 수 있습니다.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="text-muted-foreground">
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
            <span className="text-muted-foreground/70">
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
        <ul className="flex flex-col gap-1 rounded-lg bg-[#fff4e0] p-2 text-[#8a5a1a] dark:bg-[#3a2a14] dark:text-[#f5c48a]">
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
    <div className="flex h-full flex-col text-foreground">
      <div className={`${CATALOG_SCROLL} pb-3`}>
        <CatalogSection title="조명">
          <ToolCards entries={LIGHTS} />
        </CatalogSection>
        <CatalogSection title="스위치 · 분전반 · 배선">
          <ToolCards entries={WIRING} />
        </CatalogSection>
        <CatalogSection grid={false} title="배선 시뮬레이션">
          <div className="rounded-[10px] bg-[var(--panel-card,#f3f3f3)] p-3 text-[var(--panel-card-fg,#333)]">
            <WiringSimulation />
          </div>
        </CatalogSection>
      </div>
    </div>
  )
}
