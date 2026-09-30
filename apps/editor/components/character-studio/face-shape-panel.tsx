'use client'

import {
  FACE_SLIDER_GROUPS,
  FACE_SLIDERS,
  type FaceShape,
  type FaceSliderGroup,
  type FaceSliderId,
  hasSliders,
  Slider,
} from '@pascal-app/editor'
import { RotateCcw, ScanFace } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { FACE_GROUP_LABELS, FACE_SLIDER_TEXT } from './studio-data'

/** A −1–1 setting, from its middle either way: previews while dragged, commits (one undo step) on release. */
function ShapeSlider({
  id,
  value,
  onPreview,
  onCommit,
}: {
  id: FaceSliderId
  value: number
  onPreview: (value: number) => void
  onCommit: (value: number) => void
}) {
  const text = FACE_SLIDER_TEXT[id]
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
 * The face's shape, part by part (inZOI's and the Sims' face sliders): each
 * slider reshapes the head round a feature. With a face photo, the head
 * already has the photo's proportions; the sliders work on top of them.
 */
export function FaceShapePanel({
  shape,
  hasPhoto,
  onPreview,
  onCommit,
}: {
  shape: FaceShape
  hasPhoto: boolean
  onPreview: (shape: FaceShape) => void
  onCommit: (shape: FaceShape) => void
}) {
  const [group, setGroup] = useState<FaceSliderGroup>('face')
  const withSlider = (id: FaceSliderId, value: number): FaceShape => {
    const sliders = { ...shape.sliders }
    if (value === 0) delete sliders[id]
    else sliders[id] = value
    return { ...shape, sliders }
  }
  const inGroup = FACE_SLIDERS.filter((slider) => slider.group === group)
  const groupChanged = inGroup.some(({ id }) => shape.sliders[id])

  return (
    <div className="flex flex-col gap-4">
      <p
        className={cn(
          'flex items-start gap-1.5 rounded-xl px-3 py-2 text-[11px] leading-4',
          hasPhoto ? 'bg-sky-50 text-sky-800' : 'bg-neutral-50 text-neutral-500',
        )}
      >
        <ScanFace className="mt-px size-3.5 shrink-0" />
        {hasPhoto
          ? '사진에서 분석한 얼굴형 위에서 다듬어요. 사진 얼굴형을 얼마나 따를지는 얼굴 단계에서 정해요.'
          : '얼굴 단계에서 사진을 올리면 사진 속 얼굴형을 분석해 먼저 맞춰 줘요.'}
      </p>

      <div className="flex gap-1 rounded-full bg-neutral-100 p-1">
        {FACE_SLIDER_GROUPS.map((id) => (
          <button
            aria-pressed={group === id}
            className={cn(
              'relative flex-1 rounded-full py-1.5 font-medium text-[12px] transition',
              group === id ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500',
            )}
            key={id}
            onClick={() => setGroup(id)}
            type="button"
          >
            {FACE_GROUP_LABELS[id]}
            {FACE_SLIDERS.some((slider) => slider.group === id && shape.sliders[slider.id]) && (
              <span className="absolute top-1 right-2 size-1.5 rounded-full bg-sky-500" />
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {inGroup.map(({ id }) => (
          <ShapeSlider
            id={id}
            key={id}
            onCommit={(value) => onCommit(withSlider(id, value))}
            onPreview={(value) => onPreview(withSlider(id, value))}
            value={shape.sliders[id] ?? 0}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          className="flex items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white py-2 text-[12px] text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40"
          disabled={!groupChanged}
          onClick={() => {
            const sliders = { ...shape.sliders }
            for (const { id } of inGroup) delete sliders[id]
            onCommit({ ...shape, sliders })
          }}
          type="button"
        >
          <RotateCcw className="size-3.5" /> {FACE_GROUP_LABELS[group]} 되돌리기
        </button>
        <button
          className="flex items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white py-2 text-[12px] text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40"
          disabled={!hasSliders(shape)}
          onClick={() => onCommit({ ...shape, sliders: {} })}
          type="button"
        >
          <RotateCcw className="size-3.5" /> 전체 되돌리기
        </button>
      </div>
    </div>
  )
}
