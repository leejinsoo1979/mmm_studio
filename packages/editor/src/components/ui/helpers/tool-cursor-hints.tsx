'use client'

import { Info, Ruler } from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { cn } from '../../../lib/utils'
import useDraftReadout from '../../../store/use-draft-readout'
import { type PlacementAnchor, usePlacementFeedback } from '../../../store/use-placement-feedback'

/** Hint key for an information line (inZOI's ⓘ rows) rather than a key. */
const INFO_KEY = 'ⓘ'

// Right of the wall pillar, starting slightly above the pointer (inZOI).
const OFFSET_X = 36
const OFFSET_Y = -14

const LEFT_CLICK = 'Left click'
const RIGHT_CLICK = 'Right click'

/** Gap between a held ghost's screen box and the key list (inZOI). */
const ANCHOR_GAP = 16

const KEY_LABELS: Record<string, string> = {
  [LEFT_CLICK]: '클릭',
  [RIGHT_CLICK]: '우클릭',
  'Double click': '더블클릭',
}

/**
 * inZOI-style tool tips that ride next to the cursor while a build tool is
 * armed, so the keys are where the eye already is. Shown only over the 3D
 * canvas or the floor plan; the docked panel keeps the clickable chips.
 */
export function ToolCursorHints({
  hints,
  warning,
  title,
}: {
  hints: ContextualShortcutHint[]
  /** inZOI's red line under the keys (e.g. an overlapping drop). */
  warning?: string
  /** The held object's name and size, heading the list. */
  title?: { name: string; size?: string }
}) {
  const ref = useRef<HTMLDivElement>(null)
  const readout = useDraftReadout((s) => s.text)

  useEffect(() => {
    const el = ref.current
    const bounds = el?.closest<HTMLElement>('[data-viewer-bounds]')
    if (!(el && bounds)) return
    let frame = 0
    let x = 0
    let y = 0
    let shown = false
    let overCanvas = false
    let anchor: PlacementAnchor | null = usePlacementFeedback.getState().anchor

    const flush = () => {
      frame = 0
      el.style.display = shown ? 'flex' : 'none'
      if (!shown) return
      const rect = bounds.getBoundingClientRect()
      // A held item: ride beside the ghost's screen box, top-aligned with it,
      // flipping to its left edge near the right of the viewport.
      if (anchor && overCanvas) {
        const right = anchor.right - rect.left + ANCHOR_GAP
        const left =
          right + el.offsetWidth > rect.width
            ? anchor.left - rect.left - ANCHOR_GAP - el.offsetWidth
            : right
        const top = Math.min(
          Math.max(0, anchor.top - rect.top),
          Math.max(0, rect.height - el.offsetHeight),
        )
        el.style.transform = `translate(${left}px, ${top}px)`
        return
      }
      // Flip to the cursor's left / top near the far edges so it stays on screen.
      const left =
        x + OFFSET_X + el.offsetWidth > rect.width ? x - OFFSET_X - el.offsetWidth : x + OFFSET_X
      const top = Math.max(
        0,
        y + OFFSET_Y + el.offsetHeight > rect.height ? y - el.offsetHeight : y + OFFSET_Y,
      )
      el.style.transform = `translate(${left}px, ${top}px)`
    }
    const onMove = (event: PointerEvent) => {
      const target = event.target as Element | null
      const rect = bounds.getBoundingClientRect()
      x = event.clientX - rect.left
      y = event.clientY - rect.top
      overCanvas = !!target?.closest('canvas')
      shown =
        !!target?.closest('canvas, [data-floorplan-scene]') &&
        !target.closest('button, [data-floorplan-panel-control]') &&
        x >= 0 &&
        y >= 0 &&
        x <= rect.width &&
        y <= rect.height
      if (frame === 0) frame = window.requestAnimationFrame(flush)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    const unsubscribeAnchor = usePlacementFeedback.subscribe((state) => {
      if (state.anchor === anchor) return
      anchor = state.anchor
      if (frame === 0) frame = window.requestAnimationFrame(flush)
    })
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      unsubscribeAnchor()
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-40 flex-col gap-[9px] font-medium text-white [text-shadow:0_0_1px_rgba(0,0,0,1),0_0_2px_rgba(0,0,0,0.95),0_1px_3px_rgba(0,0,0,0.8),0_0_8px_rgba(0,0,0,0.5)]"
      ref={ref}
      style={{ display: 'none' }}
    >
      {title && (
        <div className="mb-0.5 flex items-baseline gap-2 whitespace-nowrap">
          <span className="font-semibold text-[13px]">{title.name}</span>
          {title.size && (
            <span className="text-[11px] text-white/80 tabular-nums">{title.size}</span>
          )}
        </div>
      )}
      {readout && (
        <div className="mb-1 flex items-center gap-3 whitespace-nowrap font-medium text-[14px] tabular-nums">
          <span className="flex w-5 shrink-0 justify-center">
            <Ruler className="size-4" />
          </span>
          <span>{readout}</span>
        </div>
      )}
      {hints.map((hint) => (
        <div
          className={cn(
            'flex items-center gap-3 whitespace-nowrap text-[12px]',
            hint.active && 'text-sky-300',
          )}
          key={`${hint.keys.join('+')}:${hint.label}`}
        >
          <span className="flex min-w-5 shrink-0 items-center justify-center gap-0.5">
            {hint.keys.map((key, index) => (
              <Fragment key={String(key)}>
                {index > 0 && <span className="px-px text-[9px] opacity-80">+</span>}
                {(Array.isArray(key) ? key : [key]).map((k) => (
                  <HintKey active={hint.active} key={k} value={k} />
                ))}
              </Fragment>
            ))}
          </span>
          <span>{hint.label}</span>
        </div>
      ))}
      {warning && (
        <div className="mt-1.5 flex h-6 items-center gap-1.5 self-start whitespace-nowrap rounded-full border border-[#E25A5A] bg-[#FDF1F1]/90 pr-2.5 pl-1 font-medium text-[#D63A3A] text-[11px] [text-shadow:none]">
          <span className="grid size-3.5 place-items-center rounded-full bg-[#E04040] font-bold text-[9px] text-white">
            !
          </span>
          {warning}
        </div>
      )}
    </div>
  )
}

function HintKey({ value, active }: { value: string; active?: boolean }) {
  if (value === INFO_KEY) return <Info className="size-4" strokeWidth={1.5} />
  if (value === LEFT_CLICK) return <MouseGlyph />
  if (value === RIGHT_CLICK) return <MouseGlyph right />
  return (
    <span
      className={cn(
        'h-[18px] rounded-[4px] px-1 font-semibold text-[9px] text-white leading-[18px] ring-1 ring-white/35 [text-shadow:none]',
        active ? 'bg-sky-500/90' : 'bg-[#8e8e8e]/80',
      )}
    >
      {KEY_LABELS[value] ?? value}
    </span>
  )
}

/** inZOI's mouse icon: grey body with the pressed (left / right) button lit white. */
function MouseGlyph({ right = false }: { right?: boolean }) {
  return (
    <svg aria-hidden="true" className="shrink-0" height="18" viewBox="0 0 14 18" width="14">
      <rect
        fill="rgba(0,0,0,0.25)"
        height="16.5"
        rx="6.25"
        stroke="#a0a0a0"
        width="12.5"
        x="0.75"
        y="0.75"
      />
      <path
        d={right ? 'M7 1.25A5.75 5.75 0 0 1 12.75 7v1H7z' : 'M7 1.25A5.75 5.75 0 0 0 1.25 7v1h5.75z'}
        fill="#ffffff"
      />
      <path d="M1.25 8h11.5M7 1.25V8" stroke="#a0a0a0" strokeWidth="1" />
    </svg>
  )
}
