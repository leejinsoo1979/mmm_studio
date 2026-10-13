import { getStudioAuthHeaders } from '../auth-client'
import {
  AI_PORTRAIT_MAX_BYTES,
  AI_PORTRAIT_TOKEN_HEADER,
  type AiPersonChoices,
  type AvatarJobError,
  type AvatarJobStage,
  PHOTOREAL_AI_REMAINING_HEADER,
  type PhotorealAiAvatar,
  type PhotorealAiLimitScope,
  type PhotorealAiRouteError,
  type PhotorealAiStatus,
  type PhotorealAiUnavailableReason,
} from './shared'

/**
 * The browser side of AI 인물 (`/api/photoreal-ai`): whether it is on (cached
 * for a minute), one portrait from the choices (its bytes and the signed
 * token the 3D step needs with them), the 3D job started from that portrait,
 * the job as it stands, and the user's finished AI 인물. Never throws.
 */

/** The status answers from the environment only: asked again after this long. */
export const PHOTOREAL_AI_STATUS_TTL_MS = 60_000

const ROUTE = '/api/photoreal-ai'

export type PhotorealAiClientStatus =
  | PhotorealAiStatus
  | { available: false; reason: 'network'; part: 'portrait' }

export type PhotorealAiErrorCode = PhotorealAiRouteError | 'network' | 'aborted'

export type PhotorealAiRefusal = {
  ok: false
  code: PhotorealAiErrorCode
  retryAfter?: number
  scope?: PhotorealAiLimitScope
}

export type AiPortraitResult =
  | {
      ok: true
      /** The image as the server made it: sent back unchanged with `token` for the 3D step. */
      image: Blob
      token: string
      portraitsLeft: number | null
    }
  | PhotorealAiRefusal

/** A 3D job as the server reports it (`AvatarJobView`), read defensively. */
export type AvatarJobReport = {
  jobId: string
  state: 'working' | 'done' | 'failed'
  stage: AvatarJobStage
  /** 0–100. */
  progress: number
  /** Once done: the new AI 인물. */
  avatar: { id: string; gender: 'male' | 'female'; name: string } | null
  error: AvatarJobError | null
}

export type AiAvatarStartResult =
  | { ok: true; job: AvatarJobReport; avatarsLeft: number | null }
  | PhotorealAiRefusal

/**
 * Why a look at a job learnt nothing. None is final: the build goes on at
 * the server whoever watches it, so the job is asked about again (with a
 * longer wait) until it ends or runs past `AVATAR_JOB_MAX_MS`. A refused
 * sign-in or an unknown job is often passing too: Firebase not yet restored
 * after a reload, or a token check that failed once.
 */
export type AvatarJobMiss = 'unreachable' | 'not_found' | 'sign_in_required'

export type AvatarJobAnswer =
  | { ok: true; job: AvatarJobReport }
  | { ok: false; miss: AvatarJobMiss }

export type PhotorealAiClientDeps = {
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  /** Request headers naming the signed-in user (the Firebase ID token). */
  headers?: () => Promise<Record<string, string>>
  now?: () => number
}

const ROUTE_ERRORS: ReadonlySet<string> = new Set<PhotorealAiRouteError>([
  'invalid_request',
  'sign_in_required',
  'too_large',
  'unsupported_type',
  'blocked',
  'rate_limited',
  'busy',
  'upstream',
  'unavailable',
  'timeout',
  'portrait_invalid',
  'portrait_expired',
  'portrait_used',
  'too_many_avatars',
  'not_found',
])

const UNAVAILABLE_REASONS: ReadonlySet<string> = new Set<PhotorealAiUnavailableReason>([
  'disabled',
  'not_enabled',
  'not_configured',
  'no_api_key',
  'moderation_required',
  'service_not_configured',
])

const STAGES: ReadonlySet<string> = new Set<AvatarJobStage>([
  'uploading',
  'queued',
  'computing',
  'exporting',
  'downloading',
  'saving',
  'done',
  'failed',
])

const JOB_ERRORS: ReadonlySet<string> = new Set<AvatarJobError>([
  'avatar_failed',
  'blocked',
  'invalid_model',
  'timeout',
  'upstream',
  'unavailable',
])

/** The server's job and avatar ids (lib/photoreal-ai/store.ts). */
const JOB_ID = /^[0-9a-f]{24}$/
const AVATAR_ID = /^[0-9a-f]{16}-[0-9a-f]{24}$/

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null

function headerCount(response: Response): number | null {
  const value = Number.parseInt(response.headers.get(PHOTOREAL_AI_REMAINING_HEADER) ?? '', 10)
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function readStatus(value: unknown): PhotorealAiClientStatus {
  const status = (value ?? {}) as Record<string, unknown>
  if (status.available === true) {
    return {
      available: true,
      mock: status.mock === true,
      signedIn: status.signedIn === true,
      portraitsLeft: count(status.portraitsLeft),
      avatarsLeft: count(status.avatarsLeft),
      avatarService: status.avatarService === true,
      notice: typeof status.notice === 'string' ? status.notice : '',
    }
  }
  const reason =
    typeof status.reason === 'string' && UNAVAILABLE_REASONS.has(status.reason)
      ? (status.reason as PhotorealAiUnavailableReason)
      : 'not_configured'
  return { available: false, reason, part: status.part === 'avatar' ? 'avatar' : 'portrait' }
}

/** Our code for a refused request: the route's own, else by HTTP status (the API guard's refusals). */
function refusalCode(status: number, error: unknown): PhotorealAiRouteError {
  if (typeof error === 'string' && ROUTE_ERRORS.has(error)) return error as PhotorealAiRouteError
  if (status === 429) return 'rate_limited'
  if (status === 504) return 'timeout'
  if (status === 404) return 'not_found'
  if (status === 413) return 'too_large'
  if (status === 401 || status === 403 || status === 503) return 'unavailable'
  if (status === 400) return 'invalid_request'
  return 'upstream'
}

async function refusal(response: Response): Promise<PhotorealAiRefusal> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown
    retryAfter?: unknown
    scope?: unknown
  } | null
  const header = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
  const retryAfter =
    typeof body?.retryAfter === 'number' && body.retryAfter > 0
      ? Math.ceil(body.retryAfter)
      : header > 0
        ? header
        : undefined
  const scope =
    body?.scope === 'burst' || body?.scope === 'daily' || body?.scope === 'global'
      ? body.scope
      : undefined
  return {
    ok: false,
    code: refusalCode(response.status, body?.error),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(scope ? { scope } : {}),
  }
}

function readAvatar(value: unknown): AvatarJobReport['avatar'] {
  const avatar = (value ?? {}) as Partial<PhotorealAiAvatar>
  if (typeof avatar.id !== 'string' || !AVATAR_ID.test(avatar.id)) return null
  if (avatar.gender !== 'male' && avatar.gender !== 'female') return null
  return {
    id: avatar.id,
    gender: avatar.gender,
    name: typeof avatar.name === 'string' ? avatar.name.slice(0, 40) : '',
  }
}

/** A job view as sent, or null when it is not one. */
export function readJobReport(value: unknown): AvatarJobReport | null {
  const view = (value ?? {}) as Record<string, unknown>
  if (typeof view.job !== 'string' || !JOB_ID.test(view.job)) return null
  const { state } = view
  if (state !== 'working' && state !== 'done' && state !== 'failed') return null
  const stage =
    typeof view.stage === 'string' && STAGES.has(view.stage)
      ? (view.stage as AvatarJobStage)
      : state === 'working'
        ? 'queued'
        : state
  const progress =
    typeof view.progress === 'number' && Number.isFinite(view.progress)
      ? Math.min(100, Math.max(0, view.progress))
      : 0
  const avatar = state === 'done' ? readAvatar(view.avatar) : null
  // A finished job with nothing to show for it has failed.
  if (state === 'done' && !avatar) {
    return {
      jobId: view.job,
      state: 'failed',
      stage: 'failed',
      progress,
      avatar: null,
      error: 'upstream',
    }
  }
  const error =
    state === 'failed'
      ? typeof view.error === 'string' && JOB_ERRORS.has(view.error)
        ? (view.error as AvatarJobError)
        : 'upstream'
      : null
  return { jobId: view.job, state, stage, progress, avatar, error }
}

export function createPhotorealAiClient(deps: PhotorealAiClientDeps = {}) {
  const send = deps.fetch ?? ((input, init) => fetch(input, init))
  const headers = deps.headers ?? getStudioAuthHeaders
  const now = deps.now ?? Date.now
  let cached: { at: number; value: Promise<PhotorealAiClientStatus> } | null = null

  return {
    /** `GET /api/photoreal-ai`, cached for a minute; `fresh` asks again (after signing in). */
    status(options: { fresh?: boolean } = {}): Promise<PhotorealAiClientStatus> {
      if (!options.fresh && cached && now() - cached.at < PHOTOREAL_AI_STATUS_TTL_MS) {
        return cached.value
      }
      const at = now()
      const value = (async () => {
        const response = await send(ROUTE, { cache: 'no-store', headers: await headers() })
        if (!response.ok) throw new Error(`photoreal-ai status ${response.status}`)
        return readStatus(await response.json())
      })().catch((): PhotorealAiClientStatus => {
        // Not kept: the next asker tries again.
        if (cached?.at === at) cached = null
        return { available: false, reason: 'network', part: 'portrait' }
      })
      cached = { at, value }
      return value
    },

    /** `POST /api/photoreal-ai/portrait`: the portrait and its token, or why not. */
    async createPortrait(
      choices: AiPersonChoices,
      signal?: AbortSignal,
    ): Promise<AiPortraitResult> {
      const failed = (): AiPortraitResult => ({
        ok: false,
        code: signal?.aborted ? 'aborted' : 'network',
      })
      let response: Response
      try {
        response = await send(`${ROUTE}/portrait`, {
          method: 'POST',
          cache: 'no-store',
          headers: { ...(await headers()), 'content-type': 'application/json' },
          body: JSON.stringify({ choices }),
          signal,
        })
      } catch {
        return failed()
      }
      // The counts changed (or the feature went off): the next status asks again.
      cached = null
      if (!response.ok) return refusal(response)
      const token = response.headers.get(AI_PORTRAIT_TOKEN_HEADER)
      if (!response.headers.get('content-type')?.startsWith('image/') || !token) {
        await response.body?.cancel().catch(() => {})
        return { ok: false, code: 'upstream' }
      }
      let image: Blob
      try {
        image = await response.blob()
      } catch {
        return failed()
      }
      if (image.size === 0 || image.size > AI_PORTRAIT_MAX_BYTES) {
        return { ok: false, code: 'upstream' }
      }
      return { ok: true, image, token, portraitsLeft: headerCount(response) }
    },

    /** `POST /api/photoreal-ai/avatar`: the portrait as it came, with its token, starts a 3D job. */
    async startAvatar(image: Blob, token: string): Promise<AiAvatarStartResult> {
      const form = new FormData()
      form.append('portrait', image, image.type === 'image/png' ? 'portrait.png' : 'portrait.jpg')
      form.append('token', token)
      let response: Response
      try {
        // No Content-Type: the browser writes the multipart boundary.
        response = await send(`${ROUTE}/avatar`, {
          method: 'POST',
          cache: 'no-store',
          headers: await headers(),
          body: form,
        })
      } catch {
        return { ok: false, code: 'network' }
      }
      cached = null
      if (!response.ok) return refusal(response)
      const job = readJobReport(await response.json().catch(() => null))
      if (!job) return { ok: false, code: 'upstream' }
      return { ok: true, job, avatarsLeft: headerCount(response) }
    },

    /** `GET /api/photoreal-ai/avatar/<job>`: asking is what moves the job on. */
    async avatarJob(jobId: string): Promise<AvatarJobAnswer> {
      let response: Response
      try {
        response = await send(`${ROUTE}/avatar/${encodeURIComponent(jobId)}`, {
          cache: 'no-store',
          headers: await headers(),
        })
      } catch {
        return { ok: false, miss: 'unreachable' }
      }
      if (response.status === 404) return { ok: false, miss: 'not_found' }
      if (response.status === 401) return { ok: false, miss: 'sign_in_required' }
      if (!response.ok) return { ok: false, miss: 'unreachable' }
      const job = readJobReport(await response.json().catch(() => null))
      if (job?.state === 'done' || job?.state === 'failed') cached = null
      return job ? { ok: true, job } : { ok: false, miss: 'unreachable' }
    },

    /**
     * `GET /api/photoreal-ai/avatars`: the user's AI 인물, or null when the listing
     * could not be had (signed out, refused or unreachable): not an answer to keep.
     */
    async avatars(): Promise<PhotorealAiAvatar[] | null> {
      try {
        const response = await send(`${ROUTE}/avatars`, {
          cache: 'no-store',
          headers: await headers(),
        })
        if (!response.ok) return null
        const body = (await response.json()) as { avatars?: unknown }
        return Array.isArray(body.avatars) ? (body.avatars as PhotorealAiAvatar[]) : null
      } catch {
        return null
      }
    },

    /** `DELETE /api/photoreal-ai/avatars/<id>`: whether it is gone. */
    async deleteAvatar(id: string): Promise<boolean> {
      try {
        const response = await send(`${ROUTE}/avatars/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          cache: 'no-store',
          headers: await headers(),
        })
        return response.ok
      } catch {
        return false
      }
    },
  }
}

export type PhotorealAiClient = ReturnType<typeof createPhotorealAiClient>

let shared: PhotorealAiClient | null = null

/** The page's client (one status cache for every caller). */
export function photorealAiClient(): PhotorealAiClient {
  shared ??= createPhotorealAiClient()
  return shared
}
