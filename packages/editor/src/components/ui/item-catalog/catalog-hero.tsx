'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../../lib/utils'

/**
 * inZOI's hero band above the catalogue: a line-art illustration with a
 * category chip at the top left and a small tab at the bottom centre that
 * collapses the band (the tab stays visible while collapsed).
 */
export function CatalogHero({
  label,
  collapsed,
  onToggle,
  children,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden bg-[var(--panel-hero,#edebea)] transition-[height] duration-200 ease-out',
        collapsed ? 'h-[14px]' : 'h-[128px]',
      )}
    >
      {!collapsed && (
        <>
          <div className="absolute inset-0 flex items-end justify-center pb-3.5 dark:[&>svg]:invert [&>svg]:h-full [&>svg]:w-full">
            {children}
          </div>
          <span className="absolute top-2 left-2 rounded-[3px] bg-[#a5d5ef] px-1.5 py-0.5 font-bold text-[10px] text-white leading-none">
            {label}
          </span>
        </>
      )}
      <button
        aria-expanded={!collapsed}
        aria-label={collapsed ? '그림 펼치기' : '그림 접기'}
        className="absolute bottom-0 left-1/2 flex h-[14px] w-12 -translate-x-1/2 items-center justify-center rounded-t-md bg-white text-[#5aa0e0] hover:text-[#3d8fd6] dark:bg-neutral-800 dark:text-sky-300"
        onClick={onToggle}
        type="button"
      >
        {collapsed ? (
          <ChevronDown className="size-3" strokeWidth={2.5} />
        ) : (
          <ChevronUp className="size-3" strokeWidth={2.5} />
        )}
      </button>
    </div>
  )
}
