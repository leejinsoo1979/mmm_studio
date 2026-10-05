'use client'

import {
  FACE_SLIDERS,
  type FacePaint,
  type FaceRegion,
  type FaceShape,
  type FaceSliderId,
  hasFaceShape,
  regionChanged,
  resetFaceRegion,
} from '@pascal-app/editor'
import { ScanFace, TriangleAlert } from 'lucide-react'
import {
  applyPreset,
  FACE_PRESETS,
  type PresetRegion,
  presetMatches,
  regionGlyph,
  regionSliders,
} from './face-presets'
import {
  BipolarSlider,
  PanelNote,
  PanelSection,
  ResetButton,
  RoundTile,
  SwatchGrid,
} from './studio-controls'
import { BROW_SWATCHES, FACE_SLIDER_TEXT, IRIS_SWATCHES, type SliderText } from './studio-data'
import { FACE_REGION_LABELS } from './studio-layout'

const BROW_DARKNESS: SliderText = { label: '진하기', low: '연하게', high: '진하게' }
const BROW_THICKNESS: SliderText = { label: '굵기', low: '가늘게', high: '굵게' }

/** A region's line drawing in a round tile. */
function Glyph({ region, sliders }: { region: PresetRegion; sliders: FaceShape['sliders'] }) {
  return (
    <svg aria-hidden className="absolute inset-[18%] size-[64%]" viewBox="0 0 48 48">
      <path
        className="fill-none stroke-[1.5] stroke-white/80"
        d={regionGlyph(region, sliders)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PresetGallery({
  region,
  shape,
  onCommit,
}: {
  region: PresetRegion
  shape: FaceShape
  onCommit: (shape: FaceShape) => void
}) {
  const current = regionSliders(shape, region)
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-4">
      {/* The face as it is now, for comparing. */}
      <div className="flex min-w-0 flex-col items-center gap-1.5">
        <span className="relative aspect-square w-full overflow-hidden rounded-full border border-sky-400/50 border-dashed bg-white/[0.08]">
          <Glyph region={region} sliders={current} />
        </span>
        <span className="w-full truncate text-center text-[11px] text-sky-300">현재</span>
      </div>
      {FACE_PRESETS[region].map((preset) => (
        <RoundTile
          key={preset.id}
          label={preset.label}
          onPick={() => onCommit(applyPreset(shape, region, preset))}
          selected={presetMatches(shape, region, preset)}
        >
          <Glyph region={region} sliders={preset.sliders} />
        </RoundTile>
      ))}
    </div>
  )
}

const COVERED_NOTE =
  '이 캐릭터는 얼굴이 가려져 있어서 점으로 다듬을 수 없어요. 슬라이더는 쓸 수 있어요.'

/**
 * One face region in the 얼굴 tab: ready-made presets, its sliders (세부
 * 조정), and for the eyes their lens colour and for the brows their colour
 * and weight. With a face photo, the sliders work on the photo's own shape.
 */
export function FaceRegionBody({
  region,
  sub,
  shape,
  paint,
  hasPhoto,
  photoEyes,
  covered,
  onPreview,
  onCommit,
  onPaintPreview,
  onPaintCommit,
}: {
  region: FaceRegion
  sub: string
  shape: FaceShape
  paint: FacePaint
  hasPhoto: boolean
  /** The iris colour the face photo puts on, if any. */
  photoEyes: string | null
  /** The character's face is covered: no handles. */
  covered: boolean
  onPreview: (shape: FaceShape) => void
  onCommit: (shape: FaceShape) => void
  onPaintPreview: (paint: FacePaint) => void
  onPaintCommit: (paint: FacePaint) => void
}) {
  const coveredNote = covered && (
    <PanelNote icon={<TriangleAlert className="mt-px size-3.5 shrink-0" />} tone="warn">
      {COVERED_NOTE}
    </PanelNote>
  )

  if (sub === 'lens') {
    return (
      <div className="flex flex-col gap-4">
        <PanelSection title="눈동자 색">
          <SwatchGrid
            iris
            onPick={(eyes) => onPaintCommit({ ...paint, eyes })}
            original={photoEyes ? '사진 눈동자' : '원래 눈'}
            swatches={IRIS_SWATCHES}
            value={paint.eyes}
          />
        </PanelSection>
        {photoEyes && (
          <p className="flex items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2 text-[11px] text-white/55 leading-4">
            <span
              className="size-4 shrink-0 rounded-full ring-1 ring-white/15"
              style={{ background: `radial-gradient(circle, #111 0 28%, ${photoEyes} 30% 100%)` }}
            />
            {paint.eyes
              ? '고른 색이 얼굴 사진의 눈동자 색 대신 보여요'
              : '얼굴 사진의 눈동자 색을 쓰고 있어요'}
          </p>
        )}
      </div>
    )
  }

  if (sub === 'color') {
    const amount = (key: 'browDarkness' | 'browThickness') => ({
      onCommit: (value: number) => onPaintCommit({ ...paint, [key]: value }),
      onPreview: (value: number) => onPaintPreview({ ...paint, [key]: value }),
    })
    return (
      <div className="flex flex-col gap-5">
        <PanelSection title="눈썹 색">
          <SwatchGrid
            onPick={(browColor) => onPaintCommit({ ...paint, browColor })}
            original="원래 눈썹"
            swatches={BROW_SWATCHES}
            value={paint.browColor}
          />
        </PanelSection>
        <PanelSection title="굵기와 진하기">
          <div className="flex flex-col gap-4">
            <BipolarSlider
              text={BROW_DARKNESS}
              value={paint.browDarkness}
              {...amount('browDarkness')}
            />
            <BipolarSlider
              text={BROW_THICKNESS}
              value={paint.browThickness}
              {...amount('browThickness')}
            />
          </div>
        </PanelSection>
      </div>
    )
  }

  if (sub === 'preset' && region !== 'ears') {
    return (
      <div className="flex flex-col gap-4">
        {coveredNote}
        <PresetGallery onCommit={onCommit} region={region} shape={shape} />
        <p className="text-[11px] text-white/40 leading-4">
          프리셋은 이 부위의 슬라이더를 바꿔요. 얼굴에 찍은 점으로 다듬은 모양은 그대로예요.
        </p>
      </div>
    )
  }

  const withSlider = (id: FaceSliderId, value: number): FaceShape => {
    const sliders = { ...shape.sliders }
    if (value === 0) delete sliders[id]
    else sliders[id] = value
    return { ...shape, sliders }
  }
  return (
    <div className="flex flex-col gap-4">
      {coveredNote}
      {hasPhoto && (
        <PanelNote icon={<ScanFace className="mt-px size-3.5 shrink-0" />} tone="info">
          사진에서 분석한 얼굴형 위에서 다듬어요. 사진 얼굴형을 얼마나 따를지는 내 얼굴 사진에서
          정해요.
        </PanelNote>
      )}
      {FACE_SLIDERS.filter((slider) => slider.group === region).map(({ id }) => (
        <BipolarSlider
          key={id}
          onCommit={(value) => onCommit(withSlider(id, value))}
          onPreview={(value) => onPreview(withSlider(id, value))}
          text={FACE_SLIDER_TEXT[id]}
          value={shape.sliders[id] ?? 0}
        />
      ))}
    </div>
  )
}

/** A region's sliders gone, and its pins where the character's face points are known. */
export function resetRegion(
  shape: FaceShape,
  region: FaceRegion,
  target: readonly number[] | null | undefined,
): FaceShape {
  if (target) return resetFaceRegion(shape, region, target)
  const sliders = { ...shape.sliders }
  for (const { id, group } of FACE_SLIDERS) if (group === region) delete sliders[id]
  return { ...shape, sliders }
}

export function regionHasChanges(
  shape: FaceShape,
  region: FaceRegion,
  target: readonly number[] | null | undefined,
): boolean {
  if (target) return regionChanged(shape, region, target)
  return FACE_SLIDERS.some(({ id, group }) => group === region && (shape.sliders[id] ?? 0) !== 0)
}

/** `{부위} 되돌리기` and `얼굴 전체 되돌리기` (every slider and every sculpted point). */
export function FaceRegionFooter({
  region,
  shape,
  target,
  onCommit,
}: {
  region: FaceRegion
  shape: FaceShape
  target: readonly number[] | null | undefined
  onCommit: (shape: FaceShape) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ResetButton
        disabled={!regionHasChanges(shape, region, target)}
        label={`${FACE_REGION_LABELS[region]} 되돌리기`}
        onClick={() => onCommit(resetRegion(shape, region, target))}
      />
      <ResetButton
        disabled={!hasFaceShape(shape)}
        label="얼굴 전체 되돌리기"
        onClick={() => onCommit({ ...shape, sliders: {}, pins: {} })}
      />
    </div>
  )
}
