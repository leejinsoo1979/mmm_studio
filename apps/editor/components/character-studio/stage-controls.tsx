'use client'

import { cn } from '@/lib/utils'
import type { StageView } from './stage-contract'
import { FOCUS_RING } from './studio-controls'
import { Tooltip } from './studio-toolbar'

const VIEWS: readonly { id: Exclude<StageView, 'free'>; label: string; hint: string }[] = [
  { id: 'front', label: '정면', hint: '정면에서 보기' },
  { id: 'angle', label: '45°', hint: '비스듬히 보기 · 다시 누르면 반대쪽' },
  { id: 'side', label: '측면', hint: '옆에서 보기 · 다시 누르면 반대쪽' },
]

/**
 * At the free rect's top right: LIVE (the avatar breathes and moves, or
 * holds still facing the camera) where the tab holds it still, and the
 * turntable's preset angles everywhere.
 */
export function StageControls({
  place,
  showLive,
  live,
  onLive,
  view,
  onView,
}: {
  /**
   * CSS px from the screen's right edge (the free rect's top right), or
   * from its left where a panel lies over the right (narrow screens).
   */
  place: { right: number } | { left: number }
  showLive: boolean
  live: boolean
  onLive: (live: boolean) => void
  view: StageView
  onView: (view: Exclude<StageView, 'free'>) => void
}) {
  return (
    <div
      className={cn(
        'pointer-events-auto absolute top-[116px] flex flex-col gap-2 transition-[right] duration-300 ease-out motion-reduce:transition-none',
        'right' in place ? 'items-end' : 'items-start',
      )}
      style={place}
    >
      {showLive && (
        <button
          aria-pressed={live}
          className={cn(
            // Above the view buttons: its blur makes it a stacking context, so
            // its tooltip can only rise over them if the button itself does.
            'group relative z-10 flex h-8 items-center gap-1.5 rounded-full px-3 font-bold text-[12px] tracking-[0.12em] ring-1 transition duration-200 ease-out motion-reduce:transition-none',
            FOCUS_RING,
            live
              ? 'bg-rose-500/90 text-white ring-rose-300/50'
              : 'bg-black/45 text-white/60 ring-white/15 backdrop-blur-xl hover:text-white',
          )}
          onClick={() => onLive(!live)}
          type="button"
        >
          <span
            aria-hidden
            className={cn(
              'size-2 rounded-full',
              live ? 'bg-white motion-safe:animate-pulse' : 'bg-white/40',
            )}
          />
          LIVE
          <Tooltip
            place={
              'right' in place
                ? 'top-1/2 right-full mr-2 -translate-y-1/2'
                : 'top-1/2 left-full ml-2 -translate-y-1/2'
            }
            text={live ? '움직임 끄기' : '움직임 켜기'}
          />
        </button>
      )}
      <div
        aria-label="보는 방향"
        className="flex flex-col overflow-hidden rounded-xl bg-black/45 ring-1 ring-white/10 backdrop-blur-xl"
        role="group"
      >
        {VIEWS.map(({ id, label, hint }) => (
          <button
            aria-label={hint}
            aria-pressed={view === id}
            className={cn(
              'h-8 w-14 text-[12px] transition duration-200 ease-out motion-reduce:transition-none',
              'outline-none focus-visible:outline-2 focus-visible:outline-sky-400 focus-visible:outline-offset-[-2px]',
              view === id ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10',
            )}
            key={id}
            onClick={() => onView(id)}
            title={hint}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
