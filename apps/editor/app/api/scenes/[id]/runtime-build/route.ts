import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { guardSceneApiRequest, sceneApiJson, withSceneApiHeaders } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'
import { canAccessOwnedResource, getVerifiedRequestStudioUserId } from '@/lib/studio-request-auth'

const schema = z.object({
  platform: z.enum(['macos', 'windows']),
  quality: z.enum(['preview', 'high', 'ultra']).default('high'),
})

type RouteParams = { params: Promise<{ id: string }> }

const localBuilderEnabled =
  process.env.MMM_DISABLE_LOCAL_RUNTIME_BUILDER !== 'true' && !process.env.VERCEL

function endpointFor(platform: 'macos' | 'windows') {
  const configured =
    platform === 'macos'
      ? (process.env.MMM_MAC_BUILD_ENDPOINT ?? process.env.PASCAL_MAC_BUILD_ENDPOINT)
      : process.env.MMM_WINDOWS_BUILD_ENDPOINT
  return configured ?? (localBuilderEnabled ? 'http://127.0.0.1:8099/jobs' : undefined)
}

function builderHeaders() {
  const token =
    process.env.MMM_BUILDER_TOKEN ?? (localBuilderEnabled ? 'mmm-local-runtime-builder' : undefined)
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const { id } = await params
  const platform = request.nextUrl.searchParams.get('platform')
  const jobId = request.nextUrl.searchParams.get('jobId')
  if ((platform !== 'macos' && platform !== 'windows') || !jobId) {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(id)
  if (!scene) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }
  if (!canAccessOwnedResource(scene.ownerId, await getVerifiedRequestStudioUserId(request))) {
    return sceneApiJson(request, { error: 'forbidden' }, { status: 403 })
  }
  const endpoint = endpointFor(platform)
  if (!endpoint) return sceneApiJson(request, { error: 'builder_not_configured' }, { status: 503 })
  const wantsDownload = request.nextUrl.searchParams.get('download') === '1'
  const response = await fetch(
    `${endpoint.replace(/\/$/, '')}/${encodeURIComponent(jobId)}${wantsDownload ? '/artifact' : ''}`,
    {
      headers: builderHeaders(),
      cache: 'no-store',
    },
  )
  if (wantsDownload) {
    if (!response.ok || !response.body) {
      return sceneApiJson(request, { error: 'artifact_unavailable' }, { status: response.status })
    }
    return withSceneApiHeaders(
      request,
      new Response(response.body, {
        status: 200,
        headers: {
          'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
          'content-disposition':
            response.headers.get('content-disposition') ?? 'attachment; filename="runtime-build"',
        },
      }),
    )
  }
  const result = (await response.json().catch(() => ({
    error: 'invalid_builder_response',
  }))) as { artifactReady?: boolean; downloadUrl?: string; [key: string]: unknown }
  if (result.artifactReady && !result.downloadUrl) {
    result.downloadUrl = `/api/scenes/${encodeURIComponent(id)}/runtime-build?platform=${platform}&jobId=${encodeURIComponent(jobId)}&download=1`
  }
  return sceneApiJson(request, result, { status: response.status })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const input = schema.safeParse(await request.json().catch(() => null))
  if (!input.success) return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })

  const { id } = await params
  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  if (!canAccessOwnedResource(scene.ownerId, await getVerifiedRequestStudioUserId(request))) {
    return sceneApiJson(request, { error: 'forbidden' }, { status: 403 })
  }

  const endpoint = endpointFor(input.data.platform)
  if (!endpoint) {
    return sceneApiJson(
      request,
      {
        error: 'builder_not_configured',
        message: `The ${input.data.platform} signing and packaging worker has not been configured yet.`,
      },
      { status: 503 },
    )
  }

  const jobId = crypto.randomUUID()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...builderHeaders(),
    },
    body: JSON.stringify({
      jobId,
      platform: input.data.platform,
      quality: input.data.quality,
      playUrl: `${new URL(request.url).origin}/play/${encodeURIComponent(scene.id)}`,
      scene: {
        id: scene.id,
        name: scene.name,
        ownerId: scene.ownerId,
        version: scene.version,
      },
    }),
  })
  if (!response.ok) return sceneApiJson(request, { error: 'builder_rejected' }, { status: 502 })
  const builderResult = (await response.json().catch(() => null)) as {
    jobId?: string
    status?: string
    downloadUrl?: string
  } | null
  return sceneApiJson(
    request,
    {
      jobId: builderResult?.jobId ?? jobId,
      status: builderResult?.status ?? 'queued',
      downloadUrl: builderResult?.downloadUrl,
    },
    { status: builderResult?.downloadUrl ? 200 : 202 },
  )
}
