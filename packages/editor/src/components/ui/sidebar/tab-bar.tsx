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
      <div className="flex h-full w-12 shrink-0 flex-col justify-between border-[#3a3a3a] border-r bg-[#292929]">
        <div className="flex flex-col">
          {tabs.map((tab) => {
            const showActive = activeTab === tab.id && !collapsed
            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'group flex h-11 w-full items-center justify-center border-[#383838] border-b text-[#b8b8b8] transition-all duration-200 [&_svg]:h-[22px] [&_svg]:w-[22px] [&_svg]:stroke-[1.9] [&_svg]:transition-colors [&_img]:transition-[opacity,filter] [&_img]:duration-200',
                      showActive
                        ? 'bg-[#303036] text-[#7779ff] [&_img]:opacity-100 [&_img]:grayscale-0'
                        : 'hover:bg-[#303030] hover:text-[#e5e5e5] [&_img]:opacity-55 [&_img]:grayscale hover:[&_img]:opacity-100 hover:[&_img]:grayscale-0',
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
