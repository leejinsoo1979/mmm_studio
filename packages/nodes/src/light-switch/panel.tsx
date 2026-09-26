'use client'

import { type AnyNode, type LightSwitchNode, useScene } from '@pascal-app/core'
import { PanelSection, PanelWrapper, SegmentedControl } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { MmField } from '../cabinet/panel-fields'
import {
  circuitName,
  DeviceActions,
  OnOffButton,
  useElectrical,
} from '../shared/electrical-panel-parts'

/** 스위치: 구 수, gang on/off (the simulation), height and its circuit. */
export default function LightSwitchPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as LightSwitchNode | undefined) : undefined,
  )
  const electrical = useElectrical()
  if (!(node?.type === 'light-switch')) return null
  const update = (patch: Partial<LightSwitchNode>) =>
    useScene.getState().updateNode(node.id, patch as Partial<AnyNode>)
  const power = electrical.switches.get(node.id)
  const on = Array.from({ length: node.gangs }, (_, g) => node.on[g] === true)
  return (
    <PanelWrapper
      icon="/icons/light.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title={node.name ?? '스위치'}
      width={300}
    >
      <PanelSection title="스위치">
        <SegmentedControl
          onChange={(v) => {
            const gangs = Number(v)
            update({ gangs, on: Array.from({ length: gangs }, (_, g) => node.on[g] === true) })
          }}
          options={[
            { label: '1구', value: '1' },
            { label: '2구', value: '2' },
            { label: '3구', value: '3' },
          ]}
          value={String(node.gangs)}
        />
        <div className="flex gap-1.5">
          {on.map((v, g) => (
            <OnOffButton
              key={g}
              label={`${g + 1}구`}
              on={v}
              onToggle={() => update({ on: on.map((x, i) => (i === g ? !x : x)) })}
            />
          ))}
        </div>
        <MmField
          label="설치 높이"
          max={2400}
          min={100}
          onCommit={(mm) => update({ position: [node.position[0], mm / 1000, node.position[2]] })}
          value={Math.round(node.position[1] * 1000)}
        />
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">회로</span>
          <span>
            {circuitName(electrical, power?.circuitId ?? null)} ·{' '}
            {power?.live ? '전원 있음' : '전원 없음'}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          배선 도구로 분전반 회로 → 전원(L), 각 구 → 조명을 연결하면 켜고 끌 수 있습니다.
        </p>
      </PanelSection>
      <DeviceActions node={node as unknown as AnyNode} />
    </PanelWrapper>
  )
}
