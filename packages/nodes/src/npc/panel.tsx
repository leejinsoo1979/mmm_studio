'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { avatarThumbnailUrl, PanelWrapper, SegmentedControl } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useState } from 'react'
import NpcAiTab from './panel/ai-tab'
import NpcBasicTab from './panel/basic-tab'
import NpcBehaviorTab from './panel/behavior-tab'
import NpcDialogueTab from './panel/dialogue-tab'
import type { NpcNode } from './schema'

type NpcPanelTab = 'basic' | 'behavior' | 'dialogue' | 'ai'

const TABS: { label: string; value: NpcPanelTab }[] = [
  { label: '기본', value: 'basic' },
  { label: '행동', value: 'behavior' },
  { label: '대화', value: 'dialogue' },
  { label: 'AI', value: 'ai' },
]

const TAB_COMPONENTS = {
  basic: NpcBasicTab,
  behavior: NpcBehaviorTab,
  dialogue: NpcDialogueTab,
  ai: NpcAiTab,
} satisfies Record<NpcPanelTab, unknown>

/** The NPC inspector: 기본 (who and where), 행동 (how it moves and greets), 대화 (its script) and AI. */
export default function NpcPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const raw = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNodeId] as unknown as NpcNode | undefined) : undefined,
  )
  const node = raw?.type === 'npc' ? raw : undefined
  const [tab, setTab] = useState<NpcPanelTab>('basic')

  const update = useCallback(
    (patch: Partial<NpcNode>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId as AnyNodeId, patch as Partial<AnyNode>)
    },
    [selectedId],
  )

  if (!node) return null
  const Tab = TAB_COMPONENTS[tab]

  return (
    <PanelWrapper
      icon={
        <img
          alt=""
          className="size-5 rounded-full bg-accent/60 object-cover object-top"
          src={avatarThumbnailUrl(node.avatar)}
        />
      }
      onClose={() => setSelection({ selectedIds: [] })}
      title={node.name}
      width={340}
    >
      <div className="px-3 pt-2">
        <SegmentedControl onChange={setTab} options={TABS} value={tab} />
      </div>
      <Tab key={node.id} node={node} update={update} />
    </PanelWrapper>
  )
}
