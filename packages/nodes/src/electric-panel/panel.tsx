'use client'

import { type AnyNode, type ElectricPanelNode, useScene } from '@pascal-app/core'
import { ActionButton, ActionGroup, PanelSection, PanelWrapper } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { DeviceActions, OnOffButton, useElectrical } from '../shared/electrical-panel-parts'

/** 분전반: circuits (name, breaker), what each feeds, and wiring issues. */
export default function ElectricPanelPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const node = useScene((s) =>
    selectedId
      ? (s.nodes[selectedId as AnyNode['id']] as ElectricPanelNode | undefined)
      : undefined,
  )
  const electrical = useElectrical()
  if (!(node?.type === 'electric-panel')) return null
  const setCircuits = (circuits: ElectricPanelNode['circuits']) =>
    useScene.getState().updateNode(node.id, { circuits } as Partial<AnyNode>)
  return (
    <PanelWrapper
      icon="/icons/light.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title={node.name ?? '분전반'}
      width={300}
    >
      <PanelSection title="회로 (차단기)">
        {node.circuits.map((c, i) => {
          const info = electrical.circuits.find(
            (x) => x.panelId === node.id && x.circuitId === c.id,
          )
          return (
            <div className="flex items-center gap-1.5" key={c.id}>
              <input
                className="h-10 min-w-0 flex-1 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-sm outline-none"
                onChange={(e) =>
                  setCircuits(
                    node.circuits.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)),
                  )
                }
                onKeyDown={(e) => e.stopPropagation()}
                value={c.name}
              />
              <span className="w-16 text-right text-[11px] text-muted-foreground">
                조명 {info?.lights ?? 0} · 스위치 {info?.switches ?? 0}
              </span>
              <div className="w-16">
                <OnOffButton
                  label={`회로 ${i + 1}`}
                  on={c.on}
                  onToggle={() =>
                    setCircuits(node.circuits.map((x) => (x.id === c.id ? { ...x, on: !x.on } : x)))
                  }
                />
              </div>
            </div>
          )
        })}
        <ActionGroup>
          <ActionButton
            label="회로 추가"
            onClick={() => {
              let n = node.circuits.length + 1
              while (node.circuits.some((c) => c.id === `c${n}`)) n += 1
              setCircuits([...node.circuits, { id: `c${n}`, name: `전등 ${n}`, on: true }])
            }}
          />
          {node.circuits.length > 1 && (
            <ActionButton
              label="마지막 회로 삭제"
              onClick={() => setCircuits(node.circuits.slice(0, -1))}
            />
          )}
        </ActionGroup>
      </PanelSection>
      {electrical.issues.length > 0 && (
        <PanelSection title="배선 점검">
          <ul className="flex flex-col gap-1 text-[#f5c48a] text-xs">
            {electrical.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </PanelSection>
      )}
      <DeviceActions node={node as unknown as AnyNode} />
    </PanelWrapper>
  )
}
