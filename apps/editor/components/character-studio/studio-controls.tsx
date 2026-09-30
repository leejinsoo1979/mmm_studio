'use client'

import { Slider } from '@pascal-app/editor'
import { Check, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { ColorPicker } from '../color-picker'
import type { SliderText, Swatch } from './studio-data'

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
        <h3 className="font-semibold text-[12px] text-neutral-500 tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </section>
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
    <div className="flex shrink-0 gap-1 rounded-full bg-neutral-100 p-1">
      {options.map(({ id, label }) => (
        <button
          aria-pressed={value === id}
          className={cn(
            'relative flex-1 whitespace-nowrap rounded-full px-1.5 py-1.5 font-medium text-[12px] transition',
            value === id
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-800',
          )}
          key={id}
          onClick={() => onPick(id)}
          type="button"
        >
          {label}
          {marked?.(id) && (
            <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-sky-500" />
          )}
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
      className="flex items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white py-2 text-[12px] text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <RotateCcw className="size-3.5" /> {label}
    </button>
  )
}

export function SwatchGrid({
  swatches,
  value,
  onPick,
  original,
}: {
  swatches: Swatch[]
  value: string | null
  onPick: (hex: string | null) => void
  original: string
}) {
  const [hover, setHover] = useState<string | null>(null)
  const current = swatches.find((swatch) => swatch.hex.toLowerCase() === value?.toLowerCase())
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-6 gap-2">
        <button
          aria-label={original}
          aria-pressed={value === null}
          className={cn(
            'relative grid aspect-square place-items-center rounded-full bg-[conic-gradient(#e5e7eb_0_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)] bg-[length:10px_10px] ring-offset-2 transition hover:scale-105',
            value === null ? 'ring-2 ring-sky-500' : 'ring-1 ring-black/10',
          )}
          onClick={() => onPick(null)}
          onMouseEnter={() => setHover(original)}
          onMouseLeave={() => setHover(null)}
          title={original}
          type="button"
        >
          <X className="size-3.5 text-neutral-400" />
        </button>
        {swatches.map((swatch) => {
          const selected = swatch.hex.toLowerCase() === value?.toLowerCase()
          return (
            <button
              aria-label={swatch.name}
              aria-pressed={selected}
              className={cn(
                'relative grid aspect-square place-items-center rounded-full shadow-[inset_0_-3px_6px_rgba(0,0,0,0.18),inset_0_2px_4px_rgba(255,255,255,0.35)] ring-offset-2 transition hover:scale-105',
                selected ? 'ring-2 ring-sky-500' : 'ring-1 ring-black/5',
              )}
              key={swatch.hex}
              onClick={() => onPick(swatch.hex)}
              onMouseEnter={() => setHover(swatch.name)}
              onMouseLeave={() => setHover(null)}
              style={{ background: swatch.hex }}
              title={swatch.name}
              type="button"
            >
              {selected && <Check className="size-3.5 text-white drop-shadow" strokeWidth={3} />}
            </button>
          )
        })}
      </div>
      <p className="h-4 text-center text-[11px] text-neutral-500">
        {hover ?? current?.name ?? (value ? value.toUpperCase() : original)}
      </p>
    </div>
  )
}

export function ColorPanel({
  swatches,
  value,
  fallback,
  original,
  onPreview,
  onCommit,
}: {
  swatches: Swatch[]
  value: string | null
  fallback: string
  original: string
  onPreview: (hex: string | null) => void
  onCommit: (hex: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <PanelSection title="추천 색상">
        <SwatchGrid onPick={onCommit} original={original} swatches={swatches} value={value} />
      </PanelSection>
      <PanelSection title="직접 고르기">
        <div className="rounded-2xl bg-neutral-50 p-3">
          <ColorPicker
            onClear={() => onCommit(null)}
            onCommit={(hex) => onCommit(hex)}
            onPreview={(hex) => onPreview(hex)}
            value={value ?? fallback}
          />
        </div>
      </PanelSection>
    </div>
  )
}

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
        <span className="font-medium text-[12px] text-neutral-700">{text.label}</span>
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'min-w-8 text-right text-[11px] tabular-nums',
              percent ? 'text-sky-600' : 'text-neutral-400',
            )}
          >
            {percent > 0 ? `+${percent}` : percent}
          </span>
          <button
            aria-label={`${text.label} 되돌리기`}
            className={cn(
              'grid size-5 place-items-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700',
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
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-neutral-200" />
        <span
          className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-sky-500"
          style={{ left: `${50 + Math.min(0, shown) * 50}%`, width: `${Math.abs(shown) * 50}%` }}
        />
        <span className="pointer-events-none absolute top-1/2 left-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-neutral-400" />
        <Slider
          className="[&_[data-slot=slider-range]]:hidden [&_[data-slot=slider-track]]:bg-transparent"
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
      <div className="flex justify-between text-[10px] text-neutral-400">
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
        <span className="text-neutral-600">{label}</span>
        <span className="font-medium text-neutral-400 tabular-nums">{`${Math.round(shown * 100)}%`}</span>
      </div>
      <Slider
        className="[&_[data-slot=slider-range]]:bg-sky-500 [&_[data-slot=slider-track]]:bg-neutral-200"
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
