'use client'

import {
  type AvatarFeet,
  type AvatarLook,
  type BodyShape,
  type BodySliderId,
  DEFAULT_BODY_SHAPE,
  type Footwear,
  hasBodyShape,
  SHOD,
} from '@pascal-app/editor'
import { BipolarSlider, PanelSection, ResetButton, Segmented, SwatchGrid } from './studio-controls'
import { BODY_SLIDER_TEXT, HEIGHT_TEXT, SOCK_SWATCHES } from './studio-data'
import { BODY_CATEGORIES, type BodyCategory } from './studio-layout'

const FOOTWEAR_OPTIONS: readonly { id: Footwear; label: string }[] = [
  { id: 'shoes', label: '신발' },
  { id: 'socks', label: '양말' },
  { id: 'bare', label: '맨발' },
]

const categoryOf = (id: BodyCategory) => BODY_CATEGORIES.find((entry) => entry.id === id)!

/**
 * The body, a category at a time (the Sims' and inZOI's way): 체격 (키 scales
 * the whole body), 상체, 팔, 하체 (legs and their length) and 발 (out of the
 * shoes, in socks or bare). Sex and age are in 기본 정보.
 */
export function BodyBody({
  category,
  body,
  feet,
  onFeet,
  onPreview,
  onCommit,
}: {
  category: BodyCategory
  body: BodyShape
  feet: AvatarFeet
  onFeet: (feet: AvatarFeet) => void
  onPreview: (body: BodyShape) => void
  onCommit: (body: BodyShape) => void
}) {
  if (category === 'feet') {
    return (
      <div className="flex flex-col gap-5">
        <PanelSection title="신발">
          <Segmented
            onPick={(wear) => onFeet({ ...feet, wear })}
            options={FOOTWEAR_OPTIONS}
            value={feet.wear}
          />
        </PanelSection>
        {feet.wear === 'socks' && (
          <PanelSection title="양말 색">
            <SwatchGrid
              onPick={(color) => onFeet({ ...feet, color })}
              original="기본 흰색"
              swatches={SOCK_SWATCHES}
              value={feet.color}
            />
          </PanelSection>
        )}
      </div>
    )
  }

  const withSlider = (id: BodySliderId, value: number): BodyShape => {
    const sliders = { ...body.sliders }
    if (value === 0) delete sliders[id]
    else sliders[id] = value
    return { ...body, sliders }
  }

  return (
    <div className="flex flex-col gap-5">
      {category === 'build' && (
        <BipolarSlider
          onCommit={(height) => onCommit({ ...body, height })}
          onPreview={(height) => onPreview({ ...body, height })}
          text={HEIGHT_TEXT}
          value={body.height}
        />
      )}
      {categoryOf(category).sliders.map((id) => (
        <BipolarSlider
          key={id}
          onCommit={(value) => onCommit(withSlider(id, value))}
          onPreview={(value) => onPreview(withSlider(id, value))}
          text={BODY_SLIDER_TEXT[id]}
          value={body.sliders[id] ?? 0}
        />
      ))}
    </div>
  )
}

/** The 몸 panel's resets: the category shown, and the whole body (feet included). */
export function BodyFooter({
  category,
  body,
  feet,
  onReset,
}: {
  category: BodyCategory
  body: BodyShape
  feet: AvatarFeet
  onReset: (patch: Partial<AvatarLook>) => void
}) {
  const entry = categoryOf(category)
  const feetChanged = feet.wear !== SHOD.wear || feet.color !== SHOD.color
  const changed =
    category === 'feet'
      ? feetChanged
      : (category === 'build' && body.height !== 0) ||
        entry.sliders.some((id) => (body.sliders[id] ?? 0) !== 0)
  return (
    <div className="grid grid-cols-2 gap-2">
      <ResetButton
        disabled={!changed}
        label={`${entry.label} 되돌리기`}
        onClick={() => {
          if (category === 'feet') return onReset({ feet: SHOD })
          const sliders = { ...body.sliders }
          for (const id of entry.sliders) delete sliders[id]
          onReset({ body: { ...body, sliders, height: category === 'build' ? 0 : body.height } })
        }}
      />
      <ResetButton
        disabled={!hasBodyShape(body) && !feetChanged}
        label="전체 되돌리기"
        onClick={() => onReset({ body: DEFAULT_BODY_SHAPE, feet: SHOD })}
      />
    </div>
  )
}
