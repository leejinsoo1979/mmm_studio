import { type AvatarJob, type AvatarJobEnd, isFinished } from '@/lib/photoreal-ai/avatar-job'
import type {
  PhotorealAiClientStatus,
  PhotorealAiErrorCode,
  PhotorealAiRefusal,
} from '@/lib/photoreal-ai/client'
import { PORTRAIT_ISSUE_TEXT, type PortraitIssue } from '@/lib/photoreal-ai/portrait-check'
import {
  AI_PERSON_AGES,
  AI_PERSON_DETAIL_CONFLICTS,
  AI_PERSON_DETAILS_MAX,
  AI_PERSON_FACE_SHAPES,
  AI_PERSON_FACIAL_HAIR,
  AI_PERSON_HAIR_COLOURS,
  AI_PERSON_IMPRESSIONS,
  AI_PERSON_LABELS,
  AI_PERSON_OUTFIT_COLOURS,
  AI_PERSON_OUTFITS,
  AI_PERSON_SEXES,
  AI_PERSON_SKIN_TONES,
  AI_PORTRAIT_TOKEN_TTL_MS,
  type AiPersonChoices,
  type AiPersonDetail,
  type AiPersonHairColour,
  type AiPersonHairStyle,
  type AiPersonOutfitColour,
  type AiPersonSex,
  type AiPersonSkinTone,
  AVATAR_JOB_ERROR_TEXT,
  AVATAR_JOB_STAGE_TEXT,
  PHOTOREAL_AI_DAILY_TEXT,
  PHOTOREAL_AI_ERROR_TEXT,
  photorealAiErrorText,
} from '@/lib/photoreal-ai/shared'
import type { CopyPart } from './ai-photo-label'

/**
 * The AI 인물 dialog's pure parts: the choices as sent, the swatches, which
 * state it shows (the 3D job first, then the route's status, then the step
 * the player is on), whether a portrait may go on to the paid 3D step, and
 * the progress while it is built.
 */

/** The choices as the route takes them: no facial hair on a woman. */
export function requestChoices(choices: AiPersonChoices): AiPersonChoices {
  return { ...choices, facialHair: choices.sex === 'male' ? choices.facialHair : 'none' }
}

/** The detail's opposite (진한 ↔ 옅은 눈썹, 쌍꺼풀 ↔ 무쌍, 도톰한 ↔ 얇은 입술), if it has one. */
const oppositeOf = (detail: AiPersonDetail) =>
  AI_PERSON_DETAIL_CONFLICTS.find((pair) => pair.includes(detail))?.find((one) => one !== detail)

/**
 * 세부 특징 after a tap: picked again, it is dropped; picking one replaces its
 * opposite; past the cap, nothing changes (the other chips are off then).
 */
export function toggleDetail(
  details: readonly AiPersonDetail[],
  detail: AiPersonDetail,
): AiPersonDetail[] {
  if (details.includes(detail)) return details.filter((one) => one !== detail)
  const opposite = oppositeOf(detail)
  const kept = details.filter((one) => one !== opposite)
  return kept.length >= AI_PERSON_DETAILS_MAX ? [...details] : [...kept, detail]
}

/** Whether a detail chip can be picked now (one picked can always be dropped). */
export const detailOpen = (details: readonly AiPersonDetail[], detail: AiPersonDetail) =>
  details.includes(detail) ||
  details.length < AI_PERSON_DETAILS_MAX ||
  details.includes(oppositeOf(detail) as AiPersonDetail)

/** Any number of random draws in [0, 1). */
type Random = () => number

const pick = <T>(list: readonly T[], random: Random): T =>
  list[Math.min(list.length - 1, Math.floor(random() * list.length))]!

/** 무작위: every list drawn again but 외모 계열 (the player's own call); the 세부 특징 kept as picked. */
export function randomChoices(current: AiPersonChoices, random: Random = Math.random) {
  const sex = pick(AI_PERSON_SEXES, random)
  return {
    sex,
    age: pick(AI_PERSON_AGES, random),
    impression: pick(AI_PERSON_IMPRESSIONS, random),
    faceShape: pick(AI_PERSON_FACE_SHAPES, random),
    skinTone: pick(AI_PERSON_SKIN_TONES, random),
    heritage: current.heritage,
    hairStyle: pick(hairStylesFor(sex), random),
    hairColour: pick(AI_PERSON_HAIR_COLOURS, random),
    facialHair: sex === 'male' ? pick(AI_PERSON_FACIAL_HAIR, random) : 'none',
    outfit: pick(AI_PERSON_OUTFITS, random),
    outfitColour: pick(AI_PERSON_OUTFIT_COLOURS, random),
    details: [...current.details],
  } satisfies AiPersonChoices
}

const SHORT_FIRST: readonly AiPersonHairStyle[] = [
  'crop',
  'twoBlock',
  'dandy',
  'slickBack',
  'buzz',
  'shortCurly',
  'shaved',
  'bob',
  'shoulder',
  'ponytail',
  'longStraight',
  'longWavy',
]
const LONG_FIRST: readonly AiPersonHairStyle[] = [
  'bob',
  'shoulder',
  'longStraight',
  'longWavy',
  'ponytail',
  'shortCurly',
  'crop',
  'twoBlock',
  'dandy',
  'slickBack',
  'buzz',
  'shaved',
]

/** Every style for either sex, the likelier ones first. */
export const hairStylesFor = (sex: AiPersonSex): readonly AiPersonHairStyle[] =>
  sex === 'male' ? SHORT_FIRST : LONG_FIRST

/** The swatch beside each colour's name (the mock portrait draws the same colours). */
export const SKIN_TONE_SWATCH: Record<AiPersonSkinTone, string> = {
  fair: '#f6decd',
  light: '#eac8ac',
  medium: '#d6aa84',
  olive: '#be966c',
  brown: '#966848',
  deep: '#60402c',
}
export const HAIR_COLOUR_SWATCH: Record<AiPersonHairColour, string> = {
  black: '#1c1a1a',
  darkBrown: '#3a281e',
  brown: '#60422c',
  lightBrown: '#96704c',
  blonde: '#d6ba80',
  auburn: '#803a22',
  grey: '#969696',
  white: '#dedede',
}
export const OUTFIT_COLOUR_SWATCH: Record<AiPersonOutfitColour, string> = {
  white: '#f4f4f4',
  black: '#202022',
  grey: '#808080',
  navy: '#222c50',
  beige: '#d2c0a0',
  khaki: '#8c825a',
  burgundy: '#6e1e2c',
  skyBlue: '#96c4e6',
}

/** A field's choices as the dialog lists them. */
export function optionsOf<K extends Exclude<keyof AiPersonChoices, 'details'>>(
  field: K,
  order: readonly AiPersonChoices[K][],
): { id: AiPersonChoices[K]; label: string }[] {
  const labels = AI_PERSON_LABELS[field] as Record<AiPersonChoices[K], string>
  return order.map((id) => ({ id, label: labels[id] }))
}

export type AiPersonUnavailableReason = Extract<
  PhotorealAiClientStatus,
  { available: false }
>['reason']

const t = (text: string): CopyPart => ({ text })
const c = (code: string): CopyPart => ({ code })

/**
 * Why AI 인물 is off. Only a development build names what to set up (the
 * server's settings); everyone else is told plainly that it is not available.
 */
export function unavailableCopy(reason: AiPersonUnavailableReason, setup: boolean): CopyPart[] {
  if (reason === 'network') return [t('AI 인물 서버에 연결하지 못했어요.')]
  if (!setup) return [t(PHOTOREAL_AI_ERROR_TEXT.unavailable)]
  switch (reason) {
    case 'disabled':
      return [t('관리자가 AI 인물 만들기를 꺼 두었어요.')]
    case 'not_configured':
    case 'no_api_key':
      return [
        t('AI 인물 사진은 AI 실사 사진과 같은 이미지 서비스를 써요. 서버 환경 변수 '),
        c('AI_PHOTO_PROVIDER'),
        t(', '),
        c('AI_PHOTO_MODEL'),
        t(', '),
        c('AI_PHOTO_API_KEY'),
        t('를 넣고 다시 시작해 주세요. 자세한 설명은 '),
        c('.env.example'),
        t('에 있어요.'),
      ]
    case 'moderation_required':
      return [
        t('이 설정에서는 이미지 검사 모델('),
        c('AI_PHOTO_MODERATION_MODEL'),
        t(')이 함께 필요해요.'),
      ]
    case 'service_not_configured':
      return [
        t('사진을 3D 아바타로 바꾸는 서비스 설정이 필요해요. 서버 환경 변수 '),
        c('AI_AVATAR_SERVICE'),
        t(', '),
        c('AI_AVATAR_CLIENT_ID'),
        t(', '),
        c('AI_AVATAR_CLIENT_SECRET'),
        t('를 넣고 다시 시작해 주세요. 개발 서버에서는 '),
        c('AI_AVATAR_MOCK=true'),
        t('로 목업을 쓸 수 있어요. 자세한 설명은 '),
        c('.env.example'),
        t('에 있어요.'),
      ]
  }
}

/** Whether the portrait suits the 3D service, as far as the browser could tell. */
export type PortraitCheck =
  | { kind: 'checking' }
  | { kind: 'checked'; issues: PortraitIssue[] }
  /** The face finder could not run (it is a convenience, not a gate on safety). */
  | { kind: 'unchecked' }

/** A portrait made in this dialog: the server's bytes as they came and the token signed for them. */
export type Portrait = {
  /** The image, as an object URL of `blob`. */
  url: string
  blob: Blob
  token: string
  madeAt: number
  check: PortraitCheck
  /** A 3D avatar was asked for with it: the server takes each portrait once. */
  used?: boolean
}

/** Where the player is in the dialog, apart from the job (which outlives it). */
export type AiPersonStep =
  | { kind: 'choose' }
  | { kind: 'generating' }
  | { kind: 'review' }
  | { kind: 'confirm' }
  | { kind: 'starting' }
  | { kind: 'error'; message: string; retryAfter: number | null; back: 'choose' | 'review' }

export const portraitExpired = (portrait: Portrait, now: number) =>
  now - portrait.madeAt >= AI_PORTRAIT_TOKEN_TTL_MS

/** Whether the portrait may go on to the 3D step, and what to say about it. */
export type PortraitGate = {
  ready: boolean
  /** The face check passed. */
  good: boolean
  /** What is wrong with the photo for a 3D avatar. */
  issues: string[]
  /** One line on why it can't go on, or on how far it was checked. */
  note: string | null
}

export function portraitGate(
  portrait: Portrait,
  context: { mock: boolean; avatarsLeft: number | null; now: number },
): PortraitGate {
  const { check } = portrait
  const issues = check.kind === 'checked' ? check.issues.map((id) => PORTRAIT_ISSUE_TEXT[id]) : []
  const good = check.kind === 'checked' && check.issues.length === 0
  const stop = (note: string): PortraitGate => ({ ready: false, good, issues, note })
  if (portrait.used) return stop(PHOTOREAL_AI_ERROR_TEXT.portrait_used)
  if (portraitExpired(portrait, context.now)) {
    return stop(PHOTOREAL_AI_ERROR_TEXT.portrait_expired)
  }
  if (context.avatarsLeft === 0) return stop(PHOTOREAL_AI_DAILY_TEXT.avatar)
  if (check.kind === 'checking') return stop('3D로 만들기 좋은 사진인지 확인하고 있어요…')
  if (check.kind === 'unchecked') {
    return { ready: true, good, issues, note: '사진을 확인하지 못했어요. 그대로 만들 수는 있어요.' }
  }
  if (issues.length > 0) {
    // The drawn mock figure has no face to find: its issues are only shown.
    if (context.mock)
      return { ready: true, good, issues, note: '목업 사진이라 검사 결과는 참고만 해요.' }
    return stop('3D 아바타가 잘 나오지 않을 사진이에요. 다시 만들어 주세요.')
  }
  return { ready: true, good, issues, note: null }
}

export type AiPersonView =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: AiPersonUnavailableReason; retry: boolean }
  | { kind: 'blocked'; message: string }
  | {
      kind: 'choose'
      canGenerate: boolean
      /** The day's portraits are spent. */
      spent: string | null
      portraitsLeft: number | null
    }
  | { kind: 'generating' }
  | {
      kind: 'review'
      gate: PortraitGate
      portraitsLeft: number | null
      avatarsLeft: number | null
    }
  | { kind: 'confirm'; avatarsLeft: number | null }
  | { kind: 'starting' }
  | { kind: 'error'; message: string; retryAfter: number | null; back: 'choose' | 'review' }
  | { kind: 'building'; job: AvatarJob }
  | { kind: 'done'; name: string }
  | { kind: 'failed'; message: string }

/**
 * What the dialog shows. A 3D job comes first (it runs on with the dialog
 * closed, one at a time), then the route's status (null while asking), then
 * the step; a step about a portrait falls back to the choices without one.
 */
export function aiPersonView(input: {
  status: PhotorealAiClientStatus | null
  job: AvatarJob | null
  step: AiPersonStep
  portrait: Portrait | null
  now: number
}): AiPersonView {
  const { status, job, step, portrait, now } = input
  if (job) {
    if (!isFinished(job)) return { kind: 'building', job }
    if (job.state === 'done' && job.avatar) {
      return { kind: 'done', name: job.avatar.name || 'AI 인물' }
    }
    return { kind: 'failed', message: jobEndText(job.error ?? 'upstream') }
  }
  if (!status) return { kind: 'loading' }
  if (!status.available) {
    return { kind: 'unavailable', reason: status.reason, retry: status.reason === 'network' }
  }
  if (!status.signedIn) {
    return { kind: 'blocked', message: PHOTOREAL_AI_ERROR_TEXT.sign_in_required }
  }
  const { portraitsLeft, avatarsLeft, mock } = status
  switch (step.kind) {
    case 'generating':
    case 'starting':
      return { kind: step.kind }
    case 'error':
      return step
    case 'review':
    case 'confirm':
      if (!portrait) break
      if (step.kind === 'confirm') return { kind: 'confirm', avatarsLeft }
      return {
        kind: 'review',
        gate: portraitGate(portrait, { mock, avatarsLeft, now }),
        portraitsLeft,
        avatarsLeft,
      }
  }
  const spent = portraitsLeft === 0 ? PHOTOREAL_AI_DAILY_TEXT.portrait : null
  return { kind: 'choose', canGenerate: spent === null, spent, portraitsLeft }
}

/** How far the portrait bar is after `seconds`: eases towards 90% (most answers take 15–60 s). */
export const portraitProgressAt = (seconds: number) =>
  0.9 * (1 - Math.exp(-Math.max(0, seconds) / 25))

/** Why a 3D job ended without an avatar, in Korean. */
export const jobEndText = (end: AvatarJobEnd) =>
  end === 'not_found' || end === 'sign_in_required'
    ? PHOTOREAL_AI_ERROR_TEXT[end]
    : AVATAR_JOB_ERROR_TEXT[end]

/** What to tell the player about a refused request, by the step it was for. */
export const refusalText = (refusal: PhotorealAiRefusal, step: 'portrait' | 'avatar') =>
  photorealAiErrorText(refusal.code, { scope: refusal.scope, step })

export const buildStageText = (job: AvatarJob) => AVATAR_JOB_STAGE_TEXT[job.stage]

/** 2분 5초, 45초. */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}분 ${seconds % 60}초` : `${seconds}초`
}

/** How many more the day allows (사진 오늘 3장 남음), when the server said. */
export const leftText = (what: string, left: number | null, unit: string) =>
  left === null ? null : `${what} 오늘 ${left}${unit} 남음`

const CHOICE_FAULTS: ReadonlySet<PhotorealAiErrorCode> = new Set<PhotorealAiErrorCode>([
  'blocked',
  'invalid_request',
])

/** Where a refused portrait sends the player: to the choices when they are the cause, else back. */
export const backAfter = (
  code: PhotorealAiErrorCode,
  hasPortraits: boolean,
): 'choose' | 'review' => (CHOICE_FAULTS.has(code) || !hasPortraits ? 'choose' : 'review')
