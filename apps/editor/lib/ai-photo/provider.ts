import { readBodyCapped } from '../npc-ai/tts'
import type { AiPhotoConfig, AiPhotoProtocol } from './config'
import { type AiPhotoImageType, sniffImage } from './image-header'
import type { AiPhotoFraming } from './shared'
import type { AiPhotoImage } from './upload'

/**
 * The two wire protocols AI photo speaks, over plain `fetch` (no SDK): the
 * request to the configured provider, and its answer read as image bytes or
 * a provider-neutral refusal. Only inline image bytes are accepted; a hosted
 * image URL is never fetched.
 */

export type AiPhotoProviderInput = {
  prompt: string
  /** Image 1: the 3D render (framing, pose, hair, clothes). */
  render: AiPhotoImage
  /** Image 2: a face photo, for facial features only. */
  face: AiPhotoImage | null
  framing: AiPhotoFraming
  /** An opaque per-user tag for the provider's abuse tracing (openai only), never the uid. */
  user: string | null
}

export type AiPhotoProviderResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; type: AiPhotoImageType }
  | {
      ok: false
      code: 'blocked' | 'upstream' | 'rate_limited'
      retryAfter?: number
      /** A short machine reason for the log (an error code or finish reason), never content. */
      detail?: string
      /**
       * Most likely nothing was generated or billed, and not because of what
       * the visitor sent: a rate limit, a server error, or our key, model or
       * URL refused. Any other failure may have been billed (an answer without
       * a usable image) or caused by the request itself (a 4xx).
       */
      refundable?: true
    }

/** The largest decoded image accepted from a provider. */
export const AI_PHOTO_MAX_OUTPUT_BYTES = 16 * 1024 * 1024
/** The provider's JSON (base64 inflates by a third). */
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024
const MAX_ERROR_BYTES = 64 * 1024
const DEFAULT_RETRY_AFTER_S = 30

const EXTENSION: Record<AiPhotoImageType, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
}

const GEMINI_SAFETY = [
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_LOW_AND_ABOVE' }))

/** Gemini finish reasons that mean the provider refused the content, even beside an image. */
const GEMINI_REFUSALS = new Set([
  'SAFETY',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'IMAGE_PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
])

/** A refusal by OpenAI (its code), Azure (its code) or a gateway that wraps one (its message). */
const OPENAI_REFUSAL =
  /moderation_blocked|content_policy_violation|content_filter|ContentPolicyViolation|safety system/i

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

export function aiPhotoRequest(
  config: AiPhotoConfig,
  input: AiPhotoProviderInput,
): { url: string; init: RequestInit } {
  const { prompt, render, face, framing, user } = input
  if (config.provider === 'gemini') {
    const inline = (image: AiPhotoImage) => ({
      inlineData: { mimeType: image.type, data: base64(image.bytes) },
    })
    return {
      url: `${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent`,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { 'x-goog-api-key': config.apiKey } : {}),
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: 'Image 1:' },
                inline(render),
                ...(face ? [{ text: 'Image 2:' }, inline(face)] : []),
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            candidateCount: 1,
            imageConfig: {
              ...config.extraParams,
              aspectRatio: framing === 'face' ? '1:1' : '2:3',
            },
          },
          safetySettings: GEMINI_SAFETY,
        }),
      },
    }
  }

  const form = new FormData()
  form.append('model', config.model)
  form.append('prompt', prompt)
  for (const [name, image] of [
    ['render', render],
    ['face', face],
  ] as const) {
    if (!image) continue
    const file = new Blob([image.bytes], { type: image.type })
    form.append('image[]', file, `${name}.${EXTENSION[image.type]}`)
  }
  form.append('n', '1')
  form.append('size', framing === 'face' ? '1024x1024' : '1024x1536')
  if (user) form.append('user', user)
  for (const [key, item] of Object.entries(config.extraParams)) form.append(key, String(item))
  return {
    url: `${config.baseUrl}/images/edits`,
    init: {
      method: 'POST',
      // FormData sets the multipart content type and boundary itself.
      headers: {
        accept: 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: form,
    },
  }
}

/** Base64 image data as bytes, when it decodes to a JPEG, WebP or PNG within the size cap. */
function decodeImage(data: unknown): AiPhotoProviderResult {
  if (typeof data !== 'string' || data.length === 0) return { ok: false, code: 'upstream' }
  const bytes = new Uint8Array(Buffer.from(data, 'base64'))
  if (bytes.byteLength > AI_PHOTO_MAX_OUTPUT_BYTES) {
    return { ok: false, code: 'upstream', detail: 'too_large' }
  }
  const header = sniffImage(bytes)
  if (!header) return { ok: false, code: 'upstream', detail: 'not_an_image' }
  return { ok: true, bytes, type: header.type }
}

const short = (value: unknown) => (typeof value === 'string' ? value.slice(0, 64) : undefined)

/** See `refundable`: 5xx, and the provider refusing our own credentials or route. */
const refundableStatus = (status: number) =>
  status >= 500 || status === 401 || status === 403 || status === 404

/** A provider error that is not a content refusal. */
function httpFailure(status: number, detail: string | undefined): AiPhotoProviderResult {
  return {
    ok: false,
    code: 'upstream',
    detail: detail || `http_${status}`,
    ...(refundableStatus(status) ? { refundable: true as const } : {}),
  }
}

/** An OpenAI-compatible `/images/edits` answer: `data[0].b64_json`, or an error. */
export function parseOpenAiImage(status: number, json: unknown): AiPhotoProviderResult {
  const body = (json ?? {}) as {
    data?: { b64_json?: unknown }[]
    error?: { code?: unknown; type?: unknown; message?: unknown }
  }
  if (status >= 200 && status < 300) {
    const first = Array.isArray(body.data) ? body.data[0] : undefined
    if (!first) return { ok: false, code: 'upstream', detail: 'no_image' }
    return decodeImage(first.b64_json)
  }
  const reason = [short(body.error?.code), short(body.error?.type)].filter(Boolean).join('/')
  const { code, type, message } = body.error ?? {}
  const refused = [code, type, message].some(
    (field) => typeof field === 'string' && OPENAI_REFUSAL.test(field),
  )
  if (status === 400 && refused) {
    return { ok: false, code: 'blocked', detail: reason }
  }
  return httpFailure(status, reason)
}

type GeminiPart = {
  thought?: unknown
  inlineData?: { data?: unknown }
  inline_data?: { data?: unknown }
}

/**
 * A Gemini `generateContent` answer: the last image part that is not a
 * thought. An answer with no final image (text only, `NO_IMAGE`,
 * `IMAGE_OTHER`, `IMAGE_RECITATION`, …) is how these models decline: blocked.
 */
export function parseGeminiImage(status: number, json: unknown): AiPhotoProviderResult {
  const body = (json ?? {}) as {
    promptFeedback?: { blockReason?: unknown }
    candidates?: { finishReason?: unknown; content?: { parts?: GeminiPart[] } }[]
    error?: { status?: unknown }
  }
  if (status < 200 || status >= 300) return httpFailure(status, short(body.error?.status))
  const blockReason = short(body.promptFeedback?.blockReason)
  if (blockReason) return { ok: false, code: 'blocked', detail: blockReason }
  const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined
  const finish = short(candidate?.finishReason)
  if (finish && GEMINI_REFUSALS.has(finish)) return { ok: false, code: 'blocked', detail: finish }
  const parts = candidate?.content?.parts
  // Thinking models send draft images first, marked `thought`; the answer is the last other one.
  let image: { data?: unknown } | undefined
  for (const part of Array.isArray(parts) ? parts : []) {
    if (part?.thought !== true) image = part?.inlineData ?? part?.inline_data ?? image
  }
  if (!image) return { ok: false, code: 'blocked', detail: finish ?? 'no_image' }
  return decodeImage(image.data)
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) return null
  const bytes = await readBodyCapped(response.body, maxBytes).catch(() => null)
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

/** The provider's answer as image bytes or a refusal; a 429 keeps its `retry-after`. */
export async function readAiPhotoResponse(
  protocol: AiPhotoProtocol,
  response: Response,
): Promise<AiPhotoProviderResult> {
  if (response.status === 429) {
    await response.body?.cancel().catch(() => {})
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
    return {
      ok: false,
      code: 'rate_limited',
      retryAfter: retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_S,
      detail: 'http_429',
      refundable: true,
    }
  }
  const json = await readJson(response, response.ok ? MAX_RESPONSE_BYTES : MAX_ERROR_BYTES)
  if (response.ok && json === null) return { ok: false, code: 'upstream', detail: 'unreadable' }
  return protocol === 'gemini'
    ? parseGeminiImage(response.status, json)
    : parseOpenAiImage(response.status, json)
}
