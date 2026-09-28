'use client'

import type { ReactNode } from 'react'
import { cn } from '../../../lib/utils'

/** Tailwind classes of the inZOI 4-up card grid. */
export const CATALOG_GRID = 'grid grid-cols-4 gap-[5px]'

/**
 * Scrolling catalogue list with inZOI's thin pale scrollbar: a 4px white
 * thumb inside the right edge and no track (thin + pale where the WebKit
 * pseudo-elements are unsupported).
 */
export const CATALOG_SCROLL =
  'min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:min-h-8 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/60 hover:[&::-webkit-scrollbar-thumb]:bg-white/85 dark:[&::-webkit-scrollbar-thumb]:bg-white/25 supports-[not_selector(::-webkit-scrollbar)]:[scrollbar-color:rgba(255,255,255,0.6)_transparent] supports-[not_selector(::-webkit-scrollbar)]:[scrollbar-width:thin]'

/**
 * inZOI catalogue group: a translucent header bar with white text over a
 * 4-up card grid. `grid={false}` renders the children as they are (forms).
 * The title doubles as the jump target (`data-catalog-section`).
 */
export function CatalogSection({
  title,
  children,
  grid = true,
  className,
}: {
  title: string
  children: ReactNode
  grid?: boolean
  className?: string
}) {
  return (
    <section className={cn('scroll-mt-1 pt-2', className)} data-catalog-section={title}>
      <h2 className="mx-2.5 mb-1.5 flex h-[26px] items-center rounded-md bg-[var(--panel-header,rgba(80,80,90,0.3))] px-2.5 font-semibold text-[12px] text-white leading-none">
        {title}
      </h2>
      <div className={cn('px-2.5', grid && CATALOG_GRID)}>{children}</div>
    </section>
  )
}
