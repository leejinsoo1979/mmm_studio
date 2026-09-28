import type { SceneGraph } from '@pascal-app/editor'
import { headers } from 'next/headers'
import { SceneLoader, type SceneMeta } from '@/components/scene-loader'
import { SceneMissingCard } from './scene-missing-card'

export const dynamic = 'force-dynamic'

interface SceneWithGraph extends SceneMeta {
  graph: SceneGraph
}

async function resolveBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (!host) {
    return 'http://localhost:3000'
  }
  return `${proto}://${host}`
}

async function fetchScene(id: string): Promise<SceneWithGraph | null> {
  const base = await resolveBaseUrl()
  const response = await fetch(`${base}/api/scenes/${encodeURIComponent(id)}`, {
    cache: 'no-store',
  })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(`Failed to load scene: ${response.status}`)
  }
  return (await response.json()) as SceneWithGraph
}

export default async function ScenePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const scene = await fetchScene(id)

  if (!scene) return <SceneMissingCard sceneId={id} />

  const { graph, ...meta } = scene
  return <SceneLoader initialScene={graph} meta={meta} />
}
