'use client'

import { createWallOnCurrentLevel } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Check, DoorOpen, MousePointer2, PenLine, Square, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { ToolType } from './archiple2d/core/types/EditorState'
import FloorplanCanvas from './archiple2d/floorplan/FloorplanCanvas'

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
          : 'border-white/10 bg-[#242424] text-neutral-300 hover:bg-[#303030] hover:text-white'
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

  const applyToMmm = useCallback(() => {
    if (!useViewer.getState().selection.levelId || !data?.points || !data?.walls) return

    const pointById = new Map(data.points.map((point) => [point.id, point]))
    for (const wall of data.walls) {
      const start = pointById.get(wall.startPointId)
      const end = pointById.get(wall.endPointId)
      if (!(start && end)) continue
      createWallOnCurrentLevel([start.x / 1000, start.y / 1000], [end.x / 1000, end.y / 1000])
    }
  }, [data])

  return (
    <section className="pointer-events-auto absolute inset-0 z-40 flex flex-col bg-[#111]">
      <header className="flex h-10 shrink-0 items-center justify-between border-white/10 border-b bg-[#181818] px-3">
        <div className="flex items-center gap-2 text-neutral-300">
          <span className="font-semibold text-white text-xs">Archiple 2D Floorplan</span>
          <span className="text-[11px]">original engine · mm coordinates · right-click finishes wall chain</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md bg-white px-2.5 py-1.5 font-semibold text-[#111] text-xs hover:bg-neutral-200"
            onClick={applyToMmm}
            type="button"
          >
            Apply to MMM
          </button>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-300 hover:bg-white/10 hover:text-white"
            onClick={onExit}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-12 shrink-0 flex-col items-center gap-2 border-white/10 border-r bg-[#202020] py-3">
          <ToolButton active={tool === ToolType.SELECT} label="Select" onClick={() => setTool(ToolType.SELECT)}>
            <MousePointer2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={tool === ToolType.WALL} label="Wall" onClick={() => setTool(ToolType.WALL)}>
            <PenLine className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={tool === ToolType.RECTANGLE} label="Room" onClick={() => setTool(ToolType.RECTANGLE)}>
            <Square className="h-4 w-4" />
          </ToolButton>
          <div className="my-1 h-px w-7 bg-white/10" />
          <ToolButton active={tool === ToolType.DOOR} label="Door" onClick={() => setTool(ToolType.DOOR)}>
            <DoorOpen className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={tool === ToolType.WINDOW} label="Window" onClick={() => setTool(ToolType.WINDOW)}>
            <Check className="h-4 w-4" />
          </ToolButton>
        </aside>

        <div className="min-w-0 flex-1 bg-white">
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

export function ArchipleFloorplanBridge() {
  const [open, setOpen] = useState(false)

  return (
    <div className="pointer-events-none absolute inset-0">
      <button
        className={`pointer-events-auto absolute bottom-5 left-5 z-50 rounded-full border px-3 py-2 font-semibold text-xs shadow-xl backdrop-blur transition ${
          open
            ? 'border-[#7567ff]/70 bg-[#7567ff] text-white hover:bg-[#6658f2]'
            : 'border-white/10 bg-[#171717]/95 text-white hover:bg-[#252525]'
        }`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? 'MMM 3D' : 'Archiple 2D'}
      </button>
      {open && <ArchipleCanvasStage onExit={() => setOpen(false)} />}
    </div>
  )
}
