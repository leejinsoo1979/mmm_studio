'use client'

import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { useIsMobile } from '../../../hooks/use-mobile'
import { CONTINUATION_PROFILES, type ContinuationContext } from '../../../lib/continuation'
import { HUD_KEYCAP, HUD_TEXT } from '../../../lib/hud'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { cn } from '../../../lib/utils'
import useEditor, { getActiveContinuationContext } from '../../../store/use-editor'
import useInteractionScope, { useMovingNode } from '../../../store/use-interaction-scope'
import useRoomPresetStatus from '../../../store/use-room-preset-status'
import { useUiHidden } from '../../../store/use-ui-hidden'
import type { RoomPresetSpec } from '../../tools/wall/wall-drafting'

const IDLE_HINT = '건축 프리셋으로 변경하거나, 구조물 또는 가구를 선택하세요.'
const SELECTION_HINT = 'Delete 삭제 · Esc 선택 해제 · Ctrl/⌘ + 클릭 선택에 추가'

const ROOM_PRESET_EDITING_HINT = '핸들로 크기와 위치를 맞추고 ✓ 확인 또는 Enter를 누르세요.'

const HINT_LINE_BY_TOOL: Record<string, string> = {
  wall: '클릭해서 벽을 그리세요. 벽을 지우거나 칠하려면 벽을 클릭하세요.',
  'rectangle-room': '방의 마주 보는 모서리 두 곳을 클릭하세요.',
  fence: '클릭해서 울타리를 그리세요.',
  zone: '클릭해서 방의 꼭짓점을 찍으세요.',
  slab: '클릭해서 바닥의 꼭짓점을 찍으세요.',
  ceiling: '클릭해서 천장의 꼭짓점을 찍으세요.',
  roof: '클릭해서 지붕의 모서리를 정하세요.',
  stair: '계단을 놓을 곳을 클릭하세요.',
  door: '문을 달 벽을 클릭하세요.',
  window: '창문을 달 벽을 클릭하세요.',
  item: '배치할 곳을 클릭하세요.',
}

/**
 * inZOI's one line at the bottom centre of the screen: what to do next for the
 * active mode or tool. Hidden while something is carried, while painting and
 * while the customize card is open (each has its own keys).
 */
export function HintLine() {
  const mode = useEditor((s) => s.mode)
  const tool = useEditor((s) => s.tool)
  const presetKind = useEditor((s) =>
    s.tool === 'room-preset'
      ? (s.toolDefaults.wall?.roomPreset as RoomPresetSpec | undefined)?.kind
      : undefined,
  )
  const presetEditing = useRoomPresetStatus((s) => s.editing)
  const hasSelection = useViewer((s) => s.selection.selectedIds.length > 0)
  const moving = useMovingNode()
  const customizing = useUiHidden((s) => s.customizing)
  const isMobile = useIsMobile()

  if (moving || customizing || isMobile) return null

  let text: string | null = null
  if (mode === 'select') text = hasSelection ? SELECTION_HINT : IDLE_HINT
  else if (mode === 'build' && tool === 'room-preset') {
    text = presetEditing
      ? ROOM_PRESET_EDITING_HINT
      : `${presetKind === 'platform' ? '플랫폼' : '방'}을 놓을 곳을 클릭하세요.`
  } else if (mode === 'build') text = (tool && HINT_LINE_BY_TOOL[tool]) || '배치할 곳을 클릭하세요.'
  else if (mode === 'delete') text = '지울 대상을 클릭하세요.'
  if (!text) return null

  return (
    <div
      className={cn(
        'pointer-events-none fixed bottom-9 left-[var(--hud-center-x,50%)] z-40 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap text-center font-normal text-[14px]',
        HUD_TEXT,
      )}
    >
      {text}
      {mode === 'build' && <ContinuationToggles />}
    </div>
  )
}

function ToggleChip({ keyLabel, label, onClick }: { keyLabel: string; label: string; onClick: () => void }) {
  return (
    <button
      className="pointer-events-auto flex h-6 items-center gap-1.5 rounded-full bg-black/[0.08] py-0.5 pr-2.5 pl-1 font-semibold text-[12px] backdrop-blur-sm transition-colors hover:bg-black/[0.16]"
      onClick={() => {
        onClick()
        sfxEmitter.emit('sfx:grid-snap')
      }}
      title={`${keyLabel} 키 또는 클릭으로 바꾸기`}
      type="button"
    >
      <span className={HUD_KEYCAP}>{keyLabel}</span>
      {label}
    </button>
  )
}

/**
 * The draw modes C (once / repeat, room / single) and T (fence type) also cycle
 * by the keys the cursor hints name; these chips reach them with the mouse.
 */
function ContinuationToggles() {
  const scope = useInteractionScope((s) => s.scope)
  const tool = useEditor((s) => s.tool)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the store getter reads the scope / tool it is keyed on
  const context: ContinuationContext | null = useMemo(getActiveContinuationContext, [scope, tool])
  const current = useEditor((s) => (context ? s.getContinuation(context) : null))
  if (!(context && current)) return null
  const editor = () => useEditor.getState()
  if (context !== 'fence') {
    // A held item turns on Z / C, so its once / repeat key is Q.
    const itemHeld = tool === 'item' || (scope.kind === 'placing' && scope.nodeType === 'item')
    return (
      <ToggleChip
        keyLabel={itemHeld ? 'Q' : 'C'}
        label={CONTINUATION_PROFILES[context].labels[current] ?? current}
        onClick={() => editor().cycleContinuation(context)}
      />
    )
  }
  const curved = current === 'curved'
  return (
    <>
      <ToggleChip
        keyLabel="T"
        label={curved ? '종류: 곡선' : '종류: 직선'}
        onClick={() => editor().setContinuation('fence', curved ? 'continuous' : 'curved')}
      />
      {!curved && (
        <ToggleChip
          keyLabel="C"
          label={current === 'single' ? '직선: 한 번' : '직선: 이어서'}
          onClick={() =>
            editor().setContinuation('fence', current === 'single' ? 'continuous' : 'single')
          }
        />
      )}
    </>
  )
}
