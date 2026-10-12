import { readFile } from 'node:fs/promises'
import { userTag } from '../ai-photo/handlers'
import { type AiPhotoImageType, sniffImage } from '../ai-photo/image-header'
import { moderateImages, moderateText } from '../ai-photo/moderation'
import { readAiPhotoResponse } from '../ai-photo/provider'
import type { PhotorealAiConfig } from './config'
import { mockPortraitPng } from './mock-portrait'
import { aiPortraitRequest } from './portrait-provider'
import { buildAiPortraitPrompt } from './prompt'
import {
  AI_PORTRAIT_MAX_BYTES,
  AI_PORTRAIT_MIN_SIDE,
  type AiPersonChoices,
  type PhotorealAiLimitScope,
  type PhotorealAiRouteError,
} from './shared'

/**
 * One AI 인물 portrait from checked choices: the 자유 설명 through text
 * moderation (when configured), the text-to-image request, the size and
 * type the 3D service can take, and the finished image through image
 * moderation. Refund rules as AI 실사 사진: a portrait counts once the
 * generation request has gone out, unless the provider's answer shows it
 * did no billable work. The 목업 draws one instead (or reads a local file).
 */

export type PortraitImage = { bytes: Uint8Array<ArrayBuffer>; type: 'image/jpeg' | 'image/png' }

export type PortraitOutcome =
  | ({ ok: true } & PortraitImage)
  | {
      ok: false
      status: number
      code: PhotorealAiRouteError
      /** Give the portrait back: nothing was billed, and the request did not cause it. */
      refund: boolean
      retryAfter?: number
      scope?: PhotorealAiLimitScope
      detail?: string
    }

export type PortraitDeps = {
  fetch: (input: string, init: RequestInit) => Promise<Response>
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  /** How long the 목업 pretends to work. */
  mockDelayMs: number
}

/** A JPEG or PNG within the size cap whose short side is big enough for a face texture. */
export function portraitImage(
  bytes: Uint8Array<ArrayBuffer>,
): { ok: true; image: PortraitImage } | { ok: false; detail: string } {
  if (bytes.byteLength > AI_PORTRAIT_MAX_BYTES) return { ok: false, detail: 'too_large' }
  const header = sniffImage(bytes)
  if (!header) return { ok: false, detail: 'not_an_image' }
  if (header.type === 'image/webp') return { ok: false, detail: 'webp' }
  if (Math.min(header.width, header.height) < AI_PORTRAIT_MIN_SIDE) {
    return { ok: false, detail: 'too_small' }
  }
  return {
    ok: true,
    image: { bytes, type: header.type as Exclude<AiPhotoImageType, 'image/webp'> },
  }
}

async function mockPortrait(
  config: PhotorealAiConfig,
  choices: AiPersonChoices,
  signal: AbortSignal,
  deps: PortraitDeps,
): Promise<PortraitOutcome> {
  try {
    await deps.sleep(deps.mockDelayMs, signal)
  } catch {
    return { ok: false, status: 502, code: 'upstream', refund: true, detail: 'aborted' }
  }
  const bytes = config.mockPortraitPath
    ? await readFile(config.mockPortraitPath).then(
        (data) => new Uint8Array(data),
        () => null,
      )
    : mockPortraitPng(choices)
  const checked = bytes ? portraitImage(bytes) : null
  if (!checked?.ok) {
    return { ok: false, status: 502, code: 'upstream', refund: true, detail: 'mock_portrait' }
  }
  return { ok: true, ...checked.image }
}

export async function producePortrait(
  config: PhotorealAiConfig,
  choices: AiPersonChoices,
  uid: string,
  signals: { request: AbortSignal; deadline: AbortSignal },
  deps: PortraitDeps,
): Promise<PortraitOutcome> {
  const signal = AbortSignal.any([signals.request, signals.deadline])
  if (config.mock || !config.image) return mockPortrait(config, choices, signal, deps)
  const image = config.image
  // Set as the generation request goes out: from then on the provider may bill.
  let sent = false
  const failed = (detail: string | undefined, refundable = false): PortraitOutcome => {
    if (signals.deadline.aborted) {
      return { ok: false, status: 504, code: 'timeout', refund: !sent, detail }
    }
    if (signals.request.aborted) {
      return { ok: false, status: 502, code: 'upstream', refund: !sent, detail: 'client_aborted' }
    }
    return { ok: false, status: 502, code: 'upstream', refund: !sent || refundable, detail }
  }
  const blocked = (detail: string | undefined): PortraitOutcome => ({
    ok: false,
    status: 422,
    code: 'blocked',
    refund: false,
    detail,
  })

  if (image.moderation && choices.notes) {
    const verdict = await moderateText(image.moderation, choices.notes, {
      fetch: deps.fetch,
      signal,
    })
    if (verdict === 'flagged') return blocked('notes_flagged')
    if (verdict === 'error') return failed('moderation')
  }

  const { url, init } = aiPortraitRequest(image, {
    prompt: buildAiPortraitPrompt(choices),
    extraParams: config.portraitExtraParams,
    user: image.provider === 'openai' ? userTag(uid) : null,
  })
  let response: Response
  try {
    sent = true
    response = await deps.fetch(url, { ...init, cache: 'no-store', signal })
  } catch {
    return failed('fetch', true)
  }
  const result = await readAiPhotoResponse(image.provider, response).catch(() => null)
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
  const checked = portraitImage(result.bytes)
  if (!checked.ok) return failed(checked.detail)

  if (image.moderation) {
    const verdict = await moderateImages(image.moderation, [checked.image], {
      fetch: deps.fetch,
      signal,
    })
    if (verdict === 'flagged') return blocked('output_flagged')
    if (verdict === 'error') return failed('moderation')
  }
  return { ok: true, ...checked.image }
}
