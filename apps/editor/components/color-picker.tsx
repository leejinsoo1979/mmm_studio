'use client'

import { Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

type Hsv = { h: number; s: number; v: number }

function hexToHsv(hex: string): Hsv {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? Number.parseInt(m[1]!, 16) : 0xffffff
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max ? d / max : 0, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
  }
  return `#${[f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** Drag on an element; reports the pointer as 0..1 fractions of its box. */
export function useDrag(
  onMove: (x: number, y: number) => void,
  onEnd: () => void,
): (e: React.PointerEvent<HTMLElement>) => void {
  return (e) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const report = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect()
      onMove(
        Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
      )
    }
    report(e)
    const move = (ev: PointerEvent) => report(ev)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      onEnd()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
}

/**
 * inZOI's colour picker: current colour, a white HEX pill, the colour the
 * part had when the card opened and a clear button on top; a saturation /
 * brightness square and a hue bar below, with `extra` (saved colours) beside
 * them. Dragging calls `onPreview`; letting go (or Enter in the field) calls
 * `onCommit`, so a drag is one change.
 */
export function ColorPicker({
  value,
  original,
  onPreview,
  onCommit,
  onClear,
  extra,
}: {
  value: string
  original?: string
  onPreview: (hex: string) => void
  onCommit: (hex: string) => void
  onClear?: () => void
  extra?: ReactNode
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const [draft, setDraft] = useState(value.toUpperCase())
  const latest = useRef(value)
  useEffect(() => {
    if (value.toLowerCase() === latest.current.toLowerCase()) return
    latest.current = value
    setHsv(hexToHsv(value))
    setDraft(value.toUpperCase())
  }, [value])

  const update = (next: Hsv) => {
    setHsv(next)
    const hex = hsvToHex(next)
    latest.current = hex
    setDraft(hex)
    onPreview(hex)
  }
  const commit = () => onCommit(latest.current)
  const dragSv = useDrag((x, y) => update({ ...hsv, s: x, v: 1 - y }), commit)
  const dragHue = useDrag((_, y) => update({ ...hsv, h: y * 360 }), commit)
  const hue = hsvToHex({ h: hsv.h, s: 1, v: 1 })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className="h-4 w-7 shrink-0 rounded-[4px] ring-1 ring-black/10"
          style={{ background: latest.current }}
        />
        <input
          aria-label="HEX 색상"
          className="h-[22px] w-[66px] rounded-full bg-white text-center font-medium text-[11px] text-[#333] uppercase shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] outline-none focus:shadow-[inset_0_0_0_1px_#8cc4f0] dark:bg-neutral-800 dark:text-neutral-100"
          onBlur={() => setDraft(latest.current.toUpperCase())}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key !== 'Enter') return
            const hex = `#${e.currentTarget.value.replace(/^#/, '')}`.toUpperCase()
            if (!/^#[0-9a-f]{6}$/i.test(hex)) return
            latest.current = hex
            setHsv(hexToHsv(hex))
            setDraft(hex)
            onCommit(hex)
          }}
          value={draft.replace(/^#/, '')}
        />
        {original && (
          <button
            aria-label="처음 색으로"
            className="size-4 shrink-0 rounded-[4px] ring-1 ring-black/10 transition-transform hover:scale-110"
            onClick={() => onCommit(original)}
            style={{ background: original }}
            title="처음 색으로"
            type="button"
          />
        )}
        {onClear && (
          <button
            aria-label="기본 재질로"
            className="ml-auto grid size-6 shrink-0 place-items-center rounded-full bg-white text-[#666] shadow-sm transition-colors hover:text-[#333] dark:bg-neutral-800 dark:text-neutral-300"
            onClick={onClear}
            title="기본 재질로"
            type="button"
          >
            <Trash2 className="size-3.5" strokeWidth={1.8} />
          </button>
        )}
      </div>
      <div className="flex gap-1.5">
        <div
          className="relative h-[84px] w-[100px] cursor-crosshair touch-none rounded-lg"
          onPointerDown={dragSv}
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})`,
          }}
        >
          <span
            className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute size-3.5 rounded-full border-2 border-white shadow"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>
        <div
          className="relative h-[84px] w-3.5 cursor-pointer touch-none rounded-full"
          onPointerDown={dragHue}
          style={{
            background: 'linear-gradient(to bottom, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          }}
        >
          <span
            className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute left-1/2 size-3.5 rounded-full border-2 border-white shadow"
            style={{ top: `${(hsv.h / 360) * 100}%`, background: hue }}
          />
        </div>
        {extra}
      </div>
    </div>
  )
}
