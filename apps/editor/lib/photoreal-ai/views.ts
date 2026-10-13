import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { userTag } from '../ai-photo/handlers'
import { moderateImages } from '../ai-photo/moderation'
import { aiPhotoRequest, readAiPhotoResponse } from '../ai-photo/provider'
import type { PhotorealAiConfig } from './config'
import { type PortraitDeps, type PortraitImage, portraitImage } from './portrait'
import { buildAiViewPrompt } from './prompt'
import { AI_VIEW_SLOTS, type AiPersonAge, type AiViewSlot } from './shared'

/**
 * The turned views of an AI 인물 portrait — both ¾ views and both profiles
 * of the same fictional person — so the browser fits the avatar's head to
 * every side of the face, not to a front-facing mask. Each is an image edit
 * of the portrait (the one image sent) over the AI 실사 사진 image API, all
 * four at once, each checked as a portrait is (type, size, moderation). A
 * view the provider refuses or fails is left out; the browser builds from
 * what came. The 목업 reads views beside its local portrait
 * (`<portrait>-left45.png` and so on), or has none.
 */

export type ViewImage = PortraitImage & { slot: AiViewSlot }

export type ViewsOutcome = {
  views: ViewImage[]
  /** The slots that came to nothing, and why (for the log). */
  missing: { slot: AiViewSlot; detail: string }[]
  /** Whether any request reached the provider (from then on it may bill). */
  sent: boolean
  /** A view the provider's safety system refused. */
  blocked: boolean
}

async function mockViews(
  config: PhotorealAiConfig,
  signal: AbortSignal,
  deps: PortraitDeps,
): Promise<ViewsOutcome> {
  const outcome: ViewsOutcome = { views: [], missing: [], sent: false, blocked: false }
  try {
    await deps.sleep(deps.mockDelayMs, signal)
  } catch {
    outcome.missing = AI_VIEW_SLOTS.map((slot) => ({ slot, detail: 'aborted' }))
    return outcome
  }
  const portrait = config.mockPortraitPath
  for (const slot of AI_VIEW_SLOTS) {
    const path = portrait
      ? `${portrait.slice(0, portrait.length - extname(portrait).length)}-${slot}${extname(portrait)}`
      : null
    const bytes = path
      ? await readFile(path).then(
          (data) => new Uint8Array(data),
          () => null,
        )
      : null
    const checked = bytes ? portraitImage(bytes) : null
    if (checked?.ok) outcome.views.push({ slot, ...checked.image })
    else outcome.missing.push({ slot, detail: 'mock_view' })
  }
  return outcome
}

export async function produceViews(
  config: PhotorealAiConfig,
  portrait: PortraitImage,
  age: AiPersonAge,
  uid: string,
  signals: { request: AbortSignal; deadline: AbortSignal },
  deps: PortraitDeps,
): Promise<ViewsOutcome> {
  const signal = AbortSignal.any([signals.request, signals.deadline])
  if (config.mock || !config.image) return mockViews(config, signal, deps)
  const image = config.image
  const outcome: ViewsOutcome = { views: [], missing: [], sent: false, blocked: false }
  const one = async (slot: AiViewSlot): Promise<void> => {
    const { url, init } = aiPhotoRequest(image, {
      prompt: buildAiViewPrompt(slot, age),
      render: portrait,
      face: null,
      framing: 'face',
      user: image.provider === 'openai' ? userTag(uid) : null,
    })
    let response: Response
    try {
      outcome.sent = true
      response = await deps.fetch(url, { ...init, cache: 'no-store', signal })
    } catch {
      outcome.missing.push({ slot, detail: signal.aborted ? 'aborted' : 'fetch' })
      return
    }
    const result = await readAiPhotoResponse(image.provider, response).catch(() => null)
    if (!result || !result.ok) {
      if (result?.code === 'blocked') outcome.blocked = true
      outcome.missing.push({ slot, detail: result?.detail ?? result?.code ?? 'read' })
      return
    }
    const checked = portraitImage(result.bytes)
    if (!checked.ok) {
      outcome.missing.push({ slot, detail: checked.detail })
      return
    }
    if (image.moderation) {
      const verdict = await moderateImages(image.moderation, [checked.image], {
        fetch: deps.fetch,
        signal,
      })
      if (verdict !== 'clear') {
        if (verdict === 'flagged') outcome.blocked = true
        outcome.missing.push({ slot, detail: verdict === 'flagged' ? 'output_flagged' : 'moderation' })
        return
      }
    }
    outcome.views.push({ slot, ...checked.image })
  }
  await Promise.all(AI_VIEW_SLOTS.map(one))
  outcome.views.sort((a, b) => AI_VIEW_SLOTS.indexOf(a.slot) - AI_VIEW_SLOTS.indexOf(b.slot))
  return outcome
}
