'use client'

import { type AnyNode, solveElectrical, useScene } from '@pascal-app/core'
import { ActionButton, ActionGroup, PanelSection, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Move, Trash2 } from 'lucide-react'

/** On/off pill used for switch gangs and breakers. */
export function OnOffButton({
  label,
  on,
  onToggle,
}: {
  label: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      className={`flex h-10 flex-1 flex-col items-center justify-center rounded-lg border text-xs transition-colors ${
        on
          ? 'border-[#ffd166]/70 bg-[#ffd166]/15 text-foreground'
          : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e]'
      }`}
      onClick={onToggle}
      type="button"
    >
      <span>{label}</span>
      <span className="font-semibold">{on ? 'ON' : 'OFF'}</span>
    </button>
  )
}

/** The circuit a node is on and the level's wiring issues. */
export function useElectrical() {
  const nodes = useScene((s) => s.nodes)
  return solveElectrical(nodes)
}

export function circuitName(state: ReturnType<typeof solveElectrical>, key: string | null) {
  if (!key) return '미연결'
  return state.circuits.find((c) => c.key === key)?.name ?? '미연결'
}

/** 이동 / 삭제 for electrical devices. */
export function DeviceActions({ node }: { node: AnyNode }) {
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setSelection = useViewer((s) => s.setSelection)
  return (
    <PanelSection title="작업">
      <ActionGroup>
        <ActionButton
          icon={<Move className="h-3.5 w-3.5" />}
          label="이동"
          onClick={() => {
            triggerSFX('sfx:item-pick')
            setMovingNode(node as never)
            setSelection({ selectedIds: [] })
          }}
        />
        <ActionButton
          className="hover:bg-red-500/20"
          icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
          label="삭제"
          onClick={() => {
            // Wires ending on the device go with it.
            const nodes = useScene.getState().nodes
            const wires = Object.values(nodes).filter(
              (n) =>
                n?.type === 'wire' &&
                ((n as { from: { nodeId: string } }).from.nodeId === node.id ||
                  (n as { to: { nodeId: string } }).to.nodeId === node.id),
            )
            useScene.getState().deleteNodes([...wires.map((w) => w.id), node.id] as never)
            setSelection({ selectedIds: [] })
          }}
        />
      </ActionGroup>
    </PanelSection>
  )
}
