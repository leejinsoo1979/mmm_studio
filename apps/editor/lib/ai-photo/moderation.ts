import type { AiPhotoModerationConfig } from './config'
import type { AiPhotoImage } from './upload'

/**
 * The optional second opinion: each input image and the result go through an
 * OpenAI-compatible `POST /moderations` before the next step. It fails
 * closed: an unreadable answer stops the photo, as a flag does.
 */

export type ModerationVerdict = 'clear' | 'flagged' | 'error'

export type ModerationOptions = {
  fetch: (input: string, init: RequestInit) => Promise<Response>
  signal: AbortSignal
}

export function moderationRequest(
  config: AiPhotoModerationConfig,
  image: AiPhotoImage,
): { url: string; init: RequestInit } {
  const url = `data:${image.type};base64,${Buffer.from(image.bytes).toString('base64')}`
  return {
    url: `${config.baseUrl}/moderations`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        input: [{ type: 'image_url', image_url: { url } }],
      }),
    },
  }
}

/** A user's own words (AI 인물's 자유 설명) through the same `/moderations`, as text. */
export function moderationTextRequest(
  config: AiPhotoModerationConfig,
  text: string,
): { url: string; init: RequestInit } {
  return {
    url: `${config.baseUrl}/moderations`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: config.model, input: [{ type: 'text', text }] }),
    },
  }
}

/** Flagged when any result is flagged or names sexual content involving minors. */
export function readModerationVerdict(json: unknown): ModerationVerdict {
  const results = (json as { results?: unknown } | null)?.results
  if (!Array.isArray(results) || results.length === 0) return 'error'
  for (const result of results as { flagged?: unknown; categories?: Record<string, unknown> }[]) {
    if (typeof result?.flagged !== 'boolean') return 'error'
    if (result.flagged || result.categories?.['sexual/minors'] === true) return 'flagged'
  }
  return 'clear'
}

async function moderate(
  { url, init }: { url: string; init: RequestInit },
  options: ModerationOptions,
): Promise<ModerationVerdict> {
  try {
    const response = await options.fetch(url, {
      ...init,
      cache: 'no-store',
      signal: options.signal,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return 'error'
    }
    return readModerationVerdict(await response.json())
  } catch {
    return 'error'
  }
}

/** One image checked; any network or HTTP failure reads as 'error'. */
export function moderateImage(
  config: AiPhotoModerationConfig,
  image: AiPhotoImage,
  options: ModerationOptions,
): Promise<ModerationVerdict> {
  return moderate(moderationRequest(config, image), options)
}

/** One text checked; any network or HTTP failure reads as 'error'. */
export function moderateText(
  config: AiPhotoModerationConfig,
  text: string,
  options: ModerationOptions,
): Promise<ModerationVerdict> {
  return moderate(moderationTextRequest(config, text), options)
}

/** Every image checked in parallel: flagged if any is, else error if any failed. */
export async function moderateImages(
  config: AiPhotoModerationConfig,
  images: AiPhotoImage[],
  options: ModerationOptions,
): Promise<ModerationVerdict> {
  const verdicts = await Promise.all(images.map((image) => moderateImage(config, image, options)))
  if (verdicts.includes('flagged')) return 'flagged'
  return verdicts.includes('error') ? 'error' : 'clear'
}
