'use client'

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
 * tabs as `IconRail`, laid out horizontally. Clicking the open tab collapses
 * the panel to just this row.
 */
export function IconTabRow({ tabs, activeTab, collapsed, onIconClick }: IconRailProps) {
  return (
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <div className="flex h-10 shrink-0 items-stretch border-black/5 border-b px-1 dark:border-white/10">
        {tabs.map((tab) => {
          const showActive = activeTab === tab.id && !collapsed
          return (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>
                <button
                  aria-label={tab.label}
                  aria-pressed={showActive}
                  className={cn(
                    'relative flex min-w-0 flex-1 items-center justify-center text-muted-foreground transition-colors [&_img]:h-[18px] [&_img]:w-[18px] [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:stroke-[1.9]',
                    showActive
                      ? 'text-foreground after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground'
                      : 'hover:text-foreground [&_img]:opacity-55 [&_img]:grayscale hover:[&_img]:opacity-100 hover:[&_img]:grayscale-0',
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
              <TooltipContent side="bottom">{tab.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
