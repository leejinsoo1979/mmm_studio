import { createHash } from 'node:crypto'
import { npcClientIp } from '../npc-ai/rate-limit'
import { readBodyCapped } from '../npc-ai/tts'
import { guardSceneApiRequest, sceneApiJson, withSceneApiHeaders } from '../scene-api-security'
import { type AiPhotoConfig, readAiPhotoConfig } from './config'
import type { AiPhotoImageType } from './image-header'
import { moderateImages } from './moderation'
import { buildAiPhotoPrompt } from './prompt'
import { aiPhotoRequest, readAiPhotoResponse } from './provider'
import { type AiPhotoLimiter, createAiPhotoLimiter } from './rate-limit'
import {
  AI_PHOTO_MAX_BODY_BYTES,
  AI_PHOTO_MAX_IMAGE_BYTES,
  type AiPhotoLimitScope,
  type AiPhotoRouteError,
  type AiPhotoStatus,
} from './shared'
import { type AiPhotoUpload, parseAiPhotoUpload } from './upload'

/**
 * `/api/ai-photo`. `GET` says whether AI photos are available (from the
 * environment only), how many this user has left and what they may send.
 * `POST` takes the studio render (and, where the owner allows it, a face
 * photo the user declared consent for), asks the configured image API for a
 * photorealistic portrait of the same character, and streams the image bytes
 * back. Nothing is stored; the log line carries counts and codes only, never
 * images, prompts or user ids.
 *
 * A failed photo stays counted once the generation request has gone out,
 * unless the provider's answer shows it did no billable work (see
 * `AiPhotoProviderResult.refundable`); the limiter caps refunds per day.
 */

export type AiPhotoUsage = {
  provider: AiPhotoConfig['provider']
  framing: AiPhotoUpload['framing']
  child: boolean
  withFace: boolean
  moderated: boolean
  status: number
  outcome: AiPhotoRouteError | 'ok'
  /** The provider's error code or finish reason, when it gave one. */
  detail?: string
  ms: number
  bytesOut: number
}

export type AiPhotoHandlerDeps = {
  /** The verified user id (Firebase uid), or null when signed out. */
  userId: (request: Request) => Promise<string | null>
  env?: Record<string, string | undefined>
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  limiter?: AiPhotoLimiter
  now?: () => number
  log?: (usage: AiPhotoUsage) => void
  /** Everything after the upload (moderation and generation) must finish within this. */
  timeoutMs?: number
}

type Outcome =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; type: AiPhotoImageType }
  | {
      ok: false
      status: number
      code: AiPhotoRouteError
      /** Give the photo back: nothing was billed, and the request did not cause it. */
      refund: boolean
      retryAfter?: number
      scope?: AiPhotoLimitScope
      detail?: string
    }

const UPSTREAM_TIMEOUT_MS = 150_000
const STREAM_CHUNK = 64 * 1024

const EXTENSION: Record<AiPhotoImageType, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
}

function refuse(
  request: Request,
  status: number,
  code: AiPhotoRouteError,
  extra: Record<string, unknown> = {},
) {
  const response = sceneApiJson(request, { error: code, ...extra }, { status })
  if (typeof extra.retryAfter === 'number') {
    response.headers.set('Retry-After', String(extra.retryAfter))
  }
  return response
}

/** The provider's per-user abuse tag: a hash, so the uid itself never leaves us. */
function userTag(uid: string | null): string | null {
  if (!uid) return null
  return createHash('sha256').update(`mmm-ai-photo:${uid}`).digest('hex').slice(0, 32)
}

function imageStream(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      controller.enqueue(bytes.subarray(offset, offset + STREAM_CHUNK))
      offset += STREAM_CHUNK
    },
  })
}

export function createAiPhotoHandlers(deps: AiPhotoHandlerDeps) {
  const env = deps.env ?? process.env
  const send = deps.fetch ?? ((input, init) => fetch(input, init))
  const limiter = deps.limiter ?? createAiPhotoLimiter()
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((usage: AiPhotoUsage) => console.info('[ai-photo] usage', usage))
  const timeoutMs = deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS

  const limitsOf = (config: AiPhotoConfig) => ({
    userDaily: config.userDailyLimit,
    globalDaily: config.dailyLimit,
  })
  const policyOf = (config: AiPhotoConfig, uid: string | null) => ({
    face: config.faceEnabled && uid !== null,
    child: config.filteredProvider,
  })

  /** Moderation (when configured), generation, and moderation of the result. */
  async function produce(
    config: AiPhotoConfig,
    upload: AiPhotoUpload,
    uid: string | null,
    request: Request,
  ): Promise<Outcome> {
    const deadline = AbortSignal.timeout(timeoutMs)
    const signal = AbortSignal.any([request.signal, deadline])
    // Set as the generation request goes out: from then on the provider may bill.
    let sent = false
    const failed = (detail: string | undefined, refundable = false): Outcome => {
      if (deadline.aborted) {
        return { ok: false, status: 504, code: 'timeout', refund: !sent, detail }
      }
      if (request.signal.aborted) {
        return { ok: false, status: 502, code: 'upstream', refund: !sent, detail: 'client_aborted' }
      }
      return { ok: false, status: 502, code: 'upstream', refund: !sent || refundable, detail }
    }
    const blocked = (detail: string | undefined): Outcome => ({
      ok: false,
      status: 422,
      code: 'blocked',
      refund: false,
      detail,
    })

    const { render, face, framing } = upload
    if (config.moderation) {
      const inputs = face ? [render, face] : [render]
      const verdict = await moderateImages(config.moderation, inputs, { fetch: send, signal })
      if (verdict === 'flagged') return blocked('input_flagged')
      if (verdict === 'error') return failed('moderation')
    }

    const prompt = buildAiPhotoPrompt({
      framing,
      style: upload.style,
      subject: upload.subject,
      withFace: face !== null,
      hints: upload.hints,
    })
    const { url, init } = aiPhotoRequest(config, {
      prompt,
      render,
      face,
      framing,
      user: config.provider === 'openai' ? userTag(uid) : null,
    })
    let response: Response
    try {
      sent = true
      response = await send(url, { ...init, cache: 'no-store', signal })
    } catch {
      // No answer at all: refunded unless it was the deadline or the visitor that cut it off.
      return failed('fetch', true)
    }
    const result = await readAiPhotoResponse(config.provider, response).catch(() => null)
    if (signal.aborted || !result) return failed('read')
    if (!result.ok) {
      if (result.code === 'blocked') return blocked(result.detail)
      if (result.code === 'rate_limited') {
        return {
          ok: false,
          status: 429,
          code: 'rate_limited',
          refund: true,
          retryAfter: result.retryAfter,
          scope: 'burst',
          detail: result.detail,
        }
      }
      return failed(result.detail, result.refundable)
    }

    if (config.moderation) {
      const verdict = await moderateImages(
        config.moderation,
        [{ bytes: result.bytes, type: result.type }],
        { fetch: send, signal },
      )
      if (verdict === 'flagged') return blocked('output_flagged')
      if (verdict === 'error') return failed('moderation')
    }
    return result
  }

  return {
    async status(request: Request): Promise<Response> {
      const guard = guardSceneApiRequest(request)
      if (guard) return guard
      const ai = readAiPhotoConfig(env)
      if (!ai.ok) {
        const body: AiPhotoStatus = { available: false, reason: ai.reason }
        return sceneApiJson(request, body)
      }
      const uid = await deps.userId(request)
      const usable = uid !== null || ai.config.allowAnonymous
      const userKey = uid ? `uid:${uid}` : `ip:${npcClientIp(request)}`
      const policy = policyOf(ai.config, uid)
      const body: AiPhotoStatus = {
        available: true,
        signInRequired: !ai.config.allowAnonymous,
        signedIn: uid !== null,
        remainingToday: usable ? limiter.remaining(userKey, !uid, limitsOf(ai.config)) : null,
        maxImageBytes: AI_PHOTO_MAX_IMAGE_BYTES,
        faceAllowed: policy.face,
        childAllowed: policy.child,
      }
      return sceneApiJson(request, body)
    },

    async generate(request: Request): Promise<Response> {
      const started = now()
      const guard = guardSceneApiRequest(request)
      if (guard) return guard
      const ai = readAiPhotoConfig(env)
      if (!ai.ok) return refuse(request, 503, 'unavailable', { reason: ai.reason })
      const config = ai.config

      const uid = await deps.userId(request)
      if (!uid && !config.allowAnonymous) return refuse(request, 401, 'sign_in_required')

      const contentType = request.headers.get('content-type') ?? ''
      if (!/^multipart\/form-data\s*;/i.test(contentType)) {
        return refuse(request, 415, 'unsupported_image_type')
      }
      if (Number(request.headers.get('content-length')) > AI_PHOTO_MAX_BODY_BYTES) {
        return refuse(request, 413, 'too_large')
      }
      if (!request.body) return refuse(request, 400, 'invalid_request')
      const body = await readBodyCapped(request.body, AI_PHOTO_MAX_BODY_BYTES).catch(
        () => undefined,
      )
      if (body === undefined) return refuse(request, 400, 'invalid_request')
      if (body === null) return refuse(request, 413, 'too_large')

      const parsed = await parseAiPhotoUpload(body, contentType, policyOf(config, uid))
      if (!parsed.ok) return refuse(request, parsed.status, parsed.code)
      const upload = parsed.upload

      const ip = npcClientIp(request)
      const limit = limiter.take({
        userKey: uid ? `uid:${uid}` : `ip:${ip}`,
        anonymous: !uid,
        ip,
        limits: limitsOf(config),
      })
      if (!limit.ok) {
        if (limit.code === 'busy') return refuse(request, 429, 'busy')
        return refuse(request, 429, 'rate_limited', {
          retryAfter: limit.retryAfter,
          scope: limit.scope,
        })
      }

      let outcome: Outcome | null = null
      try {
        outcome = await produce(config, upload, uid, request)
      } finally {
        limit.release(outcome === null || (!outcome.ok && outcome.refund))
        log({
          provider: config.provider,
          framing: upload.framing,
          child: upload.subject.child,
          withFace: upload.face !== null,
          moderated: config.moderation !== null,
          status: outcome ? (outcome.ok ? 200 : outcome.status) : 500,
          outcome: outcome ? (outcome.ok ? 'ok' : outcome.code) : 'upstream',
          ...(outcome && !outcome.ok && outcome.detail ? { detail: outcome.detail } : {}),
          ms: now() - started,
          bytesOut: outcome?.ok ? outcome.bytes.byteLength : 0,
        })
      }

      if (!outcome.ok) {
        const { status, code, retryAfter, scope } = outcome
        return refuse(request, status, code, {
          ...(retryAfter !== undefined ? { retryAfter } : {}),
          ...(scope ? { scope } : {}),
        })
      }
      return withSceneApiHeaders(
        request,
        new Response(imageStream(outcome.bytes), {
          headers: {
            'Content-Type': outcome.type,
            'Content-Disposition': `inline; filename="ai-photo.${EXTENSION[outcome.type]}"`,
            'Cache-Control': 'no-store',
            'X-AI-Photo-Remaining': String(limit.remainingToday),
          },
        }),
      )
    },
  }
}
