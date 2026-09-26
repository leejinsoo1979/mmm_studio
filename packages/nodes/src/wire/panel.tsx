'use client'

import { type AnyNode, useScene, type WireNode } from '@pascal-app/core'
import { PanelSection, PanelWrapper } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { MmField } from '../cabinet/panel-fields'
import { circuitName, DeviceActions, useElectrical } from '../shared/electrical-panel-parts'

function endLabel(nodes: Record<string, AnyNode>, e: WireNode['from']): string {
  const n = nodes[e.nodeId]
  const name =
    n?.name ?? (n?.type === 'light' ? '조명' : n?.type === 'electric-panel' ? '분전반' : '스위치')
  if (e.terminal === 'line') return `${name} · 전원(L)`
  if (e.terminal.startsWith('gang:')) return `${name} · ${Number(e.terminal.slice(5)) + 1}구`
  if (e.terminal.startsWith('circuit:') && n?.type === 'electric-panel') {
    const c = (n as unknown as { circuits: { id: string; name: string }[] }).circuits.find(
      (x) => x.id === e.terminal.slice(8),
    )
    return `${name} · ${c?.name ?? '회로'}`
  }
  return name
}

/** 배선: its two ends, circuit, live state and run height. */
export default function WirePanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes) as Record<string, AnyNode>
  const node = selectedId ? (nodes[selectedId] as unknown as WireNode | undefined) : undefined
  const electrical = useElectrical()
  if (!(node?.type === 'wire')) return null
  const info = electrical.wires.get(node.id)
  return (
    <PanelWrapper
      icon="/icons/light.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title="배선"
      width={300}
    >
      <PanelSection title="배선">
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">시작</span>
            <span>{endLabel(nodes, node.from)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">끝</span>
            <span>{endLabel(nodes, node.to)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">회로</span>
            <span>
              {circuitName(electrical, info?.circuitId ?? null)} ·{' '}
              {info?.energized ? '통전' : '차단'}
            </span>
          </div>
        </div>
        <MmField
          label="배선 높이 (천장 속)"
          max={6000}
          min={0}
          onCommit={(mm) =>
            useScene.getState().updateNode(node.id, { height: mm / 1000 } as Partial<AnyNode>)
          }
          value={Math.round(node.height * 1000)}
        />
      </PanelSection>
      <DeviceActions node={node as unknown as AnyNode} />
    </PanelWrapper>
  )
}
