import { isAbsolute, join } from 'node:path'
import {
  type AiPhotoConfig,
  type AiPhotoExtraParams,
  parseExtraParams,
  readAiPhotoConfig,
} from '../ai-photo/config'
import { isLocalBaseUrl } from '../npc-ai/config'
import type { PhotorealAiUnavailableReason } from './shared'

/**
 * AI 인물 settings, from the server's environment only (never
 * `NEXT_PUBLIC_`). The portrait reuses the AI 실사 사진 image API
 * (`AI_PHOTO_PROVIDER/BASE_URL/API_KEY/MODEL` and its moderation settings)
 * with its own extra params and caps, and is needed. The 3D step uses the
 * paid avatar service when its keys (`AI_AVATAR_CLIENT_ID/SECRET`) are set;
 * without them the browser makes the avatar from the portrait itself (the
 * photo avatar pipeline) and its turned views, so a portrait is never paid
 * for nothing, and the feature is on only with `AI_AVATAR_ENABLED=true`.
 * Broken settings fail closed.
 *
 * `AI_AVATAR_MOCK=true` runs the whole flow with no external call (a drawn
 * portrait, and the avatar service's protocol answered in-process): ignored
 * when `NODE_ENV` is `production`. With `AI_AVATAR_MOCK_SERVICE=false` it
 * has no 3D service, as a setup with no service keys: the browser makes the
 * avatar from the portrait and its turned views (local files beside
 * `AI_AVATAR_MOCK_PORTRAIT`).
 *
 * A build already started is carried to its end, and the service's copy
 * deleted, with `readJobService` alone: switching the feature off, or the
 * portrait part breaking, must not leave a paid build or a photo behind.
 */

/** The 3D avatar service: Avatar SDK's MetaPerson cloud API (one frontal photo in, rigged GLB out). */
export type AvatarServiceConfig = {
  kind: 'metaperson'
  /** No trailing slash. */
  baseUrl: string
  clientId: string
  clientSecret: string
  /** A player registered once (see the check script); null registers one and keeps it in the store. */
  playerUid: string | null
  /**
   * `AI_AVATAR_REQUIRE_AGE_CHECK=true`: a build whose `model_info` carries no
   * age is refused (turn on once the check script shows the service returns it).
   */
  requireAgeCheck: boolean
}

export type PhotorealAiLimits = { userDaily: number; globalDaily: number }

export type PhotorealAiConfig = {
  mock: boolean
  /** The portrait's image API; null in the 목업. */
  image: AiPhotoConfig | null
  /** `AI_AVATAR_PORTRAIT_EXTRA_PARAMS`. */
  portraitExtraParams: AiPhotoExtraParams
  portraitLimits: PhotorealAiLimits
  /**
   * The turned views of a portrait (both ¾ views and both profiles: four pictures a set), each
   * set counted once against these.
   */
  viewLimits: PhotorealAiLimits
  /** The paid 3D service; null when its keys are not set (the browser makes the avatar). */
  service: AvatarServiceConfig | null
  avatarLimits: PhotorealAiLimits
  /** Where finished avatars, their portraits and job records live (absolute). */
  storeDir: string
  /** 목업 only: a local image used as the portrait (else one is drawn). */
  mockPortraitPath: string | null
  /** 목업 only: the GLB the fake service hands back. */
  mockGlbPath: string | null
}

type Env = Record<string, string | undefined>

export const METAPERSON_BASE_URL = 'https://api.avatarsdk.com'
const DEFAULT_PORTRAIT_DAILY = 100
const DEFAULT_PORTRAIT_USER_DAILY = 8
const DEFAULT_VIEWS_DAILY = 25
const DEFAULT_VIEWS_USER_DAILY = 4
const DEFAULT_AVATAR_DAILY = 10
const DEFAULT_AVATAR_USER_DAILY = 2
/** apps/editor/data is ignored by git. */
const DEFAULT_STORE = join('data', 'photoreal-ai')
/** The 목업's avatar when `AI_AVATAR_MOCK_GLB` is unset: the shipped CC0 실사 character. */
const MOCK_GLB = join('public', 'characters', 'photoreal', 'makehuman-female-01.glb')

/** The 목업's service settings: the in-process fake checks they are sent, nothing else. */
const MOCK_SERVICE: AvatarServiceConfig = {
  kind: 'metaperson',
  baseUrl: METAPERSON_BASE_URL,
  clientId: 'mock-client',
  clientSecret: 'mock-secret',
  playerUid: null,
  requireAgeCheck: true,
}

const value = (env: Env, key: string) => env[key]?.trim() || undefined

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** https, or http on this machine (a local stand-in); no trailing slash. */
function serviceUrl(raw: string | undefined): string | null {
  const url = (raw ?? METAPERSON_BASE_URL).replace(/\/+$/, '')
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || (protocol === 'http:' && isLocalBaseUrl(url)) ? url : null
  } catch {
    return null
  }
}

/** The avatar service takes JPEG or PNG only, so a portrait asked for as WebP is refused here. */
function portraitParams(raw: string | undefined): AiPhotoExtraParams | null {
  const params = parseExtraParams(raw)
  if (!params) return null
  for (const [key, item] of Object.entries(params)) {
    const name = key.toLowerCase().replaceAll('_', '')
    if ((name === 'outputformat' || name === 'outputmimetype') && /webp/i.test(String(item))) {
      return null
    }
  }
  return params
}

/** The service's keys: neither set means no paid service (not a broken one). */
const serviceKeysSet = (env: Env) =>
  Boolean(value(env, 'AI_AVATAR_CLIENT_ID') || value(env, 'AI_AVATAR_CLIENT_SECRET'))

function readService(env: Env): AvatarServiceConfig | null {
  const kind = value(env, 'AI_AVATAR_SERVICE') ?? 'metaperson'
  const clientId = value(env, 'AI_AVATAR_CLIENT_ID')
  const clientSecret = value(env, 'AI_AVATAR_CLIENT_SECRET')
  const baseUrl = serviceUrl(value(env, 'AI_AVATAR_BASE_URL'))
  if (kind !== 'metaperson' || !clientId || !clientSecret || !baseUrl) return null
  return {
    kind,
    baseUrl,
    clientId,
    clientSecret,
    playerUid: value(env, 'AI_AVATAR_PLAYER_UID') ?? null,
    requireAgeCheck: value(env, 'AI_AVATAR_REQUIRE_AGE_CHECK') === 'true',
  }
}

/** The development 목업 is on (never in production). */
export function photorealAiMockOn(env: Env = process.env): boolean {
  return value(env, 'AI_AVATAR_MOCK') === 'true' && env.NODE_ENV !== 'production'
}

/** The 목업's GLB: `AI_AVATAR_MOCK_GLB`, else the shipped CC0 실사 character. */
const mockGlbOf = (env: Env, cwd: string) => value(env, 'AI_AVATAR_MOCK_GLB') ?? join(cwd, MOCK_GLB)

export type JobServiceConfig = {
  mock: boolean
  service: AvatarServiceConfig
  mockGlbPath: string | null
}

/**
 * The service a started build (made in the 목업 or not) is carried on with,
 * whatever `AI_AVATAR_ENABLED` and the portrait settings say now; null when
 * it can't be reached any more (the keys removed, or a 목업 build in production).
 */
export function readJobService(env: Env, cwd: string, mock: boolean): JobServiceConfig | null {
  if (mock) {
    if (env.NODE_ENV === 'production') return null
    return { mock: true, service: MOCK_SERVICE, mockGlbPath: mockGlbOf(env, cwd) }
  }
  const service = readService(env)
  return service ? { mock: false, service, mockGlbPath: null } : null
}

/** The store folder (absolute): `AI_AVATAR_STORE_DIR`, or apps/editor/data/photoreal-ai. */
export function photorealAiStoreDir(env: Env = process.env, cwd: string = process.cwd()): string {
  const store = value(env, 'AI_AVATAR_STORE_DIR') ?? DEFAULT_STORE
  return isAbsolute(store) ? store : join(cwd, store)
}

export type PhotorealAiConfigResult =
  | { ok: true; config: PhotorealAiConfig }
  | { ok: false; reason: PhotorealAiUnavailableReason; part: 'portrait' | 'avatar' }

export function readPhotorealAiConfig(
  env: Env = process.env,
  cwd: string = process.cwd(),
): PhotorealAiConfigResult {
  if (value(env, 'AI_AVATAR_ENABLED') === 'false') {
    return { ok: false, reason: 'disabled', part: 'portrait' }
  }
  const mock = photorealAiMockOn(env)
  const portraitExtraParams = portraitParams(value(env, 'AI_AVATAR_PORTRAIT_EXTRA_PARAMS'))
  if (!portraitExtraParams) return { ok: false, reason: 'not_configured', part: 'portrait' }

  let image: AiPhotoConfig | null = null
  // `AI_AVATAR_MOCK_SERVICE=false`: the 목업 as with no paid service, the browser making the avatar.
  let service: AvatarServiceConfig | null =
    value(env, 'AI_AVATAR_MOCK_SERVICE') === 'false' ? null : MOCK_SERVICE
  if (!mock) {
    // No face photo is ever sent here, so AI 실사 사진's face switch must not turn this off.
    const photo = readAiPhotoConfig({ ...env, AI_PHOTO_FACE_ENABLED: undefined })
    if (!photo.ok) return { ok: false, reason: photo.reason, part: 'portrait' }
    image = photo.config
    service = readService(env)
    if (!service && serviceKeysSet(env)) {
      return { ok: false, reason: 'service_not_configured', part: 'avatar' }
    }
    // With no paid service its pictures are all it costs, on the AI 실사 사진 key: a deployment
    // set up for AI 실사 사진 alone must not start paying for them unasked.
    if (!service && value(env, 'AI_AVATAR_ENABLED') !== 'true') {
      return { ok: false, reason: 'not_enabled', part: 'portrait' }
    }
  }

  return {
    ok: true,
    config: {
      mock,
      image,
      portraitExtraParams,
      portraitLimits: {
        userDaily: positiveInt(
          value(env, 'AI_AVATAR_PORTRAIT_USER_DAILY_LIMIT'),
          DEFAULT_PORTRAIT_USER_DAILY,
        ),
        globalDaily: positiveInt(
          value(env, 'AI_AVATAR_PORTRAIT_DAILY_LIMIT'),
          DEFAULT_PORTRAIT_DAILY,
        ),
      },
      viewLimits: {
        userDaily: positiveInt(
          value(env, 'AI_AVATAR_VIEWS_USER_DAILY_LIMIT'),
          DEFAULT_VIEWS_USER_DAILY,
        ),
        globalDaily: positiveInt(value(env, 'AI_AVATAR_VIEWS_DAILY_LIMIT'), DEFAULT_VIEWS_DAILY),
      },
      service,
      avatarLimits: {
        userDaily: positiveInt(value(env, 'AI_AVATAR_USER_DAILY_LIMIT'), DEFAULT_AVATAR_USER_DAILY),
        globalDaily: positiveInt(value(env, 'AI_AVATAR_DAILY_LIMIT'), DEFAULT_AVATAR_DAILY),
      },
      storeDir: photorealAiStoreDir(env, cwd),
      mockPortraitPath: mock ? (value(env, 'AI_AVATAR_MOCK_PORTRAIT') ?? null) : null,
      mockGlbPath: mock ? mockGlbOf(env, cwd) : null,
    },
  }
}
