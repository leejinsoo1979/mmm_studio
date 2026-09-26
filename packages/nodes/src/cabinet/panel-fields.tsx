'use client'

import { useEffect, useState } from 'react'

/** Integer-mm input: commits on Enter / blur, Escape restores. */
export function MmField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(
      max ?? Number.POSITIVE_INFINITY,
      Math.max(min ?? Number.NEGATIVE_INFINITY, parsed),
    )
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <label className="flex h-9 items-center justify-between gap-2 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          className="w-20 bg-transparent text-right text-foreground outline-none"
          inputMode="decimal"
          onBlur={commit}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setDraft(String(value))
              ;(e.target as HTMLInputElement).blur()
            }
            e.stopPropagation()
          }}
          step={step}
          type="text"
          value={draft}
        />
        <span className="text-muted-foreground text-xs">mm</span>
      </span>
    </label>
  )
}

export function ColorField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit: (v: string) => void
}) {
  return (
    <label className="flex h-9 items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        className="h-6 w-10 cursor-pointer rounded border-0 bg-transparent"
        onChange={(e) => onCommit(e.target.value)}
        type="color"
        value={value}
      />
    </label>
  )
}

/** Comma-separated mm list (e.g. drawer fronts 255, 255, 176, 176). */
export function HeightsField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number[]
  onCommit: (value: number[]) => void
}) {
  const text = value.join(', ')
  const [draft, setDraft] = useState(text)
  useEffect(() => setDraft(text), [text])
  const commit = () => {
    const parsed = draft
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number)
    if (parsed.length === 0 || parsed.some((n) => !Number.isFinite(n) || n < 60 || n > 600)) {
      setDraft(text)
      return
    }
    if (parsed.join(', ') !== text) onCommit(parsed)
  }
  return (
    <label className="flex flex-col gap-1 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <input
        className="bg-transparent text-foreground outline-none"
        onBlur={commit}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(text)
            ;(e.target as HTMLInputElement).blur()
          }
          e.stopPropagation()
        }}
        value={draft}
      />
    </label>
  )
}
