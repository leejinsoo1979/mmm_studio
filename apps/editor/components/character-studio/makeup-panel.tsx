'use client'

import { BEARD_STYLES, type BeardStyle, type FacePaint, NO_PAINT } from '@pascal-app/editor'
import { AmountSlider, PanelSection, ResetButton, RoundTile, SwatchGrid } from './studio-controls'
import { BEARD_LABELS, BLUSH_SWATCHES, LIP_SWATCHES, SHADOW_SWATCHES } from './studio-data'
import { MAKEUP_SETTINGS, type MakeupCategory, makeupChanged } from './studio-layout'

/** The paint's settings that are numbers: the amounts. */
type Setting = { [K in keyof FacePaint]: FacePaint[K] extends number ? K : never }[keyof FacePaint]

const FACE_OUTLINE = 'M24 5C14 5 9 13 9 23c0 10 6 20 15 20s15-10 15-20C39 13 34 5 24 5Z'

/** Each beard drawn on a plain face. */
const BEARD_SHAPES: Record<BeardStyle, React.ReactNode> = {
  none: null,
  stubble: (
    <g className="fill-white/70">
      {[
        [13, 30],
        [15, 34],
        [18, 37],
        [21, 39],
        [24, 40],
        [27, 39],
        [30, 37],
        [33, 34],
        [35, 30],
        [19, 33],
        [24, 35],
        [29, 33],
        [22, 29],
        [26, 29],
      ].map(([x, y]) => (
        <circle cx={x} cy={y} key={`${x}-${y}`} r="0.9" />
      ))}
    </g>
  ),
  mustache: (
    <path className="fill-white/80" d="M17 30c3-3 5-3 7-1 2-2 4-2 7 1-3 1-5 1-7 0-2 1-4 1-7 0Z" />
  ),
  goatee: (
    <path
      className="fill-white/80"
      d="M18 30c3-2.5 5-2.5 6-1 1-1.5 3-1.5 6 1-2 .8-4 .8-6 0-2 .8-4 .8-6 0ZM20 35c2 1.5 6 1.5 8 0l1 3c-1 3-3 4.5-5 4.5s-4-1.5-5-4.5Z"
    />
  ),
  full: (
    <path
      className="fill-white/80"
      d="M9.5 24c0 6 2 12 5 15 3 3 6 4 9.5 4s6.5-1 9.5-4c3-3 5-9 5-15l-3 1c-1 5-2 7-4 8-1-3-4-5-7.5-5s-6.5 2-7.5 5c-2-1-3-3-4-8Zm10.5 9c1.5-1.2 6.5-1.2 8 0-1 1.6-7 1.6-8 0Z"
    />
  ),
}

function BeardGlyph({ style }: { style: BeardStyle }) {
  return (
    <svg aria-hidden className="absolute inset-[16%] size-[68%]" viewBox="0 0 48 48">
      <path className="fill-none stroke-[1.5] stroke-white/45" d={FACE_OUTLINE} />
      {BEARD_SHAPES[style]}
    </svg>
  )
}

/**
 * What is painted on the face (inZOI's make-up and the Sims' facial hair),
 * a category at a time: eye make-up, lips, cheeks (blush and freckles) and
 * the beard. Colours commit as they are picked; amounts preview while
 * dragged and commit on release. Irises and brows are the 얼굴 tab's.
 */
export function MakeupBody({
  category,
  paint,
  onPreview,
  onCommit,
}: {
  category: MakeupCategory
  paint: FacePaint
  onPreview: (paint: FacePaint) => void
  onCommit: (paint: FacePaint) => void
}) {
  const set = (patch: Partial<FacePaint>) => onCommit({ ...paint, ...patch })
  const amount = (key: Setting) => ({
    onCommit: (value: number) => onCommit({ ...paint, [key]: value }),
    onPreview: (value: number) => onPreview({ ...paint, [key]: value }),
  })

  switch (category) {
    case 'eyes':
      return (
        <div className="flex flex-col gap-5">
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
        </div>
      )
    case 'lips':
      return (
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
      )
    case 'cheeks':
      return (
        <div className="flex flex-col gap-5">
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
        </div>
      )
    case 'beard':
      return (
        <div className="flex flex-col gap-5">
          <PanelSection title="수염 스타일">
            <div className="grid grid-cols-3 gap-x-3 gap-y-4">
              {BEARD_STYLES.map((style) => (
                <RoundTile
                  key={style}
                  label={BEARD_LABELS[style]}
                  onPick={() => set({ beard: style })}
                  selected={paint.beard === style}
                >
                  <BeardGlyph style={style} />
                </RoundTile>
              ))}
            </div>
          </PanelSection>
          <AmountSlider
            disabled={paint.beard === 'none'}
            label="진하기"
            value={paint.beardAmount}
            {...amount('beardAmount')}
          />
        </div>
      )
  }
}

const MAKEUP_CATEGORIES = Object.keys(MAKEUP_SETTINGS) as MakeupCategory[]

/** Wipes the make-up (eyes, lips, cheeks, beard); the irises and brows stay. */
export function MakeupFooter({
  paint,
  onCommit,
}: {
  paint: FacePaint
  onCommit: (paint: FacePaint) => void
}) {
  const wiped = Object.fromEntries(
    MAKEUP_CATEGORIES.flatMap((category) => MAKEUP_SETTINGS[category]).map((key) => [
      key,
      NO_PAINT[key],
    ]),
  )
  return (
    <div className="grid">
      <ResetButton
        disabled={!MAKEUP_CATEGORIES.some((category) => makeupChanged(category, paint))}
        label="메이크업 모두 지우기"
        onClick={() => onCommit({ ...paint, ...wiped })}
      />
    </div>
  )
}
