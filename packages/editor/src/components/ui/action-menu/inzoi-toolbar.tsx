'use client'

import { emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
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
  Video,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import { stepLevel } from '../../../hooks/use-keyboard'
import { runRedo, runUndo } from '../../../lib/history'
import { hasActivePaintMaterial } from '../../../lib/material-paint'
import { computeSceneBoundsXZ } from '../../../lib/scene-bounds'
import { triggerSFX } from '../../../lib/sfx-bus'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { type SelectionFilterKey, useSelectionFilter } from '../../../store/use-selection-filter'
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
        'flex size-8 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-30',
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
      <IconComponent className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </button>
  )
}

const Divider = () => <div className="mx-1 h-5 w-px bg-neutral-300/70 dark:bg-white/15" />

function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'flex h-7 items-center gap-1 rounded-full px-2.5 font-medium text-xs transition-colors',
        active
          ? 'bg-sky-300/80 text-sky-900 dark:bg-sky-400/40 dark:text-sky-100'
          : 'text-neutral-500 hover:bg-neutral-900/[0.06] hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/10',
      )}
      onClick={() => {
        triggerSFX('sfx:menu-click')
        onClick()
      }}
      type="button"
    >
      <Check className={cn('size-3.5', !active && 'opacity-0')} strokeWidth={2.5} />
      {label}
    </button>
  )
}

const FILTERS: [SelectionFilterKey, string][] = [
  ['furniture', '가구'],
  ['structure', '구조물'],
]

/**
 * inZOI's selection filter under the build bar: which kinds a click picks,
 * and whether the floors above the current one are hidden.
 */
function SelectionFilterBar() {
  const filter = useSelectionFilter()
  const soloLevel = useViewer((s) => s.levelMode === 'solo')
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-white/70 bg-white/85 px-1 py-0.5 shadow-[0_4px_16px_rgba(0,0,0,0.12)] backdrop-blur-md dark:border-white/10 dark:bg-neutral-900/85">
      <span className="px-2 font-semibold text-[11px] text-neutral-500 dark:text-neutral-400">
        선택 필터
      </span>
      {FILTERS.map(([key, label]) => (
        <FilterChip
          active={filter[key]}
          key={key}
          label={label}
          onClick={() => filter.toggle(key)}
        />
      ))}
      <div className="mx-1 h-4 w-px bg-neutral-300/70 dark:bg-white/15" />
      <FilterChip
        active={soloLevel}
        label="현재 층만"
        onClick={() => useViewer.getState().setLevelMode(soloLevel ? 'stacked' : 'solo')}
      />
    </div>
  )
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
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center rounded-full border border-white/70 dark:border-white/10 bg-white/90 dark:bg-neutral-900/90 px-1.5 py-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.16)] backdrop-blur-md">
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
        {!is2dOnly && (
          <ToolButton
            icon={Video}
            label="기본 카메라"
            onClick={() => {
              const bounds = computeSceneBoundsXZ(useScene.getState().nodes)
              emitter.emit('camera-controls:fit-scene', bounds ? { bounds } : {})
            }}
          />
        )}
      </Group>
      <Divider />
      <Group>
        <ToolButton disabled={!canUndo} icon={Undo2} label="되돌리기 (⌘Z)" onClick={runUndo} />
        <ToolButton disabled={!canRedo} icon={Redo2} label="다시하기 (⇧⌘Z)" onClick={runRedo} />
      </Group>
    </div>
      {mode === 'select' && <SelectionFilterBar />}
    </div>
  )
}
