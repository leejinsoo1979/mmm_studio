'use client'

import { useEffect, useRef, useState } from 'react'

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
function useDrag(
  onMove: (x: number, y: number) => void,
  onEnd: () => void,
): (e: React.PointerEvent<HTMLDivElement>) => void {
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
 * inZOI's colour picker: a saturation / brightness square, a hue bar and a
 * HEX field. Dragging calls `onPreview`; letting go (or Enter in the field)
 * calls `onCommit`, so a drag is one change.
 */
export function ColorPicker({
  value,
  onPreview,
  onCommit,
}: {
  value: string
  onPreview: (hex: string) => void
  onCommit: (hex: string) => void
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className="size-6 shrink-0 rounded-md border border-black/10"
          style={{ background: latest.current }}
        />
        <input
          aria-label="HEX 색상"
          className="w-20 rounded-md bg-neutral-100 px-2 py-1 font-mono text-[11px] uppercase outline-none dark:bg-white/10"
          onBlur={() => setDraft(latest.current.toUpperCase())}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key !== 'Enter') return
            const hex = `#${e.currentTarget.value.replace(/^#/, '')}`
            if (!/^#[0-9a-f]{6}$/i.test(hex)) return
            latest.current = hex
            setHsv(hexToHsv(hex))
            onCommit(hex)
          }}
          value={draft.replace(/^#/, '')}
        />
      </div>
      <div className="flex gap-2">
        <div
          className="relative h-24 w-28 cursor-crosshair touch-none rounded-md"
          onPointerDown={dragSv}
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})`,
          }}
        >
          <span
            className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute size-3 rounded-full border-2 border-white shadow"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>
        <div
          className="relative h-24 w-3 cursor-pointer touch-none rounded-full"
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
      </div>
    </div>
  )
}
