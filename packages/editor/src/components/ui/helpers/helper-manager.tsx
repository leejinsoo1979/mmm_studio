'use client'

import { nodeRegistry, type ToolHint } from '@pascal-app/core'
import { useEffect, useMemo, useState } from 'react'
import { useIsMobile } from '../../../hooks/use-mobile'
import {
  type ContextualShortcutHint,
  GROUP_MOVE_DRAG_LABEL,
  GROUP_ROTATE_DRAG_LABEL,
  ROTATE_HANDLE_DRAG_LABEL,
  resolveRotateHandleHelpHints,
} from '../../../lib/contextual-help'
import { continuationContextOf } from '../../../lib/continuation'
import type { ReshapeKind } from '../../../lib/interaction/scope'
import { hasActivePaintMaterial } from '../../../lib/material-paint'
import type { PaintHoverInfo, PaintScope } from '../../../lib/paint-scope'
import { isFreshPlacementMetadata } from '../../../lib/placement-metadata'
import useEditor, { getActiveContinuationContext } from '../../../store/use-editor'
import useInteractionScope, {
  useActiveHandleDrag,
  useMovingNode,
} from '../../../store/use-interaction-scope'
import { useUiHidden } from '../../../store/use-ui-hidden'
import { BuildingHelper } from './building-helper'
import { ItemHelper } from './item-helper'
import { RegisteredToolHelper } from './registered-tool-helper'
import { RoofHelper } from './roof-helper'
import { ToolCursorHints } from './tool-cursor-hints'

// 사각형 방 is a wall drawing mode with no node kind of its own.
const RECTANGLE_ROOM_HINTS: ToolHint[] = [
  { key: 'Left click', label: '방 모서리 두 곳 클릭' },
  { key: 'Esc', label: '그리기 취소' },
]

// The 방 / 플랫폼 presets ride on the wall tool the same way.
const ROOM_PRESET_HINTS: ToolHint[] = [
  { key: 'R', label: '90° 회전' },
  { key: 'Enter', label: '확인' },
  { key: 'Esc', label: '놓기 취소' },
]

// Reshaping a selected node's geometry (endpoint / curve / polygon corner). The
// tool bar's magnet shows the snapping; these name the gesture + Esc.
const RESHAPE_LABELS: Record<ReshapeKind, string> = {
  curve: '곡선 만들기',
  'control-point': '조절점 옮기기',
  tangent: '접선 옮기기',
  endpoint: '끝점 옮기기',
  boundary: '모서리 옮기기',
  hole: '구멍 모서리 옮기기',
}

function reshapingHints(reshape: ReshapeKind): ContextualShortcutHint[] {
  return [
    { keys: ['Left click'], label: `끌어서 ${RESHAPE_LABELS[reshape]}` },
    { keys: ['Shift'], label: '스냅 모드 전환' },
    { keys: ['Esc'], label: '취소' },
  ]
}

const ROTATE_LABELS_KO: Record<string, string> = {
  'Rotating freely (no angle step)': '자유 회전 중 (각도 단계 없음)',
  'Hold to rotate freely': '누른 채 자유 회전',
}

function paintScopeLabelKo(scope: PaintScope, info: PaintHoverInfo): string {
  switch (scope) {
    case 'object':
      return '사물 전체'
    case 'matching':
      return '같은 재질 모두'
    case 'room':
      return '방 전체'
    default:
      return info.slotLabel || '이 면'
  }
}

/** Paint mode's one cursor row: pick a material, then what the click paints (Shift cycles). */
function PaintScopeHints() {
  const paintHover = useEditor((s) => s.paintHover)
  const paintScope = useEditor((s) => s.paintScope)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  const paintEraser = useEditor((s) => s.paintEraser)

  let hint: ContextualShortcutHint
  if (!(paintEraser || hasActivePaintMaterial(activePaintMaterial))) {
    hint = { keys: ['ⓘ'], label: '칠할 재질을 고르세요' }
  } else if (!paintHover) {
    hint = { keys: ['ⓘ'], label: '칠할 면에 커서를 올리세요' }
  } else {
    const effective = paintHover.scopes.includes(paintScope) ? paintScope : 'single'
    const label = `칠하기: ${paintScopeLabelKo(effective, paintHover)}`
    hint = paintHover.scopes.length > 1 ? { keys: ['Shift'], label } : { keys: ['ⓘ'], label }
  }
  return <ToolCursorHints hints={[hint]} />
}

function useShiftPressed(): boolean {
  const [shift, setShift] = useState(false)

  useEffect(() => {
    const update = (event: KeyboardEvent) => {
      setShift(event.shiftKey || (event.type === 'keydown' && event.key === 'Shift'))
    }
    const clear = () => setShift(false)
    window.addEventListener('keydown', update)
    window.addEventListener('keyup', update)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', update)
      window.removeEventListener('keyup', update)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return shift
}

export function HelperManager() {
  const mode = useEditor((s) => s.mode)
  const tool = useEditor((s) => s.tool)
  const workspaceMode = useEditor((s) => s.workspaceMode)
  const scope = useInteractionScope((s) => s.scope)
  const movingNode = useMovingNode()
  const activeHandleDrag = useActiveHandleDrag()
  const customizing = useUiHidden((s) => s.customizing)
  const isMobile = useIsMobile()
  const shiftPressed = useShiftPressed()
  // biome-ignore lint/correctness/useExhaustiveDependencies: the store getter reads the scope / mode / tool it is keyed on
  const continuationContext = useMemo(() => getActiveContinuationContext(), [scope, mode, tool])

  // Helpers are keyboard-driven hints (Esc, R, etc.) — irrelevant on touch.
  if (isMobile) return null

  // The customize card carries its own keys (inZOI hides the build hints).
  if (customizing) return null

  // The studio workspace (compose panel / gallery) has no scene selection or
  // tools — editor shortcut hints would only mislead there.
  if (workspaceMode === 'studio') return null

  // Rotating a node (or a multi-selection group) via its in-world gizmo:
  // advertise Shift = free rotation, the same angle-step bypass wall drafting
  // exposes. Takes priority over the idle select-mode hints since a handle
  // drag is the active interaction.
  if (
    activeHandleDrag?.label === ROTATE_HANDLE_DRAG_LABEL ||
    activeHandleDrag?.label === GROUP_ROTATE_DRAG_LABEL
  ) {
    return (
      <ToolCursorHints
        hints={resolveRotateHandleHelpHints(shiftPressed).map((hint) => ({
          ...hint,
          label: ROTATE_LABELS_KO[hint.label] ?? hint.label,
        }))}
      />
    )
  }

  // Group-move drag: the tool bar's magnet shows the snapping; name its keys.
  if (activeHandleDrag?.label === GROUP_MOVE_DRAG_LABEL) {
    return (
      <ToolCursorHints
        hints={[
          { keys: ['Shift'], label: '스냅 모드 전환' },
          { keys: ['Ctrl'], label: '격자 간격 전환' },
        ]}
      />
    )
  }

  // Reshaping a node's geometry (endpoint / curve / polygon corner). Checked
  // before the select branch so an in-progress reshape keeps its keys.
  if (scope.kind === 'reshaping') {
    return <ToolCursorHints hints={reshapingHints(scope.reshape)} />
  }

  if (movingNode) {
    if (movingNode.type === 'building') return <BuildingHelper showRotate />
    // A fresh placement (e.g. a positioned preset like a shelf) advertises its
    // once/repeat continuation, exactly like the GLB item tool — but an existing
    // node being *moved* is not a placement, so it gets no continuation chip.
    const movingContinuationContext = isFreshPlacementMetadata(movingNode.metadata)
      ? continuationContextOf(movingNode.type)
      : null
    // Force-place only makes sense for kinds that collision-validate their drop;
    // structural kinds (wall/slab/…) never reject, so don't advertise Alt.
    return (
      <ItemHelper
        continuationContext={movingContinuationContext}
        rightClickRotates={movingNode.type === 'item'}
        showForce={nodeRegistry.get(movingNode.type)?.snapProfile !== 'structural'}
      />
    )
  }

  // Paint mode names what the next click paints (Shift cycles the scope).
  if (mode === 'material-paint') return <PaintScopeHints />

  // Idle select: the bottom hint line carries the selection keys.
  if (mode === 'select') return null

  // Legacy fallback — only `roof` remains because it hasn't migrated to
  // `def.tool` / `def.toolHints` yet (no Stage D port). Checked before the
  // generic tool branch so the snap-context fallback below doesn't capture it
  // and drop its bespoke `RoofHelper` hints. When roof migrates, this deletes.
  if (tool === 'roof') return <RoofHelper />

  // Registry-first: a kind renders the generic `RegisteredToolHelper` from its
  // `def.toolHints`, plus its continuation (C) row; the helper self-hides when
  // there's genuinely nothing to show.
  if (tool) {
    const def = nodeRegistry.get(tool)
    const hints =
      def?.toolHints ??
      (tool === 'rectangle-room'
        ? RECTANGLE_ROOM_HINTS
        : tool === 'room-preset'
          ? ROOM_PRESET_HINTS
          : [])
    return (
      <RegisteredToolHelper
        continuationContext={continuationContext}
        hints={hints}
        shiftPressed={shiftPressed}
      />
    )
  }

  return null
}
