'use client'

import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from './studio-controls'
import type { Category } from './studio-layout'

/**
 * The tab's categories down the right, inZOI's way: radio dots on one
 * leader line, each name ticked to its dot. Picking one opens the panel
 * beside it; the rail moves left as the panel slides in. Hovering reports
 * the category, so the 얼굴 tab can light up that region's handles.
 */
export function CategoryRail({
  label,
  categories,
  selected,
  highlighted,
  changed,
  onSelect,
  onHover,
  panelOpen,
  panelId,
}: {
  label: string
  categories: readonly Category[]
  selected: string
  /** A category to show as hovered from elsewhere (the face handle under the pointer). */
  highlighted: string | null
  changed: (id: string) => boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  panelOpen: boolean
  panelId: string
}) {
  const list = useRef<HTMLDivElement>(null)
  const focusAt = (index: number) => {
    const id = categories[(index + categories.length) % categories.length]!.id
    onSelect(id)
    list.current?.querySelector<HTMLElement>(`[data-category="${id}"]`)?.focus()
  }
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      className={cn(
        'pointer-events-auto absolute top-1/2 flex -translate-y-1/2 flex-col transition-[right] duration-300 ease-out motion-reduce:transition-none',
        panelOpen ? 'right-[400px]' : 'right-6',
      )}
      onKeyDown={(event) => {
        const at = categories.findIndex(({ id }) => id === selected)
        if (event.key === 'ArrowDown') focusAt(at + 1)
        else if (event.key === 'ArrowUp') focusAt(at - 1)
        else if (event.key === 'Home') focusAt(0)
        else if (event.key === 'End') focusAt(categories.length - 1)
        else return
        event.preventDefault()
      }}
      onPointerLeave={() => onHover(null)}
      ref={list}
      role="tablist"
    >
      <span aria-hidden className="absolute top-5 right-[5.5px] bottom-5 w-px bg-white/20" />
      {categories.map(({ id, label: name }) => {
        const active = id === selected
        const lit = active || id === highlighted
        return (
          <button
            aria-controls={panelId}
            aria-selected={active}
            className={cn(
              'group relative flex h-10 items-center justify-end gap-3 rounded-lg pl-3',
              FOCUS_RING,
            )}
            data-category={id}
            key={id}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(id)}
            onFocus={() => onHover(id)}
            onPointerEnter={() => onHover(id)}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
          >
            {changed(id) && (
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-sky-300" />
            )}
            <span
              className={cn(
                'whitespace-nowrap text-[13px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] transition duration-200 ease-out motion-reduce:transition-none',
                active
                  ? 'font-semibold text-white'
                  : lit
                    ? 'text-white'
                    : 'text-white/65 group-hover:text-white',
              )}
            >
              {name}
              {changed(id) && <span className="sr-only"> (바꾼 곳 있음)</span>}
            </span>
            <span
              aria-hidden
              className={cn('h-px w-5 shrink-0', active ? 'bg-sky-400/70' : 'bg-white/25')}
            />
            <span
              aria-hidden
              className={cn(
                'relative z-10 size-3 shrink-0 rounded-full ring-2 transition duration-200 ease-out motion-reduce:transition-none',
                active
                  ? 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.8)] ring-sky-400'
                  : lit
                    ? 'bg-[#0b0c0f] ring-white'
                    : 'bg-[#0b0c0f] ring-white/50',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
