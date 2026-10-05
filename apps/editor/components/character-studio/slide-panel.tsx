'use client'

import { X } from 'lucide-react'
import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from './studio-controls'
import type { SubTab } from './studio-layout'

/**
 * The panel that slides in from the right with a category's options: its
 * title, its sub-tabs when it has more than one, the options, and resets
 * in the footer. Closed, it slides out and takes no pointer.
 */
export function SlidePanel({
  id,
  open,
  title,
  subTabs,
  sub,
  onSub,
  onClose,
  footer,
  short,
  overlay,
  children,
}: {
  id: string
  open: boolean
  title: string
  subTabs: readonly SubTab[]
  sub: string
  onSub: (id: string) => void
  onClose: () => void
  footer?: React.ReactNode
  /** Under 720 px tall: down to 88 px from the bottom. */
  short: boolean
  /** Lies over the stage (narrow screens) rather than beside it. */
  overlay: boolean
  children: React.ReactNode
}) {
  const tabs = useRef<HTMLDivElement>(null)
  const showTabs = subTabs.length > 1
  return (
    <section
      aria-hidden={!open}
      aria-label={title}
      className={cn(
        'absolute top-6 right-6 flex w-[360px] max-w-[calc(100vw-48px)] flex-col rounded-2xl bg-neutral-950/80 ring-1 ring-white/10 backdrop-blur-xl transition duration-300 ease-out motion-reduce:transition-none',
        short ? 'bottom-[88px]' : 'bottom-[112px]',
        overlay ? 'shadow-2xl' : 'shadow-[0_24px_60px_rgba(0,0,0,0.5)]',
        open
          ? 'pointer-events-auto translate-x-0 opacity-100'
          : 'pointer-events-none translate-x-[calc(100%+24px)] opacity-0',
      )}
      id={id}
      // Closed, nothing in it takes focus.
      inert={!open}
      role="tabpanel"
    >
      <header className="flex items-center justify-between px-5 pt-4 pb-2">
        <h2 className="font-bold text-[16px] text-white">{title}</h2>
        <button
          aria-label="패널 닫기"
          className={cn(
            'grid size-8 place-items-center rounded-full text-white/60 transition duration-200 ease-out hover:bg-white/10 hover:text-white motion-reduce:transition-none',
            FOCUS_RING,
          )}
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      </header>
      {showTabs && (
        <div
          aria-label={`${title} 세부 메뉴`}
          className="flex gap-5 border-white/10 border-b px-5"
          onKeyDown={(event) => {
            const at = subTabs.findIndex((tab) => tab.id === sub)
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
            if (!step) return
            event.preventDefault()
            const next = subTabs[(at + step + subTabs.length) % subTabs.length]!.id
            onSub(next)
            tabs.current?.querySelector<HTMLElement>(`[data-sub="${next}"]`)?.focus()
          }}
          ref={tabs}
          role="tablist"
        >
          {subTabs.map((tab) => (
            <button
              aria-selected={tab.id === sub}
              className={cn(
                'h-10 rounded-sm text-[13px] transition duration-200 ease-out motion-reduce:transition-none',
                FOCUS_RING,
                tab.id === sub
                  ? 'text-white shadow-[inset_0_-2px_0_#38bdf8]'
                  : 'text-white/50 hover:text-white/80',
              )}
              data-sub={tab.id}
              key={tab.id}
              onClick={() => onSub(tab.id)}
              role="tab"
              tabIndex={tab.id === sub ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [scrollbar-color:rgba(255,255,255,0.2)_transparent] [scrollbar-width:thin]">
        {children}
      </div>
      {footer && <footer className="border-white/10 border-t px-5 py-3">{footer}</footer>}
    </section>
  )
}
