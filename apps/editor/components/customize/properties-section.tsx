'use client'

import type { MaterialSchema } from '@pascal-app/core'
import { FlipHorizontal2, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDrag } from '../color-picker'

type Key = 'gloss' | 'scale' | 'offsetX' | 'offsetY'
type Values = Record<Key, number>

const ROWS: { key: Key; label: string; textured: boolean }[] = [
  { key: 'gloss', label: '광택', textured: false },
  { key: 'scale', label: '패턴크기', textured: true },
  { key: 'offsetX', label: '좌우이동', textured: true },
  { key: 'offsetY', label: '상하이동', textured: true },
]

function repeatOf(material: MaterialSchema | null): [number, number] {
  const t = material?.texture
  const r = t?.repeat ?? [t?.scale ?? 1, t?.scale ?? 1]
  return [r[0] || 1, r[1] || 1]
}

const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)))

function valuesOf(material: MaterialSchema | null): Values {
  const [rx] = repeatOf(material)
  const offset = material?.texture?.offset ?? [0, 0]
  return {
    gloss: clamp((1 - (material?.properties?.roughness ?? 0.5)) * 100),
    // 50 is the finish as authored; every 25 halves / doubles the pattern.
    scale: clamp(50 - 25 * Math.log2(Math.abs(rx))),
    offsetX: clamp(50 + offset[0] * 50),
    offsetY: clamp(50 + offset[1] * 50),
  }
}

function patched(base: MaterialSchema, key: Key, value: number): MaterialSchema {
  if (key === 'gloss') {
    return {
      ...base,
      preset: 'custom',
      properties: {
        color: '#ffffff',
        metalness: 0,
        opacity: 1,
        transparent: false,
        side: 'front',
        ...base.properties,
        roughness: 1 - value / 100,
      },
    }
  }
  const texture = base.texture
  if (!texture) return base
  const [rx, ry] = repeatOf(base)
  const offset = texture.offset ?? [0, 0]
  if (key === 'scale') {
    const r = 2 ** ((50 - value) / 25)
    return {
      ...base,
      preset: 'custom',
      texture: { ...texture, scale: undefined, repeat: [r * Math.sign(rx), r * Math.sign(ry)] },
    }
  }
  const shift = (value - 50) / 50
  return {
    ...base,
    preset: 'custom',
    texture: {
      ...texture,
      offset: key === 'offsetX' ? [shift, offset[1]] : [offset[0], shift],
    },
  }
}

function Slider({
  label,
  value,
  disabled,
  onChange,
  onEnd,
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (value: number) => void
  onEnd: () => void
}) {
  const drag = useDrag((x) => onChange(clamp(x * 100)), onEnd)
  return (
    <div className={`flex flex-col gap-0.5 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex h-[14px] items-center justify-between font-medium text-[10px] text-[#333] dark:text-neutral-200">
        {label}
        <span className="min-w-[26px] rounded-full bg-white px-1.5 text-center font-bold text-[10px] tabular-nums leading-[14px] dark:bg-neutral-800">
          {value}
        </span>
      </div>
      <div
        className={`relative flex h-2.5 touch-none items-center ${disabled ? '' : 'cursor-pointer'}`}
        onPointerDown={disabled ? undefined : drag}
      >
        <div className="relative h-[3px] w-full rounded-full bg-[#e1e1e1] dark:bg-white/15">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[#93c8f1]"
            style={{ width: `${value}%` }}
          />
        </div>
        <span
          className="-translate-x-1/2 absolute size-2.5 rounded-full bg-[#8ab8e6] shadow ring-2 ring-white dark:ring-neutral-900"
          style={{ left: `${value}%` }}
        />
        <input
          aria-label={label}
          className="sr-only"
          disabled={disabled}
          max={100}
          min={0}
          onChange={(e) => onChange(Number(e.target.value))}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={onEnd}
          type="range"
          value={value}
        />
      </div>
    </div>
  )
}

/**
 * inZOI's 속성 column (gloss, pattern size and shift) and the flip / rotate
 * buttons beside it. A drag previews; letting go commits one change.
 */
export function PropertiesSection({
  base,
  onPreview,
  onApply,
}: {
  base: MaterialSchema | null
  onPreview: (material: MaterialSchema) => void
  onApply: (material: MaterialSchema) => void
}) {
  const committed = valuesOf(base)
  const [draft, setDraft] = useState<Values>(committed)
  const pending = useRef<MaterialSchema | null>(null)
  const signature = JSON.stringify(committed)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only when the committed values change
  useEffect(() => setDraft(committed), [signature])

  const textured = !!base?.texture
  const change = (key: Key, value: number) => {
    if (!base) return
    setDraft((d) => ({ ...d, [key]: value }))
    const next = patched(base, key, value)
    pending.current = next
    onPreview(next)
  }
  const end = () => {
    if (!pending.current) return
    const next = pending.current
    pending.current = null
    onApply(next)
  }
  const texture = base?.texture
  const flip = () => {
    if (!(base && texture)) return
    const [rx, ry] = repeatOf(base)
    onApply({
      ...base,
      preset: 'custom',
      texture: { ...texture, scale: undefined, repeat: [-rx, ry] },
    })
  }
  const rotate = () => {
    if (!(base && texture)) return
    onApply({
      ...base,
      preset: 'custom',
      texture: { ...texture, rotation: ((texture.rotation ?? 0) + Math.PI / 2) % (Math.PI * 2) },
    })
  }

  return (
    <>
      <div className="flex w-[148px] shrink-0 flex-col px-3 pt-2.5 pb-2">
        <h3 className="mb-1.5 font-semibold text-[11px] text-[#333] leading-[14px] dark:text-neutral-200">
          속성
        </h3>
        <div className="flex h-[104px] flex-col justify-between">
          {ROWS.map((row) => (
            <Slider
              disabled={!base || (row.textured && !textured)}
              key={row.key}
              label={row.label}
              onChange={(value) => change(row.key, value)}
              onEnd={end}
              value={draft[row.key]}
            />
          ))}
        </div>
      </div>
      <div className="flex w-8 shrink-0 flex-col items-center gap-2 pt-8">
        <button
          aria-label="패턴 뒤집기"
          className="grid size-[22px] place-items-center text-[#9a9a9a] transition-colors hover:text-[#555] disabled:opacity-40 disabled:hover:text-[#9a9a9a] dark:text-neutral-400"
          disabled={!textured}
          onClick={flip}
          title="패턴 뒤집기"
          type="button"
        >
          <FlipHorizontal2 className="size-[18px]" strokeWidth={1.5} />
        </button>
        <button
          aria-label="패턴 90° 회전"
          className="grid size-[22px] place-items-center text-[#9a9a9a] transition-colors hover:text-[#555] disabled:opacity-40 disabled:hover:text-[#9a9a9a] dark:text-neutral-400"
          disabled={!textured}
          onClick={rotate}
          title="패턴 90° 회전"
          type="button"
        >
          <RotateCw className="size-[18px]" strokeWidth={1.5} />
        </button>
      </div>
    </>
  )
}
