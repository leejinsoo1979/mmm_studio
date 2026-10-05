import type { NextRequest } from 'next/server'
import { createAiPhotoHandlers } from '@/lib/ai-photo/handlers'
import { sceneApiPreflight } from '@/lib/scene-api-security'
import { getVerifiedRequestStudioUserId } from '@/lib/studio-request-auth'

/**
 * AI 실사 사진: `GET` reports availability, `POST` turns the character
 * studio's render into a photorealistic portrait (see `lib/ai-photo/handlers`).
 * Not tied to a scene, so play mode can reuse it.
 */

export const dynamic = 'force-dynamic'
/** Image generation takes 15–90 s; the upstream deadline is 150 s. */
export const maxDuration = 180

const handlers = createAiPhotoHandlers({ userId: getVerifiedRequestStudioUserId })

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export function GET(request: NextRequest) {
  return handlers.status(request)
}

export function POST(request: NextRequest) {
  return handlers.generate(request)
}
