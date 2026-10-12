/**
 * What the AI 인물 routes (`/api/photoreal-ai/*`) and their browser client
 * agree on: the appearance choices (fixed enums with Korean labels; there
 * is no free text, so no name or description reaches the image model), the
 * status, job and avatar shapes, the error codes and their Korean copy, and
 * the AI disclosure. Safe on both sides (no Node or
 * DOM-only APIs).
 *
 * The flow: `POST portrait` makes an AI photo of a fictional adult from the
 * choices and signs it; `POST avatar` sends that signed photo to the 3D
 * avatar service and returns a job; `GET avatar/<job>` advances and reports
 * the job until the finished avatar is saved and listed by `GET avatars`.
 */

export const AI_PERSON_SEXES = ['female', 'male'] as const
export const AI_PERSON_AGES = ['20s', '30s', '40s', '50s', '60s'] as const
export const AI_PERSON_IMPRESSIONS = ['soft', 'sharp', 'calm', 'bright', 'smart', 'strong'] as const
export const AI_PERSON_FACE_SHAPES = ['oval', 'round', 'square', 'slim', 'long'] as const
export const AI_PERSON_SKIN_TONES = ['fair', 'light', 'medium', 'olive', 'brown', 'deep'] as const
export const AI_PERSON_HERITAGES = [
  'eastAsian',
  'southeastAsian',
  'southAsian',
  'european',
  'african',
  'latin',
  'middleEastern',
  'any',
] as const
export const AI_PERSON_HAIR_STYLES = [
  'crop',
  'twoBlock',
  'dandy',
  'bob',
  'shoulder',
  'longStraight',
  'longWavy',
  'ponytail',
  'slickBack',
  'buzz',
  'shaved',
  'shortCurly',
] as const
export const AI_PERSON_HAIR_COLOURS = [
  'black',
  'darkBrown',
  'brown',
  'lightBrown',
  'blonde',
  'auburn',
  'grey',
  'white',
] as const
export const AI_PERSON_FACIAL_HAIR = ['none', 'stubble', 'shortBeard'] as const
export const AI_PERSON_OUTFITS = [
  'tshirt',
  'knit',
  'shirt',
  'suit',
  'blouse',
  'hoodie',
  'sport',
  'workwear',
] as const
export const AI_PERSON_OUTFIT_COLOURS = [
  'white',
  'black',
  'grey',
  'navy',
  'beige',
  'khaki',
  'burgundy',
  'skyBlue',
] as const

/** 세부 특징: up to `AI_PERSON_DETAILS_MAX`, each a fixed phrase in the prompt. */
export const AI_PERSON_DETAILS = [
  'thickBrows',
  'fineBrows',
  'doubleEyelids',
  'monolids',
  'freckles',
  'cheekMole',
  'dimples',
  'highNoseBridge',
  'fullLips',
  'thinLips',
  'angularJaw',
  'highCheekbones',
] as const
export const AI_PERSON_DETAILS_MAX = 4
/** Details that contradict each other: at most one of each pair. */
export const AI_PERSON_DETAIL_CONFLICTS: readonly (readonly [AiPersonDetail, AiPersonDetail])[] = [
  ['thickBrows', 'fineBrows'],
  ['doubleEyelids', 'monolids'],
  ['fullLips', 'thinLips'],
]

export type AiPersonSex = (typeof AI_PERSON_SEXES)[number]
export type AiPersonAge = (typeof AI_PERSON_AGES)[number]
export type AiPersonImpression = (typeof AI_PERSON_IMPRESSIONS)[number]
export type AiPersonFaceShape = (typeof AI_PERSON_FACE_SHAPES)[number]
export type AiPersonSkinTone = (typeof AI_PERSON_SKIN_TONES)[number]
export type AiPersonHeritage = (typeof AI_PERSON_HERITAGES)[number]
export type AiPersonHairStyle = (typeof AI_PERSON_HAIR_STYLES)[number]
export type AiPersonHairColour = (typeof AI_PERSON_HAIR_COLOURS)[number]
export type AiPersonFacialHair = (typeof AI_PERSON_FACIAL_HAIR)[number]
export type AiPersonOutfit = (typeof AI_PERSON_OUTFITS)[number]
export type AiPersonOutfitColour = (typeof AI_PERSON_OUTFIT_COLOURS)[number]
export type AiPersonDetail = (typeof AI_PERSON_DETAILS)[number]

/** The `POST /api/photoreal-ai/portrait` body's `choices`: every field is a fixed choice. */
export type AiPersonChoices = {
  sex: AiPersonSex
  age: AiPersonAge
  impression: AiPersonImpression
  faceShape: AiPersonFaceShape
  skinTone: AiPersonSkinTone
  heritage: AiPersonHeritage
  hairStyle: AiPersonHairStyle
  hairColour: AiPersonHairColour
  /** Men only; ignored for women. */
  facialHair: AiPersonFacialHair
  outfit: AiPersonOutfit
  outfitColour: AiPersonOutfitColour
  /** 세부 특징: distinct, at most `AI_PERSON_DETAILS_MAX`, no conflicting pair. */
  details: AiPersonDetail[]
}

/** Whether a list of details may be sent: distinct, within the cap, no conflicting pair. */
export function detailsAllowed(details: readonly AiPersonDetail[]): boolean {
  if (details.length > AI_PERSON_DETAILS_MAX || new Set(details).size !== details.length) {
    return false
  }
  return AI_PERSON_DETAIL_CONFLICTS.every(([a, b]) => !(details.includes(a) && details.includes(b)))
}

export const AI_PERSON_DEFAULTS: AiPersonChoices = {
  sex: 'female',
  age: '30s',
  impression: 'soft',
  faceShape: 'oval',
  skinTone: 'light',
  heritage: 'eastAsian',
  hairStyle: 'shoulder',
  hairColour: 'darkBrown',
  facialHair: 'none',
  outfit: 'knit',
  outfitColour: 'beige',
  details: [],
}

/** Korean labels, in the order the dialog shows them. */
export const AI_PERSON_LABELS = {
  sex: { female: '여성', male: '남성' },
  age: { '20s': '20대', '30s': '30대', '40s': '40대', '50s': '50대', '60s': '60대' },
  impression: {
    soft: '부드러운',
    sharp: '또렷한',
    calm: '차분한',
    bright: '밝은',
    smart: '지적인',
    strong: '강인한',
  },
  faceShape: {
    oval: '계란형',
    round: '둥근형',
    square: '각진형',
    slim: '갸름한형',
    long: '긴 얼굴형',
  },
  skinTone: {
    fair: '아주 밝은',
    light: '밝은',
    medium: '중간',
    olive: '올리브',
    brown: '갈색',
    deep: '짙은 갈색',
  },
  heritage: {
    eastAsian: '동아시아',
    southeastAsian: '동남아시아',
    southAsian: '남아시아',
    european: '유럽',
    african: '아프리카',
    latin: '중남미',
    middleEastern: '중동',
    any: '지정 안 함',
  },
  hairStyle: {
    crop: '짧은 커트',
    twoBlock: '투블럭',
    dandy: '댄디컷',
    bob: '단발',
    shoulder: '중단발',
    longStraight: '긴 생머리',
    longWavy: '긴 웨이브',
    ponytail: '묶은 머리',
    slickBack: '올백',
    buzz: '아주 짧은 머리',
    shaved: '삭발',
    shortCurly: '짧은 곱슬',
  },
  hairColour: {
    black: '검정',
    darkBrown: '흑갈색',
    brown: '갈색',
    lightBrown: '밝은 갈색',
    blonde: '금발',
    auburn: '적갈색',
    grey: '회색',
    white: '은백색',
  },
  facialHair: { none: '없음', stubble: '짧은 수염', shortBeard: '다듬은 턱수염' },
  outfit: {
    tshirt: '티셔츠',
    knit: '니트',
    shirt: '셔츠',
    suit: '정장',
    blouse: '블라우스',
    hoodie: '후드티',
    sport: '운동복',
    workwear: '작업복',
  },
  outfitColour: {
    white: '흰색',
    black: '검정',
    grey: '회색',
    navy: '네이비',
    beige: '베이지',
    khaki: '카키',
    burgundy: '버건디',
    skyBlue: '하늘색',
  },
  details: {
    thickBrows: '진한 눈썹',
    fineBrows: '옅은 눈썹',
    doubleEyelids: '쌍꺼풀',
    monolids: '무쌍',
    freckles: '주근깨',
    cheekMole: '볼에 점',
    dimples: '보조개',
    highNoseBridge: '높은 콧대',
    fullLips: '도톰한 입술',
    thinLips: '얇은 입술',
    angularJaw: '각진 턱',
    highCheekbones: '도드라진 광대',
  },
} as const satisfies {
  [K in Exclude<keyof AiPersonChoices, 'details'>]: Record<AiPersonChoices[K], string>
} & { details: Record<AiPersonDetail, string> }

/** The portrait the route hands out: at most this many bytes, and a short side of at least `AI_PORTRAIT_MIN_SIDE`. */
export const AI_PORTRAIT_MAX_BYTES = 4_000_000
export const AI_PORTRAIT_MIN_SIDE = 768
/** A signed portrait may be turned into an avatar for this long. */
export const AI_PORTRAIT_TOKEN_TTL_MS = 30 * 60_000

/** A portrait's response header: the signed hand-off the 3D step needs with it. */
export const AI_PORTRAIT_TOKEN_HEADER = 'X-Photoreal-AI-Token'
/** On a portrait (portraits left today) and a started 3D job (builds left today). */
export const PHOTOREAL_AI_REMAINING_HEADER = 'X-Photoreal-AI-Remaining'

/** `moderation_required`: the image setup needs `AI_PHOTO_MODERATION_MODEL` and has none. */
export type PhotorealAiUnavailableReason =
  | 'disabled'
  | 'not_configured'
  | 'no_api_key'
  | 'moderation_required'
  | 'service_not_configured'

/** `GET /api/photoreal-ai`. The remaining counts are this server instance's: a hint. */
export type PhotorealAiStatus =
  | {
      available: true
      /** The development 목업: no image API or 3D service is called. */
      mock: boolean
      signedIn: boolean
      /** Null when signed out. */
      portraitsLeft: number | null
      avatarsLeft: number | null
      notice: string
    }
  | {
      available: false
      reason: PhotorealAiUnavailableReason
      /** Which step is missing: the AI portrait, or the 3D avatar service. */
      part: 'portrait' | 'avatar'
    }

/** The `error` of a refused request to any `/api/photoreal-ai` route. */
export type PhotorealAiRouteError =
  | 'invalid_request'
  | 'sign_in_required'
  | 'too_large'
  | 'unsupported_type'
  | 'blocked'
  | 'rate_limited'
  | 'busy'
  | 'upstream'
  | 'unavailable'
  | 'timeout'
  | 'portrait_invalid'
  | 'portrait_expired'
  | 'portrait_used'
  | 'too_many_avatars'
  | 'not_found'

export type PhotorealAiLimitScope = 'burst' | 'daily' | 'global'

/** Where a 3D avatar job is. */
export type AvatarJobStage =
  | 'uploading'
  | 'queued'
  | 'computing'
  | 'exporting'
  | 'downloading'
  | 'saving'
  | 'done'
  | 'failed'

/** Why a 3D avatar job ended without an avatar. */
export type AvatarJobError =
  | 'avatar_failed'
  | 'blocked'
  | 'invalid_model'
  | 'timeout'
  | 'upstream'
  | 'unavailable'

/** One finished AI avatar, as the 실사 list shows it. */
export type PhotorealAiAvatar = {
  /** `<user key>-<random>`: names the files; knowing it is what lets a page load them. */
  id: string
  /** "AI 인물 1", "AI 인물 2", … (never free text: no real person's name can be attached). */
  name: string
  gender: AiPersonSex
  /** The rigged GLB (`/api/photoreal-ai/avatars/<id>/model.glb`). */
  url: string
  /** The AI portrait it was made from, for the card. */
  thumbnail: string
  createdAt: number
  /** Always true: the card must carry `AI_PERSON_LABEL`. */
  ai: true
  /** "AI 생성 인물 · <service>". */
  credit: string
}

/** `POST /api/photoreal-ai/avatar` (202) and `GET /api/photoreal-ai/avatar/<job>`. */
export type AvatarJobView = {
  job: string
  state: 'working' | 'done' | 'failed'
  stage: AvatarJobStage
  /** 0–100. */
  progress: number
  mock: boolean
  avatar?: PhotorealAiAvatar
  error?: AvatarJobError
}

/** `GET /api/photoreal-ai/avatars`. */
export type PhotorealAiAvatarList = { avatars: PhotorealAiAvatar[] }

/** How often the browser should ask about a job; the server asks the service no more often. */
export const AVATAR_JOB_POLL_MS = 3000

/** Korean copy for each route error; `rate_limited` reads by scope (see `photorealAiErrorText`). */
export const PHOTOREAL_AI_ERROR_TEXT: Record<
  PhotorealAiRouteError | 'network' | 'aborted',
  string
> = {
  invalid_request: '요청을 확인하지 못했어요. 다시 시도해 주세요.',
  sign_in_required: '로그인하면 AI 인물을 만들 수 있어요.',
  too_large: '보낸 내용이 너무 커요. 다시 시도해 주세요.',
  unsupported_type: '요청 형식이 맞지 않아요. 다시 시도해 주세요.',
  blocked: '안전 기준에 맞지 않아 만들 수 없어요. 고른 항목을 바꿔 주세요.',
  rate_limited: '잠시 뒤에 다시 시도해 주세요.',
  busy: '이미 만들고 있어요. 끝나면 다시 시도해 주세요.',
  upstream: 'AI 서비스가 응답하지 않아요. 잠시 뒤 다시 시도해 주세요.',
  unavailable: '지금은 AI 인물을 만들 수 없어요.',
  timeout: '시간이 너무 오래 걸렸어요. 다시 시도해 주세요.',
  portrait_invalid:
    '이 사진으로는 3D 아바타를 만들 수 없어요. 이 화면에서 만든 AI 사진만 쓸 수 있어요.',
  portrait_expired: '사진을 확인할 수 있는 시간이 지났어요. 사진을 다시 만들어 주세요.',
  portrait_used: '이 사진으로는 이미 3D 아바타를 만들었어요.',
  too_many_avatars: 'AI 인물이 너무 많아요. 쓰지 않는 AI 인물을 지운 뒤 다시 만들어 주세요.',
  not_found: '찾을 수 없어요. 처음부터 다시 시도해 주세요.',
  network: '인터넷 연결을 확인하고 다시 시도해 주세요.',
  aborted: '만들기를 취소했어요.',
}

/** Shown when a daily allowance (the user's or the server's) is spent. */
export const PHOTOREAL_AI_DAILY_TEXT = {
  portrait: '오늘 만들 수 있는 인물 사진을 모두 만들었어요. 내일 다시 만들어 주세요.',
  avatar: '오늘 만들 수 있는 3D 아바타를 모두 만들었어요. 내일 다시 만들어 주세요.',
} as const

/** What to tell the user about a refused request. */
export function photorealAiErrorText(
  code: PhotorealAiRouteError | 'network' | 'aborted',
  options: { scope?: PhotorealAiLimitScope; step?: 'portrait' | 'avatar' } = {},
): string {
  if (code === 'rate_limited' && (options.scope === 'daily' || options.scope === 'global')) {
    return PHOTOREAL_AI_DAILY_TEXT[options.step ?? 'portrait']
  }
  return PHOTOREAL_AI_ERROR_TEXT[code]
}

/** Korean copy for each way a 3D job can end without an avatar. */
export const AVATAR_JOB_ERROR_TEXT: Record<AvatarJobError, string> = {
  avatar_failed: '이 사진으로 3D 아바타를 만들지 못했어요. 사진을 다시 만들어 시도해 주세요.',
  blocked: '안전 기준에 맞지 않아 3D 아바타를 만들 수 없어요.',
  invalid_model: '받은 3D 파일이 올바르지 않아요. 다시 시도해 주세요.',
  timeout: '3D 아바타를 만드는 데 시간이 너무 오래 걸렸어요. 다시 시도해 주세요.',
  upstream: '3D 아바타 서비스가 응답하지 않아요. 잠시 뒤 다시 시도해 주세요.',
  unavailable: '지금은 3D 아바타를 만들 수 없어요.',
}

/** The progress line for each stage. */
export const AVATAR_JOB_STAGE_TEXT: Record<AvatarJobStage, string> = {
  uploading: '사진을 보내는 중이에요…',
  queued: '차례를 기다리는 중이에요…',
  computing: '얼굴과 몸을 3D로 만드는 중이에요…',
  exporting: '아바타 파일을 만드는 중이에요…',
  downloading: '아바타를 받는 중이에요…',
  saving: '실사 목록에 넣는 중이에요…',
  done: '3D 아바타가 완성됐어요.',
  failed: '3D 아바타를 만들지 못했어요.',
}

/** The disclosure on the dialog, under every portrait and on every AI avatar card. */
export const AI_PERSON_NOTICE =
  'AI가 새로 만든 가상의 성인 인물이에요. 실제 사람이 아니며, 실존 인물을 닮게 만들 수 없어요.'
export const AI_PERSON_LABEL = 'AI 생성 인물'
