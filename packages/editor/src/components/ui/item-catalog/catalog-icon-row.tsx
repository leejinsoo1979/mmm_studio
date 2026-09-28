'use client'

import { Root as TooltipRoot } from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { triggerSFX } from '../../../lib/sfx-bus'
import { cn } from '../../../lib/utils'
import { TooltipContent, TooltipProvider, TooltipTrigger } from '../primitives/tooltip'

export type CatalogIconRowItem = { id: string; label: string; icon: ReactNode }

/**
 * inZOI's sub-category row: evenly spaced outline icons on a light strip;
 * the active one sits in a white disc. Labels show as tooltips.
 */
export function CatalogIconRow({
  items,
  activeId,
  onSelect,
}: {
  items: CatalogIconRowItem[]
  activeId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <TooltipProvider delayDuration={200} disableHoverableContent>
      <div className="flex h-[38px] shrink-0 items-center justify-center bg-[var(--panel-subrow,#f2f2f2)] px-1.5">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <div className="flex min-w-0 max-w-10 flex-1 justify-center" key={item.id}>
              <TooltipRoot>
                <TooltipTrigger asChild>
                  <button
                    aria-label={item.label}
                    aria-pressed={active}
                    className={cn(
                      'grid aspect-square w-full max-w-8 place-items-center rounded-full transition-colors [&_svg]:size-5 [&_svg]:stroke-[1.5]',
                      active
                        ? 'bg-white text-[#5aa0e0] shadow-[0_1px_3px_rgba(0,0,0,0.15)] dark:bg-white/15 dark:text-sky-300'
                        : 'text-[#555] hover:text-[#222] dark:text-neutral-300 dark:hover:text-white',
                    )}
                    onClick={() => {
                      triggerSFX('sfx:menu-click')
                      onSelect(item.id)
                    }}
                    onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                    type="button"
                  >
                    {item.icon}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="pointer-events-none" side="bottom" sideOffset={4}>
                  {item.label}
                </TooltipContent>
              </TooltipRoot>
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
