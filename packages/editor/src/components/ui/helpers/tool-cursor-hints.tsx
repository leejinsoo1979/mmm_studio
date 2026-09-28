'use client'

import { Info, Ruler } from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { HUD_KEYCAP, HUD_MUTED, HUD_TEXT } from '../../../lib/hud'
import { cn } from '../../../lib/utils'
import useDraftReadout from '../../../store/use-draft-readout'
import { type PlacementAnchor, usePlacementFeedback } from '../../../store/use-placement-feedback'
import { MouseGlyph } from '../primitives/mouse-glyph'

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
  'Double click': '더블클릭',
}

type Rect = { left: number; top: number; right: number; bottom: number }

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

/** HUD chrome (tool bar, legend, header, …) the hints must never draw over. */
function hudAvoidRects(doc: Document): Rect[] {
  return Array.from(doc.querySelectorAll<HTMLElement>('[data-hud-avoid]'), (el) =>
    el.getBoundingClientRect(),
  ).filter((rect) => rect.width > 0 && rect.height > 0)
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
      // Right / below the cursor first, then flip left and / or up: the first
      // placement that stays on screen and clear of the HUD chrome wins.
      const avoid = hudAvoidRects(el.ownerDocument)
      const px = x + rect.left
      const py = y + rect.top
      if (avoid.some((r) => overlaps(r, { left: px, top: py, right: px, bottom: py }))) {
        el.style.display = 'none'
        return
      }
      const w = el.offsetWidth
      const h = el.offsetHeight
      const candidates = [
        [x + OFFSET_X, y + OFFSET_Y],
        [x - OFFSET_X - w, y + OFFSET_Y],
        [x + OFFSET_X, y - h - OFFSET_Y],
        [x - OFFSET_X - w, y - h - OFFSET_Y],
      ] as const
      const fits = ([cx, cy]: readonly [number, number]) => {
        if (cx < 0 || cy < 0 || cx + w > rect.width || cy + h > rect.height) return false
        const left = cx + rect.left
        const top = cy + rect.top
        const box = { left, top, right: left + w, bottom: top + h }
        return !avoid.some((r) => overlaps(r, box))
      }
      const placement = candidates.find(fits)
      if (!placement) {
        el.style.display = 'none'
        return
      }
      el.style.transform = `translate(${placement[0]}px, ${placement[1]}px)`
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
      className={cn(
        'pointer-events-none fixed top-0 left-0 z-40 flex-col gap-[7px] font-medium',
        HUD_TEXT,
      )}
      ref={ref}
      style={{ display: 'none' }}
    >
      {title && (
        <div className="mb-0.5 flex items-baseline gap-2 whitespace-nowrap">
          <span className="font-semibold text-[13px]">{title.name}</span>
          {title.size && (
            <span className={cn('text-[11px] tabular-nums', HUD_MUTED)}>{title.size}</span>
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
            'flex items-center gap-2.5 whitespace-nowrap text-[11px]',
            hint.active && 'text-[#2f7fd0]',
          )}
          key={`${hint.keys.join('+')}:${hint.label}`}
        >
          <span className="flex min-w-5 shrink-0 items-center justify-center gap-0.5">
            {hint.keys.map((key, index) => (
              <Fragment key={String(key)}>
                {index > 0 && <span className="px-px text-[9px]">+</span>}
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
  if (value === LEFT_CLICK) return <MouseGlyph button="left" />
  if (value === RIGHT_CLICK) return <MouseGlyph button="right" />
  return (
    <span className={cn(HUD_KEYCAP, 'h-[18px] px-1 text-[9px]', active && 'bg-[#3d8fe0]')}>
      {KEY_LABELS[value] ?? value}
    </span>
  )
}
