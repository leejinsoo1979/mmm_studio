'use client'

import {
  type AnyNodeId,
  type BuildingNode,
  emitter,
  getLevelDisplayName,
  type LevelNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  Ban,
  Blend,
  Box,
  BrickWall,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Columns2,
  DoorOpen,
  Ellipsis,
  Grid3x3,
  Home,
  Info,
  type LucideIcon,
  Magnet,
  Map as MapIcon,
  MousePointer2,
  PanelBottom,
  PanelTopDashed,
  Pipette,
  Redo2,
  RotateCcw,
  RotateCw,
  Scan,
  Square,
  SquareDashed,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
  VectorSquare,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { useActiveSnapContext } from '../../../hooks/use-active-snap-context'
import { stepLevel } from '../../../hooks/use-keyboard'
import { runRedo, runUndo } from '../../../lib/history'
import { HUD_TEXT } from '../../../lib/hud'
import { addLevelAbove } from '../../../lib/level-selection'
import { hasActivePaintMaterial } from '../../../lib/material-paint'
import { sfxEmitter, triggerSFX } from '../../../lib/sfx-bus'
import {
  cycleSnappingModeIn,
  resolveSnapFlags,
  type SnappingMode,
  snappingModesFor,
} from '../../../lib/snapping-mode'
import { cn } from '../../../lib/utils'
import useEditor, { type GridSnapStep, type ViewMode } from '../../../store/use-editor'
import {
  type SelectionFilterKey,
  STRUCTURE_KINDS,
  type StructureKind,
  useSelectionFilter,
} from '../../../store/use-selection-filter'
import { useUiHidden } from '../../../store/use-ui-hidden'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { SecondaryToggles } from './view-toggles'

const BUTTON_CLASS =
  'relative flex size-9 shrink-0 items-center justify-center rounded-full text-[#6b6b6b] transition-colors hover:bg-black/[0.05] disabled:pointer-events-none disabled:text-[#d0d0d0] dark:text-neutral-300 dark:hover:bg-white/10 dark:disabled:text-neutral-600'

// inZOI keeps its sky accent in both UI themes.
const ACTIVE_CLASS =
  'bg-[#bfe0fa] text-[#2f7fd0] hover:bg-[#bfe0fa] dark:bg-[#bfe0fa] dark:text-[#2f7fd0] dark:hover:bg-[#bfe0fa]'

function ToolButton({
  icon: IconComponent,
  label,
  active = false,
  disabled = false,
  onClick,
  children,
  title = label,
}: {
  icon: LucideIcon
  label: string
  /** Tooltip, when it says more than the accessible name. */
  title?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cn(BUTTON_CLASS, active && ACTIVE_CLASS)}
      disabled={disabled}
      onClick={() => {
        triggerSFX('sfx:menu-click')
        onClick()
      }}
      title={title}
      type="button"
    >
      <IconComponent className="size-[22px]" strokeWidth={1.5} />
      {children}
    </button>
  )
}

// The pitch tightens on narrow screens so the bar clears the panel and the
// day / night slider.
const Divider = () => (
  <div className="mx-1 h-6 w-px shrink-0 bg-[#d4d4d4] min-[1440px]:mx-1.5 dark:bg-white/15" />
)

function Group({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center min-[1440px]:gap-1 min-[1600px]:gap-2">{children}</div>
  )
}

const VIEW_MODES: { id: ViewMode; label: string; title: string; icon: LucideIcon }[] = [
  { id: '3d', label: '3D', title: '3D 보기', icon: Box },
  { id: '2d', label: '2D', title: '2D 도면', icon: MapIcon },
  { id: 'split', label: '분할', title: '분할 보기', icon: Columns2 },
]

function ViewModeGroup() {
  const viewMode = useEditor((s) => s.viewMode)
  const current = VIEW_MODES.find((mode) => mode.id === viewMode) ?? VIEW_MODES[0]!
  const next = VIEW_MODES[(VIEW_MODES.indexOf(current) + 1) % VIEW_MODES.length]!
  return (
    <>
      <div className="hidden items-center min-[1440px]:flex min-[1440px]:gap-1 min-[1600px]:gap-2">
        {VIEW_MODES.map((mode) => (
          <ToolButton
            active={viewMode === mode.id}
            icon={mode.icon}
            key={mode.id}
            label={mode.label}
            onClick={() => useEditor.getState().setViewMode(mode.id)}
            title={mode.title}
          />
        ))}
      </div>
      {/* Narrow screens: one button cycling 3D → 2D → 분할. */}
      <div className="min-[1440px]:hidden">
        <ToolButton
          icon={current.icon}
          label={`보기 전환: ${current.title}`}
          onClick={() => useEditor.getState().setViewMode(next.id)}
          title={`${current.title} · 클릭하면 ${next.title}`}
        />
      </div>
    </>
  )
}

function useBuildingLevels(): { buildingId: BuildingNode['id'] | null; levels: LevelNode[] } {
  const buildingId = useViewer((s) => s.selection.buildingId) as BuildingNode['id'] | null
  const levels = useScene(
    useShallow((s) => {
      const building = buildingId ? s.nodes[buildingId] : null
      if (building?.type !== 'building') return [] as LevelNode[]
      return building.children
        .map((id) => s.nodes[id as AnyNodeId])
        .filter((node): node is LevelNode => node?.type === 'level')
    }),
  )
  return { buildingId, levels: [...levels].sort((a, b) => a.level - b.level) }
}

/**
 * inZOI's stairs ▲▼ with the current floor: up / down a floor, and ▲ on the
 * top floor builds a new one. Adding / reordering floors stays in 장면.
 */
function LevelStepper() {
  const levelId = useViewer((s) => s.selection.levelId)
  const { buildingId, levels } = useBuildingLevels()
  const index = levels.findIndex((level) => level.id === levelId)
  const current = index === -1 ? null : levels[index]
  const onTop = index === levels.length - 1
  // PgUp only steps between floors; building a new one is the button's alone.
  const upLabel = onTop ? '새 층 추가' : '위층 (Page Up)'
  const stepClass =
    'flex h-[18px] w-7 items-center justify-center rounded-full text-[#6b6b6b] transition-colors hover:bg-black/[0.05] disabled:pointer-events-none disabled:text-[#d0d0d0] dark:text-neutral-300 dark:hover:bg-white/10 dark:disabled:text-neutral-600'
  return (
    <div className="flex h-9 shrink-0 items-center pr-1">
      <div className="flex flex-col">
        <button
          aria-label={upLabel}
          className={stepClass}
          disabled={!buildingId}
          onClick={() => {
            triggerSFX('sfx:menu-click')
            if (onTop && buildingId) addLevelAbove(buildingId)
            else stepLevel(1)
          }}
          title={upLabel}
          type="button"
        >
          <ChevronUp className="size-3.5" strokeWidth={2} />
        </button>
        <button
          aria-label="아래층 (Page Down)"
          className={stepClass}
          disabled={index <= 0}
          onClick={() => {
            triggerSFX('sfx:menu-click')
            stepLevel(-1)
          }}
          title="아래층 (Page Down)"
          type="button"
        >
          <ChevronDown className="size-3.5" strokeWidth={2} />
        </button>
      </div>
      <span
        className="min-w-6 max-w-16 truncate whitespace-nowrap font-semibold text-[#555] text-[12px] tabular-nums dark:text-neutral-300"
        title={current ? getLevelDisplayName(current) : undefined}
      >
        {current ? getLevelDisplayName(current) : '—'}
      </span>
    </div>
  )
}

const WALL_MODE_ORDER = ['cutaway', 'up', 'down', 'translucent'] as const
const WALL_MODES: Record<string, { icon: LucideIcon; label: string }> = {
  up: { icon: BrickWall, label: '벽 올리기' },
  cutaway: { icon: PanelTopDashed, label: '벽 자르기' },
  down: { icon: PanelBottom, label: '벽 내리기' },
  translucent: { icon: Blend, label: '반투명 벽' },
}

function WallModeButton() {
  const wallMode = useViewer((s) => s.wallMode)
  const config = WALL_MODES[wallMode] ?? WALL_MODES.cutaway!
  return (
    <ToolButton
      icon={config.icon}
      label={`벽 보기: ${config.label} (Home / End)`}
      onClick={() => {
        const index = WALL_MODE_ORDER.indexOf(wallMode as (typeof WALL_MODE_ORDER)[number])
        const next = WALL_MODE_ORDER[(index + 1) % WALL_MODE_ORDER.length]
        if (next) useViewer.getState().setWallMode(next)
      }}
    />
  )
}

function GridButton() {
  const showGrid = useViewer((s) => s.showGrid)
  return (
    <ToolButton
      icon={Grid3x3}
      label={showGrid ? '격자 숨기기' : '격자 보기'}
      onClick={() => useViewer.getState().setShowGrid(!showGrid)}
    >
      {!showGrid && (
        <span className="pointer-events-none absolute h-[1.5px] w-7 rotate-45 rounded-full bg-current" />
      )}
    </ToolButton>
  )
}

const SNAP_MODE_LABELS: Record<SnappingMode, string> = {
  grid: '격자',
  lines: '선',
  angles: '각도',
  off: '끔',
}

const GRID_SNAP_STEPS: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05]

/**
 * inZOI's magnet with the snap step as a subscript. Click cycles the active
 * tool's snapping mode (as Shift does); the chevron picks a mode or step.
 */
function SnapToolButton() {
  const context = useActiveSnapContext() ?? 'wall'
  const mode = useEditor((s) => s.snappingModeByContext[context])
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  const gridOn = resolveSnapFlags(mode).grid
  const setMode = (next: SnappingMode) => {
    useEditor.getState().setSnappingMode(context, next)
    sfxEmitter.emit('sfx:grid-snap')
  }
  const label = `스냅: ${SNAP_MODE_LABELS[mode]}${gridOn ? ` ${gridSnapStep} m` : ''} · Shift 모드 · Ctrl 간격`
  return (
    <Popover>
      <div className="flex items-center">
        <ToolButton
          active={mode !== 'off'}
          icon={mode === 'off' ? Ban : Magnet}
          label={label}
          onClick={() => setMode(cycleSnappingModeIn(context, mode))}
        >
          {gridOn && (
            <span className="pointer-events-none absolute right-0 bottom-0.5 font-semibold text-[9px] tabular-nums leading-none">
              {gridSnapStep}
            </span>
          )}
        </ToolButton>
        <PopoverTrigger asChild>
          <button
            aria-label="스냅 설정"
            className="flex h-9 w-4 items-center justify-center rounded-full text-[#9a9a9a] transition-colors hover:bg-black/[0.05] hover:text-[#6b6b6b] dark:text-neutral-400 dark:hover:bg-white/10"
            type="button"
          >
            <ChevronDown className="size-3" strokeWidth={2} />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="center"
        className="w-44 rounded-xl border-0 bg-[#f5f5f5]/95 p-2 shadow-[0_2px_8px_rgba(0,0,0,0.15)] backdrop-blur-md dark:bg-neutral-900/95"
        side="bottom"
        sideOffset={10}
      >
        <p className="px-1.5 pb-1 text-[11px] text-neutral-500">스냅 방식 (Shift)</p>
        <div className="grid grid-cols-2 gap-1">
          {snappingModesFor(context).map((option) => (
            <button
              className={cn(
                'h-7 rounded-full text-[12px] text-neutral-700 transition-colors hover:bg-black/[0.05] dark:text-neutral-200 dark:hover:bg-white/10',
                option === mode && ACTIVE_CLASS,
              )}
              key={option}
              onClick={() => setMode(option)}
              type="button"
            >
              {SNAP_MODE_LABELS[option]}
            </button>
          ))}
        </div>
        <p className="px-1.5 pt-2 pb-1 text-[11px] text-neutral-500">격자 간격 (Ctrl)</p>
        <div className="grid grid-cols-4 gap-1">
          {GRID_SNAP_STEPS.map((step) => (
            <button
              className={cn(
                'h-7 rounded-full text-[11px] text-neutral-700 tabular-nums transition-colors hover:bg-black/[0.05] dark:text-neutral-200 dark:hover:bg-white/10',
                step === gridSnapStep && ACTIVE_CLASS,
              )}
              key={step}
              onClick={() => {
                useEditor.getState().setGridSnapStep(step)
                sfxEmitter.emit('sfx:grid-snap')
              }}
              type="button"
            >
              {step}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function HudSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      aria-checked={checked}
      className="flex items-center gap-1.5"
      onClick={() => {
        triggerSFX('sfx:menu-click')
        onChange()
      }}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          'relative h-[18px] w-[34px] shrink-0 rounded-full transition-colors',
          checked ? 'bg-[#a6d5fb]' : 'bg-black/20',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
      {label}
    </button>
  )
}

const STRUCTURE_CHIPS: Record<StructureKind, { icon: LucideIcon; label: string }> = {
  floor: { icon: Square, label: '바닥' },
  wall: { icon: BrickWall, label: '벽' },
  roof: { icon: Home, label: '지붕' },
  stair: { icon: ChevronsUp, label: '계단' },
  opening: { icon: DoorOpen, label: '문 · 창문' },
  other: { icon: Ellipsis, label: '기타 구조물' },
}

function KindChip({ kind, disabled }: { kind: StructureKind; disabled: boolean }) {
  const on = useSelectionFilter((s) => s.structureKinds[kind])
  const { icon: IconComponent, label } = STRUCTURE_CHIPS[kind]
  return (
    <button
      aria-label={label}
      aria-pressed={on}
      className={cn(
        'flex size-6 items-center justify-center rounded-[4px] border transition-colors [text-shadow:none] disabled:opacity-40',
        on
          ? 'border-white/80 bg-[#a8cbe3] text-white'
          : 'border-[color:var(--hud-muted)] bg-white/15 text-[color:var(--hud-muted)]',
      )}
      disabled={disabled}
      onClick={() => {
        triggerSFX('sfx:menu-click')
        useSelectionFilter.getState().toggleKind(kind)
      }}
      title={label}
      type="button"
    >
      <IconComponent className="size-3.5" strokeWidth={1.75} />
    </button>
  )
}

const FILTERS: [SelectionFilterKey, string][] = [
  ['furniture', '가구'],
  ['structure', '구조물'],
]

const FilterDivider = () => (
  <span className="h-4 w-px shrink-0 bg-[color:var(--hud-fg)] opacity-40" />
)

/**
 * inZOI's selection filter under the build bar: plate-less HUD text with a
 * switch per family, structure chips, and whether only the current floor shows.
 */
function SelectionFilterBar() {
  const filter = useSelectionFilter()
  const soloLevel = useViewer((s) => s.levelMode === 'solo')
  const levelId = useViewer((s) => s.selection.levelId)
  const levelName = useScene((s) => {
    const level = levelId ? s.nodes[levelId as AnyNodeId] : null
    return level?.type === 'level' ? getLevelDisplayName(level) : null
  })
  return (
    <div
      className={cn(
        'flex h-8 items-center gap-3 whitespace-nowrap rounded-md bg-black/[0.06] px-3 font-semibold text-[12px] backdrop-blur-sm',
        HUD_TEXT,
      )}
    >
      <span className="flex items-center gap-1.5">
        <SquareDashed className="size-4" strokeWidth={1.75} />
        선택 필터
        <span title="클릭으로 고를 수 있는 종류를 정합니다">
          <Info className="size-3 opacity-60" />
        </span>
      </span>
      {FILTERS.map(([key, label]) => (
        <span className="flex items-center gap-3" key={key}>
          <FilterDivider />
          <HudSwitch checked={filter[key]} label={label} onChange={() => filter.toggle(key)} />
          {key === 'structure' && (
            <span className="flex items-center gap-1">
              {STRUCTURE_KINDS.map((kind) => (
                <KindChip disabled={!filter.structure} key={kind} kind={kind} />
              ))}
            </span>
          )}
        </span>
      ))}
      <FilterDivider />
      <button
        aria-pressed={soloLevel}
        className="flex items-center gap-1.5"
        onClick={() => {
          triggerSFX('sfx:menu-click')
          useViewer.getState().setLevelMode(soloLevel ? 'stacked' : 'solo')
        }}
        type="button"
      >
        <span className="flex size-3.5 items-center justify-center rounded-full border-[1.5px] border-current">
          {soloLevel && <span className="size-1.5 rounded-full bg-current" />}
        </span>
        현재 층만 적용
        {levelName && (
          <span className="font-bold text-[#5aa8e6] text-[11px] [text-shadow:none]">
            {levelName}
          </span>
        )}
      </button>
    </div>
  )
}

/**
 * inZOI's build bar: one light pill of thin grey icons, grouped as
 * view | floor, walls, grid & snap | select | edit | history | camera. The
 * tooltip names the tool and its key; the selection filter hangs below.
 */
export function InzoiToolbar() {
  const mode = useEditor((s) => s.mode)
  const phase = useEditor((s) => s.phase)
  const structureLayer = useEditor((s) => s.structureLayer)
  const selectionTool = useEditor((s) => s.floorplanSelectionTool)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  const paintEraser = useEditor((s) => s.paintEraser)
  const is2dOnly = useEditor((s) => s.viewMode === '2d')
  const customizing = useUiHidden((s) => s.customizing)
  const collapsed = useUiHidden((s) => s.toolbarCollapsed)
  const canUndo = useStore(useScene.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useScene.temporal, (s) => s.futureStates.length > 0)

  const zoneActive = mode === 'build' && phase === 'structure' && structureLayer === 'zones'
  const pickActive =
    mode === 'material-paint' && !paintEraser && !hasActivePaintMaterial(activePaintMaterial)
  const showFilter = (mode === 'select' || mode === 'build') && !customizing

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

  if (collapsed) {
    return (
      <button
        aria-label="도구 모음 펼치기"
        className="flex h-4 w-7 items-center justify-center rounded-b-md bg-[#f5f5f5]/95 text-[#6b6b6b] shadow-[0_2px_8px_rgba(0,0,0,0.15)] dark:bg-neutral-900/90 dark:text-neutral-300"
        onClick={() => useUiHidden.getState().toggleToolbar()}
        title="도구 모음 펼치기"
        type="button"
      >
        <ChevronDown className="size-3.5" strokeWidth={2} />
      </button>
    )
  }

  return (
    <div className="relative">
      <div className="flex h-11 items-center rounded-full bg-[#f5f5f5]/95 px-2 shadow-[0_2px_8px_rgba(0,0,0,0.15)] backdrop-blur-md dark:bg-neutral-900/90">
        <ViewModeGroup />
        <Divider />
        <Group>
          <LevelStepper />
          <WallModeButton />
          <GridButton />
          <SnapToolButton />
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
        </Group>
        <Divider />
        <Group>
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
          <ToolButton disabled={!canUndo} icon={Undo2} label="되돌리기 (⌘Z)" onClick={runUndo} />
          <ToolButton disabled={!canRedo} icon={Redo2} label="다시하기 (⇧⌘Z)" onClick={runRedo} />
        </Group>
        <Divider />
        <Group>
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
      <div
        className="absolute top-full left-1/2 mt-2 flex -translate-x-1/2 flex-col items-center gap-1"
        data-hud-avoid
      >
        {showFilter && <SelectionFilterBar />}
        {!customizing && (
          <button
            aria-label="도구 모음 접기"
            className={cn('flex h-4 w-7 items-center justify-center opacity-80', HUD_TEXT)}
            onClick={() => useUiHidden.getState().toggleToolbar()}
            title="도구 모음 접기"
            type="button"
          >
            <ChevronUp className="size-4" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}
