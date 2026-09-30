'use client'

import {
  avatarGender,
  BODY_SLIDER_GROUPS,
  BODY_SLIDERS,
  type BodyShape,
  type BodySliderGroup,
  type BodySliderId,
  DEFAULT_BODY_SHAPE,
  hasBodyShape,
} from '@pascal-app/editor'
import { useState } from 'react'
import { counterpartAvatar, isChild } from './avatar-counterpart'
import { BipolarSlider, PanelSection, ResetButton, Segmented } from './studio-controls'
import { BODY_GROUP_LABELS, BODY_SLIDER_TEXT, GENDER_LABELS, HEIGHT_TEXT } from './studio-data'

const GENDER_OPTIONS = (['male', 'female'] as const).map((id) => ({ id, label: GENDER_LABELS[id] }))
const AGE_OPTIONS = [
  { id: 'adult', label: '성인' },
  { id: 'child', label: '어린이' },
] as const
const GROUP_OPTIONS = BODY_SLIDER_GROUPS.map((id) => ({ id, label: BODY_GROUP_LABELS[id] }))

/**
 * The body, the Sims' and inZOI's way: sex and age switch the character to
 * its nearest counterpart in the library (the rest of the look stays), the
 * height scales the whole body and the sliders reshape it part by part.
 */
export function BodyPanel({
  avatar,
  body,
  onAvatar,
  onPreview,
  onCommit,
}: {
  avatar: string
  body: BodyShape
  onAvatar: (avatar: string) => void
  onPreview: (body: BodyShape) => void
  onCommit: (body: BodyShape) => void
}) {
  const [group, setGroup] = useState<BodySliderGroup>('build')
  const gender = avatarGender(avatar)
  const child = isChild(avatar)
  const withSlider = (id: BodySliderId, value: number): BodyShape => {
    const sliders = { ...body.sliders }
    if (value === 0) delete sliders[id]
    else sliders[id] = value
    return { ...body, sliders }
  }
  const inGroup = BODY_SLIDERS.filter((slider) => slider.group === group)
  const groupChanged = inGroup.some(({ id }) => body.sliders[id])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3">
          <PanelSection title="성별">
            <Segmented
              onPick={(next) => onAvatar(counterpartAvatar(avatar, next, child))}
              options={GENDER_OPTIONS}
              value={gender}
            />
          </PanelSection>
          <PanelSection title="연령">
            <Segmented
              onPick={(next) => onAvatar(counterpartAvatar(avatar, gender, next === 'child'))}
              options={AGE_OPTIONS}
              value={child ? 'child' : 'adult'}
            />
          </PanelSection>
        </div>
        <p className="text-[11px] text-neutral-400 leading-4">
          가장 닮은 캐릭터로 바뀌고, 꾸민 얼굴·머리·체형은 그대로 따라가요
        </p>
      </div>

      <BipolarSlider
        onCommit={(height) => onCommit({ ...body, height })}
        onPreview={(height) => onPreview({ ...body, height })}
        text={HEIGHT_TEXT}
        value={body.height}
      />

      <PanelSection title="부위별 체형">
        <Segmented
          marked={(id) =>
            BODY_SLIDERS.some((slider) => slider.group === id && body.sliders[slider.id])
          }
          onPick={setGroup}
          options={GROUP_OPTIONS}
          value={group}
        />
        <div className="flex flex-col gap-4 pt-1">
          {inGroup.map(({ id }) => (
            <BipolarSlider
              key={id}
              onCommit={(value) => onCommit(withSlider(id, value))}
              onPreview={(value) => onPreview(withSlider(id, value))}
              text={BODY_SLIDER_TEXT[id]}
              value={body.sliders[id] ?? 0}
            />
          ))}
        </div>
      </PanelSection>

      <div className="grid grid-cols-2 gap-2">
        <ResetButton
          disabled={!groupChanged}
          label={`${BODY_GROUP_LABELS[group]} 되돌리기`}
          onClick={() => {
            const sliders = { ...body.sliders }
            for (const { id } of inGroup) delete sliders[id]
            onCommit({ ...body, sliders })
          }}
        />
        <ResetButton
          disabled={!hasBodyShape(body)}
          label="전체 되돌리기"
          onClick={() => onCommit(DEFAULT_BODY_SHAPE)}
        />
      </div>
    </div>
  )
}
