import type { NextRequest } from 'next/server'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'
import { canAccessOwnedResource, getRequestStudioUserId } from '@/lib/studio-request-auth'

export const dynamic = 'force-dynamic'

const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
  if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
    return sceneApiJson(request, { error: 'unsupported_image_type' }, { status: 415 })
  }

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_THUMBNAIL_BYTES) {
    return sceneApiJson(request, { error: 'thumbnail_too_large' }, { status: 413 })
  }

  const { id } = await params
  const operations = await getSceneOperations()
  const userId = getRequestStudioUserId(request)
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  if (!canAccessOwnedResource(scene.ownerId, userId)) {
    return sceneApiJson(request, { error: 'forbidden' }, { status: 403 })
  }

  const thumbnailUrl = `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`
  try {
    const meta = await operations.saveScene({
      id,
      name: scene.name,
      projectId: scene.projectId,
      ownerId: scene.ownerId ?? userId,
      graph: scene.graph,
      thumbnailUrl,
      expectedVersion: scene.version,
    })
    return sceneApiJson(request, meta)
  } catch (error) {
    const code = (error as { code?: string })?.code
    return sceneApiJson(
      request,
      { error: code === 'version_conflict' ? 'version_conflict' : 'thumbnail_save_failed' },
      { status: code === 'version_conflict' ? 409 : 500 },
    )
  }
}
