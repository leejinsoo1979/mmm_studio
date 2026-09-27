'use client'

import { emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Grid3x3,
  type LucideIcon,
  MousePointer2,
  Pipette,
  Redo2,
  RotateCcw,
  RotateCw,
  Scan,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
  VectorSquare,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import { stepLevel } from '../../../hooks/use-keyboard'
import { runRedo, runUndo } from '../../../lib/history'
import { hasActivePaintMaterial } from '../../../lib/material-paint'
import { triggerSFX } from '../../../lib/sfx-bus'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { SecondaryToggles } from './view-toggles'

function ToolButton({
  icon: IconComponent,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex size-9 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-30',
        active
          ? 'bg-sky-300/80 text-sky-800 dark:bg-sky-400/40 dark:text-sky-100'
          : 'text-neutral-600 hover:bg-neutral-900/[0.06] hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white',
      )}
      disabled={disabled}
      onClick={() => {
        triggerSFX('sfx:menu-click')
        onClick()
      }}
      title={label}
      type="button"
    >
      <IconComponent className="h-[19px] w-[19px]" strokeWidth={1.75} />
    </button>
  )
}

const Divider = () => <div className="mx-1.5 h-5 w-px bg-neutral-300/70 dark:bg-white/15" />

function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>
}

/**
 * inZOI's build bar: one white pill of thin monochrome icons, grouped as view
 * aids | select & edit | history | floors & camera. No labels or key badges;
 * the tooltip names the tool and its key.
 */
export function InzoiToolbar() {
  const mode = useEditor((s) => s.mode)
  const phase = useEditor((s) => s.phase)
  const structureLayer = useEditor((s) => s.structureLayer)
  const selectionTool = useEditor((s) => s.floorplanSelectionTool)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  const paintEraser = useEditor((s) => s.paintEraser)
  const is2dOnly = useEditor((s) => s.viewMode === '2d')
  const showGrid = useViewer((s) => s.showGrid)
  const canUndo = useStore(useScene.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useScene.temporal, (s) => s.futureStates.length > 0)

  const zoneActive = mode === 'build' && phase === 'structure' && structureLayer === 'zones'
  const pickActive =
    mode === 'material-paint' && !paintEraser && !hasActivePaintMaterial(activePaintMaterial)

  const leaveSite = () => {
    const editor = useEditor.getState()
    if (editor.phase === 'site') {
      editor.setPhase('structure')
      editor.setStructureLayer('elements')
    }
  }
  const select = (tool: 'click' | 'marquee') => {
    leaveSite()
    useEditor.getState().setMode('select')
    useEditor.getState().setFloorplanSelectionTool(tool)
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-full border border-white/70 dark:border-white/10 bg-white/90 dark:bg-neutral-900/90 px-1.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.16)] backdrop-blur-md">
      <Group>
        <ToolButton
          active={showGrid}
          icon={Grid3x3}
          label="격자 보기"
          onClick={() => useViewer.getState().setShowGrid(!showGrid)}
        />
        <SecondaryToggles />
      </Group>
      <Divider />
      <Group>
        <ToolButton
          active={mode === 'select' && selectionTool === 'click'}
          icon={MousePointer2}
          label="선택 (V)"
          onClick={() => select('click')}
        />
        <ToolButton
          active={mode === 'select' && selectionTool === 'marquee'}
          icon={SquareDashedMousePointer}
          label="범위 선택"
          onClick={() => select('marquee')}
        />
        <ToolButton
          active={zoneActive}
          icon={VectorSquare}
          label="방 · 구역 (Z)"
          onClick={() => {
            leaveSite()
            const editor = useEditor.getState()
            if (zoneActive) return editor.setMode('select')
            editor.setPhase('structure')
            editor.setStructureLayer('zones')
            editor.setMode('build')
          }}
        />
        <ToolButton
          active={pickActive}
          icon={Pipette}
          label="재질 스포이드"
          onClick={() => {
            leaveSite()
            const editor = useEditor.getState()
            if (pickActive) return editor.setMode('select')
            editor.setActivePaintMaterial(null)
            editor.setPaintEraser(false)
            editor.setMode('material-paint')
          }}
        />
        <ToolButton
          active={mode === 'delete'}
          icon={Trash2}
          label="삭제 (X)"
          onClick={() => {
            leaveSite()
            useEditor.getState().setMode(mode === 'delete' ? 'select' : 'delete')
          }}
        />
      </Group>
      <Divider />
      <Group>
        <ToolButton icon={ArrowUpToLine} label="위층 (Page Up)" onClick={() => stepLevel(1)} />
        <ToolButton
          icon={ArrowDownToLine}
          label="아래층 (Page Down)"
          onClick={() => stepLevel(-1)}
        />
        <ToolButton
          icon={RotateCcw}
          label="왼쪽으로 돌리기"
          onClick={() => emitter.emit('camera-controls:orbit-ccw')}
        />
        <ToolButton
          icon={RotateCw}
          label="오른쪽으로 돌리기"
          onClick={() => emitter.emit('camera-controls:orbit-cw')}
        />
        {!is2dOnly && (
          <ToolButton
            icon={Scan}
            label="위에서 보기"
            onClick={() => emitter.emit('camera-controls:top-view')}
          />
        )}
      </Group>
    </div>
      <div className="flex items-center rounded-full border border-white/70 dark:border-white/10 bg-white/90 dark:bg-neutral-900/90 px-1.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.16)] backdrop-blur-md">
        <ToolButton disabled={!canUndo} icon={Undo2} label="되돌리기 (⌘Z)" onClick={runUndo} />
        <ToolButton disabled={!canRedo} icon={Redo2} label="다시하기 (⇧⌘Z)" onClick={runRedo} />
      </div>
    </div>
  )
}
