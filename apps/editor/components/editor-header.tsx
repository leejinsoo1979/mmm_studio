import { type AnyNodeId, getLevelDisplayName, type SlabNode, useScene } from '@pascal-app/core'
import { HUD_TEXT, useUiHidden } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useEffect, useRef, useState } from 'react'

interface EditorHeaderProps {
  sceneName: string
  onRename: (name: string) => Promise<void>
}

type Point = readonly [number, number]

function ringArea(points: readonly Point[]): number {
  let twice = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i]!
    const [x2, z2] = points[(i + 1) % points.length]!
    twice += x1 * z2 - x2 * z1
  }
  return Math.abs(twice) / 2
}

/** Floor area of the current level: its slabs, less their holes, in m². */
function useLevelFloorArea(): { area: number; levelName: string | null } {
  const levelId = useViewer((s) => s.selection.levelId)
  const area = useScene((s) => {
    const level = levelId ? s.nodes[levelId as AnyNodeId] : null
    if (level?.type !== 'level') return 0
    let total = 0
    for (const childId of level.children) {
      const node = s.nodes[childId as AnyNodeId]
      if (node?.type !== 'slab') continue
      const slab = node as SlabNode
      total += ringArea(slab.polygon)
      for (const hole of slab.holes ?? []) total -= ringArea(hole)
    }
    return total
  })
  const levelName = useScene((s) => {
    const level = levelId ? s.nodes[levelId as AnyNodeId] : null
    return level?.type === 'level' ? getLevelDisplayName(level) : null
  })
  return { area, levelName }
}

function formatFloorArea(squareMeters: number, imperial: boolean): string {
  if (squareMeters <= 0) return '—'
  return imperial ? `${(squareMeters * 10.7639).toFixed(0)}ft²` : `${squareMeters.toFixed(1)}m²`
}

/** inZOI's 소지금 card under the build panel; ours reads the floor area. */
function FloorAreaCard() {
  const { area, levelName } = useLevelFloorArea()
  const imperial = useViewer((s) => s.unit === 'imperial')
  return (
    <div
      className="fixed bottom-3 left-3 z-40 h-12 rounded-xl bg-[#f9f9f9]/95 shadow-[0_2px_10px_rgba(0,0,0,0.08)] backdrop-blur-md dark:bg-neutral-900/95"
      style={{ width: 'calc(var(--viewer-left-inset, 0px) - 12px)' }}
    >
      <span className="absolute top-2 left-3 text-[11px] text-neutral-500 dark:text-neutral-400">
        바닥 면적{levelName ? ` · ${levelName}` : ''}
      </span>
      <span className="absolute top-1/2 right-4 -translate-y-1/2 font-semibold text-[17px] text-neutral-900 tabular-nums dark:text-neutral-50">
        {formatFloorArea(area, imperial)}
      </span>
    </div>
  )
}

/** Warns when the server keeps scenes in memory only (they vanish on restart). */
function useMemoryStoreWarning(): boolean {
  const [memory, setMemory] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch('/api/health', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((health: { store?: string } | null) => {
        if (!cancelled && health?.store === 'memory') setMemory(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return memory
}

/**
 * The palette's own Esc handler closes it, exactly like its 확인 button. The
 * key starts where a real one would, so the palette's capture listener takes
 * it before the editor's Esc (which would also drop the selection).
 */
function leaveCustomize() {
  const target = document.activeElement ?? document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

function BackButton({ customizing }: { customizing: boolean }) {
  const disc = (
    <span className="flex size-full items-center justify-center rounded-full bg-white text-[#555] shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
      <ChevronLeft className="size-4" strokeWidth={2.25} />
    </span>
  )
  const ringClass =
    'flex size-9 shrink-0 items-center justify-center rounded-full bg-white/35 p-[5px] backdrop-blur-sm transition-colors hover:bg-white/55'
  const textClass = `ml-2.5 shrink-0 font-normal text-[17px] hover:underline ${HUD_TEXT}`
  if (customizing) {
    return (
      <>
        <button aria-label="돌아가기" className={ringClass} onClick={leaveCustomize} type="button">
          {disc}
        </button>
        <button className={textClass} onClick={leaveCustomize} type="button">
          돌아가기
        </button>
      </>
    )
  }
  return (
    <>
      <Link aria-label="대시보드로 돌아가기" className={ringClass} href="/dashboard">
        {disc}
      </Link>
      <Link className={textClass} href="/dashboard">
        돌아가기
      </Link>
    </>
  )
}

export function EditorHeader({ sceneName, onRename }: EditorHeaderProps) {
  const [draftName, setDraftName] = useState(sceneName)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const customizing = useUiHidden((s) => s.customizing)
  const memoryStore = useMemoryStoreWarning()

  useEffect(() => setDraftName(sceneName), [sceneName])

  const commitName = async () => {
    const nextName = draftName.trim()
    if (!nextName || nextName === sceneName) {
      setDraftName(sceneName)
      return
    }
    setIsSaving(true)
    try {
      await onRename(nextName)
    } catch {
      setDraftName(sceneName)
    } finally {
      setIsSaving(false)
    }
  }

  let title: ReactNode
  if (customizing) {
    title = <span className={`font-normal text-[17px] ${HUD_TEXT}`}>건축 커스터마이즈</span>
  } else {
    title = (
      <input
        aria-label="프로젝트 이름"
        className={`h-8 w-auto min-w-24 max-w-60 rounded-md border border-transparent bg-transparent px-1.5 font-normal text-[17px] outline-none transition [field-sizing:content] hover:border-black/10 focus:border-black/15 focus:bg-white/90 focus:text-neutral-900 focus:[text-shadow:none] disabled:opacity-60 ${HUD_TEXT}`}
        disabled={isSaving}
        maxLength={200}
        onBlur={() => void commitName()}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraftName(sceneName)
            event.currentTarget.blur()
          }
        }}
        ref={inputRef}
        value={draftName}
      />
    )
  }

  // inZOI "‹ 돌아가기 | 건축 모드": plate-less HUD text over the scene.
  return (
    <>
      <header className="flex h-11 items-center">
        <BackButton customizing={customizing} />
        <span className="mx-4 h-4 w-px shrink-0 bg-[color:var(--hud-fg)] opacity-60" />
        {title}
        {memoryStore && !customizing && (
          <span
            className="ml-3 whitespace-nowrap font-medium text-[#b45309] text-[12px] [text-shadow:0_0_4px_rgba(255,255,255,0.95)]"
            title="서버가 장면을 메모리에만 저장하고 있습니다"
          >
            임시 저장소 사용 중 · 재시작하면 사라집니다
          </span>
        )}
      </header>
      {!customizing && <FloorAreaCard />}
    </>
  )
}
