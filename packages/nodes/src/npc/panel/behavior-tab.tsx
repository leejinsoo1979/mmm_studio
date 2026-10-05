'use client'

import { useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  cn,
  EMOTES,
  type EmoteId,
  PanelSection,
  SegmentedControl,
  SliderControl,
  ToggleControl,
  triggerSFX,
} from '@pascal-app/editor'
import { PenLine, Plus, Trash2, X } from 'lucide-react'
import { useMemo } from 'react'
import { collectSceneFacts, getNpcNameResolvers } from '../knowledge'
import {
  finishNpcPatrolDrawing,
  NPC_PATROL_MAX_POINTS,
  startNpcPatrolDrawing,
  useNpcPatrolDrawing,
} from '../patrol-tool'
import type { NpcBehavior, NpcBehaviorMode, NpcNode, NpcSpeed } from '../schema'
import { TextField } from './basic-tab'

type BehaviorPatch = (patch: Partial<NpcBehavior>) => void

const MODE_OPTIONS: { label: string; value: NpcBehaviorMode }[] = [
  { label: '가만히 서 있기', value: 'stand' },
  { label: '돌아다니기', value: 'wander' },
  { label: '순찰하기', value: 'patrol' },
]

const SPEED_OPTIONS: { label: string; value: NpcSpeed }[] = [
  { label: '느리게', value: 'slow' },
  { label: '보통', value: 'normal' },
  { label: '빠르게', value: 'brisk' },
]

const LOOP_OPTIONS: { label: string; value: NpcBehavior['patrolLoop'] }[] = [
  { label: '처음으로 돌아가기', value: 'loop' },
  { label: '왔던 길로 왕복', value: 'pingpong' },
]

/** Short motions that suit someone waiting around (no dances or moods: those loop until they walk). */
const IDLE_EMOTES: EmoteId[] = [
  'lookAround',
  'stretch',
  'yawn',
  'scratchHead',
  'drink',
  'shrug',
  'nod',
  'clap',
  'laugh',
  'photo',
]
const GREET_EMOTES: EmoteId[] = ['wave', 'waveBig', 'nod', 'clap', 'cheer', 'hooray']

const MAX_IDLE_EMOTES = 8
const MAX_BARKS = 8
const MAX_ROOMS = 16
const NEW_BARK = '안녕하세요!'

/** Room facts without the app's Korean item names; only the room list is read here. */
const PLAIN_NAMES = {
  item: (asset: { name: string }) => asset.name,
  material: (ref: string) => ref,
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="px-1 pt-1 text-muted-foreground text-xs">{children}</span>
}

function Chip({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-40',
        active
          ? 'border-sky-500 bg-sky-500/15 text-foreground'
          : 'border-border/50 bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      disabled={disabled}
      onClick={() => {
        triggerSFX('sfx:menu-click')
        onClick()
      }}
      type="button"
    >
      {label}
    </button>
  )
}

function IconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={onClick}
      title={label}
      type="button"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  )
}

/**
 * Rooms of the NPC's level that wandering may head for. Read once when shown:
 * rooms don't change while an NPC is selected, and the facts walk the scene.
 */
function WanderRooms({
  levelId,
  selected,
  setBehavior,
}: {
  levelId: string | null
  selected: string[]
  setBehavior: BehaviorPatch
}) {
  const rooms = useMemo(
    () =>
      collectSceneFacts(
        useScene.getState().nodes,
        getNpcNameResolvers() ?? PLAIN_NAMES,
      ).rooms.filter((room) => room.levelId === levelId),
    [levelId],
  )
  if (rooms.length === 0) {
    return (
      <FieldLabel>이 층에 방이 아직 없어요. 방을 만들면 활동 공간을 고를 수 있어요.</FieldLabel>
    )
  }
  const roomIds = new Set(rooms.map((room) => room.id))
  const toggle = (roomId: string) => {
    const next = selected.includes(roomId)
      ? selected.filter((id) => id !== roomId)
      : [...selected, roomId]
    setBehavior({ rooms: next.filter((id) => roomIds.has(id)) })
  }
  return (
    <>
      <FieldLabel>
        활동 공간{selected.length === 0 && ' (고르지 않으면 갈 수 있는 곳 어디든 다녀요)'}
      </FieldLabel>
      <div className="flex flex-wrap gap-1">
        {rooms.map((room) => {
          const active = selected.includes(room.id)
          return (
            <Chip
              active={active}
              disabled={!active && selected.length >= MAX_ROOMS}
              key={room.id}
              label={room.name}
              onClick={() => toggle(room.id)}
            />
          )
        })}
      </div>
    </>
  )
}

function PatrolPath({ node, setBehavior }: { node: NpcNode; setBehavior: BehaviorPatch }) {
  const { patrol, patrolLoop } = node.behavior
  const drawing = useNpcPatrolDrawing(node.id)
  return (
    <>
      {drawing ? (
        <p className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs leading-relaxed">
          바닥을 눌러 순찰 지점을 찍으세요. Backspace는 하나 되돌리기, Enter나 Esc는 끝내기예요.
        </p>
      ) : (
        patrol.length < 2 && (
          <FieldLabel>지점을 둘 이상 찍으면 그 사이를 오가며 순찰해요.</FieldLabel>
        )
      )}
      {patrol.length > 0 && (
        <ol className="flex flex-col gap-1">
          {patrol.map(([x, z], index) => (
            <li
              className="flex h-8 items-center justify-between rounded-md bg-muted pr-0.5 pl-2.5 text-xs tabular-nums"
              key={`${x},${z},${index}`}
            >
              <span>
                <span className="mr-2 font-semibold">{index + 1}</span>
                {`X ${x.toFixed(2)} · Z ${z.toFixed(2)} m`}
              </span>
              <IconButton
                label={`${index + 1}번 지점 지우기`}
                onClick={() => setBehavior({ patrol: patrol.filter((_, i) => i !== index) })}
              />
            </li>
          ))}
        </ol>
      )}
      <ActionGroup>
        {drawing ? (
          <ActionButton label="그리기 끝내기" onClick={finishNpcPatrolDrawing} />
        ) : (
          <ActionButton
            className="disabled:pointer-events-none disabled:opacity-40"
            disabled={patrol.length >= NPC_PATROL_MAX_POINTS}
            icon={<PenLine className="h-3.5 w-3.5" />}
            label={patrol.length > 0 ? '이어 그리기' : '경로 그리기'}
            onClick={() => {
              triggerSFX('sfx:menu-click')
              startNpcPatrolDrawing(node.id)
            }}
          />
        )}
        {patrol.length > 0 && (
          <ActionButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="모두 지우기"
            onClick={() => setBehavior({ patrol: [] })}
          />
        )}
      </ActionGroup>
      <FieldLabel>마지막 지점에서</FieldLabel>
      <SegmentedControl
        onChange={(loop) => setBehavior({ patrolLoop: loop })}
        options={LOOP_OPTIONS}
        value={patrolLoop}
      />
    </>
  )
}

export default function NpcBehaviorTab({
  node,
  update,
}: {
  node: NpcNode
  update: (patch: Partial<NpcNode>) => void
}) {
  const { behavior } = node
  const { greet } = behavior
  const setBehavior: BehaviorPatch = (patch) => update({ behavior: { ...behavior, ...patch } })
  const setGreet = (patch: Partial<NpcBehavior['greet']>) =>
    setBehavior({ greet: { ...greet, ...patch } })
  const moves = behavior.mode !== 'stand'

  return (
    <>
      <PanelSection title="움직임">
        <SegmentedControl
          onChange={(mode) => setBehavior({ mode })}
          options={MODE_OPTIONS}
          value={behavior.mode}
        />
        {moves && (
          <>
            <FieldLabel>걸음 속도</FieldLabel>
            <SegmentedControl
              onChange={(speed) => setBehavior({ speed })}
              options={SPEED_OPTIONS}
              value={behavior.speed}
            />
          </>
        )}
        {behavior.mode === 'wander' && (
          <SliderControl
            label="돌아다닐 반경"
            max={30}
            min={0.5}
            onChange={(wanderRadius) => setBehavior({ wanderRadius })}
            precision={1}
            step={0.5}
            unit="m"
            value={behavior.wanderRadius}
          />
        )}
        {moves && (
          <>
            <SliderControl
              label="최소 머무름"
              max={behavior.dwell[1]}
              min={0}
              onChange={(min) => setBehavior({ dwell: [min, behavior.dwell[1]] })}
              step={1}
              unit="초"
              value={behavior.dwell[0]}
            />
            <SliderControl
              label="최대 머무름"
              max={120}
              min={behavior.dwell[0]}
              onChange={(max) => setBehavior({ dwell: [behavior.dwell[0], max] })}
              step={1}
              unit="초"
              value={behavior.dwell[1]}
            />
          </>
        )}
        <ToggleControl
          checked={behavior.lookAtPlayer}
          label="가까이 온 플레이어 바라보기"
          onChange={(lookAtPlayer) => setBehavior({ lookAtPlayer })}
        />
        {behavior.mode === 'wander' && (
          <WanderRooms
            levelId={node.parentId}
            selected={behavior.rooms}
            setBehavior={setBehavior}
          />
        )}
      </PanelSection>

      {behavior.mode === 'patrol' && (
        <PanelSection title="순찰 경로">
          <PatrolPath node={node} setBehavior={setBehavior} />
        </PanelSection>
      )}

      <PanelSection title="쉬는 동작">
        <FieldLabel>멈춰 있을 때 가끔 하는 동작이에요.</FieldLabel>
        <div className="flex flex-wrap gap-1">
          {IDLE_EMOTES.map((id) => {
            const active = behavior.idleEmotes.includes(id)
            return (
              <Chip
                active={active}
                disabled={!active && behavior.idleEmotes.length >= MAX_IDLE_EMOTES}
                key={id}
                label={EMOTES[id].label}
                onClick={() =>
                  setBehavior({
                    idleEmotes: active
                      ? behavior.idleEmotes.filter((emote) => emote !== id)
                      : [...behavior.idleEmotes, id],
                  })
                }
              />
            )
          })}
        </div>
      </PanelSection>

      <PanelSection title="인사">
        <ToggleControl
          checked={greet.enabled}
          label="다가오면 인사하기"
          onChange={(enabled) => setGreet({ enabled })}
        />
        {greet.enabled && (
          <>
            <SliderControl
              label="인사 거리"
              max={8}
              min={1}
              onChange={(radius) => setGreet({ radius })}
              precision={1}
              step={0.5}
              unit="m"
              value={greet.radius}
            />
            <SliderControl
              label="다시 인사까지"
              max={600}
              min={5}
              onChange={(cooldown) => setGreet({ cooldown })}
              step={5}
              unit="초"
              value={greet.cooldown}
            />
            <FieldLabel>인사 동작</FieldLabel>
            <div className="flex flex-wrap gap-1">
              {GREET_EMOTES.map((id) => (
                <Chip
                  active={greet.emote === id}
                  key={id}
                  label={EMOTES[id].label}
                  onClick={() => setGreet({ emote: id })}
                />
              ))}
            </div>
            <FieldLabel>인사말 (말풍선으로 하나씩 골라 말해요)</FieldLabel>
            {greet.barks.map((bark, index) => (
              <div className="flex items-center gap-1" key={`${bark},${index}`}>
                <TextField
                  maxLength={80}
                  onCommit={(text) =>
                    setGreet({ barks: greet.barks.map((b, i) => (i === index ? text : b)) })
                  }
                  value={bark}
                />
                <IconButton
                  label="인사말 지우기"
                  onClick={() => setGreet({ barks: greet.barks.filter((_, i) => i !== index) })}
                />
              </div>
            ))}
            {greet.barks.length < MAX_BARKS && (
              <ActionButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label="인사말 추가"
                onClick={() => setGreet({ barks: [...greet.barks, NEW_BARK] })}
              />
            )}
          </>
        )}
      </PanelSection>
    </>
  )
}
