'use client'

import {
  Brush,
  Hand,
  type LucideIcon,
  Palette,
  PersonStanding,
  ScanFace,
  Scissors,
  UserRound,
} from 'lucide-react'
import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from './studio-controls'
import type { StudioTab } from './studio-layout'

const TAB_ICONS: Record<StudioTab, LucideIcon> = {
  preset: UserRound,
  face: ScanFace,
  body: PersonStanding,
  hair: Scissors,
  makeup: Brush,
  skin: Palette,
  motion: Hand,
}

/**
 * The big tabs along the bottom (프리셋 · 얼굴 · 몸 · 헤어 · 메이크업 · 피부 ·
 * 동작): ←/→ move between them, 1–7 jump straight to one (the studio's
 * key handler). On short screens only their icons show.
 */
export function StudioTabs({
  tabs,
  value,
  onPick,
  panelId,
  short,
}: {
  tabs: readonly { id: StudioTab; label: string }[]
  value: StudioTab
  onPick: (tab: StudioTab) => void
  panelId: string
  short: boolean
}) {
  const row = useRef<HTMLDivElement>(null)
  const go = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length]!
    onPick(tab.id)
    row.current?.querySelector<HTMLElement>(`[data-tab="${tab.id}"]`)?.focus()
  }
  return (
    <div
      aria-label="꾸미기 메뉴"
      className="pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-end gap-1 rounded-2xl bg-black/45 px-2 py-1.5 ring-1 ring-white/10 backdrop-blur-xl"
      onKeyDown={(event) => {
        const at = tabs.findIndex(({ id }) => id === value)
        if (event.key === 'ArrowRight') go(at + 1)
        else if (event.key === 'ArrowLeft') go(at - 1)
        else if (event.key === 'Home') go(0)
        else if (event.key === 'End') go(tabs.length - 1)
        else return
        event.preventDefault()
      }}
      ref={row}
      role="tablist"
    >
      {tabs.map(({ id, label }, index) => {
        const Icon = TAB_ICONS[id]
        const selected = id === value
        return (
          <button
            aria-controls={panelId}
            aria-keyshortcuts={String(index + 1)}
            aria-label={short ? label : undefined}
            aria-selected={selected}
            className={cn(
              'relative flex w-[76px] flex-col items-center gap-1 rounded-xl transition duration-200 ease-out motion-reduce:transition-none',
              FOCUS_RING,
              short ? 'h-12 justify-center' : 'py-2',
              selected
                ? 'bg-white/10 text-white after:absolute after:bottom-0.5 after:h-0.5 after:w-6 after:rounded-full after:bg-sky-400'
                : 'text-white/55 hover:bg-white/5 hover:text-white',
            )}
            data-tab={id}
            key={id}
            onClick={() => onPick(id)}
            role="tab"
            tabIndex={selected ? 0 : -1}
            title={short ? `${label} (${index + 1})` : undefined}
            type="button"
          >
            <Icon className="size-6" />
            {!short && <span className="font-medium text-[12px]">{label}</span>}
          </button>
        )
      })}
    </div>
  )
}
