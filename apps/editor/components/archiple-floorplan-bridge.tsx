'use client'

import { createWallSegmentsOnCurrentLevel } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Check, DoorOpen, MousePointer2, PenLine, Square, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { ToolType } from './archiple2d/core/types/EditorState'
import FloorplanCanvas from './archiple2d/floorplan/FloorplanCanvas'

// Archiple works in millimetres (FloorplanCanvas config); MMM plan points are
// building-local metres. Archiple x / y map to plan x / z.
const ARCHIPLE_MM_PER_PLAN_UNIT = 1000

type ArchipleExportData = {
  points?: Array<{ id: string; x: number; y: number }>
  walls?: Array<{ id: string; startPointId: string; endPointId: string }>
}

function ToolButton({
  active,
  children,
  label,
  onClick,
}: {
  active?: boolean
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-md border transition ${
        active
          ? 'border-[#7567ff] bg-[#7567ff] text-white'
          : 'border-foreground/10 bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

function ArchipleCanvasStage({ onExit }: { onExit: () => void }) {
  const [tool, setTool] = useState<ToolType>(ToolType.WALL)
  const [data, setData] = useState<ArchipleExportData | null>(null)

  // Esc in the canvas cancels the draft and switches its tool to Select
  // (KeyboardController); keep the tool bar in step so picking Wall re-arms it.
  useEffect(() => {
    const onToolChanged = (event: Event) =>
      setTool((event as CustomEvent<{ tool: ToolType }>).detail.tool)
    window.addEventListener('tool-changed', onToolChanged)
    return () => window.removeEventListener('tool-changed', onToolChanged)
  }, [])

  // Apply keeps its explicit trigger: the drawing reaches the MMM level only
  // here, exactly as drawn (no re-snapping), as one undo step.
  const applyToMmm = useCallback(() => {
    if (!useViewer.getState().selection.levelId || !data?.points || !data?.walls) return

    const pointById = new Map(data.points.map((point) => [point.id, point]))
    const toPlan = (point: { x: number; y: number }): [number, number] => [
      point.x / ARCHIPLE_MM_PER_PLAN_UNIT,
      point.y / ARCHIPLE_MM_PER_PLAN_UNIT,
    ]
    const segments: [[number, number], [number, number]][] = []
    for (const wall of data.walls) {
      const start = pointById.get(wall.startPointId)
      const end = pointById.get(wall.endPointId)
      if (start && end) segments.push([toPlan(start), toPlan(end)])
    }
    createWallSegmentsOnCurrentLevel(segments)
  }, [data])

  return (
    // A card in the scene area, below the top row and beside the build panel,
    // so the tool bar and the panel never cover its header. z-[60] lifts it
    // over the tool bar's filter row (z-50), which hangs into the same band.
    <section
      className="pointer-events-auto absolute z-[60] flex flex-col overflow-hidden rounded-2xl bg-sidebar shadow-[0_2px_12px_rgba(0,0,0,0.12)]"
      style={{ top: 64, right: 12, bottom: 12, left: 'calc(var(--viewer-left-inset, 0px) + 12px)' }}
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-foreground/10 border-b bg-sidebar px-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="font-semibold text-foreground text-xs">Archiple 2D 도면 (실험)</span>
          <span className="text-[11px]">원본 엔진 · mm 좌표 · 우클릭으로 벽 잇기 끝내기</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md bg-white px-2.5 py-1.5 font-semibold text-[#111] text-xs hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
            onClick={applyToMmm}
            type="button"
          >
            MMM에 적용
          </button>
          <button
            aria-label="닫기"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            onClick={onExit}
            title="닫기"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-12 shrink-0 flex-col items-center gap-2 border-foreground/10 border-r bg-card py-3">
          <ToolButton
            active={tool === ToolType.SELECT}
            label="선택"
            onClick={() => setTool(ToolType.SELECT)}
          >
            <MousePointer2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            active={tool === ToolType.WALL}
            label="벽"
            onClick={() => setTool(ToolType.WALL)}
          >
            <PenLine className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            active={tool === ToolType.RECTANGLE}
            label="방"
            onClick={() => setTool(ToolType.RECTANGLE)}
          >
            <Square className="h-4 w-4" />
          </ToolButton>
          <div className="my-1 h-px w-7 bg-foreground/10" />
          <ToolButton
            active={tool === ToolType.DOOR}
            label="문"
            onClick={() => setTool(ToolType.DOOR)}
          >
            <DoorOpen className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            active={tool === ToolType.WINDOW}
            label="창문"
            onClick={() => setTool(ToolType.WINDOW)}
          >
            <Check className="h-4 w-4" />
          </ToolButton>
        </aside>

        {/* `relative`: the canvas container is absolutely positioned and would
            otherwise cover the header and tool bar. */}
        <div className="relative min-w-0 flex-1 bg-white dark:bg-neutral-900">
          <FloorplanCanvas
            activeTool={tool}
            onDataChange={(nextData) => setData(nextData)}
            renderStyle="solid"
            showGrid
            wallHeight={2400}
            wallThickness={100}
          />
        </div>
      </div>
    </section>
  )
}

/** Opened from the 보기 설정 menu ('Archiple 2D 도면'); the stage's ✕ closes it. */
export const useArchipleBridge = create<{ open: boolean; setOpen: (open: boolean) => void }>(
  (set) => ({
    open: false,
    setOpen: (open) => set({ open }),
  }),
)

export function ArchipleFloorplanBridge() {
  const open = useArchipleBridge((s) => s.open)
  if (!open) return null
  return (
    <div className="pointer-events-none absolute inset-0">
      <ArchipleCanvasStage onExit={() => useArchipleBridge.getState().setOpen(false)} />
    </div>
  )
}
