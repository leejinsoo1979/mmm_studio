'use client'

import {
  FACE_SLIDER_GROUPS,
  FACE_SLIDERS,
  type FaceShape,
  type FaceSliderGroup,
  type FaceSliderId,
  hasSliders,
} from '@pascal-app/editor'
import { ScanFace } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { BipolarSlider, ResetButton, Segmented } from './studio-controls'
import { FACE_GROUP_LABELS, FACE_SLIDER_TEXT } from './studio-data'

const GROUP_OPTIONS = FACE_SLIDER_GROUPS.map((id) => ({ id, label: FACE_GROUP_LABELS[id] }))

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

      <Segmented
        marked={(id) =>
          FACE_SLIDERS.some((slider) => slider.group === id && shape.sliders[slider.id])
        }
        onPick={setGroup}
        options={GROUP_OPTIONS}
        value={group}
      />

      <div className="flex flex-col gap-4">
        {inGroup.map(({ id }) => (
          <BipolarSlider
            key={id}
            onCommit={(value) => onCommit(withSlider(id, value))}
            onPreview={(value) => onPreview(withSlider(id, value))}
            text={FACE_SLIDER_TEXT[id]}
            value={shape.sliders[id] ?? 0}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ResetButton
          disabled={!groupChanged}
          label={`${FACE_GROUP_LABELS[group]} 되돌리기`}
          onClick={() => {
            const sliders = { ...shape.sliders }
            for (const { id } of inGroup) delete sliders[id]
            onCommit({ ...shape, sliders })
          }}
        />
        <ResetButton
          disabled={!hasSliders(shape)}
          label="전체 되돌리기"
          onClick={() => onCommit({ ...shape, sliders: {} })}
        />
      </div>
    </div>
  )
}
