'use client'

import { useViewer } from '@pascal-app/viewer'
import { useIsMobile } from '../../../hooks/use-mobile'
import { HUD_TEXT } from '../../../lib/hud'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { useMovingNode } from '../../../store/use-interaction-scope'
import { useUiHidden } from '../../../store/use-ui-hidden'

const IDLE_HINT = '건축 프리셋으로 변경하거나, 구조물 또는 가구를 선택하세요.'
const SELECTION_HINT = 'Delete 삭제 · Esc 선택 해제 · Ctrl/⌘ + 클릭 선택에 추가'

const HINT_LINE_BY_TOOL: Record<string, string> = {
  wall: '클릭해서 벽을 그리세요. 벽을 지우거나 칠하려면 벽을 클릭하세요.',
  'room-preset': '방을 놓을 곳을 클릭하세요.',
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
  const hasSelection = useViewer((s) => s.selection.selectedIds.length > 0)
  const moving = useMovingNode()
  const customizing = useUiHidden((s) => s.customizing)
  const isMobile = useIsMobile()

  if (moving || customizing || isMobile) return null

  let text: string | null = null
  if (mode === 'select') text = hasSelection ? SELECTION_HINT : IDLE_HINT
  else if (mode === 'build') text = (tool && HINT_LINE_BY_TOOL[tool]) || '배치할 곳을 클릭하세요.'
  else if (mode === 'delete') text = '지울 대상을 클릭하세요.'
  if (!text) return null

  return (
    <div
      className={cn(
        'pointer-events-none fixed bottom-9 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap text-center font-normal text-[14px]',
        HUD_TEXT,
      )}
    >
      {text}
    </div>
  )
}
