import type { NextRequest } from 'next/server'
import { createPhotorealAiHandlers } from '@/lib/photoreal-ai/handlers'
import { sceneApiPreflight } from '@/lib/scene-api-security'
import { getVerifiedRequestStudioUserId } from '@/lib/studio-request-auth'

/**
 * AI 인물: an AI photo of a fictional adult made into a moving 실사 avatar
 * (see `lib/photoreal-ai/handlers` for the paths). One route for every
 * path, so the caps, the running jobs and the 목업 service live in one place.
 */

export const dynamic = 'force-dynamic'
/** A portrait takes 15–90 s (deadline 150 s); the step that downloads a finished avatar takes up to 120 s. */
export const maxDuration = 180

type RouteParams = { params: Promise<{ path?: string[] }> }

const handlers = createPhotorealAiHandlers({ userId: getVerifiedRequestStudioUserId })

async function dispatch(method: string, request: NextRequest, { params }: RouteParams) {
  const { path = [] } = await params
  return handlers.route(method, path, request)
}

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export function GET(request: NextRequest, context: RouteParams) {
  return dispatch('GET', request, context)
}

export function POST(request: NextRequest, context: RouteParams) {
  return dispatch('POST', request, context)
}

export function DELETE(request: NextRequest, context: RouteParams) {
  return dispatch('DELETE', request, context)
}
