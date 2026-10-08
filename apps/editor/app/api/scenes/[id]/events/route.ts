import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'
import { createSceneEventStream } from '@/lib/scene-event-stream'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

const MAX_EVENTS_PER_POLL = 50

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function GET(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()

  if (!operations.canListSceneEvents) {
    return sceneApiJson(request, { error: 'scene_events_unavailable' }, { status: 501 })
  }

  const scene = await operations.loadStoredScene(id)
  if (!scene) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const afterFromQuery = Number.parseInt(url.searchParams.get('after') ?? '0', 10)
  const afterFromHeader = Number.parseInt(request.headers.get('Last-Event-ID') ?? '0', 10)
  const cursor = Math.max(
    0,
    Number.isFinite(afterFromQuery) ? afterFromQuery : 0,
    Number.isFinite(afterFromHeader) ? afterFromHeader : 0,
  )

  const stream = createSceneEventStream({
    signal: request.signal,
    cursor,
    listEvents: (afterEventId) =>
      operations.listSceneEvents(id, { afterEventId, limit: MAX_EVENTS_PER_POLL }),
  })

  return withSceneApiHeaders(
    request,
    new Response(stream, {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      },
    }),
  )
}
