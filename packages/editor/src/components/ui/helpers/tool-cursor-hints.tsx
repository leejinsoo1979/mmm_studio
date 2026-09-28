'use client'

import { AlertCircle, Info } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { cn } from '../../../lib/utils'

/** Hint key for an information line (inZOI's ⓘ rows) rather than a key. */
const INFO_KEY = 'ⓘ'

const OFFSET_X = 24
const OFFSET_Y = 20

const KEY_LABELS: Record<string, string> = {
  'Left click': '클릭',
  'Right click': '우클릭',
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
}: {
  hints: ContextualShortcutHint[]
  /** inZOI's red line under the keys (e.g. an overlapping drop). */
  warning?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    const bounds = el?.closest<HTMLElement>('[data-viewer-bounds]')
    if (!(el && bounds)) return
    let frame = 0
    let x = 0
    let y = 0
    let shown = false

    const flush = () => {
      frame = 0
      el.style.display = shown ? 'flex' : 'none'
      if (!shown) return
      const rect = bounds.getBoundingClientRect()
      // Flip to the cursor's left / top near the far edges so it stays on screen.
      const left =
        x + OFFSET_X + el.offsetWidth > rect.width ? x - OFFSET_X - el.offsetWidth : x + OFFSET_X
      const top =
        y + OFFSET_Y + el.offsetHeight > rect.height ? y - OFFSET_Y - el.offsetHeight : y + OFFSET_Y
      el.style.transform = `translate(${left}px, ${top}px)`
    }
    const onMove = (event: PointerEvent) => {
      const target = event.target as Element | null
      const rect = bounds.getBoundingClientRect()
      x = event.clientX - rect.left
      y = event.clientY - rect.top
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
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-40 flex-col gap-1 text-neutral-800 [text-shadow:0_0_4px_rgba(255,255,255,0.95),0_0_2px_rgba(255,255,255,0.95)]"
      ref={ref}
      style={{ display: 'none' }}
    >
      {hints.map((hint) => (
        <div
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap text-[11px]',
            hint.active && 'font-semibold text-sky-700',
          )}
          key={`${hint.keys.join('+')}:${hint.label}`}
        >
          {hint.keys.map((key) =>
            key === INFO_KEY ? (
              <Info className="size-3.5 shrink-0 opacity-70" key="info" />
            ) : (
            <span
              className={cn(
                'rounded px-1 py-px font-semibold text-[10px]',
                hint.active ? 'bg-sky-100' : 'bg-neutral-200 dark:bg-neutral-700',
              )}
              key={String(key)}
            >
              {Array.isArray(key)
                  ? key.map((k) => KEY_LABELS[k] ?? k).join(' / ')
                  : (KEY_LABELS[key] ?? key)}
            </span>
            ),
          )}
          <span>{hint.label}</span>
        </div>
      ))}
      {warning && (
        <div className="mt-1 flex items-center gap-1 whitespace-nowrap rounded-full bg-red-500/90 px-2 py-0.5 font-medium text-[11px] text-white [text-shadow:none]">
          <AlertCircle className="size-3.5" />
          {warning}
        </div>
      )}
    </div>
  )
}
