import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

const schema = z.object({
  platform: z.literal('macos'),
  quality: z.enum(['preview', 'high', 'ultra']).default('high'),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const input = schema.safeParse(await request.json().catch(() => null))
  if (!input.success) return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })

  const { id } = await params
  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  const endpoint = process.env.PASCAL_MAC_BUILD_ENDPOINT
  if (!endpoint) {
    return sceneApiJson(
      request,
      {
        error: 'builder_not_configured',
        message: 'The macOS signing and packaging worker has not been configured yet.',
      },
      { status: 503 },
    )
  }

  const jobId = crypto.randomUUID()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      platform: input.data.platform,
      quality: input.data.quality,
      scene: { id: scene.id, name: scene.name, version: scene.version, graph: scene.graph },
    }),
  })
  if (!response.ok) return sceneApiJson(request, { error: 'builder_rejected' }, { status: 502 })
  return sceneApiJson(request, { jobId, status: 'queued' }, { status: 202 })
}
