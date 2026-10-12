import type { AiPhotoConfig, AiPhotoExtraParams } from '../ai-photo/config'
import { GEMINI_SAFETY } from '../ai-photo/provider'

/**
 * The AI 인물 portrait request: text only (no input image) over the two
 * protocols AI 실사 사진 already speaks. openai: `POST /images/generations`
 * (JSON); gemini: the same `generateContent` call with a single text part.
 * Both answer in the shapes `readAiPhotoResponse` reads: `data[0].b64_json`,
 * or Gemini image parts.
 */

/** Square: the most face pixels at the one size every image model supports. */
export const PORTRAIT_SIZE = '1024x1024'
export const PORTRAIT_ASPECT = '1:1'

export type AiPortraitProviderInput = {
  prompt: string
  /** `AI_AVATAR_PORTRAIT_EXTRA_PARAMS`, checked by `parseExtraParams`. */
  extraParams: AiPhotoExtraParams
  /** An opaque per-user tag for the provider's abuse tracing (openai only), never the uid. */
  user: string | null
}

export function aiPortraitRequest(
  config: Pick<AiPhotoConfig, 'provider' | 'baseUrl' | 'apiKey' | 'model'>,
  input: AiPortraitProviderInput,
): { url: string; init: RequestInit } {
  const { prompt, extraParams, user } = input
  if (config.provider === 'gemini') {
    return {
      url: `${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent`,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { 'x-goog-api-key': config.apiKey } : {}),
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            candidateCount: 1,
            imageConfig: { ...extraParams, aspectRatio: PORTRAIT_ASPECT },
          },
          safetySettings: GEMINI_SAFETY,
        }),
      },
    }
  }
  return {
    url: `${config.baseUrl}/images/generations`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      // `moderation` is never sent (the provider's default), and the extra params can't set it:
      // `parseExtraParams` reserves it, with `size`, `n`, `user` and the rest.
      body: JSON.stringify({
        ...extraParams,
        model: config.model,
        prompt,
        n: 1,
        size: PORTRAIT_SIZE,
        ...(user ? { user } : {}),
      }),
    },
  }
}
