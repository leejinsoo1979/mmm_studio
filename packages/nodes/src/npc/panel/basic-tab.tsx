'use client'

import { type AnyNode, type AnyNodeId, useLiveTransforms, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  ALL_AVATARS,
  AVATAR_TABS,
  type AvatarTab,
  avatarLabel,
  avatarTab,
  avatarThumbnailUrl,
  cn,
  findAvatar,
  PanelSection,
  SegmentedControl,
  SliderControl,
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Palette, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNpcStudioRequest } from '../look-request'
import { NPC_ROLE_LABELS, NpcNode, type NpcRole } from '../schema'
import { countNpcs, NPC_LIMIT, nextNpcName } from '../tool'

/** Past this many NPCs the inspector says play may slow down. */
const NPC_WARN_COUNT = 12

const ROLE_OPTIONS: { label: string; value: NpcRole }[] = [
  { label: NPC_ROLE_LABELS.resident, value: 'resident' },
  { label: NPC_ROLE_LABELS.passerby, value: 'passerby' },
  { label: NPC_ROLE_LABELS.guide, value: 'guide' },
  { label: NPC_ROLE_LABELS.consultant, value: 'consultant' },
  { label: '직접 설정', value: 'custom' },
]

const AVATAR_TAB_OPTIONS = AVATAR_TABS.map(({ id, label }) => ({ label, value: id }))

const toDegrees = (radians: number) => Math.round((radians * 180) / Math.PI)

/** A text input that commits trimmed, non-empty text on Enter / blur; Escape restores. */
export function TextField({
  label,
  value,
  maxLength,
  onCommit,
}: {
  label?: string
  value: string
  maxLength: number
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = draft.trim()
    if (next && next !== value) onCommit(next)
    else setDraft(value)
  }
  return (
    <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/50 bg-muted px-3 text-sm">
      {label && <span className="shrink-0 text-muted-foreground">{label}</span>}
      <input
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
        maxLength={maxLength}
        onBlur={commit}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(value)
            ;(e.target as HTMLInputElement).blur()
          }
          e.stopPropagation()
        }}
        type="text"
        value={draft}
      />
    </label>
  )
}

/** The Rocketbox library by tab, as a compact thumbnail grid. */
function AvatarPicker({ value, onPick }: { value: string; onPick: (avatarId: string) => void }) {
  const current = findAvatar(value)
  const [tab, setTab] = useState<AvatarTab>(() => avatarTab(current))
  const avatars = useMemo(() => ALL_AVATARS.filter((avatar) => avatarTab(avatar) === tab), [tab])
  return (
    <>
      <SegmentedControl onChange={setTab} options={AVATAR_TAB_OPTIONS} value={tab} />
      <div className="grid max-h-[228px] grid-cols-5 gap-1 overflow-y-auto pr-0.5">
        {avatars.map((avatar) => (
          <button
            aria-label={avatarLabel(avatar.id)}
            aria-pressed={avatar.id === current.id}
            className={cn(
              'rounded-lg border p-0.5 transition-colors',
              avatar.id === current.id
                ? 'border-sky-500 bg-sky-500/10'
                : 'border-transparent hover:border-border hover:bg-accent/50',
            )}
            key={avatar.id}
            onClick={() => {
              if (avatar.id === current.id) return
              triggerSFX('sfx:menu-click')
              onPick(avatar.id)
            }}
            title={avatarLabel(avatar.id)}
            type="button"
          >
            <img
              alt=""
              className="aspect-[128/208] w-full object-contain"
              loading="lazy"
              src={avatarThumbnailUrl(avatar.id)}
            />
          </button>
        ))}
      </div>
    </>
  )
}

export default function NpcBasicTab({
  node,
  update,
}: {
  node: NpcNode
  update: (patch: Partial<NpcNode>) => void
}) {
  const npcCount = useScene((s) => countNpcs(s.nodes))
  const [draftRotation, setDraftRotation] = useState<number | null>(null)

  // A yaw drag previews through live transforms; drop it if the panel closes mid-drag.
  useEffect(() => () => useLiveTransforms.getState().clear(node.id), [node.id])

  const previewRotation = (degrees: number) => {
    const rotation = (degrees * Math.PI) / 180
    setDraftRotation(rotation)
    useLiveTransforms.getState().set(node.id, { position: [...node.position], rotation })
  }
  const commitRotation = (degrees: number) => {
    const rotation = (degrees * Math.PI) / 180
    useLiveTransforms.getState().clear(node.id)
    setDraftRotation(null)
    if (Math.abs(rotation - node.rotation) > 1e-6) update({ rotation })
  }
  const setPosition = (axis: 0 | 2, value: number) => {
    const position: [number, number, number] = [...node.position]
    position[axis] = value
    update({ position })
  }

  const handleMove = () => {
    triggerSFX('sfx:item-pick')
    useEditor.getState().setMovingNode(node as never)
    useViewer.getState().setSelection({ selectedIds: [] })
  }
  const handleDuplicate = () => {
    const { nodes, createNode } = useScene.getState()
    if (!node.parentId || countNpcs(nodes) >= NPC_LIMIT) return
    triggerSFX('sfx:item-pick')
    const metadata =
      typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
        ? node.metadata
        : {}
    const copy = NpcNode.parse({
      ...structuredClone(node),
      id: undefined,
      name: nextNpcName(node.name, nodes),
      metadata: { ...metadata, isNew: true },
    })
    createNode(copy as unknown as AnyNode, node.parentId as AnyNodeId)
    useEditor.getState().setMovingNode(copy as never)
    useViewer.getState().setSelection({ selectedIds: [] })
  }
  const handleDelete = () => {
    triggerSFX('sfx:structure-delete')
    useScene.getState().deleteNode(node.id as AnyNodeId)
    useViewer.getState().setSelection({ selectedIds: [] })
  }

  const storedDegrees = toDegrees(node.rotation)

  return (
    <>
      <PanelSection title="이름과 역할">
        <TextField
          label="이름"
          maxLength={24}
          onCommit={(name) => update({ name })}
          value={node.name}
        />
        <SegmentedControl
          onChange={(role) => update({ role })}
          options={ROLE_OPTIONS}
          value={node.role}
        />
        <ToggleControl
          checked={node.showNameTag}
          label="머리 위 이름표 보이기"
          onChange={(showNameTag) => update({ showNameTag })}
        />
      </PanelSection>

      <PanelSection title="캐릭터">
        <AvatarPicker onPick={(avatar) => update({ avatar })} value={node.avatar} />
        <ActionGroup>
          <ActionButton
            icon={<Palette className="h-3.5 w-3.5" />}
            label="외형 꾸미기"
            onClick={() => {
              triggerSFX('sfx:menu-click')
              useNpcStudioRequest.getState().request(node.id)
            }}
          />
          {node.look && (
            <ActionButton
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label="기본 외형으로"
              onClick={() => update({ look: null })}
            />
          )}
        </ActionGroup>
      </PanelSection>

      <PanelSection title="위치와 방향">
        <SliderControl
          label="X"
          max={node.position[0] + 2}
          min={node.position[0] - 2}
          onChange={(value) => setPosition(0, value)}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label="Z"
          max={node.position[2] + 2}
          min={node.position[2] - 2}
          onChange={(value) => setPosition(2, value)}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
        <SliderControl
          label="방향"
          max={storedDegrees + 180}
          min={storedDegrees - 180}
          onChange={previewRotation}
          onCommit={commitRotation}
          precision={0}
          step={1}
          unit="°"
          value={toDegrees(draftRotation ?? node.rotation)}
        />
      </PanelSection>

      <PanelSection title="동작">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="이동" onClick={handleMove} />
          <ActionButton
            className="disabled:pointer-events-none disabled:opacity-40"
            disabled={npcCount >= NPC_LIMIT}
            icon={<Copy className="h-3.5 w-3.5" />}
            label="복제"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="삭제"
            onClick={handleDelete}
          />
        </ActionGroup>
        {npcCount > NPC_WARN_COUNT && (
          <p className="px-1 text-amber-500 text-xs leading-relaxed">
            이 장면에 NPC가 {npcCount}명 있어요. 많을수록 플레이가 느려질 수 있어요 (최대{' '}
            {NPC_LIMIT}명).
          </p>
        )}
      </PanelSection>
    </>
  )
}
