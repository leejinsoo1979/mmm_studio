import {
  FACE_SLIDERS,
  type FaceRegion,
  type FaceShape,
  type FaceSliderId,
} from '@pascal-app/editor'

/**
 * Ready-made shapes for each face region (a starting point the sliders and
 * the handles refine), and the line drawing each tile shows: drawn from the
 * sliders themselves, so the 현재 tile shows the face as it is.
 */

export type PresetRegion = Exclude<FaceRegion, 'ears'>
export type FaceSliders = Partial<Record<FaceSliderId, number>>
export type FacePreset = { id: string; label: string; sliders: FaceSliders }

const BASIC: FacePreset = { id: 'basic', label: '기본', sliders: {} }

export const FACE_PRESETS: Record<PresetRegion, readonly FacePreset[]> = {
  face: [
    BASIC,
    {
      id: 'oval',
      label: '계란형',
      sliders: { faceWidth: -0.2, jawWidth: -0.3, chinWidth: -0.2, jawAngle: -0.3 },
    },
    {
      id: 'round',
      label: '둥근형',
      sliders: { faceWidth: 0.3, cheeks: 0.4, faceLength: -0.2, chinWidth: 0.3 },
    },
    {
      id: 'vline',
      label: 'V라인',
      sliders: { jawAngle: -0.7, jawWidth: -0.4, chinWidth: -0.5, chinLength: 0.3 },
    },
    { id: 'square', label: '각진형', sliders: { jawAngle: 0.7, jawWidth: 0.5, chinWidth: 0.4 } },
    { id: 'long', label: '긴 얼굴', sliders: { faceLength: 0.6, faceWidth: -0.2 } },
  ],
  eyes: [
    BASIC,
    { id: 'big', label: '큰 눈', sliders: { eyeSize: 0.5, eyeOpen: 0.4 } },
    { id: 'almond', label: '아몬드', sliders: { eyeWidth: 0.4, eyeOpen: -0.2, eyeTilt: 0.2 } },
    { id: 'upturned', label: '올라간 눈', sliders: { eyeTilt: 0.6 } },
    { id: 'downturned', label: '처진 눈', sliders: { eyeTilt: -0.6 } },
    { id: 'narrow', label: '가는 눈', sliders: { eyeOpen: -0.6, eyeWidth: 0.3 } },
  ],
  brows: [
    BASIC,
    { id: 'straight', label: '일자', sliders: { browArch: -0.7 } },
    { id: 'arched', label: '아치', sliders: { browArch: 0.7 } },
    { id: 'raised', label: '올라간', sliders: { browTilt: 0.6 } },
    { id: 'lowered', label: '처진', sliders: { browTilt: -0.6 } },
    { id: 'high', label: '높은', sliders: { browHeight: 0.5 } },
  ],
  nose: [
    BASIC,
    { id: 'high', label: '오똑한', sliders: { noseHeight: 0.6, noseBridge: -0.3 } },
    { id: 'small', label: '작은', sliders: { noseLength: -0.4, noseWidth: -0.4 } },
    { id: 'wide', label: '넓은', sliders: { noseWidth: 0.5, noseBridge: 0.3 } },
    { id: 'upturned', label: '들린 코', sliders: { noseTip: 0.6 } },
    { id: 'aquiline', label: '매부리', sliders: { noseHeight: 0.5, noseTip: -0.5 } },
  ],
  mouth: [
    BASIC,
    { id: 'full', label: '도톰한', sliders: { lipFullness: 0.6 } },
    { id: 'thin', label: '얇은', sliders: { lipFullness: -0.5 } },
    { id: 'wide', label: '넓은', sliders: { mouthWidth: 0.5 } },
    { id: 'small', label: '작은', sliders: { mouthWidth: -0.5 } },
    { id: 'smile', label: '미소', sliders: { mouthCorners: 0.6 } },
  ],
}

const regionIds = (region: FaceRegion) =>
  new Set<string>(FACE_SLIDERS.filter(({ group }) => group === region).map(({ id }) => id))

/** A shape's sliders in one region (zeros left out, as a saved shape leaves them). */
export function regionSliders(shape: FaceShape, region: FaceRegion): FaceSliders {
  const ids = regionIds(region)
  return Object.fromEntries(
    Object.entries(shape.sliders).filter(([id, value]) => ids.has(id) && value !== 0),
  ) as FaceSliders
}

/** Whether a region's sliders are exactly a preset's (기본: none set). */
export function presetMatches(shape: FaceShape, region: FaceRegion, preset: FacePreset): boolean {
  const own = regionSliders(shape, region)
  const keys = Object.keys(own)
  const wanted = Object.entries(preset.sliders).filter(([, value]) => value !== 0)
  return (
    keys.length === wanted.length &&
    wanted.every(([id, value]) => own[id as FaceSliderId] === value)
  )
}

/** The shape with a region's sliders replaced by a preset's; the other regions and the pins stay. */
export function applyPreset(shape: FaceShape, region: FaceRegion, preset: FacePreset): FaceShape {
  const ids = regionIds(region)
  const rest = Object.entries(shape.sliders).filter(([id]) => !ids.has(id))
  const own = Object.entries(preset.sliders).filter(([, value]) => value !== 0)
  return { ...shape, sliders: Object.fromEntries([...rest, ...own]) as FaceSliders }
}

type Point = readonly [number, number]

const n = (value: number) => Number(value.toFixed(2))
const at = ([x, y]: Point) => `${n(x)} ${n(y)}`

/** A closed loop through `points`, smoothed (Catmull-Rom as cubic Béziers). */
function smoothLoop(points: readonly Point[]): string {
  const count = points.length
  const p = (i: number) => points[(i + count) % count]!
  let d = `M${at(p(0))}`
  for (let i = 0; i < count; i++) {
    const [a, b, c, e] = [p(i - 1), p(i), p(i + 1), p(i + 2)]
    const c1: Point = [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6]
    const c2: Point = [c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6]
    d += `C${at(c1)} ${at(c2)} ${at(c)}`
  }
  return `${d}Z`
}

/** A circle as two arcs. */
const circle = ([x, y]: Point, r: number) =>
  `M${n(x + r)} ${n(y)}A${n(r)} ${n(r)} 0 1 0 ${n(x - r)} ${n(y)}A${n(r)} ${n(r)} 0 1 0 ${n(x + r)} ${n(y)}Z`

/** Mirrors right-side points (x > 24) onto the left, for a symmetric loop. */
const mirrored = (right: readonly Point[]): Point[] => [
  ...right,
  ...right
    .slice(0, -1)
    .reverse()
    .slice(0, -1)
    .map(([x, y]): Point => [48 - x, y]),
]

/**
 * A region drawn from its sliders: an SVG path `d` in a 48×48 box, for a
 * stroked, unfilled line. 윤곽 a face outline, 눈 an almond eye and iris, 눈썹
 * a brow, 코 a nose in profile, 입 the lips.
 */
export function regionGlyph(region: PresetRegion, sliders: FaceSliders): string {
  const s = (id: FaceSliderId) => sliders[id] ?? 0
  switch (region) {
    case 'face': {
      const length = s('faceLength')
      const width = s('faceWidth')
      const top = 6 - length * 2
      const chinY = 42 + length * 2 + s('chinLength') * 2
      const jawY = 32 + s('jawAngle') * 2.5
      const jawX = 24 + 11 + s('jawWidth') * 2.5 + s('jawAngle') * 1.5
      const chinX = 24 + 3.5 + s('chinWidth') * 2.5
      const cheekX = 24 + 14 + width * 3 + s('cheeks') * 1.5
      // From the crown round the right side to the chin's middle; mirrored for the left.
      return smoothLoop(
        mirrored([
          [24, top],
          [24 + 12 + width * 2.5, 13 - length],
          [cheekX, 23],
          [jawX, jawY],
          [chinX, chinY - 1],
          [24, chinY],
        ]),
      )
    }
    case 'eyes': {
      const size = 1 + s('eyeSize') * 0.2
      const half = (15 + s('eyeWidth') * 4) * size
      const open = (8 + s('eyeOpen') * 4) * size
      const tilt = s('eyeTilt') * 6
      const inner: Point = [24 - half, 25 + tilt * 0.3]
      const outer: Point = [24 + half, 25 - tilt]
      const iris = Math.min(open * 0.6, half * 0.4)
      return [
        `M${at(inner)}`,
        `Q${at([24, 25 - open * 1.6])} ${at(outer)}`,
        `Q${at([24, 25 + open * 1.15])} ${at(inner)}Z`,
        circle([24, 25 - open * 0.15], iris),
      ].join('')
    }
    case 'brows': {
      const lift = s('browHeight') * 4
      const inner = 9 + s('browSpacing') * 3
      const arch = 6 + s('browArch') * 5
      const tail = 27 - lift - s('browTilt') * 6
      const start: Point = [inner, 29 - lift]
      const end: Point = [42, tail]
      return [
        `M${at(start)}`,
        `Q${at([22, 29 - lift - arch * 2])} ${at(end)}`,
        `Q${at([24, 33 - lift - arch * 2])} ${at([inner, 33 - lift])}Z`,
      ].join('')
    }
    case 'nose': {
      // In profile, facing right: down from the brow, out to the tip, back under to the lip.
      const tipX = 31 + s('noseHeight') * 5
      const tipY = 31 + s('noseLength') * 4
      const lift = s('noseTip') * 4
      const bump = s('noseBridge') * 2
      const base = 20 - s('noseWidth') * 2
      return [
        `M${at([19, 6])}`,
        `C${at([21 + bump, 15])} ${at([tipX - 4, tipY - 9])} ${at([tipX, tipY - lift])}`,
        `C${at([tipX + 2.5, tipY + 3 - lift])} ${at([tipX - 1, tipY + 6 - lift * 0.5])} ${at([tipX - 5, tipY + 5.5 - lift * 0.5])}`,
        `C${at([tipX - 9, tipY + 5])} ${at([base + 2, tipY + 6])} ${at([base, tipY + 9])}`,
      ].join('')
    }
    case 'mouth': {
      const half = 13 + s('mouthWidth') * 4
      const corner = 25 - s('mouthCorners') * 4
      const upper = 5 + s('lipFullness') * 2.5 + s('upperLip') * 2.5
      const lower = 6 + s('lipFullness') * 3 + s('lowerLip') * 3
      const left: Point = [24 - half, corner]
      const right: Point = [24 + half, corner]
      return [
        `M${at(left)}`,
        `Q${at([24 - half * 0.55, 25 - upper])} ${at([20.5, 25 - upper])}`,
        `Q${at([24, 25 - upper + 2.5])} ${at([27.5, 25 - upper])}`,
        `Q${at([24 + half * 0.55, 25 - upper])} ${at(right)}`,
        `Q${at([24, 25 + lower * 2])} ${at(left)}Z`,
        `M${at(left)}Q${at([24, 26.5])} ${at(right)}`,
      ].join('')
    }
  }
}
