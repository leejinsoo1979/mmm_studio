import type { NextRequest } from 'next/server'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  try {
    const published = await operations.saveScene({
      id,
      name: scene.name,
      projectId: scene.projectId,
      ownerId: scene.ownerId,
      graph: scene.graph,
      thumbnailUrl: scene.thumbnailUrl,
      expectedVersion: scene.version,
      saveMode: 'checkpoint',
      publish: true,
    })
    const origin = new URL(request.url).origin
    return sceneApiJson(request, {
      sceneId: id,
      version: published.version,
      playUrl: `${origin}/play/${encodeURIComponent(id)}`,
      publishedAt: new Date().toISOString(),
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'version_conflict') {
      return sceneApiJson(request, { error: code }, { status: 409 })
    }
    return sceneApiJson(request, { error: 'publish_failed' }, { status: 500 })
  }
}
