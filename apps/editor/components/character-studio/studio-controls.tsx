'use client'

import { Slider } from '@pascal-app/editor'
import { Check, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { ColorPicker } from '../color-picker'
import type { SliderText, Swatch } from './studio-data'

/** Every interactive element's keyboard focus ring. */
export const FOCUS_RING =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'

export function PanelSection({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[12px] text-white/50 tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A short note in a panel: muted, or `tone` for something to act on. */
export function PanelNote({
  icon,
  tone = 'muted',
  children,
}: {
  icon?: React.ReactNode
  tone?: 'muted' | 'info' | 'warn'
  children: React.ReactNode
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 rounded-xl px-3 py-2 text-[11px] leading-4',
        tone === 'muted' && 'bg-white/[0.05] text-white/55',
        tone === 'info' && 'bg-sky-400/10 text-sky-200',
        tone === 'warn' && 'bg-amber-400/10 text-amber-200',
      )}
    >
      {icon}
      <span>{children}</span>
    </p>
  )
}

/**
 * A row of mutually exclusive choices, pill-shaped. `marked` puts a dot on
 * the choices that hold changes, so the player sees where they have been.
 */
export function Segmented<T extends string>({
  options,
  value,
  onPick,
  marked,
}: {
  options: readonly { id: T; label: string }[]
  value: T
  onPick: (id: T) => void
  marked?: (id: T) => boolean
}) {
  return (
    <div className="flex shrink-0 gap-1 rounded-full bg-white/[0.06] p-1">
      {options.map(({ id, label }) => (
        <button
          aria-pressed={value === id}
          className={cn(
            'relative flex-1 whitespace-nowrap rounded-full px-1.5 py-1.5 font-medium text-[12px] transition duration-200 ease-out motion-reduce:transition-none',
            FOCUS_RING,
            value === id ? 'bg-white text-neutral-900 shadow-sm' : 'text-white/60 hover:text-white',
          )}
          key={id}
          onClick={() => onPick(id)}
          type="button"
        >
          {label}
          {marked?.(id) && (
            <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-sky-400" />
          )}
        </button>
      ))}
    </div>
  )
}

/** Filter chips (a gallery's 전체 / 여성 / 남성, the emote kinds). */
export function Chips<T extends string>({
  options,
  value,
  onPick,
  label,
}: {
  options: readonly { id: T; label: string }[]
  value: T
  onPick: (id: T) => void
  label: string
}) {
  return (
    <div aria-label={label} className="flex flex-wrap gap-1.5" role="group">
      {options.map(({ id, label: text }) => (
        <button
          aria-pressed={value === id}
          className={cn(
            'h-7 rounded-full px-3 font-medium text-[12px] transition duration-200 ease-out motion-reduce:transition-none',
            FOCUS_RING,
            value === id
              ? 'bg-white text-neutral-900'
              : 'bg-white/[0.08] text-white/75 ring-1 ring-white/10 hover:bg-white/15 hover:text-white',
          )}
          key={id}
          onClick={() => onPick(id)}
          type="button"
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** Puts a part of the look back as the character has it (one undo step). */
export function ResetButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-[12px] text-white/70 transition duration-200 ease-out hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-white/5 motion-reduce:transition-none',
        FOCUS_RING,
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <RotateCcw className="size-3.5" /> {label}
    </button>
  )
}

/**
 * A gallery tile: a round picture with its name under it (hairstyles, face
 * presets, beards). `badge` sits on the circle's lower right.
 */
export function RoundTile({
  selected,
  label,
  onPick,
  children,
  badge,
  title,
}: {
  selected: boolean
  label: string
  onPick: () => void
  children: React.ReactNode
  badge?: React.ReactNode
  title?: string
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn('group flex min-w-0 flex-col items-center gap-1.5 rounded-xl', FOCUS_RING)}
      onClick={onPick}
      title={title ?? label}
      type="button"
    >
      <span className="relative aspect-square w-full">
        <span
          className={cn(
            'absolute inset-0 overflow-hidden rounded-full bg-white/[0.05] transition duration-200 ease-out motion-reduce:transition-none',
            selected
              ? 'shadow-[0_0_0_4px_rgba(56,189,248,0.15)] ring-2 ring-sky-400'
              : 'ring-1 ring-white/10 group-hover:ring-white/40',
          )}
        >
          {children}
        </span>
        {badge}
      </span>
      <span
        className={cn(
          'w-full truncate text-center text-[11px]',
          selected ? 'text-white' : 'text-white/70',
        )}
      >
        {label}
      </span>
    </button>
  )
}

export function SwatchGrid({
  swatches,
  value,
  onPick,
  original,
  iris,
}: {
  swatches: Swatch[]
  value: string | null
  onPick: (hex: string | null) => void
  original: string
  /** Draw each swatch as an iris round a pupil. */
  iris?: boolean
}) {
  const [hover, setHover] = useState<string | null>(null)
  const current = swatches.find((swatch) => swatch.hex.toLowerCase() === value?.toLowerCase())
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-6 gap-2.5">
        <button
          aria-label={original}
          aria-pressed={value === null}
          className={cn(
            'relative grid aspect-square place-items-center rounded-full bg-[conic-gradient(#3f3f46_0_25%,#27272a_0_50%,#3f3f46_0_75%,#27272a_0)] bg-[length:10px_10px] ring-offset-2 ring-offset-neutral-950 transition duration-200 ease-out hover:scale-105 motion-reduce:transition-none',
            FOCUS_RING,
            value === null ? 'ring-2 ring-sky-400' : 'ring-1 ring-white/15',
          )}
          onClick={() => onPick(null)}
          onMouseEnter={() => setHover(original)}
          onMouseLeave={() => setHover(null)}
          title={original}
          type="button"
        >
          <X className="size-3.5 text-white/50" />
        </button>
        {swatches.map((swatch) => {
          const selected = swatch.hex.toLowerCase() === value?.toLowerCase()
          return (
            <button
              aria-label={swatch.name}
              aria-pressed={selected}
              className={cn(
                'relative grid aspect-square place-items-center rounded-full ring-offset-2 ring-offset-neutral-950 transition duration-200 ease-out hover:scale-105 motion-reduce:transition-none',
                FOCUS_RING,
                !iris &&
                  'shadow-[inset_0_-3px_6px_rgba(0,0,0,0.25),inset_0_2px_4px_rgba(255,255,255,0.3)]',
                selected ? 'ring-2 ring-sky-400' : 'ring-1 ring-white/10',
              )}
              key={swatch.hex}
              onClick={() => onPick(swatch.hex)}
              onMouseEnter={() => setHover(swatch.name)}
              onMouseLeave={() => setHover(null)}
              style={{
                background: iris
                  ? `radial-gradient(circle, #111 0 28%, ${swatch.hex} 30% 100%)`
                  : swatch.hex,
              }}
              title={swatch.name}
              type="button"
            >
              {selected && <Check className="size-3.5 text-white drop-shadow" strokeWidth={3} />}
            </button>
          )
        })}
      </div>
      <p className="h-4 text-center text-[11px] text-white/60">
        {hover ?? current?.name ?? (value ? value.toUpperCase() : original)}
      </p>
    </div>
  )
}

/**
 * Recommended colours and a free picker. `part` shows one of the two (a
 * panel with sub-tabs for them), both when left out.
 */
export function ColorPanel({
  swatches,
  value,
  fallback,
  original,
  onPreview,
  onCommit,
  part,
}: {
  swatches: Swatch[]
  value: string | null
  fallback: string
  original: string
  onPreview: (hex: string | null) => void
  onCommit: (hex: string | null) => void
  part?: 'swatches' | 'custom'
}) {
  const grid = (
    <SwatchGrid onPick={onCommit} original={original} swatches={swatches} value={value} />
  )
  const picker = (
    <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
      <ColorPicker
        onClear={() => onCommit(null)}
        onCommit={(hex) => onCommit(hex)}
        onPreview={(hex) => onPreview(hex)}
        value={value ?? fallback}
      />
    </div>
  )
  if (part === 'swatches') return grid
  if (part === 'custom') return picker
  return (
    <div className="flex flex-col gap-5">
      <PanelSection title="추천 색상">{grid}</PanelSection>
      <PanelSection title="직접 고르기">{picker}</PanelSection>
    </div>
  )
}

const SLIDER_DARK =
  '[&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:focus-visible:ring-sky-400/50'

/**
 * A −1–1 setting, from its middle either way (a face or body slider):
 * previews while dragged, commits (one undo step) on release.
 */
export function BipolarSlider({
  text,
  value,
  onPreview,
  onCommit,
}: {
  text: SliderText
  value: number
  onPreview: (value: number) => void
  onCommit: (value: number) => void
}) {
  const [shown, setShown] = useState(value)
  useEffect(() => setShown(value), [value])
  const percent = Math.round(shown * 100)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-medium text-[12px] text-white/80">{text.label}</span>
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'min-w-8 text-right text-[11px] tabular-nums',
              percent ? 'text-sky-300' : 'text-white/35',
            )}
          >
            {percent > 0 ? `+${percent}` : percent}
          </span>
          <button
            aria-label={`${text.label} 되돌리기`}
            className={cn(
              'grid size-5 place-items-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white motion-reduce:transition-none',
              FOCUS_RING,
              percent === 0 && 'invisible',
            )}
            onClick={() => onCommit(0)}
            type="button"
          >
            <RotateCcw className="size-3" />
          </button>
        </span>
      </div>
      <div className="relative">
        {/* The track drawn here, filled from its middle out to the setting. */}
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/15" />
        <span
          className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-sky-400"
          style={{ left: `${50 + Math.min(0, shown) * 50}%`, width: `${Math.abs(shown) * 50}%` }}
        />
        <span className="pointer-events-none absolute top-1/2 left-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-white/40" />
        <Slider
          aria-label={text.label}
          className={cn(
            '[&_[data-slot=slider-range]]:hidden [&_[data-slot=slider-track]]:bg-transparent',
            SLIDER_DARK,
          )}
          max={100}
          min={-100}
          onValueChange={([next]) => {
            if (next === undefined) return
            setShown(next / 100)
            onPreview(next / 100)
          }}
          onValueCommit={([next]) => next !== undefined && onCommit(next / 100)}
          step={1}
          value={[shown * 100]}
        />
      </div>
      <div className="flex justify-between text-[10px] text-white/40">
        <span>{text.low}</span>
        <span>{text.high}</span>
      </div>
    </div>
  )
}

/**
 * A 0–1 setting (an amount): previews while dragged, when the caller wants
 * that, and commits (one undo step) on release.
 */
export function AmountSlider({
  label,
  value,
  onPreview,
  onCommit,
  disabled,
}: {
  label: string
  value: number
  onPreview?: (value: number) => void
  onCommit: (value: number) => void
  disabled?: boolean
}) {
  const [shown, setShown] = useState(value)
  useEffect(() => setShown(value), [value])
  return (
    <div>
      <div
        className={cn(
          'mb-1.5 flex items-center justify-between text-[12px]',
          disabled && 'opacity-50',
        )}
      >
        <span className="text-white/80">{label}</span>
        <span
          className={cn('font-medium tabular-nums', shown ? 'text-sky-300' : 'text-white/35')}
        >{`${Math.round(shown * 100)}%`}</span>
      </div>
      <Slider
        aria-label={label}
        className={cn(
          '[&_[data-slot=slider-range]]:bg-sky-400 [&_[data-slot=slider-track]]:bg-white/15',
          SLIDER_DARK,
        )}
        disabled={disabled}
        max={100}
        min={0}
        onValueChange={([next]) => {
          if (next === undefined) return
          setShown(next / 100)
          onPreview?.(next / 100)
        }}
        onValueCommit={([next]) => next !== undefined && onCommit(next / 100)}
        step={1}
        value={[shown * 100]}
      />
    </div>
  )
}
