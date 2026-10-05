'use client'

import { Slider } from '@pascal-app/editor'
import { ArrowUpDown, Eye, EyeOff, FlipHorizontal2, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SculptSettings } from './stage-contract'
import { FOCUS_RING } from './studio-controls'
import { Tooltip } from './studio-toolbar'

export type SculptOptions = Omit<SculptSettings, 'region'>

export const DEFAULT_SCULPT: SculptOptions = { symmetric: true, radiusScale: 1, depth: false }

export const RADIUS_MIN = 0.5
export const RADIUS_MAX = 2

/** The radius scale moved by `step`, kept in range and on the slider's 0.05 grid. */
export const stepRadius = (value: number, step: number) =>
  Math.round(Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, value + step)) * 20) / 20

const toggle = (on: boolean) =>
  cn(
    'group relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] transition duration-200 ease-out motion-reduce:transition-none',
    FOCUS_RING,
    on ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10',
  )

const iconButton = cn(
  'group relative grid size-8 place-items-center rounded-full text-white/70 transition duration-200 ease-out hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent motion-reduce:transition-none',
  FOCUS_RING,
)

const ABOVE = 'bottom-10 left-1/2 -translate-x-1/2'

export const COACH_LINES = [
  '점을 끌어 얼굴을 다듬어요',
  'Alt를 누르고 끌면 앞뒤로 움직여요',
  '옆으로 돌려 옆모습도 다듬을 수 있어요',
] as const

export const COACH_WIDTH = 248

/**
 * The first time the handles show, in a top corner of the free rect (clear
 * of the chin, the bars at the bottom and the view buttons): how sculpting
 * works.
 */
export function SculptCoach({
  left,
  top,
  onDismiss,
}: {
  /** Its top left corner, CSS px. */
  left: number
  top: number
  onDismiss: () => void
}) {
  return (
    <div
      className="pointer-events-auto absolute flex items-start gap-2 rounded-xl bg-black/70 py-2.5 pr-2 pl-3 text-[12px] text-white leading-5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl transition-[left] duration-300 ease-out motion-reduce:transition-none"
      role="note"
      style={{ left, top, width: COACH_WIDTH }}
    >
      <ul className="flex-1 space-y-0.5">
        {COACH_LINES.map((line, index) => (
          <li className={index === 0 ? 'font-semibold' : 'text-white/70'} key={line}>
            {line}
          </li>
        ))}
      </ul>
      <button
        aria-label="안내 닫기"
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white',
          FOCUS_RING,
        )}
        onClick={onDismiss}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

/**
 * Under the face in the 얼굴 tab: how a handle's drag spreads (대칭, 범위,
 * 앞뒤), putting the region back, and showing or hiding the handles.
 */
export function SculptBar({
  left,
  options,
  onOptions,
  showHandles,
  onShowHandles,
  regionLabel,
  canReset,
  onReset,
}: {
  /** The free rect's middle, CSS px from the left. */
  left: number
  options: SculptOptions
  onOptions: (options: SculptOptions) => void
  showHandles: boolean
  onShowHandles: (show: boolean) => void
  /** The region a reset puts back, null for none (the photo). */
  regionLabel: string | null
  canReset: boolean
  onReset: () => void
}) {
  return (
    <div
      className="pointer-events-auto absolute bottom-[112px] max-w-[380px] -translate-x-1/2 transition-[left] duration-300 ease-out motion-reduce:transition-none"
      style={{ left }}
    >
      <div
        aria-label="얼굴 조각 설정"
        className="flex h-10 items-center gap-1 rounded-full bg-black/45 px-1.5 ring-1 ring-white/10 backdrop-blur-xl"
        role="toolbar"
      >
        <button
          aria-keyshortcuts="X"
          aria-pressed={options.symmetric}
          className={toggle(options.symmetric)}
          onClick={() => onOptions({ ...options, symmetric: !options.symmetric })}
          type="button"
        >
          <FlipHorizontal2 className="size-4" /> 대칭
          <Tooltip place={ABOVE} text="양쪽을 함께 다듬어요 (X)" />
        </button>
        <div className="group relative flex h-8 items-center gap-2 px-2">
          <span className="text-[12px] text-white/70">범위</span>
          <Slider
            aria-keyshortcuts="[ ]"
            aria-label="범위"
            className="w-24 [&_[data-slot=slider-range]]:bg-sky-400 [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-track]]:bg-white/15"
            max={RADIUS_MAX * 100}
            min={RADIUS_MIN * 100}
            onValueChange={([next]) =>
              next !== undefined && onOptions({ ...options, radiusScale: next / 100 })
            }
            step={5}
            value={[options.radiusScale * 100]}
          />
          <Tooltip place={ABOVE} text={`범위 ${Math.round(options.radiusScale * 100)}% ([ ])`} />
        </div>
        <button
          aria-pressed={options.depth}
          className={toggle(options.depth)}
          onClick={() => onOptions({ ...options, depth: !options.depth })}
          type="button"
        >
          <ArrowUpDown className="size-4" /> 앞뒤
          <Tooltip place={ABOVE} text="위아래로 끌면 앞뒤로 밀고 당겨요" />
        </button>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-white/15" />
        <button
          aria-label={regionLabel ? `${regionLabel} 되돌리기` : '부위 되돌리기'}
          className={iconButton}
          disabled={!canReset}
          onClick={onReset}
          type="button"
        >
          <RotateCcw className="size-4" />
          <Tooltip place={ABOVE} text={regionLabel ? `${regionLabel} 되돌리기` : '부위 되돌리기'} />
        </button>
        <button
          aria-label="점 표시"
          aria-pressed={showHandles}
          className={iconButton}
          onClick={() => onShowHandles(!showHandles)}
          type="button"
        >
          {showHandles ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          <Tooltip place={ABOVE} text={showHandles ? '점 숨기기' : '점 표시'} />
        </button>
      </div>
    </div>
  )
}
