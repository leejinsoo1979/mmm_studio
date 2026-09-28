'use client'

import { Root as TooltipRoot } from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { triggerSFX } from './../../../lib/sfx-bus'
import { cn } from './../../../lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../primitives/tooltip'

export type SidebarTab = {
  id: string
  label: string
  mobileDefaultSnap?: number
  mobileIcon?: ReactNode
  /** Desktop icon shown in the vertical rail (v2 layout). */
  icon?: ReactNode
  /**
   * Generic panel ids this tab stands in for, so a request for one (the F
   * shortcut opens `'items'`) lands on this tab.
   */
  aliases?: string[]
}

interface TabBarProps {
  tabs: SidebarTab[]
  activeTab: string
  onTabChange: (id: string) => void
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-border/50 border-b px-2">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            className={cn(
              'relative h-7 rounded-md px-3 font-medium text-sm transition-colors',
              isActive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
            key={tab.id}
            onClick={() => {
              triggerSFX('sfx:menu-click')
              onTabChange(tab.id)
            }}
            onMouseEnter={() => triggerSFX('sfx:menu-hover')}
            type="button"
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

interface IconRailProps {
  tabs: SidebarTab[]
  /** Highlighted tab. Stays highlighted while the panel is collapsed. */
  activeTab: string
  /** True when the panel beside the rail is collapsed. */
  collapsed: boolean
  /** Clicking a rail icon: switch tab, or toggle the panel (see layout). */
  onIconClick: (id: string) => void
}

/**
 * Vertical icon rail for the v2 left column. Always visible (even when the
 * panel is collapsed) so the user can reopen the panel by clicking an icon.
 * The label renders as a hover tooltip on the right.
 */
export function IconRail({ tabs, activeTab, collapsed, onIconClick }: IconRailProps) {
  return (
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <div className="flex h-full w-12 shrink-0 flex-col justify-between border-border border-r bg-muted">
        <div className="flex flex-col">
          {tabs.map((tab) => {
            const showActive = activeTab === tab.id && !collapsed
            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'group flex h-11 w-full items-center justify-center border-border border-b text-muted-foreground transition-all duration-200 [&_svg]:h-[22px] [&_svg]:w-[22px] [&_svg]:stroke-[1.9] [&_svg]:transition-colors [&_img]:transition-[opacity,filter] [&_img]:duration-200',
                      showActive
                        ? 'bg-muted text-[#7779ff] [&_img]:opacity-100 [&_img]:grayscale-0'
                        : 'hover:bg-muted hover:text-foreground [&_img]:opacity-55 [&_img]:grayscale hover:[&_img]:opacity-100 hover:[&_img]:grayscale-0',
                    )}
                    onClick={() => {
                      triggerSFX('sfx:menu-click')
                      onIconClick(tab.id)
                    }}
                    onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                    type="button"
                  >
                    {tab.icon ?? tab.label.charAt(0)}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{tab.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </TooltipProvider>
  )
}

/**
 * inZOI-style tab row across the top of the floating build panel: the same
 * tabs as `IconRail`, laid out horizontally. The open tab sits in a sky-blue
 * disc; hovering another blooms a soft glow and grows its glyph. Clicking the
 * open tab collapses the panel to just this row.
 */
export function IconTabRow({ tabs, activeTab, collapsed, onIconClick }: IconRailProps) {
  return (
    <TooltipProvider delayDuration={400} disableHoverableContent>
      <div className="flex h-[50px] shrink-0 items-center bg-[var(--panel-tabs,#f8f8f8)] px-1.5">
        {tabs.map((tab) => {
          const showActive = activeTab === tab.id && !collapsed
          return (
            <TooltipRoot key={tab.id}>
              <TooltipTrigger asChild>
                <button
                  aria-label={tab.label}
                  aria-pressed={showActive}
                  className={cn(
                    'group relative flex h-full min-w-0 flex-1 items-center justify-center',
                    !showActive &&
                      'before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(closest-side,rgba(191,221,245,0.65),transparent)] before:opacity-0 before:transition-opacity before:duration-150 hover:before:opacity-100',
                  )}
                  onClick={() => {
                    triggerSFX('sfx:menu-click')
                    onIconClick(tab.id)
                  }}
                  onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                  type="button"
                >
                  <span
                    className={cn(
                      'relative flex size-11 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-out [&_img]:size-6 [&_svg]:size-6 [&_svg]:stroke-[1.5]',
                      showActive
                        ? 'bg-[#a1d3f8] text-white dark:bg-sky-400/60'
                        : 'text-[#555] group-hover:scale-[1.3] group-hover:text-[#6a7a8a] dark:text-neutral-300 dark:group-hover:text-sky-200 [&_img]:opacity-55 [&_img]:grayscale group-hover:[&_img]:opacity-100 group-hover:[&_img]:grayscale-0',
                    )}
                  >
                    {tab.icon ?? tab.label.charAt(0)}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{tab.label}</TooltipContent>
            </TooltipRoot>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
