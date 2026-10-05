'use client'

import {
  Camera,
  Check,
  ChevronDown,
  Dices,
  Focus,
  LoaderCircle,
  type LucideIcon,
  Redo2,
  Undo2,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { STUDIO_FILTERS, type StudioFilterId } from './stage-contract'
import { FOCUS_RING } from './studio-controls'

/**
 * A dark pill under a button (its `group`), on hover or keyboard focus
 * after a beat. `place` positions it; centred under a 40 px button by default.
 */
export function Tooltip({
  text,
  place = 'top-12 left-1/2 -translate-x-1/2',
}: {
  text: string
  place?: string
}) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute z-20 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 font-normal text-[11px] text-white/90 tracking-normal opacity-0 ring-1 ring-white/10 transition-opacity delay-0 duration-150 group-hover:opacity-100 group-hover:delay-300 group-focus-visible:opacity-100 group-focus-visible:delay-300 motion-reduce:transition-none',
        place,
      )}
      role="presentation"
    >
      {text}
    </span>
  )
}

function ToolButton({
  icon: Icon,
  label,
  shortcut,
  onClick,
  disabled,
  busy,
}: {
  icon: LucideIcon
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean
}) {
  return (
    <button
      aria-busy={busy || undefined}
      aria-keyshortcuts={shortcut}
      aria-label={label}
      className={cn(
        'group relative grid size-10 place-items-center rounded-full text-white/80 transition duration-200 ease-out hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent motion-reduce:transition-none',
        FOCUS_RING,
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {busy ? <LoaderCircle className="size-5 animate-spin" /> : <Icon className="size-5" />}
      <Tooltip text={shortcut ? `${label} (${shortcut})` : label} />
    </button>
  )
}

const Separator = () => <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />

/** ←/→ and Home/End over a row of radio pills, moving the choice and the focus together. */
function stepFilter(current: StudioFilterId, key: string): StudioFilterId | null {
  const ids = STUDIO_FILTERS.map(({ id }) => id)
  const at = ids.indexOf(current)
  if (key === 'ArrowRight' || key === 'ArrowDown') return ids[(at + 1) % ids.length]!
  if (key === 'ArrowLeft' || key === 'ArrowUp') return ids[(at - 1 + ids.length) % ids.length]!
  if (key === 'Home') return ids[0]!
  if (key === 'End') return ids[ids.length - 1]!
  return null
}

function FilterPills({
  filter,
  onFilter,
}: {
  filter: StudioFilterId
  onFilter: (filter: StudioFilterId) => void
}) {
  const row = useRef<HTMLDivElement>(null)
  return (
    <div
      aria-label="사진 필터"
      className="pointer-events-auto absolute top-[72px] left-1/2 flex -translate-x-1/2 gap-1.5"
      onKeyDown={(event) => {
        const next = stepFilter(filter, event.key)
        if (!next) return
        event.preventDefault()
        onFilter(next)
        row.current?.querySelector<HTMLElement>(`[data-filter="${next}"]`)?.focus()
      }}
      ref={row}
      role="radiogroup"
    >
      {STUDIO_FILTERS.map(({ id, label }) => (
        <button
          aria-checked={filter === id}
          className={cn(
            'h-7 whitespace-nowrap rounded-full px-3 font-medium text-[12px] transition duration-200 ease-out motion-reduce:transition-none',
            FOCUS_RING,
            filter === id
              ? 'bg-white text-neutral-900'
              : 'bg-white/[0.08] text-white/75 ring-1 ring-white/10 hover:bg-white/15 hover:text-white',
          )}
          data-filter={id}
          key={id}
          onClick={() => onFilter(id)}
          role="radio"
          tabIndex={filter === id ? 0 : -1}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** On short screens: one pill naming the filter, opening the list. */
function FilterMenu({
  filter,
  onFilter,
}: {
  filter: StudioFilterId
  onFilter: (filter: StudioFilterId) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const label = STUDIO_FILTERS.find(({ id }) => id === filter)?.label
  useEffect(() => {
    if (!open) return
    box.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])
  return (
    <div className="pointer-events-auto absolute top-[68px] left-1/2 -translate-x-1/2" ref={box}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`사진 필터: ${label}`}
        className={cn(
          'flex h-7 items-center gap-1 rounded-full bg-white/[0.08] px-3 font-medium text-[12px] text-white/85 ring-1 ring-white/10 hover:bg-white/15',
          FOCUS_RING,
        )}
        onClick={() => setOpen(!open)}
        type="button"
      >
        {label}
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div
          aria-label="사진 필터"
          className="absolute top-9 left-1/2 flex w-32 -translate-x-1/2 flex-col rounded-xl bg-neutral-900/95 p-1 ring-1 ring-white/10 backdrop-blur-xl"
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setOpen(false)
              return
            }
            const next = stepFilter(filter, event.key)
            if (!next) return
            event.preventDefault()
            onFilter(next)
            box.current?.querySelector<HTMLElement>(`[data-filter="${next}"]`)?.focus()
          }}
          role="listbox"
        >
          {STUDIO_FILTERS.map(({ id, label: text }) => (
            <button
              aria-selected={filter === id}
              className={cn(
                'flex h-8 items-center justify-between rounded-lg px-2.5 text-left text-[12px] text-white/80 hover:bg-white/10',
                FOCUS_RING,
              )}
              data-filter={id}
              key={id}
              onClick={() => {
                onFilter(id)
                setOpen(false)
              }}
              role="option"
              tabIndex={filter === id ? 0 : -1}
              type="button"
            >
              {text}
              {filter === id && <Check className="size-3.5 text-sky-300" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The top-centre toolbar (무작위 · 사진 저장 · AI 실사 사진 | 프레임 맞춤 |
 * 되돌리기 · 다시 하기) and under it the looks the canvas and its snapshots
 * are seen through.
 */
export function StudioToolbar({
  randomizing,
  onRandom,
  snapshotting,
  onSnapshot,
  onAi,
  onFrame,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  filter,
  onFilter,
  short,
}: {
  randomizing: boolean
  onRandom: () => void
  snapshotting: boolean
  onSnapshot: () => void
  onAi: () => void
  onFrame: () => void
  canUndo: boolean
  onUndo: () => void
  canRedo: boolean
  onRedo: () => void
  filter: StudioFilterId
  onFilter: (filter: StudioFilterId) => void
  /** Under 720 px tall: the filters fold into one pill. */
  short: boolean
}) {
  return (
    <>
      <div className="pointer-events-auto absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-black/45 p-1 ring-1 ring-white/10 backdrop-blur-xl">
        <ToolButton
          busy={randomizing}
          disabled={randomizing}
          icon={Dices}
          label="무작위"
          onClick={onRandom}
        />
        <ToolButton
          busy={snapshotting}
          disabled={snapshotting}
          icon={Camera}
          label="사진 저장"
          onClick={onSnapshot}
        />
        <ToolButton icon={WandSparkles} label="AI 실사 사진" onClick={onAi} />
        <Separator />
        <ToolButton icon={Focus} label="프레임 맞춤" onClick={onFrame} shortcut="F" />
        <Separator />
        <ToolButton
          disabled={!canUndo}
          icon={Undo2}
          label="되돌리기"
          onClick={onUndo}
          shortcut="Ctrl+Z"
        />
        <ToolButton
          disabled={!canRedo}
          icon={Redo2}
          label="다시 하기"
          onClick={onRedo}
          shortcut="Ctrl+Shift+Z"
        />
      </div>
      {short ? (
        <FilterMenu filter={filter} onFilter={onFilter} />
      ) : (
        <FilterPills filter={filter} onFilter={onFilter} />
      )}
    </>
  )
}
