import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  AVATAR_TABS,
  type AvatarLook,
  BALD,
  BODY_SLIDERS,
  DEFAULT_EMOTE_KEYS,
  FACE_HANDLE,
  FACE_SLIDER_GROUPS,
  NO_LOOK,
} from '@pascal-app/editor'
import {
  BODY_CATEGORIES,
  type ChangeContext,
  categoriesOf,
  categoryChanged,
  firstCategory,
  focusOf,
  freeRect,
  lookChips,
  MAKEUP_SETTINGS,
  regionOfCategory,
  STILL_TABS,
  stageInsets,
  stagePose,
  studioTabs,
} from './studio-layout'

const TARGET: readonly number[] = JSON.parse(
  readFileSync(
    new URL('../../public/characters/rocketbox/face-points.json', import.meta.url),
    'utf8',
  ),
).avatars.Male_Adult_02

const context = (look: Partial<AvatarLook>, extra: Partial<ChangeContext> = {}): ChangeContext => ({
  look: { ...NO_LOOK, ...look },
  avatar: 'Male_Adult_02',
  keys: DEFAULT_EMOTE_KEYS,
  target: TARGET,
  ...extra,
})

describe('the tabs', () => {
  test('a player has all seven, an NPC no 동작', () => {
    expect(studioTabs(false).map(({ label }) => label)).toEqual([
      '프리셋',
      '얼굴',
      '몸',
      '헤어',
      '메이크업',
      '피부',
      '동작',
    ])
    expect(studioTabs(true).map(({ id }) => id)).not.toContain('motion')
  })

  test('the avatar holds still in 얼굴, 헤어 and 메이크업 unless LIVE is on', () => {
    expect([...STILL_TABS].sort()).toEqual(['face', 'hair', 'makeup'])
    expect(stagePose('face', false)).toBe('still')
    expect(stagePose('face', true)).toBe('live')
    expect(stagePose('body', false)).toBe('live')
  })

  test('the camera closes in on the region being edited while its panel is open', () => {
    expect(focusOf('face', 'eyes', true)).toBe('eyes')
    expect(focusOf('face', 'brows', true)).toBe('eyes')
    expect(focusOf('face', 'nose', true)).toBe('mouth')
    expect(focusOf('face', 'face', true)).toBe('face')
    expect(focusOf('makeup', 'lips', true)).toBe('mouth')
    expect(focusOf('makeup', 'cheeks', true)).toBe('face')
    expect(focusOf('body', 'feet', true)).toBe('feet')
    expect(focusOf('body', 'lower', true)).toBe('legs')
    expect(focusOf('body', 'upper', true)).toBe('full')
    expect(focusOf('hair', 'style', true)).toBe('hair')
  })

  test('and goes back to the tab’s framing once it is closed', () => {
    expect(focusOf('face', 'eyes', false)).toBe('face')
    expect(focusOf('body', 'feet', false)).toBe('full')
  })
})

describe('the rails', () => {
  test('the face rail has the photo for a player only, then 윤곽 to 귀', () => {
    expect(categoriesOf('face', false).map(({ label }) => label)).toEqual([
      '내 얼굴 사진',
      '윤곽',
      '눈',
      '눈썹',
      '코',
      '입',
      '귀',
    ])
    expect(categoriesOf('face', true).map(({ id }) => id)).toEqual([...FACE_SLIDER_GROUPS])
    expect(firstCategory('face', false, 'Male_Adult_02')).toBe('photo')
    expect(firstCategory('face', true, 'Male_Adult_02')).toBe('face')
  })

  test('face regions have their sub-tabs', () => {
    const subs = Object.fromEntries(
      categoriesOf('face', false).map(({ id, subTabs }) => [id, subTabs.map(({ label }) => label)]),
    )
    expect(subs.eyes).toEqual(['프리셋', '세부 조정', '렌즈'])
    expect(subs.brows).toEqual(['프리셋', '세부 조정', '색·굵기'])
    expect(subs.ears).toEqual(['세부 조정'])
    expect(subs.photo).toEqual([])
  })

  test('each face category but the photo sculpts its region', () => {
    expect(regionOfCategory('photo')).toBeNull()
    for (const region of FACE_SLIDER_GROUPS) expect(regionOfCategory(region)).toBe(region)
  })

  test('the preset rail is the avatar groups, opening on the character’s own', () => {
    expect(categoriesOf('preset', false).map(({ id }) => id)).toEqual(
      AVATAR_TABS.map(({ id }) => id),
    )
    expect(firstCategory('preset', false, 'Female_Adult_03')).toBe('women')
    expect(firstCategory('preset', false, 'Male_Child_01')).toBe('children')
  })

  test('every body slider is in exactly one body category, legs under 하체', () => {
    const listed = BODY_CATEGORIES.flatMap(({ sliders }) => sliders)
    expect([...listed].sort()).toEqual(BODY_SLIDERS.map(({ id }) => id).sort())
    expect(new Set(listed).size).toBe(listed.length)
    expect(BODY_CATEGORIES.find(({ id }) => id === 'lower')?.sliders).toContain('legLength')
    expect(BODY_CATEGORIES.find(({ id }) => id === 'upper')?.sliders).toContain('torsoLength')
  })

  test('the makeup rail leaves the irises and brows to the face', () => {
    const settings = Object.values(MAKEUP_SETTINGS).flat()
    expect(settings).not.toContain('eyes')
    expect(settings).not.toContain('browColor')
  })

  test('the hair rail offers its colour only, no hairstyle or bald head to pick', () => {
    for (const npc of [false, true]) {
      expect(categoriesOf('hair', npc).map(({ label }) => label)).toEqual(['색상'])
      expect(firstCategory('hair', npc, 'Female_Adult_03')).toBe('color')
    }
  })
})

describe('changed categories', () => {
  test('nothing is changed on a plain look but the character’s own preset group', () => {
    for (const tab of studioTabs(false)) {
      for (const { id } of categoriesOf(tab.id, false)) {
        const expected = tab.id === 'preset' && id === 'men'
        expect(categoryChanged(tab.id, id, context({}))).toBe(expected)
      }
    }
  })

  test('a face region is changed by its sliders, its pins, or its paint', () => {
    const sliders = context({ shape: { ...NO_LOOK.shape, sliders: { eyeSize: 0.3 } } })
    expect(categoryChanged('face', 'eyes', sliders)).toBe(true)
    expect(categoryChanged('face', 'nose', sliders)).toBe(false)

    const tip = FACE_HANDLE['nose-tip']
    if (tip.kind !== 'landmark') throw new Error('nose tip is a landmark')
    const pins = context({ shape: { ...NO_LOOK.shape, pins: { [tip.landmark]: [0, 0, 0.02] } } })
    expect(categoryChanged('face', 'nose', pins)).toBe(true)
    expect(categoryChanged('face', 'eyes', pins)).toBe(false)
    expect(
      categoryChanged('face', 'eyes', context({ paint: { ...NO_LOOK.paint, eyes: '#3e6aa8' } })),
    ).toBe(true)
    expect(
      categoryChanged(
        'face',
        'brows',
        context({ paint: { ...NO_LOOK.paint, browThickness: 0.4 } }),
      ),
    ).toBe(true)
  })

  test('without the face points only the sliders count', () => {
    const look = { shape: { ...NO_LOOK.shape, sliders: { noseTip: 0.4 } } }
    expect(categoryChanged('face', 'nose', context(look, { target: undefined }))).toBe(true)
    expect(categoryChanged('face', 'nose', context({}, { target: null }))).toBe(false)
  })

  test('body categories: 키 is 체격’s, legs are 하체’s, bare feet are 발’s', () => {
    const tall = context({ body: { ...NO_LOOK.body, height: 0.2 } })
    expect(categoryChanged('body', 'build', tall)).toBe(true)
    expect(categoryChanged('body', 'lower', tall)).toBe(false)
    const legs = context({ body: { ...NO_LOOK.body, sliders: { legLength: 0.3 } } })
    expect(categoryChanged('body', 'lower', legs)).toBe(true)
    expect(categoryChanged('body', 'feet', context({ feet: { wear: 'bare', color: null } }))).toBe(
      true,
    )
  })

  test('makeup counts only what shows', () => {
    const faded = context({ paint: { ...NO_LOOK.paint, lips: '#c2566e', lipAmount: 0 } })
    expect(categoryChanged('makeup', 'lips', faded)).toBe(false)
    const lips = context({ paint: { ...NO_LOOK.paint, lips: '#c2566e' } })
    expect(categoryChanged('makeup', 'lips', lips)).toBe(true)
    expect(categoryChanged('makeup', 'eyes', lips)).toBe(false)
    expect(
      categoryChanged('makeup', 'beard', context({ paint: { ...NO_LOOK.paint, beard: 'full' } })),
    ).toBe(true)
  })

  test('a saved hairstyle or bald head marks no hair category; a dye marks 색상', () => {
    for (const hairStyle of [BALD, 'Female_Adult_03']) {
      expect(categoryChanged('hair', 'color', context({ hairStyle }))).toBe(false)
      expect(categoryChanged('hair', 'style', context({ hairStyle }))).toBe(false)
    }
    expect(categoryChanged('hair', 'color', context({ hair: '#8c2436' }))).toBe(true)
  })

  test('changed keys mark 단축키', () => {
    expect(categoryChanged('motion', 'keys', context({}, { keys: { KeyQ: 'wave' } }))).toBe(true)
    expect(categoryChanged('motion', 'emotes', context({}, { keys: { KeyQ: 'wave' } }))).toBe(false)
  })
})

describe('꾸민 곳', () => {
  test('a look with only sculpted pins still counts as a face shape', () => {
    expect(lookChips(NO_LOOK)).toEqual([])
    expect(
      lookChips({ ...NO_LOOK, shape: { ...NO_LOOK.shape, pins: { 4: [0, 0, 0.02] } } }),
    ).toEqual(['얼굴형'])
    expect(lookChips({ ...NO_LOOK, hair: '#8c2436', hairStyle: 'Female_Adult_03' })).toEqual([
      '염색',
    ])
  })

  test('a saved hairstyle or bald head shows nothing: the character wears its own hair', () => {
    expect(lookChips({ ...NO_LOOK, hairStyle: BALD, shave: 0.9 })).toEqual([])
    expect(lookChips({ ...NO_LOOK, hairStyle: 'Female_Adult_03' })).toEqual([])
  })
})

describe('insets and the free rect', () => {
  test('at 1280×720 the open panel leaves a 400×496 rect between the card and the rail', () => {
    const viewport = { width: 1280, height: 720 }
    const insets = stageInsets(viewport, { uiHidden: false, panelOpen: true })
    expect(insets).toEqual({ top: 112, bottom: 112, left: 328, right: 552 })
    expect(freeRect(viewport, insets)).toEqual({ x: 328, y: 112, width: 400, height: 496 })
    expect(stageInsets(viewport, { uiHidden: false, panelOpen: false }).right).toBe(176)
  })

  test('hidden UI leaves only the gutter', () => {
    const insets = stageInsets({ width: 1512, height: 860 }, { uiHidden: true, panelOpen: true })
    expect(insets).toEqual({ top: 24, right: 24, bottom: 24, left: 24 })
  })

  test('narrower screens fold the card; the panel still keeps the rail off the face', () => {
    const insets = stageInsets({ width: 1100, height: 760 }, { uiHidden: false, panelOpen: true })
    expect(insets).toEqual({ top: 112, bottom: 112, left: 24, right: 552 })
    expect(freeRect({ width: 1024, height: 760 }, { ...insets, right: 552 }).width).toBe(448)
  })

  test('under 1024 px the panel lies over the stage', () => {
    const insets = stageInsets({ width: 900, height: 760 }, { uiHidden: false, panelOpen: true })
    expect(insets).toEqual({ top: 112, bottom: 112, left: 24, right: 176 })
  })

  test('with the sculpt bar the face is framed above it, at any height', () => {
    const viewport = { width: 1280, height: 720 }
    const insets = stageInsets(viewport, { uiHidden: false, panelOpen: true, sculptBar: true })
    expect(insets.bottom).toBe(160)
    expect(freeRect(viewport, insets).height).toBe(448)
    const short = { width: 1366, height: 640 }
    expect(stageInsets(short, { uiHidden: false, panelOpen: false, sculptBar: true }).bottom).toBe(
      160,
    )
    expect(stageInsets(viewport, { uiHidden: true, panelOpen: true, sculptBar: true }).bottom).toBe(
      24,
    )
  })

  test('short screens shrink the top and bottom', () => {
    const insets = stageInsets({ width: 1366, height: 640 }, { uiHidden: false, panelOpen: false })
    expect(insets.top).toBe(96)
    expect(insets.bottom).toBe(88)
  })

  test('the free rect never goes negative', () => {
    const viewport = { width: 150, height: 180 }
    const rect = freeRect(viewport, stageInsets(viewport, { uiHidden: false, panelOpen: true }))
    expect(rect.width).toBe(0)
    expect(rect.height).toBe(0)
  })
})
