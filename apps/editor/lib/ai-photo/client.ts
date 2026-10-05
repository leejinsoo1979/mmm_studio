import { getStudioAuthHeaders } from '../auth-client'
import { sniffImage } from './image-header'
import {
  AI_PHOTO_FACE_MAX_SIDE,
  AI_PHOTO_MAX_IMAGE_BYTES,
  type AiPhotoFraming,
  type AiPhotoHints,
  type AiPhotoLimitScope,
  type AiPhotoRouteError,
  type AiPhotoStatus,
  type AiPhotoStyle,
  avatarSubject,
  avatarTakesFace,
} from './shared'

/**
 * The browser side of AI 실사 사진: whether the feature is on (cached for a
 * minute), one photo request as multipart with the visitor's ID token, the
 * studio face photo prepared for upload, and the Korean copy per error.
 */

export {
  AI_PHOTO_SHOTS,
  type AiPhotoFraming,
  type AiPhotoHints,
  type AiPhotoStyle,
  avatarSubject,
  avatarTakesFace,
} from './shared'

/** The route's status answers from the environment only: asked again after this long. */
export const AI_PHOTO_STATUS_TTL_MS = 60_000

export type AiPhotoClientStatus = AiPhotoStatus | { available: false; reason: 'network' }

export type AiPhotoErrorCode = AiPhotoRouteError | 'network' | 'aborted'

export type AiPhotoRequest = {
  /** The studio capture (JPEG or WebP) at `AI_PHOTO_SHOTS[framing]`. */
  render: Blob
  /** A face photo (`facePhotoBlob`), only when the status allows it and `avatarTakesFace`. */
  face?: Blob | null
  /** The user ticked that the face is their own, or that its owner agreed. */
  consent: boolean
  avatarId: string
  framing: AiPhotoFraming
  style?: AiPhotoStyle
  hints?: AiPhotoHints
  signal?: AbortSignal
}

export type AiPhotoResult =
  | {
      ok: true
      /** The provider's bytes as they came (keep them as is when saving: provenance data lives there). */
      image: Blob
      remainingToday: number | null
    }
  | { ok: false; code: AiPhotoErrorCode; retryAfter?: number; scope?: AiPhotoLimitScope }

export type AiPhotoClientDeps = {
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  /** Request headers naming the signed-in user (the Firebase ID token). */
  headers?: () => Promise<Record<string, string>>
  now?: () => number
}

const ROUTE = '/api/ai-photo'
const HEX = /^#[0-9a-f]{6}$/i
const HINT_KEYS = ['hair', 'skin', 'eyes', 'lips'] as const

const ROUTE_ERRORS: ReadonlySet<string> = new Set<AiPhotoRouteError>([
  'invalid_request',
  'consent_required',
  'face_not_allowed',
  'child_not_allowed',
  'sign_in_required',
  'too_large',
  'unsupported_image_type',
  'invalid_image',
  'blocked',
  'rate_limited',
  'busy',
  'upstream',
  'unavailable',
  'timeout',
])

/** Korean copy for each error. `rate_limited` reads by scope: see `aiPhotoErrorText`. */
export const AI_PHOTO_ERROR_TEXT: Record<AiPhotoErrorCode, string> = {
  invalid_request: '사진을 준비하지 못했어요. 다시 시도해 주세요.',
  consent_required: '얼굴 사진 사용 동의에 체크해 주세요.',
  face_not_allowed: '이 캐릭터는 얼굴 사진 없이 만들어요.',
  child_not_allowed: '어린이 캐릭터는 지금 AI 실사 사진을 만들 수 없어요.',
  sign_in_required: '로그인하면 AI 실사 사진을 만들 수 있어요.',
  too_large: '사진이 너무 커요. 다시 시도해 주세요.',
  unsupported_image_type: '사진을 준비하지 못했어요. 다시 시도해 주세요.',
  invalid_image: '사진을 준비하지 못했어요. 다시 시도해 주세요.',
  blocked:
    '안전 기준에 맞지 않아 사진을 만들 수 없어요. 옷차림이나 얼굴 사진을 바꿔 다시 시도해 주세요.',
  rate_limited: '잠시 뒤에 다시 만들어 주세요.',
  busy: '사진을 만드는 중이에요. 끝나면 다시 시도해 주세요.',
  upstream: 'AI 서비스가 응답하지 않아요. 잠시 뒤 다시 시도해 주세요.',
  unavailable: '지금은 AI 실사 사진을 쓸 수 없어요.',
  timeout: '시간이 너무 오래 걸렸어요. 다시 시도해 주세요.',
  network: '인터넷 연결을 확인하고 다시 시도해 주세요.',
  aborted: '사진 만들기를 취소했어요.',
}

const DAILY_TEXT = '오늘 만들 수 있는 사진을 모두 만들었어요. 내일 다시 만들어 주세요.'

/** What to tell the user about a failed photo. */
export function aiPhotoErrorText(result: Extract<AiPhotoResult, { ok: false }>): string {
  if (result.code === 'rate_limited' && (result.scope === 'daily' || result.scope === 'global')) {
    return DAILY_TEXT
  }
  return AI_PHOTO_ERROR_TEXT[result.code]
}

function readStatus(value: unknown): AiPhotoClientStatus {
  const status = (value ?? {}) as Record<string, unknown>
  if (status.available === true) {
    return {
      available: true,
      signInRequired: status.signInRequired !== false,
      signedIn: status.signedIn === true,
      remainingToday: typeof status.remainingToday === 'number' ? status.remainingToday : null,
      maxImageBytes:
        typeof status.maxImageBytes === 'number' ? status.maxImageBytes : AI_PHOTO_MAX_IMAGE_BYTES,
      faceAllowed: status.faceAllowed === true,
      childAllowed: status.childAllowed === true,
    }
  }
  const reason =
    status.reason === 'disabled' ||
    status.reason === 'no_api_key' ||
    status.reason === 'moderation_required'
      ? status.reason
      : null
  return { available: false, reason: reason ?? 'not_configured' }
}

/** Our code for a refused request: the route's own, else by HTTP status (the API guard's refusals). */
function errorCode(status: number, error: unknown): AiPhotoErrorCode {
  if (typeof error === 'string' && ROUTE_ERRORS.has(error)) return error as AiPhotoRouteError
  if (status === 429) return 'rate_limited'
  if (status === 413) return 'too_large'
  if (status === 504) return 'timeout'
  if (status === 401 || status === 403 || status === 503) return 'unavailable'
  return 'upstream'
}

/** Only well-formed colours; lip colour never for a child. */
function cleanHints(hints: AiPhotoHints | undefined, child: boolean): AiPhotoHints | undefined {
  const clean: AiPhotoHints = {}
  for (const key of HINT_KEYS) {
    const hex = hints?.[key]
    if ((key !== 'lips' || !child) && typeof hex === 'string' && HEX.test(hex)) {
      clean[key] = hex.toLowerCase()
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined
}

const extension = (type: string) => (type === 'image/webp' ? 'webp' : 'jpg')

export function createAiPhotoClient(deps: AiPhotoClientDeps = {}) {
  const send = deps.fetch ?? ((input, init) => fetch(input, init))
  const headers = deps.headers ?? getStudioAuthHeaders
  const now = deps.now ?? Date.now
  let cached: { at: number; value: Promise<AiPhotoClientStatus> } | null = null

  return {
    /** `GET /api/ai-photo`, cached for a minute; `fresh` asks again (after signing in). */
    status(options: { fresh?: boolean } = {}): Promise<AiPhotoClientStatus> {
      if (!options.fresh && cached && now() - cached.at < AI_PHOTO_STATUS_TTL_MS) {
        return cached.value
      }
      const at = now()
      const value = (async () => {
        const response = await send(ROUTE, { cache: 'no-store', headers: await headers() })
        if (!response.ok) throw new Error(`ai-photo status ${response.status}`)
        return readStatus(await response.json())
      })().catch((): AiPhotoClientStatus => {
        // Not kept: the next asker tries again.
        if (cached?.at === at) cached = null
        return { available: false, reason: 'network' }
      })
      cached = { at, value }
      return value
    },

    /** One photo. Checks what it can before sending; never throws. */
    async create(request: AiPhotoRequest): Promise<AiPhotoResult> {
      const { render, face = null, consent, avatarId, framing, signal } = request
      const subject = avatarSubject(avatarId)
      if (!subject) return { ok: false, code: 'invalid_request' }
      if (face && !avatarTakesFace(avatarId)) return { ok: false, code: 'face_not_allowed' }
      if (face && !consent) return { ok: false, code: 'consent_required' }
      if (
        render.size > AI_PHOTO_MAX_IMAGE_BYTES ||
        (face && face.size > AI_PHOTO_MAX_IMAGE_BYTES)
      ) {
        return { ok: false, code: 'too_large' }
      }

      const hints = cleanHints(request.hints, subject.child)
      const form = new FormData()
      form.append(
        'options',
        JSON.stringify({
          avatarId,
          framing,
          style: request.style ?? 'realistic',
          consent,
          ...(hints ? { hints } : {}),
        }),
      )
      form.append('render', render, `render.${extension(render.type)}`)
      if (face) form.append('face', face, `face.${extension(face.type)}`)

      const failed = (): AiPhotoResult => ({
        ok: false,
        code: signal?.aborted ? 'aborted' : 'network',
      })
      let response: Response
      try {
        // No Content-Type: the browser writes the multipart boundary.
        response = await send(ROUTE, {
          method: 'POST',
          cache: 'no-store',
          headers: await headers(),
          body: form,
          signal,
        })
      } catch {
        return failed()
      }

      if (response.ok) {
        if (!response.headers.get('content-type')?.startsWith('image/')) {
          await response.body?.cancel().catch(() => {})
          return { ok: false, code: 'upstream' }
        }
        let image: Blob
        try {
          image = await response.blob()
        } catch {
          return failed()
        }
        // The count changed: the next status asks again.
        cached = null
        const remaining = Number.parseInt(response.headers.get('x-ai-photo-remaining') ?? '', 10)
        return { ok: true, image, remainingToday: Number.isFinite(remaining) ? remaining : null }
      }

      const body = (await response.json().catch(() => null)) as {
        error?: unknown
        retryAfter?: unknown
        scope?: unknown
      } | null
      // The server says AI photos are off now: the next status asks again.
      if (response.status === 503) cached = null
      const code = errorCode(response.status, body?.error)
      const header = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
      const retryAfter =
        typeof body?.retryAfter === 'number' ? body.retryAfter : header > 0 ? header : undefined
      const scope =
        body?.scope === 'burst' || body?.scope === 'daily' || body?.scope === 'global'
          ? body.scope
          : undefined
      return {
        ok: false,
        code,
        ...(retryAfter !== undefined ? { retryAfter } : {}),
        ...(scope ? { scope } : {}),
      }
    },
  }
}

export type AiPhotoClient = ReturnType<typeof createAiPhotoClient>

let shared: AiPhotoClient | null = null
const client = () => {
  shared ??= createAiPhotoClient()
  return shared
}

/** Whether to show the AI photo button (cached for a minute; `fresh` after signing in). */
export function getAiPhotoStatus(options?: { fresh?: boolean }): Promise<AiPhotoClientStatus> {
  return client().status(options)
}

/** `POST /api/ai-photo`: the photorealistic portrait, or why not. */
export function createAiPhoto(request: AiPhotoRequest): Promise<AiPhotoResult> {
  return client().create(request)
}

/** The bytes and media type of a base64 data URL, or null. */
export function decodeDataUrl(
  dataUrl: string,
): { type: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]*)$/i.exec(dataUrl)
  if (!match) return null
  let binary: string
  try {
    binary = atob(match[2] ?? '')
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { type: (match[1] ?? '').toLowerCase(), bytes }
}

/** The image as a JPEG whose longer side is at most `maxSide` (browser only). */
async function toJpeg(blob: Blob, maxSide: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d context')
    // The studio's grey crop padding, so transparent areas don't turn black.
    context.fillStyle = '#808080'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
  } finally {
    bitmap.close()
  }
}

/**
 * The studio face photo (`look.face.photo`) ready to upload: a JPEG or WebP
 * within the limits as it is, anything else re-encoded to JPEG. Null when it
 * can't be read.
 */
export async function facePhotoBlob(dataUrl: string): Promise<Blob | null> {
  const decoded = decodeDataUrl(dataUrl)
  const header = decoded && sniffImage(decoded.bytes)
  if (!decoded || !header) return null
  const blob = new Blob([decoded.bytes], { type: header.type })
  const fits =
    header.type !== 'image/png' &&
    Math.max(header.width, header.height) <= AI_PHOTO_FACE_MAX_SIDE &&
    decoded.bytes.byteLength <= AI_PHOTO_MAX_IMAGE_BYTES
  if (fits) return blob
  try {
    return await toJpeg(blob, AI_PHOTO_FACE_MAX_SIDE)
  } catch {
    return null
  }
}
