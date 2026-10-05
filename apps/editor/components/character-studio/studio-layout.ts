import {
  AVATAR_TABS,
  type AvatarLook,
  type AvatarTab,
  avatarTab,
  BALD,
  type BodySliderId,
  DEFAULT_EMOTE_KEYS,
  type EmoteId,
  FACE_SLIDERS,
  type FacePaint,
  type FaceRegion,
  findAvatar,
  hasBodyShape,
  hasFacePaint,
  hasFaceShape,
  regionChanged,
} from '@pascal-app/editor'
import type { CameraFocus, StageInsets, StagePose } from './stage-contract'

/**
 * The studio's tables (bottom tabs, each tab's rail of categories and their
 * sub-tabs), the stage's insets from the chrome, and which categories hold
 * changes. Pure, so the layout rules are tested without a browser.
 */

export type StudioTab = 'preset' | 'face' | 'body' | 'hair' | 'makeup' | 'skin' | 'motion'

export const STUDIO_TABS: readonly { id: StudioTab; label: string; focus: CameraFocus }[] = [
  { id: 'preset', label: '프리셋', focus: 'full' },
  { id: 'face', label: '얼굴', focus: 'face' },
  { id: 'body', label: '몸', focus: 'full' },
  { id: 'hair', label: '헤어', focus: 'hair' },
  { id: 'makeup', label: '메이크업', focus: 'face' },
  { id: 'skin', label: '피부', focus: 'upper' },
  { id: 'motion', label: '동작', focus: 'full' },
]

/** An NPC has no game keys, so no 동작. */
export const studioTabs = (npc: boolean) =>
  npc ? STUDIO_TABS.filter((tab) => tab.id !== 'motion') : STUDIO_TABS

export const TAB_FOCUS = Object.fromEntries(
  STUDIO_TABS.map((tab) => [tab.id, tab.focus]),
) as Record<StudioTab, CameraFocus>

/** Rail categories the camera closes in on while their panel is open (the rest keep the tab's framing). */
const CATEGORY_FOCUS: Partial<Record<StudioTab, Readonly<Record<string, CameraFocus>>>> = {
  face: { eyes: 'eyes', brows: 'eyes', nose: 'mouth', mouth: 'mouth' },
  makeup: { eyes: 'eyes', lips: 'mouth', beard: 'mouth' },
  body: { lower: 'legs', feet: 'feet' },
}

/**
 * What the camera frames: the region being edited while its panel is
 * open, and the tab's own framing once the panel is closed.
 */
export function focusOf(tab: StudioTab, category: string, panelOpen: boolean): CameraFocus {
  return (panelOpen && CATEGORY_FOCUS[tab]?.[category]) || TAB_FOCUS[tab]
}

/** Where the avatar holds still unless LIVE is on, and so where the LIVE toggle shows. */
export const STILL_TABS: ReadonlySet<StudioTab> = new Set(['face', 'hair', 'makeup'])

/** Tabs that turn the avatar to face the camera as they are entered. */
export const FRONT_TABS: ReadonlySet<StudioTab> = new Set(['face', 'makeup'])

export const stagePose = (tab: StudioTab, live: boolean): StagePose =>
  STILL_TABS.has(tab) && !live ? 'still' : 'live'

export type SubTab = { id: string; label: string }
export type Category = { id: string; label: string; subTabs: readonly SubTab[] }

export type FaceCategory = 'photo' | FaceRegion

/** The rail's names for the face's regions. */
export const FACE_REGION_LABELS: Record<FaceRegion, string> = {
  face: '윤곽',
  eyes: '눈',
  brows: '눈썹',
  nose: '코',
  mouth: '입',
  ears: '귀',
}

const PRESET: SubTab = { id: 'preset', label: '프리셋' }
const DETAIL: SubTab = { id: 'detail', label: '세부 조정' }

const FACE_CATEGORIES: readonly Category[] = [
  { id: 'photo', label: '내 얼굴 사진', subTabs: [] },
  { id: 'face', label: FACE_REGION_LABELS.face, subTabs: [PRESET, DETAIL] },
  {
    id: 'eyes',
    label: FACE_REGION_LABELS.eyes,
    subTabs: [PRESET, DETAIL, { id: 'lens', label: '렌즈' }],
  },
  {
    id: 'brows',
    label: FACE_REGION_LABELS.brows,
    subTabs: [PRESET, DETAIL, { id: 'color', label: '색·굵기' }],
  },
  { id: 'nose', label: FACE_REGION_LABELS.nose, subTabs: [PRESET, DETAIL] },
  { id: 'mouth', label: FACE_REGION_LABELS.mouth, subTabs: [PRESET, DETAIL] },
  { id: 'ears', label: FACE_REGION_LABELS.ears, subTabs: [DETAIL] },
]

export type BodyCategory = 'build' | 'upper' | 'arms' | 'lower' | 'feet'

/**
 * The 몸 tab's categories and their sliders: grouped for finding them (legs
 * under 하체), independent of the shaper's own groups. 체격 also holds 키.
 */
export const BODY_CATEGORIES: readonly {
  id: BodyCategory
  label: string
  sliders: readonly BodySliderId[]
}[] = [
  { id: 'build', label: '체격', sliders: ['weight', 'muscle', 'headSize'] },
  {
    id: 'upper',
    label: '상체',
    sliders: ['torsoLength', 'shoulders', 'chest', 'waist', 'belly', 'neck'],
  },
  { id: 'arms', label: '팔', sliders: ['arms'] },
  { id: 'lower', label: '하체', sliders: ['hips', 'legLength', 'legs'] },
  { id: 'feet', label: '발', sliders: [] },
]

export type MakeupCategory = 'eyes' | 'lips' | 'cheeks' | 'beard'

/** Each makeup category's paint settings (the irises and brows are the 얼굴 tab's). */
export const MAKEUP_SETTINGS: Record<MakeupCategory, readonly (keyof FacePaint)[]> = {
  eyes: ['shadow', 'shadowAmount', 'liner'],
  lips: ['lips', 'lipAmount'],
  cheeks: ['blush', 'blushAmount', 'freckles'],
  beard: ['beard', 'beardAmount'],
}

const CATEGORIES: Record<Exclude<StudioTab, 'face'>, readonly Category[]> = {
  preset: AVATAR_TABS.map(({ id, label }) => ({ id, label, subTabs: [] })),
  body: BODY_CATEGORIES.map(({ id, label }) => ({ id, label, subTabs: [] })),
  hair: [
    { id: 'style', label: '스타일', subTabs: [] },
    { id: 'color', label: '색상', subTabs: [] },
  ],
  makeup: [
    { id: 'eyes', label: '눈 화장', subTabs: [] },
    { id: 'lips', label: '입술', subTabs: [] },
    { id: 'cheeks', label: '볼', subTabs: [] },
    { id: 'beard', label: '수염', subTabs: [] },
  ],
  skin: [
    {
      id: 'tone',
      label: '피부 톤',
      subTabs: [
        { id: 'swatches', label: '추천' },
        { id: 'custom', label: '직접 고르기' },
      ],
    },
  ],
  motion: [
    { id: 'emotes', label: '동작', subTabs: [] },
    { id: 'keys', label: '단축키', subTabs: [] },
  ],
}

/** A tab's rail. An NPC's face has no photo (scenes are public). */
export function categoriesOf(tab: StudioTab, npc: boolean): readonly Category[] {
  if (tab === 'face')
    return npc ? FACE_CATEGORIES.filter(({ id }) => id !== 'photo') : FACE_CATEGORIES
  return CATEGORIES[tab]
}

/** The category a tab opens on: its first, except 프리셋, which opens where the character is. */
export function firstCategory(tab: StudioTab, npc: boolean, avatar: string): string {
  if (tab === 'preset') return avatarTab(findAvatar(avatar))
  return categoriesOf(tab, npc)[0]!.id
}

/** The face region a 얼굴 category sculpts (사진 none). */
export const regionOfCategory = (category: string): FaceRegion | null =>
  category === 'photo' || !(category in FACE_REGION_LABELS) ? null : (category as FaceRegion)

export type ChangeContext = {
  look: AvatarLook
  avatar: string
  keys: Record<string, EmoteId>
  /** The character's face points; undefined while loading, null for a covered face. */
  target: readonly number[] | null | undefined
}

const groupSet = (look: AvatarLook, region: FaceRegion) =>
  FACE_SLIDERS.some(({ id, group }) => group === region && (look.shape.sliders[id] ?? 0) !== 0)

const shapeChanged = (look: AvatarLook, region: FaceRegion, target: ChangeContext['target']) =>
  target ? regionChanged(look.shape, region, target) : groupSet(look, region)

/** Paint with nothing on: what each category's own settings are laid over to judge them alone. */
const FACE_PAINT_OFF: FacePaint = {
  eyes: null,
  browColor: null,
  browDarkness: 0,
  browThickness: 0,
  lips: null,
  lipAmount: 0,
  blush: null,
  blushAmount: 0,
  shadow: null,
  shadowAmount: 0,
  liner: 0,
  beard: 'none',
  beardAmount: 0,
  freckles: 0,
}

/** Whether a makeup category shows on the face (as hasFacePaint judges the whole paint). */
export function makeupChanged(category: MakeupCategory, paint: FacePaint): boolean {
  const own = Object.fromEntries(MAKEUP_SETTINGS[category].map((key) => [key, paint[key]]))
  return hasFacePaint({ ...FACE_PAINT_OFF, ...own })
}

/** Whether a rail category holds changes (its dot). 프리셋 marks the character's own group. */
export function categoryChanged(tab: StudioTab, category: string, context: ChangeContext): boolean {
  const { look, target } = context
  switch (tab) {
    case 'preset':
      return avatarTab(findAvatar(context.avatar)) === (category as AvatarTab)
    case 'face': {
      if (category === 'photo') return look.face !== null
      const region = category as FaceRegion
      if (shapeChanged(look, region, target)) return true
      if (region === 'eyes') return look.paint.eyes !== null
      if (region === 'brows') {
        return (
          look.paint.browColor !== null ||
          look.paint.browDarkness !== 0 ||
          look.paint.browThickness !== 0
        )
      }
      return false
    }
    case 'body': {
      if (category === 'feet') return look.feet.wear !== 'shoes'
      const entry = BODY_CATEGORIES.find(({ id }) => id === category)
      if (!entry) return false
      if (category === 'build' && look.body.height !== 0) return true
      return entry.sliders.some((id) => (look.body.sliders[id] ?? 0) !== 0)
    }
    case 'hair':
      return category === 'style' ? look.hairStyle !== null : look.hair !== null
    case 'makeup':
      return makeupChanged(category as MakeupCategory, look.paint)
    case 'skin':
      return look.skin !== null
    case 'motion':
      return (
        category === 'keys' && JSON.stringify(context.keys) !== JSON.stringify(DEFAULT_EMOTE_KEYS)
      )
  }
}

/** What a look changes, for 꾸민 곳 (empty: the character as it comes). */
export function lookChips(look: AvatarLook): string[] {
  return [
    look.face && '내 얼굴',
    hasFaceShape(look.shape) && '얼굴형',
    hasBodyShape(look.body) && '체형',
    look.hairStyle && (look.hairStyle === BALD ? '민머리' : '헤어스타일'),
    look.hair && '염색',
    hasFacePaint(look.paint) && '메이크업',
    look.skin && '피부 톤',
    look.feet.wear !== 'shoes' && (look.feet.wear === 'socks' ? '양말' : '맨발'),
  ].filter((chip): chip is string => typeof chip === 'string')
}

/** Viewport widths and heights the layout changes at (CSS px). */
export const WIDE = 1280
export const NARROW = 1024
export const SHORT = 720

/** The edges every piece of chrome keeps off: 24 px round the screen. */
const GUTTER = 24
const LEFT_CARD = 280
const RAIL = 176
const PANEL = 360
/**
 * How far up the sculpt bar reaches (its `bottom-[112px]`, 40 px tall) with
 * a little air: the face is framed above it, or the chin's handle would sit
 * under the bar, which takes the pointer.
 */
const SCULPT_BAR_TOP = 112 + 40 + 8

export type Viewport = { width: number; height: number }

/** Whether the left card has room beside the stage (narrower screens fold it into a chip). */
export const cardBeside = (viewport: Viewport) => viewport.width >= WIDE

/**
 * Whether the open panel takes its room from the stage. From 1024 px it
 * does, so the rail beside it never lies over the face; narrower, it lies
 * over the stage.
 */
export const panelPushes = (viewport: Viewport) => viewport.width >= NARROW

/**
 * The CSS px the chrome covers along each edge of the full-bleed stage: the
 * stage frames the character in what is left. Hidden UI leaves the gutter.
 */
export function stageInsets(
  viewport: Viewport,
  {
    uiHidden,
    panelOpen,
    sculptBar = false,
  }: { uiHidden: boolean; panelOpen: boolean; sculptBar?: boolean },
): StageInsets {
  if (uiHidden) return { top: GUTTER, right: GUTTER, bottom: GUTTER, left: GUTTER }
  const short = viewport.height < SHORT
  return {
    top: short ? 96 : 112,
    bottom: Math.max(short ? 88 : 112, sculptBar ? SCULPT_BAR_TOP : 0),
    left: cardBeside(viewport) ? GUTTER + LEFT_CARD + GUTTER : GUTTER,
    right: RAIL + (panelPushes(viewport) && panelOpen ? PANEL + 16 : 0),
  }
}

/** The part of the screen the chrome leaves, where the character stands. */
export function freeRect(viewport: Viewport, insets: StageInsets) {
  return {
    x: insets.left,
    y: insets.top,
    width: Math.max(0, viewport.width - insets.left - insets.right),
    height: Math.max(0, viewport.height - insets.top - insets.bottom),
  }
}
