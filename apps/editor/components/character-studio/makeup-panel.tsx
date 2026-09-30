'use client'

import { BEARD_STYLES, type FacePaint, hasFacePaint, NO_PAINT } from '@pascal-app/editor'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  AmountSlider,
  BipolarSlider,
  PanelSection,
  ResetButton,
  Segmented,
  SwatchGrid,
} from './studio-controls'
import {
  BEARD_LABELS,
  BLUSH_SWATCHES,
  BROW_SWATCHES,
  IRIS_SWATCHES,
  LIP_SWATCHES,
  SHADOW_SWATCHES,
  type SliderText,
} from './studio-data'

type Part = 'eyes' | 'brows' | 'lips' | 'cheeks' | 'beard'

const PARTS: { id: Part; label: string }[] = [
  { id: 'eyes', label: '눈' },
  { id: 'brows', label: '눈썹' },
  { id: 'lips', label: '입술' },
  { id: 'cheeks', label: '볼' },
  { id: 'beard', label: '수염' },
]

/** Each part's own settings: between them, all of the paint's. */
const PART_SETTINGS: Record<Part, (keyof FacePaint)[]> = {
  eyes: ['eyes', 'shadow', 'shadowAmount', 'liner'],
  brows: ['browColor', 'browDarkness', 'browThickness'],
  lips: ['lips', 'lipAmount'],
  cheeks: ['blush', 'blushAmount', 'freckles'],
  beard: ['beard', 'beardAmount'],
}

/**
 * Whether a part's paint shows on the face, for the dot on its tab: judged
 * as the reset and the name badge judge the whole paint (hasFacePaint), so
 * a colour turned down to 0% is no paint to any of them.
 */
function painted(part: Part, paint: FacePaint) {
  const own = Object.fromEntries(PART_SETTINGS[part].map((key) => [key, paint[key]]))
  return hasFacePaint({ ...NO_PAINT, ...own })
}

/** The paint's settings that are numbers: the amounts, and the brows' darkness and thickness. */
type Setting = { [K in keyof FacePaint]: FacePaint[K] extends number ? K : never }[keyof FacePaint]

const BROW_DARKNESS: SliderText = { label: '진하기', low: '연하게', high: '진하게' }
const BROW_THICKNESS: SliderText = { label: '굵기', low: '가늘게', high: '굵게' }

/**
 * What is painted on the face (inZOI's make-up and the Sims' facial hair):
 * the irises, the brows, lips, blush, eyeshadow and liner, a beard and
 * freckles, a part at a time. Colours commit as they are picked; amounts
 * preview while dragged and commit on release. `photoEyes` is the iris
 * colour the face photo puts on (얼굴 step), if any: what picking no colour
 * here shows, and what picking one covers.
 */
export function MakeupPanel({
  paint,
  photoEyes,
  onPreview,
  onCommit,
}: {
  paint: FacePaint
  photoEyes: string | null
  onPreview: (paint: FacePaint) => void
  onCommit: (paint: FacePaint) => void
}) {
  const [part, setPart] = useState<Part>('eyes')
  const set = (patch: Partial<FacePaint>) => onCommit({ ...paint, ...patch })
  const amount = (key: Setting) => ({
    onCommit: (value: number) => onCommit({ ...paint, [key]: value }),
    onPreview: (value: number) => onPreview({ ...paint, [key]: value }),
  })

  return (
    <div className="flex flex-col gap-5">
      <Segmented
        marked={(id) => painted(id, paint)}
        onPick={setPart}
        options={PARTS}
        value={part}
      />

      {part === 'eyes' && (
        <>
          <PanelSection title="눈동자 색">
            <SwatchGrid
              onPick={(eyes) => set({ eyes })}
              original={photoEyes ? '사진 눈동자' : '원래 눈'}
              swatches={IRIS_SWATCHES}
              value={paint.eyes}
            />
            {photoEyes && (
              <p className="flex items-center gap-2 rounded-xl bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500 leading-4">
                <span
                  className="size-4 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{
                    background: `radial-gradient(circle, #111 0 28%, ${photoEyes} 30% 100%)`,
                  }}
                />
                {paint.eyes
                  ? '고른 색이 얼굴 사진의 눈동자 색 대신 보여요'
                  : '얼굴 사진의 눈동자 색을 쓰고 있어요'}
              </p>
            )}
          </PanelSection>
          <PanelSection title="아이섀도">
            <SwatchGrid
              onPick={(shadow) => set({ shadow })}
              original="없음"
              swatches={SHADOW_SWATCHES}
              value={paint.shadow}
            />
            <AmountSlider
              disabled={!paint.shadow}
              label="진하기"
              value={paint.shadowAmount}
              {...amount('shadowAmount')}
            />
          </PanelSection>
          <PanelSection title="아이라이너">
            <AmountSlider label="진하기" value={paint.liner} {...amount('liner')} />
          </PanelSection>
        </>
      )}

      {part === 'brows' && (
        <>
          <PanelSection title="눈썹 색">
            <SwatchGrid
              onPick={(browColor) => set({ browColor })}
              original="원래 눈썹"
              swatches={BROW_SWATCHES}
              value={paint.browColor}
            />
          </PanelSection>
          <PanelSection title="모양">
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
        </>
      )}

      {part === 'lips' && (
        <PanelSection title="입술 색">
          <SwatchGrid
            onPick={(lips) => set({ lips })}
            original="없음"
            swatches={LIP_SWATCHES}
            value={paint.lips}
          />
          <AmountSlider
            disabled={!paint.lips}
            label="진하기"
            value={paint.lipAmount}
            {...amount('lipAmount')}
          />
        </PanelSection>
      )}

      {part === 'cheeks' && (
        <>
          <PanelSection title="볼터치">
            <SwatchGrid
              onPick={(blush) => set({ blush })}
              original="없음"
              swatches={BLUSH_SWATCHES}
              value={paint.blush}
            />
            <AmountSlider
              disabled={!paint.blush}
              label="진하기"
              value={paint.blushAmount}
              {...amount('blushAmount')}
            />
          </PanelSection>
          <PanelSection title="주근깨">
            <AmountSlider label="양" value={paint.freckles} {...amount('freckles')} />
          </PanelSection>
        </>
      )}

      {part === 'beard' && (
        <PanelSection title="수염 스타일">
          <div className="grid grid-cols-3 gap-1.5">
            {BEARD_STYLES.map((style) => (
              <button
                aria-pressed={paint.beard === style}
                className={cn(
                  'whitespace-nowrap rounded-full py-1.5 font-medium text-[12px] transition',
                  paint.beard === style
                    ? 'bg-sky-500 text-white shadow-[0_4px_10px_rgba(14,165,233,0.3)]'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
                )}
                key={style}
                onClick={() => set({ beard: style })}
                type="button"
              >
                {BEARD_LABELS[style]}
              </button>
            ))}
          </div>
          <AmountSlider
            disabled={paint.beard === 'none'}
            label="진하기"
            value={paint.beardAmount}
            {...amount('beardAmount')}
          />
        </PanelSection>
      )}

      <ResetButton
        disabled={!hasFacePaint(paint)}
        label="메이크업 모두 지우기"
        onClick={() => onCommit(NO_PAINT)}
      />
    </div>
  )
}
