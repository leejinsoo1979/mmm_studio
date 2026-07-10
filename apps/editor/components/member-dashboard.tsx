'use client'

import {
  ArrowRight,
  Box,
  CalendarDays,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Search,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { CreateSceneButton } from '@/components/save-button'
import type { SceneMeta } from '@/components/scene-loader'
import { getStudioUser, type StudioUser, signOutStudio } from '@/lib/auth-client'

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function providerLabel(provider: StudioUser['provider']): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}

function DashboardSceneThumbnail({ scene, index }: { scene: SceneMeta; index: number }) {
  if (scene.thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={scene.name} className="h-full w-full object-cover" src={scene.thumbnailUrl} />
    )
  }

  const accents = [
    'from-[#d9e2db] via-[#f6f6f0] to-[#c59b6a]',
    'from-[#cfd8dd] via-[#f3f4ef] to-[#789182]',
    'from-[#e1d5c5] via-[#f5f1e9] to-[#718b95]',
  ]

  return (
    <div className={`relative h-full w-full bg-gradient-to-br ${accents[index % accents.length]}`}>
      <div className="absolute inset-0 bg-[linear-gradient(#20272314_1px,transparent_1px),linear-gradient(90deg,#20272314_1px,transparent_1px)] bg-[size:28px_28px]" />
      <div className="absolute top-[18%] left-[14%] h-[52%] w-[62%] border border-[#202723]/45 bg-white/24" />
      <div className="absolute top-[18%] left-[44%] h-[52%] border-[#202723]/45 border-l" />
      <div className="absolute top-[43%] left-[14%] w-[62%] border-[#202723]/45 border-t" />
    </div>
  )
}

export function MemberDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<StudioUser | null>(null)
  const [scenes, setScenes] = useState<SceneMeta[]>([])
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const currentUser = getStudioUser()
    if (!currentUser) {
      router.replace('/signup?next=/dashboard')
      return
    }
    setUser(currentUser)
  }, [router])

  useEffect(() => {
    let cancelled = false
    async function loadScenes() {
      try {
        const response = await fetch('/api/scenes?limit=50', { cache: 'no-store' })
        if (!response.ok) return
        const payload = (await response.json()) as { scenes?: SceneMeta[] } | SceneMeta[]
        const nextScenes = Array.isArray(payload) ? payload : (payload.scenes ?? [])
        if (!cancelled) setScenes(nextScenes)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    loadScenes()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredScenes = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return scenes
    return scenes.filter((scene) => `${scene.name} ${scene.id}`.toLowerCase().includes(term))
  }, [query, scenes])

  const totalNodes = scenes.reduce((sum, scene) => sum + scene.nodeCount, 0)
  const recentScene = [...scenes].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )[0]

  if (!user) {
    return <div className="min-h-screen bg-[#eef1ec]" />
  }

  return (
    <main className="min-h-screen bg-[#eef1ec] text-[#202723]">
      <header className="sticky top-0 z-30 border-black/8 border-b bg-[#f8faf7]/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link className="flex items-center gap-3" href="/">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#202723] text-white">
              <Box className="h-5 w-5" />
            </span>
            <span>
              <span className="block font-semibold leading-none">MMM Studio</span>
              <span className="mt-1 block text-[#7a837d] text-[10px] uppercase tracking-[0.18em]">
                Member dashboard
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              className="hidden h-10 items-center rounded-xl border border-black/8 bg-white px-4 font-semibold text-[#56635c] text-sm transition hover:bg-[#f1f4ef] sm:flex"
              href="/scenes"
            >
              Scenes
            </Link>
            <button
              className="grid h-10 w-10 place-items-center rounded-xl border border-black/8 bg-white text-[#657069] transition hover:bg-[#f1f4ef]"
              onClick={() => {
                signOutStudio().finally(() => router.push('/'))
              }}
              title="Sign out"
              type="button"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[320px_1fr] lg:py-8">
        <aside className="space-y-4">
          <section className="rounded-[20px] border border-black/8 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#202723] font-semibold text-white">
                {user.avatarInitials}
              </span>
              <div className="min-w-0">
                <h1 className="truncate font-semibold text-xl tracking-[-0.03em]">{user.name}</h1>
                <p className="mt-1 truncate text-[#78817b] text-sm">{user.email}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-2 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-[#f1f5f1] px-3 py-2.5">
                <span className="text-[#6d7770]">Provider</span>
                <span className="font-semibold">{providerLabel(user.provider)}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[#f1f5f1] px-3 py-2.5">
                <span className="text-[#6d7770]">Workspace</span>
                <span className="max-w-[150px] truncate font-semibold">{user.workspaceName}</span>
              </div>
            </div>
          </section>

          <section className="rounded-[20px] border border-black/8 bg-[#202723] p-5 text-white shadow-sm">
            <Sparkles className="h-5 w-5 text-[#c9d8ce]" />
            <h2 className="mt-4 font-semibold text-lg">Next action</h2>
            <p className="mt-2 text-[#bec8c1] text-sm leading-6">
              Create a scene, import assets, and keep the project attached to this member workspace.
            </p>
            <div className="mt-5">
              <CreateSceneButton
                className="h-11 w-full rounded-xl bg-white px-4 font-semibold text-[#202723] text-sm transition hover:bg-[#eef2ef] disabled:opacity-50"
                label="Create new scene"
              />
            </div>
          </section>
        </aside>

        <section className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { label: 'Scenes', value: scenes.length, icon: LayoutDashboard },
              { label: 'Objects', value: totalNodes, icon: Box },
              {
                label: 'Last edit',
                value: recentScene ? formatDate(recentScene.updatedAt) : 'No edits',
                icon: CalendarDays,
              },
            ].map((metric) => (
              <div
                className="rounded-[18px] border border-black/8 bg-white p-5 shadow-sm"
                key={metric.label}
              >
                <metric.icon className="h-5 w-5 text-[#627266]" />
                <p className="mt-5 text-[#748079] text-xs uppercase tracking-[0.16em]">
                  {metric.label}
                </p>
                <p className="mt-1 font-semibold text-2xl tracking-[-0.03em]">{metric.value}</p>
              </div>
            ))}
          </div>

          <section className="rounded-[22px] border border-black/8 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[#738078] text-xs uppercase tracking-[0.16em]">Projects</p>
                <h2 className="mt-2 font-semibold text-2xl tracking-[-0.03em]">Personal scenes</h2>
              </div>
              <label className="flex h-11 min-w-0 items-center gap-3 rounded-xl border border-black/8 bg-[#f6f8f5] px-4 sm:w-[320px]">
                <Search className="h-4 w-4 text-[#748079]" />
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#9da59f]"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search scenes"
                  type="search"
                  value={query}
                />
              </label>
            </div>

            {isLoading ? (
              <div className="grid min-h-[260px] place-items-center text-[#748079] text-sm">
                Loading scenes...
              </div>
            ) : filteredScenes.length === 0 ? (
              <div className="grid min-h-[260px] place-items-center rounded-xl border border-black/8 border-dashed bg-[#f7f9f6] p-8 text-center">
                <div>
                  <FolderOpen className="mx-auto h-8 w-8 text-[#6b7c70]" />
                  <h3 className="mt-4 font-semibold text-lg">
                    {query ? 'No matching scenes' : 'No scenes yet'}
                  </h3>
                  <p className="mt-2 text-[#748079] text-sm">
                    {query
                      ? 'Try another search term.'
                      : 'Create your first scene from this dashboard.'}
                  </p>
                </div>
              </div>
            ) : (
              <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredScenes.map((scene, index) => (
                  <li key={scene.id}>
                    <Link
                      className="group block overflow-hidden rounded-[18px] border border-black/8 bg-[#fbfcfa] transition hover:-translate-y-0.5 hover:border-[#7f9789] hover:shadow-[0_18px_45px_rgba(32,39,35,0.12)]"
                      href={`/scene/${scene.id}`}
                    >
                      <div className="aspect-[1.45] overflow-hidden bg-[#e3e9e3]">
                        <DashboardSceneThumbnail index={index} scene={scene} />
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate font-semibold">{scene.name}</h3>
                            <p className="mt-1 truncate font-mono text-[#8a938d] text-[11px]">
                              {scene.id}
                            </p>
                          </div>
                          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[#8a938d] transition group-hover:translate-x-0.5 group-hover:text-[#202723]" />
                        </div>
                        <div className="mt-4 flex items-center justify-between border-black/8 border-t pt-3 text-xs">
                          <span className="text-[#7a847d]">{scene.nodeCount} objects</span>
                          <span className="font-semibold">{formatDate(scene.updatedAt)}</span>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      </div>
    </main>
  )
}
