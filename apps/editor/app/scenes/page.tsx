import {
  ArrowUpRight,
  Box,
  CalendarDays,
  CircleHelp,
  Clock3,
  FolderClosed,
  FolderOpen,
  Grid2X2,
  Home,
  Layers3,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { CreateSceneButton } from '@/components/save-button'
import type { SceneMeta } from '@/components/scene-loader'

export const dynamic = 'force-dynamic'

async function resolveBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return host ? `${proto}://${host}` : 'http://localhost:3000'
}

async function fetchScenes(): Promise<SceneMeta[]> {
  const response = await fetch(`${await resolveBaseUrl()}/api/scenes?limit=50`, {
    cache: 'no-store',
  })
  if (!response.ok) return []
  const payload = (await response.json()) as { scenes?: SceneMeta[] } | SceneMeta[]
  return Array.isArray(payload) ? payload : (payload.scenes ?? [])
}

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

function formatRelativeDate(iso: string): string {
  const updatedAt = new Date(iso).getTime()
  if (!Number.isFinite(updatedAt)) return 'Recently updated'
  const elapsedDays = Math.max(0, Math.floor((Date.now() - updatedAt) / 86_400_000))
  if (elapsedDays === 0) return 'Today'
  if (elapsedDays === 1) return 'Yesterday'
  if (elapsedDays < 30) return `${elapsedDays} days ago`
  return `${Math.floor(elapsedDays / 30)} mo ago`
}

function sceneAccent(index: number): string {
  const accents = [
    'from-[#c7d9d2] via-[#edf0e7] to-[#d7a86e]',
    'from-[#c8c4b8] via-[#eee9df] to-[#8d9b8a]',
    'from-[#b9c8d0] via-[#e8eceb] to-[#c88765]',
    'from-[#d2c2ad] via-[#f1ece2] to-[#778b83]',
    'from-[#bfc8ba] via-[#e7e9df] to-[#bd8268]',
    'from-[#c5cbd0] via-[#eeeee9] to-[#a5916e]',
  ]
  return accents[index % accents.length]!
}

function SceneThumbnail({ scene, index }: { index: number; scene: SceneMeta }) {
  if (scene.thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={scene.name} className="h-full w-full object-cover" src={scene.thumbnailUrl} />
    )
  }

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-gradient-to-br ${sceneAccent(index)}`}
    >
      <div className="absolute inset-0 bg-[linear-gradient(#27322d12_1px,transparent_1px),linear-gradient(90deg,#27322d12_1px,transparent_1px)] bg-[size:32px_32px]" />
      <div className="absolute top-[16%] left-[12%] h-[56%] w-[64%] border border-[#29332e]/55 bg-white/25 shadow-[0_20px_60px_rgba(37,46,42,0.16)]" />
      <div className="absolute top-[16%] left-[43%] h-[56%] border-[#29332e]/55 border-l" />
      <div className="absolute top-[42%] left-[12%] w-[64%] border-[#29332e]/55 border-t" />
      <div className="absolute right-[10%] bottom-[12%] flex h-12 w-12 items-center justify-center rounded-full bg-[#202723] text-white shadow-xl">
        <Grid2X2 className="h-5 w-5" />
      </div>
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-black/6 bg-white/70 px-4 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e9eee9] text-[#4e6458]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[#68716c] text-[11px] uppercase tracking-[0.12em]">{label}</p>
        <p className="mt-0.5 truncate font-semibold text-[#202521] text-lg">{value}</p>
      </div>
    </div>
  )
}

function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-black/6 border-r bg-[#f8f8f4] px-4 py-5 lg:flex">
      <Link className="flex items-center gap-3 px-2" href="/">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#202723] text-white shadow-sm">
          <Box className="h-5 w-5" />
        </span>
        <span>
          <span className="block font-semibold text-[15px] leading-none">MMM Studio</span>
          <span className="mt-1.5 block text-[#7a827d] text-[9px] uppercase tracking-[0.18em]">
            Spatial workspace
          </span>
        </span>
      </Link>

      <div className="mt-8">
        <CreateSceneButton
          className="h-11 w-full rounded-xl bg-[#202723] px-4 font-semibold text-sm text-white shadow-[0_8px_20px_rgba(32,39,35,0.14)] transition hover:bg-[#344139] disabled:opacity-50"
          label="+  New scene"
        />
      </div>

      <nav className="mt-7 space-y-1" aria-label="Main navigation">
        <p className="px-3 pb-2 font-medium text-[#979d99] text-[10px] uppercase tracking-[0.16em]">
          Workspace
        </p>
        <Link
          className="flex h-11 items-center gap-3 rounded-xl px-3 text-[#6f7772] text-sm transition hover:bg-black/[0.035] hover:text-[#202521]"
          href="/"
        >
          <Home className="h-[18px] w-[18px]" />
          Overview
        </Link>
        <Link
          aria-current="page"
          className="flex h-11 items-center gap-3 rounded-xl bg-[#e5ebe5] px-3 font-semibold text-[#33463b] text-sm"
          href="/scenes"
        >
          <Layers3 className="h-[18px] w-[18px]" />
          My scenes
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#647e6e]" />
        </Link>
        <button
          className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[#6f7772] text-sm transition hover:bg-black/[0.035] hover:text-[#202521]"
          type="button"
        >
          <FolderClosed className="h-[18px] w-[18px]" />
          Assets
        </button>
      </nav>

      <div className="mt-auto">
        <div className="mb-3 rounded-2xl border border-black/6 bg-white/70 p-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e6ece7] text-[#52685b]">
            <Sparkles className="h-4 w-4" />
          </span>
          <p className="mt-3 font-semibold text-sm">Need inspiration?</p>
          <p className="mt-1 text-[#7b827e] text-xs leading-5">
            Explore templates for your next space.
          </p>
        </div>
        <button
          className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[#727a75] text-sm hover:bg-black/[0.035]"
          type="button"
        >
          <CircleHelp className="h-[17px] w-[17px]" /> Help & support
        </button>
        <button
          className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[#727a75] text-sm hover:bg-black/[0.035]"
          type="button"
        >
          <Settings className="h-[17px] w-[17px]" /> Settings
        </button>
        <div className="mt-3 flex items-center gap-3 border-black/6 border-t px-2 pt-4">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#cbd7ce] font-semibold text-[#405348] text-xs">
            JS
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-sm">Jinsoo Lee</p>
            <p className="truncate text-[#89908c] text-[11px]">Personal workspace</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default async function ScenesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string }>
}) {
  const scenes = await fetchScenes()
  const params = await searchParams
  const query = params.q?.trim().toLocaleLowerCase() ?? ''
  const sort = params.sort === 'name' ? 'name' : 'recent'
  const filteredScenes = scenes.filter((scene) =>
    `${scene.name} ${scene.id}`.toLocaleLowerCase().includes(query),
  )
  const sortedScenes = [...filteredScenes].sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
  const allByRecent = [...scenes].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
  const totalNodes = scenes.reduce((sum, scene) => sum + scene.nodeCount, 0)
  const latestScene = allByRecent[0]

  return (
    <div className="min-h-screen bg-[#f2f3ef] text-[#202521]">
      <Sidebar />
      <header className="sticky top-0 z-30 border-black/6 border-b bg-[#f8f8f4]/90 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-3.5 sm:px-8 lg:px-12">
          <Link className="flex items-center gap-3" href="/">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#202723] text-white">
              <Box className="h-[18px] w-[18px]" />
            </span>
            <span>
              <span className="block font-semibold text-sm leading-none">MMM Studio</span>
              <span className="mt-1 block text-[#7a827d] text-[10px] uppercase tracking-[0.16em]">
                Spatial workspace
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              className="hidden text-[#6c746f] text-sm transition hover:text-[#202521] sm:block"
              href="/"
            >
              Home
            </Link>
            <CreateSceneButton
              className="h-10 rounded-xl bg-[#202723] px-4 font-semibold text-sm text-white shadow-[0_8px_20px_rgba(32,39,35,0.16)] transition hover:-translate-y-0.5 hover:bg-[#344139] disabled:opacity-50"
              label="New scene"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-5 py-8 sm:px-8 lg:ml-64 lg:px-10 lg:py-10 xl:px-12">
        <section className="relative overflow-hidden rounded-[28px] bg-[#202723] px-6 py-8 text-white shadow-[0_24px_70px_rgba(35,43,38,0.16)] sm:px-9 sm:py-10 lg:px-12">
          <div className="absolute -top-24 -right-16 h-80 w-80 rounded-full bg-[#89a292]/20 blur-3xl" />
          <div className="absolute right-[22%] -bottom-24 h-64 w-64 rounded-full bg-[#c89d68]/12 blur-3xl" />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_430px] lg:items-end">
            <div>
              <p className="flex items-center gap-2 font-medium text-[#aebdb4] text-xs uppercase tracking-[0.18em]">
                <Sparkles className="h-3.5 w-3.5" /> Workspace overview
              </p>
              <h1 className="mt-5 max-w-2xl text-balance font-semibold text-4xl leading-[1.05] tracking-[-0.04em] sm:text-5xl lg:text-[58px]">
                Bring your spaces
                <br className="hidden sm:block" /> to life.
              </h1>
              <p className="mt-5 max-w-xl text-[#c7d0ca] text-sm leading-6 sm:text-base">
                Create, organize, and return to every interior concept from one focused workspace.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <Metric icon={<Layers3 className="h-4 w-4" />} label="Scenes" value={scenes.length} />
              <Metric icon={<Box className="h-4 w-4" />} label="Objects" value={totalNodes} />
              <Metric
                icon={<Clock3 className="h-4 w-4" />}
                label="Last edit"
                value={latestScene ? formatRelativeDate(latestScene.updatedAt) : '—'}
              />
            </div>
          </div>
        </section>

        <section className="pt-10">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-medium text-[#718078] text-xs uppercase tracking-[0.16em]">
                Library
              </p>
              <h2 className="mt-2 font-semibold text-3xl tracking-[-0.03em]">Your scenes</h2>
              <p className="mt-2 text-[#747c77] text-sm">
                {query
                  ? `${sortedScenes.length} result${sortedScenes.length === 1 ? '' : 's'} for “${params.q}”`
                  : `${scenes.length} saved scene${scenes.length === 1 ? '' : 's'}`}
              </p>
            </div>

            <form className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto" method="get">
              <label className="flex h-11 min-w-0 items-center gap-3 rounded-xl border border-black/8 bg-white px-4 shadow-sm sm:w-[320px]">
                <Search className="h-4 w-4 shrink-0 text-[#768079]" />
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#9a9f9b]"
                  defaultValue={params.q}
                  name="q"
                  placeholder="Search by scene or ID"
                  type="search"
                />
              </label>
              <select
                aria-label="Sort scenes"
                className="h-11 rounded-xl border border-black/8 bg-white px-4 text-sm outline-none shadow-sm"
                defaultValue={sort}
                name="sort"
              >
                <option value="recent">Recently updated</option>
                <option value="name">Name A–Z</option>
              </select>
              <button
                className="h-11 rounded-xl bg-[#dce4dd] px-5 font-semibold text-[#36473d] text-sm transition hover:bg-[#cdd9cf]"
                type="submit"
              >
                Apply
              </button>
            </form>
          </div>

          {sortedScenes.length === 0 ? (
            <div className="mt-7 grid min-h-[340px] place-items-center rounded-[24px] border border-black/8 border-dashed bg-white/70 p-10 text-center">
              <div>
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e4ebe5] text-[#526a5c]">
                  <FolderOpen className="h-6 w-6" />
                </span>
                <h2 className="mt-5 font-semibold text-2xl">
                  {query ? 'No matching scenes' : 'Create your first scene'}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-[#737b76] text-sm leading-6">
                  {query
                    ? 'Try a different scene name or project ID.'
                    : 'Start drawing walls, placing objects, and shaping your next interior concept.'}
                </p>
                <div className="mt-6 flex justify-center">
                  {query ? (
                    <Link
                      className="rounded-xl bg-[#202723] px-5 py-3 font-semibold text-sm text-white"
                      href="/scenes"
                    >
                      Clear search
                    </Link>
                  ) : (
                    <CreateSceneButton
                      className="h-11 rounded-xl bg-[#202723] px-5 font-semibold text-sm text-white disabled:opacity-50"
                      label="Create first scene"
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <ul className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {sortedScenes.map((scene, index) => (
                <li key={scene.id}>
                  <Link
                    className="group block overflow-hidden rounded-[22px] border border-black/7 bg-[#fafaf7] shadow-[0_4px_18px_rgba(32,39,35,0.04)] transition duration-300 hover:-translate-y-1 hover:border-[#758d7f]/45 hover:shadow-[0_18px_45px_rgba(32,39,35,0.12)]"
                    href={`/scene/${scene.id}`}
                  >
                    <div className="relative aspect-[1.5] overflow-hidden bg-[#dfe5e0]">
                      <SceneThumbnail index={index} scene={scene} />
                      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/55 via-black/10 to-transparent px-4 pt-14 pb-4 text-white">
                        <span className="rounded-lg bg-black/25 px-2.5 py-1 font-medium text-xs backdrop-blur-md">
                          {scene.nodeCount} objects
                        </span>
                        <span className="flex h-9 w-9 translate-y-2 items-center justify-center rounded-full bg-white text-[#202521] opacity-0 shadow-lg transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold text-[#202521] text-lg tracking-[-0.02em]">
                            {scene.name}
                          </h3>
                          <p className="mt-1 truncate font-mono text-[#8a918c] text-[11px]">
                            {scene.id}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-[#e3ebe5] px-2.5 py-1 font-semibold text-[#526a5c] text-[10px] uppercase tracking-wide">
                          Active
                        </span>
                      </div>
                      <div className="mt-5 flex items-center justify-between border-black/7 border-t pt-4 text-xs">
                        <span className="flex items-center gap-2 text-[#7b837e]">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {formatDate(scene.updatedAt)}
                        </span>
                        <span className="font-semibold text-[#505c55]">
                          {formatRelativeDate(scene.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
