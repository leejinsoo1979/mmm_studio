import { isLocalBaseUrl } from '../npc-ai/config'
import type { AiPhotoUnavailableReason } from './shared'

/**
 * AI photo settings, from the server's environment only (never
 * `NEXT_PUBLIC_`): the owner picks the protocol and model there, and nothing
 * in the repo names a model. Empty values count as unset. A broken optional
 * setting (extra params, moderation) makes the feature unavailable rather
 * than run without it.
 *
 * Safety switches, all failing closed:
 * - `AI_PHOTO_MODERATION_MODEL` (an OpenAI-compatible `/moderations` model)
 *   is required unless `AI_PHOTO_BASE_URL` is a first-party API with its own
 *   safety filters (OpenAI, Azure OpenAI, Gemini, Vertex AI). A gateway or a
 *   self-hosted model may have no filter at all.
 * - Child avatars are refused unless the provider is such a first-party API:
 *   OpenAI's image moderation has no `sexual/minors` category, so only the
 *   provider's own child-safety classifiers cover them.
 * - `AI_PHOTO_FACE_ENABLED=true` lets signed-in users attach a face photo. Off
 *   by default, and it needs moderation. Nothing proves the face is the
 *   user's own, consented, or an adult's, so turn it on only once accounts
 *   carry a server-side 18+ attestation and consent record.
 */

/**
 * `openai`: an OpenAI-compatible image edit API (`POST /images/edits`,
 * multipart). `gemini`: the Gemini API (`models/{model}:generateContent`).
 */
export type AiPhotoProtocol = 'openai' | 'gemini'

/** Model-specific options from `AI_PHOTO_EXTRA_PARAMS`: flat values only. */
export type AiPhotoExtraParams = Record<string, string | number | boolean>

/** An OpenAI-compatible `/moderations` check of the inputs and the result. */
export type AiPhotoModerationConfig = { baseUrl: string; apiKey: string | null; model: string }

export type AiPhotoConfig = {
  provider: AiPhotoProtocol
  /** No trailing slash. */
  baseUrl: string
  /** Null for a local server that needs none. */
  apiKey: string | null
  model: string
  /** openai: extra form fields. gemini: merged into `generationConfig.imageConfig`. */
  extraParams: AiPhotoExtraParams
  /** Photos per UTC day on this server instance. */
  dailyLimit: number
  /** Photos per signed-in user per UTC day. */
  userDailyLimit: number
  /** Signed-out visitors may use it (per IP, with a small daily allowance). */
  allowAnonymous: boolean
  /** Signed-in users may attach a face photo. */
  faceEnabled: boolean
  /** `baseUrl` is a first-party API with its own safety and child-safety filters. */
  filteredProvider: boolean
  /** Required unless `filteredProvider` and no face photos. */
  moderation: AiPhotoModerationConfig | null
}

type Env = Record<string, string | undefined>

const DEFAULT_BASE_URL: Record<AiPhotoProtocol, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}
const DEFAULT_MODERATION_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_DAILY_LIMIT = 200
const DEFAULT_USER_DAILY_LIMIT = 10
const MAX_EXTRA_PARAMS = 16

/** Hosts of first-party APIs that run their own safety filters on every image request. */
const FILTERED_HOSTS = [
  /^api\.openai\.com$/,
  /^[a-z0-9-]+\.openai\.azure\.com$/,
  /^generativelanguage\.googleapis\.com$/,
  /^([a-z0-9-]+-)?aiplatform\.googleapis\.com$/,
]

/**
 * Keys `AI_PHOTO_EXTRA_PARAMS` may not set, compared lowercased without `_`:
 * what the route sends itself, and anything that could loosen safety.
 */
const RESERVED_PARAMS = new Set([
  'model',
  'prompt',
  'image',
  'images',
  'mask',
  'n',
  'size',
  'user',
  'moderation',
  'stream',
  'partialimages',
  'contents',
  'safetysettings',
  'systeminstruction',
  'responsemodalities',
  'candidatecount',
  'aspectratio',
  'persongeneration',
])

const value = (env: Env, key: string) => env[key]?.trim() || undefined

function baseUrl(raw: string | undefined, fallback: string): string | null {
  const url = (raw ?? fallback).replace(/\/+$/, '')
  try {
    return new URL(url).protocol.startsWith('http') ? url : null
  } catch {
    return null
  }
}

function isFilteredProvider(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && FILTERED_HOSTS.some((host) => host.test(hostname))
  } catch {
    return false
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** The parsed `AI_PHOTO_EXTRA_PARAMS`, or null when it is not a flat object of allowed keys. */
export function parseExtraParams(raw: string | undefined): AiPhotoExtraParams | null {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const entries = Object.entries(parsed)
  if (entries.length > MAX_EXTRA_PARAMS) return null
  const params: AiPhotoExtraParams = {}
  for (const [key, item] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) return null
    if (RESERVED_PARAMS.has(key.toLowerCase().replaceAll('_', ''))) return null
    const ok =
      typeof item === 'string'
        ? item.length <= 200
        : typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))
    if (!ok) return null
    params[key] = item as string | number | boolean
  }
  return params
}

function readModeration(
  env: Env,
  main: { baseUrl: string; apiKey: string | null },
): AiPhotoModerationConfig | null | AiPhotoUnavailableReason {
  const model = value(env, 'AI_PHOTO_MODERATION_MODEL')
  if (!model) return null
  const url = baseUrl(value(env, 'AI_PHOTO_MODERATION_BASE_URL'), DEFAULT_MODERATION_BASE_URL)
  if (!url) return 'not_configured'
  // The main key only goes where the main requests go.
  const apiKey =
    value(env, 'AI_PHOTO_MODERATION_API_KEY') ?? (url === main.baseUrl ? main.apiKey : null)
  if (!apiKey && !isLocalBaseUrl(url)) return 'no_api_key'
  return { baseUrl: url, apiKey, model }
}

export function readAiPhotoConfig(
  env: Env = process.env,
): { ok: true; config: AiPhotoConfig } | { ok: false; reason: AiPhotoUnavailableReason } {
  if (value(env, 'AI_PHOTO_ENABLED') === 'false') return { ok: false, reason: 'disabled' }
  const provider = value(env, 'AI_PHOTO_PROVIDER')
  const model = value(env, 'AI_PHOTO_MODEL')
  if ((provider !== 'openai' && provider !== 'gemini') || !model) {
    return { ok: false, reason: 'not_configured' }
  }
  const url = baseUrl(value(env, 'AI_PHOTO_BASE_URL'), DEFAULT_BASE_URL[provider])
  if (!url) return { ok: false, reason: 'not_configured' }
  const apiKey = value(env, 'AI_PHOTO_API_KEY') ?? null
  if (!apiKey && !isLocalBaseUrl(url)) return { ok: false, reason: 'no_api_key' }
  const extraParams = parseExtraParams(value(env, 'AI_PHOTO_EXTRA_PARAMS'))
  if (!extraParams) return { ok: false, reason: 'not_configured' }
  const moderation = readModeration(env, { baseUrl: url, apiKey })
  if (typeof moderation === 'string') return { ok: false, reason: moderation }
  const filteredProvider = isFilteredProvider(url)
  const faceEnabled = value(env, 'AI_PHOTO_FACE_ENABLED') === 'true'
  if (!moderation && (!filteredProvider || faceEnabled)) {
    return { ok: false, reason: 'moderation_required' }
  }
  return {
    ok: true,
    config: {
      provider,
      baseUrl: url,
      apiKey,
      model,
      extraParams,
      dailyLimit: positiveInt(value(env, 'AI_PHOTO_DAILY_LIMIT'), DEFAULT_DAILY_LIMIT),
      userDailyLimit: positiveInt(
        value(env, 'AI_PHOTO_USER_DAILY_LIMIT'),
        DEFAULT_USER_DAILY_LIMIT,
      ),
      allowAnonymous: value(env, 'AI_PHOTO_ALLOW_ANONYMOUS') === 'true',
      faceEnabled,
      filteredProvider,
      moderation,
    },
  }
}
