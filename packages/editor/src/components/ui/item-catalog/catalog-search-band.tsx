'use client'

import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../../lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'

/**
 * inZOI's frosted band under the tab row: a pill search field (clear button
 * left of a fixed magnifier) and, below it, an optional row with a pill at
 * the left and white outline icon actions at the right.
 */
export function CatalogSearchBand({
  value,
  onChange,
  placeholder = '검색',
  left,
  actions,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  left?: ReactNode
  actions?: ReactNode
}) {
  const hasRow = Boolean(left || actions)
  return (
    <div
      className={cn(
        'shrink-0 bg-[var(--panel-band,rgba(170,170,178,0.55))] px-2.5 pt-2.5',
        hasRow ? 'pb-1.5' : 'pb-2.5',
      )}
    >
      <label className="flex h-8 items-center gap-2 rounded-full bg-white/75 pr-2.5 pl-3 dark:bg-white/10">
        <input
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[#333] outline-none placeholder:text-[#a5a5a5] dark:text-neutral-100 dark:placeholder:text-neutral-400"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') onChange('')
          }}
          placeholder={placeholder}
          type="text"
          value={value}
        />
        {value && (
          <button
            aria-label="검색 지우기"
            className="grid size-4 shrink-0 place-items-center rounded-full bg-[#9a9a9a] text-white hover:bg-[#808080]"
            onClick={() => onChange('')}
            type="button"
          >
            <X className="size-2.5" strokeWidth={3} />
          </button>
        )}
        <Search
          aria-hidden
          className="size-4 shrink-0 text-[#222] dark:text-neutral-200"
          strokeWidth={2}
        />
      </label>
      {hasRow && (
        <div className="mt-1 flex h-7 items-center gap-2">
          {left}
          <div className="ml-auto flex items-center gap-2 pr-0.5">{actions}</div>
        </div>
      )}
    </div>
  )
}

/** Classes of a white outline icon action in the band's filter row. */
export const CATALOG_BAND_ACTION =
  'grid size-6 place-items-center rounded-full text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)] transition-colors hover:bg-white/20 [&_svg]:size-5 [&_svg]:stroke-[1.5]'

/**
 * Small outlined pill at the left of the band's filter row that opens a
 * settings popover beside the panel (inZOI's secondary action).
 */
export function CatalogBandPill({
  label,
  children,
  contentClassName,
}: {
  label: ReactNode
  children: ReactNode
  contentClassName?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="h-6 max-w-[220px] truncate rounded-full border border-white/80 px-2.5 font-medium text-[11px] text-white transition-colors [text-shadow:0_1px_2px_rgba(0,0,0,0.3)] hover:bg-white/20 data-[state=open]:bg-white/25"
          type="button"
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          'w-[300px] rounded-2xl border-0 bg-white p-3 text-neutral-800 shadow-[0_10px_36px_rgba(0,0,0,0.25)] dark:bg-neutral-900 dark:text-neutral-100',
          contentClassName,
        )}
        onKeyDown={(e) => e.stopPropagation()}
        side="right"
        sideOffset={14}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
