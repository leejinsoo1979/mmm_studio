'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import type { CountertopCutout, CountertopNode } from './schema'

function NumberRow({
  label,
  value,
  onCommit,
  min,
  max,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
  min: number
  max: number
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const v = Number(draft)
    if (!Number.isFinite(v)) return setDraft(String(value))
    const clamped = Math.min(max, Math.max(min, v))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <label className="flex h-9 items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          className="w-20 bg-transparent text-right outline-none"
          onBlur={commit}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            e.stopPropagation()
          }}
          value={draft}
        />
        <span className="text-muted-foreground text-xs">mm</span>
      </span>
    </label>
  )
}

const CUTOUT_DEFAULTS: Record<CountertopCutout['kind'], { widthMm: number; depthMm: number }> = {
  sink: { widthMm: 800, depthMm: 460 },
  cooktop: { widthMm: 560, depthMm: 490 },
}

export default function CountertopPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const node = useScene((s) =>
    selectedId
      ? (s.nodes[selectedId as AnyNodeId] as unknown as CountertopNode | undefined)
      : undefined,
  )
  if (node?.type !== 'countertop') return null
  const update = (patch: Partial<CountertopNode>) =>
    useScene.getState().updateNode(node.id as AnyNodeId, patch as Partial<AnyNode>)
  const updateCutout = (id: string, patch: Partial<CountertopCutout>) =>
    update({ cutouts: node.cutouts.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const addCutout = (kind: CountertopCutout['kind']) =>
    update({
      cutouts: [
        ...node.cutouts,
        {
          id: `cut_${Date.now().toString(36)}`,
          kind,
          centerMm: node.lengthMm / 2,
          ...CUTOUT_DEFAULTS[kind],
        },
      ],
    })

  return (
    <PanelWrapper
      icon="/icons/shelf.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title={node.name || '상판'}
      width={300}
    >
      <PanelSection title="치수">
        <NumberRow
          label="길이"
          max={6000}
          min={300}
          onCommit={(lengthMm) => update({ lengthMm })}
          value={node.lengthMm}
        />
        <NumberRow
          label="깊이"
          max={1200}
          min={300}
          onCommit={(depthMm) => update({ depthMm })}
          value={node.depthMm}
        />
        <SegmentedControl
          onChange={(t) => update({ thicknessMm: Number(t) as CountertopNode['thicknessMm'] })}
          options={['10', '20', '30'].map((t) => ({ label: `${t}T`, value: t }))}
          value={String(node.thicknessMm)}
        />
        <NumberRow
          label="뒷턱 높이"
          max={200}
          min={0}
          onCommit={(backsplashMm) => update({ backsplashMm })}
          value={node.backsplashMm}
        />
        <NumberRow
          label="설치 높이"
          max={2000}
          min={0}
          onCommit={(mm) => update({ position: [node.position[0], mm / 1000, node.position[2]] })}
          value={Math.round(node.position[1] * 1000)}
        />
        <label className="flex h-9 items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
          <span className="text-muted-foreground">색상</span>
          <input
            onChange={(e) => update({ color: e.target.value })}
            type="color"
            value={node.color}
          />
        </label>
      </PanelSection>
      <PanelSection title="타공">
        <ActionGroup>
          <ActionButton label="싱크볼 추가" onClick={() => addCutout('sink')} />
          <ActionButton label="쿡탑 추가" onClick={() => addCutout('cooktop')} />
        </ActionGroup>
        {node.cutouts.map((cut) => (
          <div
            className="flex flex-col gap-1.5 rounded-lg border border-border/40 p-2"
            key={cut.id}
          >
            <div className="flex items-center justify-between text-xs">
              <span>{cut.kind === 'sink' ? '싱크볼' : '쿡탑'}</span>
              <button
                className="text-[#ff9a9a] hover:underline"
                onClick={() => update({ cutouts: node.cutouts.filter((c) => c.id !== cut.id) })}
                type="button"
              >
                삭제
              </button>
            </div>
            <NumberRow
              label="중심(왼쪽 끝부터)"
              max={node.lengthMm}
              min={0}
              onCommit={(centerMm) => updateCutout(cut.id, { centerMm })}
              value={cut.centerMm}
            />
            <NumberRow
              label="폭"
              max={1500}
              min={200}
              onCommit={(widthMm) => updateCutout(cut.id, { widthMm })}
              value={cut.widthMm}
            />
            <NumberRow
              label="깊이"
              max={700}
              min={200}
              onCommit={(depthMm) => updateCutout(cut.id, { depthMm })}
              value={cut.depthMm}
            />
          </div>
        ))}
      </PanelSection>
    </PanelWrapper>
  )
}
