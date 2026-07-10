import type { SceneGraph } from '@pascal-app/editor'
import { headers } from 'next/headers'
import Link from 'next/link'
import { PlaySceneLoader } from '@/components/play-scene-loader'
import type { SceneMeta } from '@/components/scene-loader'

export const dynamic = 'force-dynamic'

type PublishedScene = SceneMeta & { graph: SceneGraph; published?: boolean }

async function baseUrl() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host ?? 'localhost:3000'}`
}

async function loadScene(id: string): Promise<PublishedScene | null> {
  const response = await fetch(`${await baseUrl()}/api/scenes/${encodeURIComponent(id)}`, {
    cache: 'no-store',
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Failed to load published scene: ${response.status}`)
  return (await response.json()) as PublishedScene
}

export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const scene = await loadScene(id)

  if (!scene) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#141414] p-6 text-white">
        <div className="max-w-sm text-center">
          <p className="text-white/45 text-xs uppercase tracking-[0.2em]">Unavailable</p>
          <h1 className="mt-3 font-semibold text-2xl">This experience is not available.</h1>
          <Link
            className="mt-6 inline-block rounded-lg bg-white px-4 py-2 text-black text-sm"
            href="/scenes"
          >
            Back to scenes
          </Link>
        </div>
      </main>
    )
  }

  return <PlaySceneLoader scene={scene.graph} />
}
