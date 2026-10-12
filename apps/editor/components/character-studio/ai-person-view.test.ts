import { describe, expect, test } from 'bun:test'
import type { AvatarJob } from '@/lib/photoreal-ai/avatar-job'
import type { PhotorealAiClientStatus } from '@/lib/photoreal-ai/client'
import {
  AI_PERSON_DEFAULTS,
  AI_PERSON_DETAILS,
  AI_PERSON_DETAILS_MAX,
  AI_PERSON_HAIR_STYLES,
  AI_PERSON_LABELS,
  AI_PORTRAIT_TOKEN_TTL_MS,
  type AiPersonChoices,
  AVATAR_JOB_ERROR_TEXT,
  AVATAR_JOB_STAGE_TEXT,
  PHOTOREAL_AI_DAILY_TEXT,
  PHOTOREAL_AI_ERROR_TEXT,
} from '@/lib/photoreal-ai/shared'
import {
  type AiPersonStep,
  aiPersonView,
  backAfter,
  buildStageText,
  detailOpen,
  elapsedText,
  HAIR_COLOUR_SWATCH,
  hairStylesFor,
  leftText,
  OUTFIT_COLOUR_SWATCH,
  optionsOf,
  type Portrait,
  type PortraitCheck,
  portraitGate,
  randomChoices,
  refusalText,
  requestChoices,
  SKIN_TONE_SWATCH,
  toggleDetail,
  unavailableCopy,
} from './ai-person-view'

const READY: PhotorealAiClientStatus = {
  available: true,
  signedIn: true,
  mock: false,
  portraitsLeft: 5,
  avatarsLeft: 2,
  notice: '',
}

const NOW = 1_000_000

const portrait = (check: PortraitCheck, madeAt = NOW - 1000): Portrait => ({
  url: 'blob:p1',
  blob: new Blob(),
  token: 'signed',
  madeAt,
  check,
})

const JOB: AvatarJob = {
  jobId: 'a'.repeat(24),
  startedAt: NOW - 60_000,
  state: 'working',
  stage: 'computing',
  progress: 40,
  avatar: null,
  error: null,
  seen: false,
}

function view(
  overrides: Partial<{
    status: PhotorealAiClientStatus | null
    job: AvatarJob | null
    step: AiPersonStep
    portrait: Portrait | null
  }> = {},
) {
  return aiPersonView({
    status: READY,
    job: null,
    step: { kind: 'choose' },
    portrait: null,
    now: NOW,
    ...overrides,
  })
}

describe('requestChoices', () => {
  test('drops facial hair from a woman and keeps the details', () => {
    const choices: AiPersonChoices = {
      ...AI_PERSON_DEFAULTS,
      sex: 'female',
      facialHair: 'shortBeard',
      details: ['freckles'],
    }
    expect(requestChoices(choices)).toEqual({ ...choices, facialHair: 'none' })
    expect(requestChoices({ ...choices, sex: 'male' }).facialHair).toBe('shortBeard')
  })
})

describe('the details', () => {
  test('a tap adds or drops one; its opposite gives way; never past the cap', () => {
    expect(toggleDetail([], 'freckles')).toEqual(['freckles'])
    expect(toggleDetail(['freckles'], 'freckles')).toEqual([])
    expect(toggleDetail(['thickBrows', 'dimples'], 'fineBrows')).toEqual(['dimples', 'fineBrows'])
    const full: AiPersonChoices['details'] = ['thickBrows', 'freckles', 'cheekMole', 'dimples']
    expect(full).toHaveLength(AI_PERSON_DETAILS_MAX)
    expect(toggleDetail(full, 'highNoseBridge')).toEqual(full)
    expect(detailOpen(full, 'highNoseBridge')).toBe(false)
    expect(detailOpen(full, 'freckles')).toBe(true)
    // Swapping a picked one for its opposite stays open at the cap.
    expect(detailOpen(full, 'fineBrows')).toBe(true)
    expect(toggleDetail(full, 'fineBrows')).toEqual([
      'freckles',
      'cheekMole',
      'dimples',
      'fineBrows',
    ])
  })

  test('every detail has a Korean label', () => {
    expect(Object.keys(AI_PERSON_LABELS.details)).toEqual([...AI_PERSON_DETAILS])
  })
})

describe('randomChoices', () => {
  test('draws every list but 외모 계열, keeps the details, and gives women no beard', () => {
    const current: AiPersonChoices = {
      ...AI_PERSON_DEFAULTS,
      heritage: 'european',
      details: ['cheekMole'],
    }
    let seed = 0
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }
    for (let i = 0; i < 200; i++) {
      const drawn = randomChoices(current, random)
      expect(drawn.heritage).toBe('european')
      expect(drawn.details).toEqual(['cheekMole'])
      if (drawn.sex === 'female') expect(drawn.facialHair).toBe('none')
      for (const [field, value] of Object.entries(drawn)) {
        if (field === 'details') continue
        expect(AI_PERSON_LABELS[field as keyof typeof AI_PERSON_LABELS]).toHaveProperty(value)
      }
    }
    expect(randomChoices(current, () => 0.999999).sex).toBe('male')
  })
})

describe('the lists', () => {
  test('every hairstyle is offered to either sex, in an order of its own', () => {
    for (const sex of ['female', 'male'] as const) {
      expect([...hairStylesFor(sex)].sort()).toEqual([...AI_PERSON_HAIR_STYLES].sort())
    }
    expect(hairStylesFor('male')[0]).not.toBe(hairStylesFor('female')[0])
  })

  test('every colour has a swatch and every option a Korean label', () => {
    for (const swatches of [SKIN_TONE_SWATCH, HAIR_COLOUR_SWATCH, OUTFIT_COLOUR_SWATCH]) {
      for (const hex of Object.values(swatches)) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(Object.keys(SKIN_TONE_SWATCH)).toEqual(Object.keys(AI_PERSON_LABELS.skinTone))
    expect(Object.keys(HAIR_COLOUR_SWATCH)).toEqual(Object.keys(AI_PERSON_LABELS.hairColour))
    expect(Object.keys(OUTFIT_COLOUR_SWATCH)).toEqual(Object.keys(AI_PERSON_LABELS.outfitColour))
    expect(optionsOf('age', ['20s', '60s'])).toEqual([
      { id: '20s', label: '20대' },
      { id: '60s', label: '60대' },
    ])
  })

  test('each unavailable reason says what to set up, but only in development', () => {
    const reasons = [
      'disabled',
      'not_configured',
      'no_api_key',
      'moderation_required',
      'service_not_configured',
      'network',
    ] as const
    for (const reason of reasons) {
      expect(unavailableCopy(reason, true).length).toBeGreaterThan(0)
      // Everyone else reads one plain line, with no server setting named.
      const plain = unavailableCopy(reason, false)
      expect(plain).toHaveLength(1)
      expect(JSON.stringify(plain)).not.toMatch(/AI_|code|\.env/)
    }
    expect(unavailableCopy('no_api_key', false)).toEqual([
      { text: PHOTOREAL_AI_ERROR_TEXT.unavailable },
    ])
    expect(unavailableCopy('no_api_key', true)).toContainEqual({ code: 'AI_PHOTO_API_KEY' })
    expect(unavailableCopy('service_not_configured', true)).toContainEqual({
      code: 'AI_AVATAR_SERVICE',
    })
  })
})

describe('aiPersonView', () => {
  test('asks, then says why it is off or that signing in is needed', () => {
    expect(view({ status: null })).toEqual({ kind: 'loading' })
    expect(
      view({ status: { available: false, reason: 'service_not_configured', part: 'avatar' } }),
    ).toEqual({
      kind: 'unavailable',
      reason: 'service_not_configured',
      retry: false,
    })
    expect(
      view({ status: { available: false, reason: 'network', part: 'portrait' } }),
    ).toMatchObject({ retry: true })
    expect(view({ status: { ...READY, signedIn: false } })).toEqual({
      kind: 'blocked',
      message: PHOTOREAL_AI_ERROR_TEXT.sign_in_required,
    })
  })

  test('the choices: a spent day stops the portrait', () => {
    expect(view()).toEqual({
      kind: 'choose',
      canGenerate: true,
      spent: null,
      portraitsLeft: 5,
    })
    expect(view({ status: { ...READY, portraitsLeft: 0 } })).toMatchObject({
      canGenerate: false,
      spent: PHOTOREAL_AI_DAILY_TEXT.portrait,
    })
  })

  test('a step about a portrait without one falls back to the choices', () => {
    expect(view({ step: { kind: 'review' } }).kind).toBe('choose')
    expect(view({ step: { kind: 'confirm' } }).kind).toBe('choose')
  })

  test('steps in flight and errors show as they are', () => {
    expect(view({ step: { kind: 'generating' } })).toEqual({ kind: 'generating' })
    expect(view({ step: { kind: 'starting' } })).toEqual({ kind: 'starting' })
    const error: AiPersonStep = { kind: 'error', message: 'x', retryAfter: 3, back: 'review' }
    expect(view({ step: error })).toEqual(error)
  })

  test('review and confirm carry the counts left', () => {
    const shown = portrait({ kind: 'checked', issues: [] })
    expect(view({ step: { kind: 'review' }, portrait: shown })).toEqual({
      kind: 'review',
      gate: { ready: true, good: true, issues: [], note: null },
      portraitsLeft: 5,
      avatarsLeft: 2,
    })
    expect(view({ step: { kind: 'confirm' }, portrait: shown })).toEqual({
      kind: 'confirm',
      avatarsLeft: 2,
    })
  })

  test('a job comes first: building, done, or failed with its reason', () => {
    const status = {
      available: false as const,
      reason: 'disabled' as const,
      part: 'portrait' as const,
    }
    expect(view({ job: JOB, status })).toEqual({ kind: 'building', job: JOB })
    const avatar = { id: `${'b'.repeat(16)}-${'c'.repeat(24)}`, gender: 'male' as const }
    expect(
      view({ job: { ...JOB, state: 'done', avatar: { ...avatar, name: 'AI 인물 3' } }, status }),
    ).toEqual({ kind: 'done', name: 'AI 인물 3' })
    expect(view({ job: { ...JOB, state: 'done', avatar: { ...avatar, name: '' } } })).toEqual({
      kind: 'done',
      name: 'AI 인물',
    })
    expect(view({ job: { ...JOB, state: 'failed', error: 'avatar_failed' } })).toEqual({
      kind: 'failed',
      message: AVATAR_JOB_ERROR_TEXT.avatar_failed,
    })
    expect(view({ job: { ...JOB, state: 'failed', error: 'not_found' } })).toEqual({
      kind: 'failed',
      message: PHOTOREAL_AI_ERROR_TEXT.not_found,
    })
    expect(view({ job: { ...JOB, state: 'failed', error: null } })).toEqual({
      kind: 'failed',
      message: AVATAR_JOB_ERROR_TEXT.upstream,
    })
  })
})

describe('portraitGate', () => {
  const context = { mock: false, avatarsLeft: 2, now: NOW }

  test('a good, fresh portrait may go on', () => {
    expect(portraitGate(portrait({ kind: 'checked', issues: [] }), context)).toEqual({
      ready: true,
      good: true,
      issues: [],
      note: null,
    })
  })

  test('waits for the check, and stops on issues, an old portrait or a spent day', () => {
    expect(portraitGate(portrait({ kind: 'checking' }), context).ready).toBe(false)
    const flawed = portraitGate(
      portrait({ kind: 'checked', issues: ['eyes_closed', 'turned'] }),
      context,
    )
    expect(flawed.ready).toBe(false)
    expect(flawed.issues).toEqual(['눈을 감고 있어요.', '얼굴이 정면을 보고 있지 않아요.'])
    expect(
      portraitGate(
        portrait({ kind: 'checked', issues: [] }, NOW - AI_PORTRAIT_TOKEN_TTL_MS),
        context,
      ),
    ).toMatchObject({ ready: false, note: PHOTOREAL_AI_ERROR_TEXT.portrait_expired })
    expect(
      portraitGate(portrait({ kind: 'checked', issues: [] }), { ...context, avatarsLeft: 0 }),
    ).toMatchObject({ ready: false, note: PHOTOREAL_AI_DAILY_TEXT.avatar })
    expect(
      portraitGate({ ...portrait({ kind: 'checked', issues: [] }), used: true }, context),
    ).toMatchObject({ ready: false, note: PHOTOREAL_AI_ERROR_TEXT.portrait_used })
  })

  test('a check that could not run, or the mock figure, does not stop it', () => {
    expect(portraitGate(portrait({ kind: 'unchecked' }), context).ready).toBe(true)
    const mock = portraitGate(portrait({ kind: 'checked', issues: ['no_face'] }), {
      ...context,
      mock: true,
    })
    expect(mock).toMatchObject({
      ready: true,
      good: false,
      issues: ['사진에서 얼굴을 찾지 못했어요.'],
    })
  })
})

describe('progress and refusals', () => {
  test('each stage reads in Korean', () => {
    expect(buildStageText(JOB)).toBe(AVATAR_JOB_STAGE_TEXT.computing)
  })

  test('a spent day reads by the step it was for', () => {
    const spent = { ok: false as const, code: 'rate_limited' as const, scope: 'daily' as const }
    expect(refusalText(spent, 'portrait')).toBe(PHOTOREAL_AI_DAILY_TEXT.portrait)
    expect(refusalText(spent, 'avatar')).toBe(PHOTOREAL_AI_DAILY_TEXT.avatar)
    expect(refusalText({ ok: false, code: 'portrait_used' }, 'avatar')).toBe(
      PHOTOREAL_AI_ERROR_TEXT.portrait_used,
    )
  })

  test('elapsed time in minutes and seconds', () => {
    expect(elapsedText(45_900)).toBe('45초')
    expect(elapsedText(125_000)).toBe('2분 5초')
    expect(elapsedText(-5)).toBe('0초')
  })
})

describe('after a refused portrait', () => {
  test('the choices when they are the cause, else back to the portraits there are', () => {
    expect(backAfter('invalid_request', true)).toBe('choose')
    expect(backAfter('blocked', true)).toBe('choose')
    expect(backAfter('upstream', true)).toBe('review')
    expect(backAfter('rate_limited', false)).toBe('choose')
  })

  test('counts left read in Korean, or not at all when unknown', () => {
    expect(leftText('사진', 3, '장')).toBe('사진 오늘 3장 남음')
    expect(leftText('3D 변환', null, '번')).toBeNull()
  })
})
