'use client'

import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  Folder,
  FolderPlus,
  LayoutTemplate,
  LogOut,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  PlayCircle,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SceneMeta } from '@/components/scene-loader'
import {
  getStudioAuthHeaders,
  getStudioUser,
  type StudioUser,
  signOutStudio,
} from '@/lib/auth-client'

const ACCENT = '#fa4b0f'
const PINNED_KEY = 'mmm:pinned-scenes'
const ARCHIVED_KEY = 'mmm:archived-scenes'
const PRO_CARD_KEY = 'mmm:pro-card-dismissed'

type Section = 'models' | 'pinned' | 'archive'
type SortMode = 'edited' | 'created' | 'name'
type Popover = 'workspace' | 'sort' | 'new' | null

const SORT_LABELS: Record<SortMode, string> = {
  edited: 'Last edited',
  created: 'Date created',
  name: 'Name',
}

const SECTION_TITLES: Record<Section, string> = {
  models: 'My models',
  pinned: 'Pinned',
  archive: 'Archive',
}

function timeAgo(iso: string): string {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return 'a while ago'
  const seconds = Math.max(0, (Date.now() - time) / 1000)
  if (seconds < 60) return 'just now'
  const steps: [number, string][] = [
    [86400 * 365, 'year'],
    [86400 * 30, 'month'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ]
  for (const [size, label] of steps) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size)
      return `${count} ${label}${count === 1 ? '' : 's'} ago`
    }
  }
  return 'just now'
}

function readIdSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeIdSet(key: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // Best-effort persistence only.
  }
}

function ThumbnailPlaceholder() {
  return (
    <div className="relative h-full w-full bg-white">
      <div className="absolute top-[24%] left-[22%] h-[50%] w-[56%] border border-[#dcdcdc]" />
      <div className="absolute top-[24%] left-[50%] h-[50%] border-[#dcdcdc] border-l" />
      <div className="absolute top-[52%] left-[22%] w-[28%] border-[#dcdcdc] border-t" />
      <div className="absolute top-[36%] left-[64%] h-[14%] border-[#dcdcdc] border-l" />
    </div>
  )
}

interface MenuState {
  scene: SceneMeta
  x: number
  y: number
}

export function MemberDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<StudioUser | null>(null)
  const [scenes, setScenes] = useState<SceneMeta[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [section, setSection] = useState<Section>('models')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('edited')
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set())
  const [popover, setPopover] = useState<Popover>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renameTarget, setRenameTarget] = useState<SceneMeta | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SceneMeta | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [proDismissed, setProDismissed] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }, [])

  useEffect(() => {
    const currentUser = getStudioUser()
    if (!currentUser) {
      router.replace('/signup?next=/dashboard')
      return
    }
    setUser(currentUser)
    setPinnedIds(readIdSet(PINNED_KEY))
    setArchivedIds(readIdSet(ARCHIVED_KEY))
    setProDismissed(window.localStorage.getItem(PRO_CARD_KEY) === '1')
  }, [router])

  useEffect(() => {
    let cancelled = false
    async function loadScenes() {
      try {
        const response = await fetch('/api/scenes?limit=200', {
          cache: 'no-store',
          headers: await getStudioAuthHeaders(),
        })
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenu(null)
        setPopover(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const visibleScenes = useMemo(() => {
    let list = scenes.filter((scene) =>
      section === 'archive' ? archivedIds.has(scene.id) : !archivedIds.has(scene.id),
    )
    if (section === 'pinned') list = list.filter((scene) => pinnedIds.has(scene.id))
    const term = query.trim().toLowerCase()
    if (term) list = list.filter((scene) => scene.name.toLowerCase().includes(term))
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      const key = sort === 'created' ? 'createdAt' : 'updatedAt'
      return new Date(b[key]).getTime() - new Date(a[key]).getTime()
    })
  }, [scenes, section, query, sort, pinnedIds, archivedIds])

  const togglePinned = useCallback((sceneId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev)
      if (next.has(sceneId)) next.delete(sceneId)
      else next.add(sceneId)
      writeIdSet(PINNED_KEY, next)
      return next
    })
  }, [])

  const setArchived = useCallback(
    (sceneId: string, archived: boolean) => {
      setArchivedIds((prev) => {
        const next = new Set(prev)
        if (archived) next.add(sceneId)
        else next.delete(sceneId)
        writeIdSet(ARCHIVED_KEY, next)
        return next
      })
      showToast(archived ? 'Model archived' : 'Model restored')
    },
    [showToast],
  )

  const createScene = useCallback(async () => {
    if (isCreating) return
    setIsCreating(true)
    try {
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getStudioAuthHeaders()) },
        body: JSON.stringify({ name: 'New Model', graph: { nodes: {}, rootNodeIds: [] } }),
      })
      if (!response.ok) {
        showToast('Failed to create model')
        return
      }
      const meta = (await response.json()) as SceneMeta
      router.push(`/scene/${meta.id}`)
    } catch {
      showToast('Failed to create model')
    } finally {
      setIsCreating(false)
    }
  }, [isCreating, router, showToast])

  const duplicateScene = useCallback(
    async (scene: SceneMeta) => {
      try {
        const headers = await getStudioAuthHeaders()
        const response = await fetch(`/api/scenes/${scene.id}`, { cache: 'no-store', headers })
        if (!response.ok) {
          showToast('Failed to duplicate model')
          return
        }
        const full = (await response.json()) as SceneMeta & { graph: unknown }
        const createResponse = await fetch('/api/scenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            name: `Copy of ${scene.name}`,
            graph: full.graph,
            // The create schema only accepts absolute URLs for thumbnails.
            ...(scene.thumbnailUrl && /^https?:/.test(scene.thumbnailUrl)
              ? { thumbnailUrl: scene.thumbnailUrl }
              : {}),
          }),
        })
        if (!createResponse.ok) {
          showToast('Failed to duplicate model')
          return
        }
        const meta = (await createResponse.json()) as SceneMeta
        setScenes((prev) => [meta, ...prev])
        showToast('Model duplicated')
      } catch {
        showToast('Failed to duplicate model')
      }
    },
    [showToast],
  )

  const submitRename = useCallback(async () => {
    const target = renameTarget
    const name = renameValue.trim()
    if (!target || !name || name === target.name) {
      setRenameTarget(null)
      return
    }
    try {
      const response = await fetch(`/api/scenes/${target.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${target.version}"`,
          ...(await getStudioAuthHeaders()),
        },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        showToast('Failed to rename model')
        return
      }
      const meta = (await response.json()) as SceneMeta
      setScenes((prev) => prev.map((scene) => (scene.id === meta.id ? meta : scene)))
    } catch {
      showToast('Failed to rename model')
    } finally {
      setRenameTarget(null)
    }
  }, [renameTarget, renameValue, showToast])

  const submitDelete = useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    try {
      const response = await fetch(`/api/scenes/${target.id}`, {
        method: 'DELETE',
        headers: await getStudioAuthHeaders(),
      })
      if (!response.ok && response.status !== 404) {
        showToast('Failed to delete model')
        return
      }
      setScenes((prev) => prev.filter((scene) => scene.id !== target.id))
      setArchived(target.id, false)
      showToast('Model deleted')
    } catch {
      showToast('Failed to delete model')
    } finally {
      setDeleteTarget(null)
    }
  }, [deleteTarget, setArchived, showToast])

  const importFile = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await file.text()) as {
          graph?: { nodes?: unknown; rootNodeIds?: unknown }
          nodes?: unknown
          rootNodeIds?: unknown
        }
        const graph = parsed.graph ?? parsed
        if (!graph || typeof graph !== 'object' || !('nodes' in graph)) {
          showToast('Unsupported file — expected a scene JSON export')
          return
        }
        const name = file.name.replace(/\.json$/i, '') || 'Imported model'
        const response = await fetch('/api/scenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getStudioAuthHeaders()) },
          body: JSON.stringify({ name, graph }),
        })
        if (!response.ok) {
          showToast('Failed to import model')
          return
        }
        const meta = (await response.json()) as SceneMeta
        setScenes((prev) => [meta, ...prev])
        showToast(`Imported "${meta.name}"`)
      } catch {
        showToast('Failed to import model')
      }
    },
    [showToast],
  )

  const openCardMenu = useCallback((scene: SceneMeta, x: number, y: number) => {
    setPopover(null)
    setMenu({
      scene,
      x: Math.min(x, window.innerWidth - 216),
      y: Math.min(y, window.innerHeight - 340),
    })
  }, [])

  if (!user) {
    return <div className="min-h-screen bg-white" />
  }

  const workspaceName = user.workspaceName || `${user.name}'s space`
  const isArchiveView = section === 'archive'

  return (
    <div className="flex h-screen bg-white font-sans text-[#1a1a1a] antialiased">
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-[#ececec] border-r px-3 pt-3 pb-4 md:flex">
        <div className="relative">
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-black/[0.04]"
            onClick={() => setPopover((prev) => (prev === 'workspace' ? null : 'workspace'))}
            type="button"
          >
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md font-semibold text-[13px] text-white"
              style={{ backgroundColor: ACCENT }}
            >
              {user.avatarInitials.charAt(0)}
            </span>
            <span className="min-w-0 flex-1 truncate text-left font-medium text-[14px]">
              {workspaceName}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#9b9b9b]" />
          </button>
          {popover === 'workspace' && (
            <div className="absolute top-full right-0 left-0 z-50 mt-1 rounded-[10px] border border-black/8 bg-white p-1 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
              <div className="px-2.5 py-2">
                <p className="truncate font-medium text-[13px]">{user.name}</p>
                <p className="truncate text-[#9b9b9b] text-[12px]">{user.email}</p>
              </div>
              <div className="my-1 h-px bg-black/6" />
              <button
                className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition hover:bg-black/[0.05]"
                onClick={() => {
                  signOutStudio().finally(() => router.push('/'))
                }}
                type="button"
              >
                <LogOut className="h-3.5 w-3.5 text-[#6b6b6b]" />
                Sign out
              </button>
            </div>
          )}
        </div>

        <nav className="mt-5 space-y-0.5">
          {(
            [
              { key: 'models' as const, label: 'My models', icon: File },
              { key: 'pinned' as const, label: 'Pinned', icon: Pin },
              { key: 'archive' as const, label: 'Archive', icon: Archive },
            ] satisfies { key: Section; label: string; icon: typeof File }[]
          ).map((item) => (
            <button
              className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition ${
                section === item.key
                  ? 'bg-[#f1f1f0] font-medium'
                  : 'text-[#4a4a4a] hover:bg-black/[0.03]'
              }`}
              key={item.key}
              onClick={() => setSection(item.key)}
              type="button"
            >
              <item.icon className="h-4 w-4 text-[#6b6b6b]" />
              {item.label}
            </button>
          ))}
        </nav>

        <p className="mt-8 px-2.5 font-medium text-[13px]">Discover</p>
        <nav className="mt-2 space-y-0.5">
          {[
            { label: 'Templates', icon: LayoutTemplate },
            { label: 'Tutorials', icon: PlayCircle },
            { label: 'Documentation', icon: BookOpen },
          ].map((item) => (
            <button
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[#4a4a4a] text-[14px] transition hover:bg-black/[0.03]"
              key={item.label}
              onClick={() => showToast(`${item.label} is coming soon`)}
              type="button"
            >
              <item.icon className="h-4 w-4 text-[#6b6b6b]" />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main ────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 px-7 pt-5 pb-4">
          <h1 className="font-semibold text-[15px]">{SECTION_TITLES[section]}</h1>
          <div className="flex items-center gap-2">
            <button
              className="hidden h-8 w-8 place-items-center rounded-lg text-[#5c5c5c] transition hover:bg-black/[0.05] sm:grid"
              onClick={() => showToast('Folders are coming soon')}
              title="New folder"
              type="button"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
            <label className="hidden h-8 w-[220px] items-center gap-2 rounded-lg border border-[#e5e5e5] px-2.5 transition focus-within:border-[#c9c9c9] lg:flex">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#9b9b9b]" />
              <input
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#9b9b9b]"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                type="search"
                value={query}
              />
            </label>
            <div className="relative">
              <button
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[#4a4a4a] text-[13px] transition hover:bg-black/[0.05]"
                onClick={() => setPopover((prev) => (prev === 'sort' ? null : 'sort'))}
                type="button"
              >
                {SORT_LABELS[sort]}
                <ChevronDown className="h-3.5 w-3.5 text-[#9b9b9b]" />
              </button>
              {popover === 'sort' && (
                <div className="absolute top-full right-0 z-50 mt-1 w-[160px] rounded-[10px] border border-black/8 bg-white p-1 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
                  {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                    <button
                      className="flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[13px] transition hover:bg-black/[0.05]"
                      key={mode}
                      onClick={() => {
                        setSort(mode)
                        setPopover(null)
                      }}
                      type="button"
                    >
                      {SORT_LABELS[mode]}
                      {sort === mode && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="h-8 rounded-lg border border-[#e2e2e2] px-3.5 font-medium text-[13px] transition hover:bg-black/[0.03]"
              onClick={() => importInputRef.current?.click()}
              type="button"
            >
              Import
            </button>
            <div className="relative">
              <div className="flex overflow-hidden rounded-lg" style={{ backgroundColor: ACCENT }}>
                <button
                  className="h-8 px-3.5 font-medium text-[13px] text-white transition hover:bg-black/10 disabled:opacity-60"
                  disabled={isCreating}
                  onClick={createScene}
                  type="button"
                >
                  {isCreating ? 'Creating…' : 'New model'}
                </button>
                <span className="my-1.5 w-px bg-white/30" />
                <button
                  className="grid h-8 w-6 place-items-center text-white transition hover:bg-black/10"
                  onClick={() => setPopover((prev) => (prev === 'new' ? null : 'new'))}
                  type="button"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              {popover === 'new' && (
                <div className="absolute top-full right-0 z-50 mt-1 w-[180px] rounded-[10px] border border-black/8 bg-white p-1 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
                  <button
                    className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition hover:bg-black/[0.05]"
                    onClick={() => {
                      setPopover(null)
                      createScene()
                    }}
                    type="button"
                  >
                    <Plus className="h-3.5 w-3.5 text-[#6b6b6b]" />
                    New model
                  </button>
                  <button
                    className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition hover:bg-black/[0.05]"
                    onClick={() => {
                      setPopover(null)
                      importInputRef.current?.click()
                    }}
                    type="button"
                  >
                    <Upload className="h-3.5 w-3.5 text-[#6b6b6b]" />
                    Import file
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="min-w-0 flex-1 overflow-y-auto px-7 pb-24">
            {isLoading ? (
              <div className="grid grid-cols-1 gap-x-5 gap-y-8 pt-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => `skeleton-${i}`).map((key) => (
                  <div key={key}>
                    <div className="aspect-[3/2] animate-pulse rounded-[10px] border border-[#efefef] bg-[#f7f7f6]" />
                    <div className="mt-2.5 h-3.5 w-1/2 animate-pulse rounded bg-[#f0f0ef]" />
                    <div className="mt-1.5 h-3 w-1/3 animate-pulse rounded bg-[#f5f5f4]" />
                  </div>
                ))}
              </div>
            ) : visibleScenes.length === 0 ? (
              <div className="grid h-full min-h-[320px] place-items-center">
                <div className="text-center">
                  {isArchiveView ? (
                    <Archive className="mx-auto h-6 w-6 text-[#c4c4c4]" />
                  ) : section === 'pinned' ? (
                    <Pin className="mx-auto h-6 w-6 text-[#c4c4c4]" />
                  ) : (
                    <File className="mx-auto h-6 w-6 text-[#c4c4c4]" />
                  )}
                  <h2 className="mt-3 font-medium text-[14px]">
                    {query
                      ? 'No matching models'
                      : isArchiveView
                        ? 'Archive is empty'
                        : section === 'pinned'
                          ? 'No pinned models'
                          : 'No models yet'}
                  </h2>
                  <p className="mt-1 text-[#9b9b9b] text-[13px]">
                    {query
                      ? 'Try another search term.'
                      : isArchiveView
                        ? 'Archived models will show up here.'
                        : section === 'pinned'
                          ? 'Pin a model to find it here quickly.'
                          : 'Create your first model to get started.'}
                  </p>
                  {!query && section === 'models' && (
                    <button
                      className="mt-4 h-8 rounded-lg px-3.5 font-medium text-[13px] text-white transition hover:opacity-90"
                      onClick={createScene}
                      style={{ backgroundColor: ACCENT }}
                      type="button"
                    >
                      New model
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-x-5 gap-y-8 pt-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {visibleScenes.map((scene) => (
                  <div className="group" key={scene.id}>
                    <button
                      className={`relative block aspect-[3/2] w-full cursor-pointer overflow-hidden rounded-[10px] border bg-white text-left transition ${
                        menu?.scene.id === scene.id
                          ? 'border-[#c9c9c9]'
                          : 'border-[#e8e8e8] hover:border-[#cfcfcf]'
                      }`}
                      onClick={() => router.push(`/scene/${scene.id}`)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        openCardMenu(scene, event.clientX, event.clientY)
                      }}
                      type="button"
                    >
                      {scene.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={scene.name}
                          className="h-full w-full object-cover"
                          src={scene.thumbnailUrl}
                        />
                      ) : (
                        <ThumbnailPlaceholder />
                      )}
                    </button>
                    <div className="mt-2.5 flex items-start justify-between gap-2 px-0.5">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate font-medium text-[13px]">
                          {pinnedIds.has(scene.id) && (
                            <Pin className="h-3 w-3 shrink-0 text-[#9b9b9b]" />
                          )}
                          <span className="truncate">{scene.name}</span>
                        </p>
                        <p className="mt-0.5 truncate text-[#9b9b9b] text-[12px]">
                          Edited {timeAgo(scene.updatedAt)}
                        </p>
                      </div>
                      <button
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#5c5c5c] transition hover:bg-black/[0.05] ${
                          menu?.scene.id === scene.id
                            ? 'bg-black/[0.05] opacity-100'
                            : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
                        }`}
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect()
                          openCardMenu(scene, rect.left, rect.bottom + 6)
                        }}
                        type="button"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Info panel ─────────────────────────────── */}
          <aside className="hidden w-[300px] shrink-0 border-[#ececec] border-l px-6 pt-5 xl:block">
            <div className="flex items-center gap-2.5">
              <File className="h-4 w-4 text-[#6b6b6b]" />
              <p className="font-medium text-[14px]">{SECTION_TITLES[section]}</p>
            </div>
            <p className="mt-3 text-[#8a8a8a] text-[13px] leading-5">
              {isArchiveView
                ? 'Archived models are hidden from your library. Restore them anytime, or delete them permanently.'
                : section === 'pinned'
                  ? 'Pinned models stay at hand. Pin the projects you keep coming back to.'
                  : 'This space is just for you. You can invite others to individual models. For shared workspaces, upgrade to the team plan.'}{' '}
              <span className="cursor-pointer underline decoration-[#c9c9c9] underline-offset-2 hover:text-[#4a4a4a]">
                Learn more
              </span>
            </p>
          </aside>
        </div>
      </main>

      {/* ── Card context menu ───────────────────────────── */}
      {menu && (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-50 w-[200px] rounded-[10px] border border-black/8 bg-white p-1 text-[13px] shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              className="flex h-8 w-full items-center rounded-md px-2.5 transition hover:bg-black/[0.05]"
              onClick={() => router.push(`/scene/${menu.scene.id}`)}
              type="button"
            >
              Open
            </button>
            {isArchiveView ? (
              <>
                <div className="my-1 h-px bg-black/6" />
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 transition hover:bg-black/[0.05]"
                  onClick={() => {
                    setArchived(menu.scene.id, false)
                    setMenu(null)
                  }}
                  type="button"
                >
                  <ArchiveRestore className="h-3.5 w-3.5 text-[#6b6b6b]" />
                  Restore
                </button>
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[#d92c20] transition hover:bg-[#d92c20]/8"
                  onClick={() => {
                    setDeleteTarget(menu.scene)
                    setMenu(null)
                  }}
                  type="button"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete permanently
                </button>
              </>
            ) : (
              <>
                <div className="my-1 h-px bg-black/6" />
                <div className="group/move relative">
                  <button
                    className="flex h-8 w-full items-center justify-between rounded-md px-2.5 transition hover:bg-black/[0.05]"
                    type="button"
                  >
                    Move to
                    <ChevronRight className="h-3.5 w-3.5 text-[#9b9b9b]" />
                  </button>
                  <div className="invisible absolute top-0 left-full z-50 ml-1 w-[176px] rounded-[10px] border border-black/8 bg-white p-1 opacity-0 shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition group-hover/move:visible group-hover/move:opacity-100">
                    <p className="px-2.5 py-1.5 text-[#9b9b9b] text-[12px]">Move to</p>
                    <button
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 transition hover:bg-black/[0.05]"
                      onClick={() => setMenu(null)}
                      type="button"
                    >
                      <Folder className="h-3.5 w-3.5 text-[#6b6b6b]" />
                      My models
                    </button>
                  </div>
                </div>
                <div className="my-1 h-px bg-black/6" />
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 transition hover:bg-black/[0.05]"
                  onClick={() => {
                    setRenameValue(menu.scene.name)
                    setRenameTarget(menu.scene)
                    setMenu(null)
                  }}
                  type="button"
                >
                  <Pencil className="h-3.5 w-3.5 text-[#6b6b6b]" />
                  Rename
                </button>
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 transition hover:bg-black/[0.05]"
                  onClick={() => {
                    togglePinned(menu.scene.id)
                    setMenu(null)
                  }}
                  type="button"
                >
                  {pinnedIds.has(menu.scene.id) ? (
                    <>
                      <PinOff className="h-3.5 w-3.5 text-[#6b6b6b]" />
                      Unpin model
                    </>
                  ) : (
                    <>
                      <Pin className="h-3.5 w-3.5 text-[#6b6b6b]" />
                      Pin model
                    </>
                  )}
                </button>
                <div className="my-1 h-px bg-black/6" />
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 transition hover:bg-black/[0.05]"
                  onClick={() => {
                    duplicateScene(menu.scene)
                    setMenu(null)
                  }}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5 text-[#6b6b6b]" />
                  Duplicate
                </button>
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 transition hover:bg-black/[0.05]"
                  onClick={() => {
                    setArchived(menu.scene.id, true)
                    setMenu(null)
                  }}
                  type="button"
                >
                  <Archive className="h-3.5 w-3.5 text-[#6b6b6b]" />
                  Archive
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Popover overlay ─────────────────────────────── */}
      {popover && (
        <div aria-hidden="true" className="fixed inset-0 z-30" onClick={() => setPopover(null)} />
      )}

      {/* ── Rename dialog ───────────────────────────────── */}
      {renameTarget && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/25 p-4">
          <div className="w-full max-w-[360px] rounded-xl border border-black/8 bg-white p-5 shadow-[0_16px_60px_rgba(0,0,0,0.18)]">
            <h2 className="font-semibold text-[14px]">Rename model</h2>
            <input
              className="mt-3 h-9 w-full rounded-lg border border-[#e2e2e2] px-3 text-[13px] outline-none transition focus:border-[#b8b8b8]"
              onChange={(event) => setRenameValue(event.target.value)}
              ref={(element) => {
                element?.focus()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitRename()
              }}
              value={renameValue}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="h-8 rounded-lg border border-[#e2e2e2] px-3.5 font-medium text-[13px] transition hover:bg-black/[0.03]"
                onClick={() => setRenameTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-8 rounded-lg px-3.5 font-medium text-[13px] text-white transition hover:opacity-90 disabled:opacity-50"
                disabled={!renameValue.trim()}
                onClick={submitRename}
                style={{ backgroundColor: ACCENT }}
                type="button"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm dialog ───────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/25 p-4">
          <div className="w-full max-w-[360px] rounded-xl border border-black/8 bg-white p-5 shadow-[0_16px_60px_rgba(0,0,0,0.18)]">
            <h2 className="font-semibold text-[14px]">Delete model permanently?</h2>
            <p className="mt-2 text-[#8a8a8a] text-[13px] leading-5">
              "{deleteTarget.name}" will be permanently deleted. This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="h-8 rounded-lg border border-[#e2e2e2] px-3.5 font-medium text-[13px] transition hover:bg-black/[0.03]"
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-8 rounded-lg bg-[#d92c20] px-3.5 font-medium text-[13px] text-white transition hover:bg-[#c02419]"
                onClick={submitDelete}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pro card ────────────────────────────────────── */}
      {!proDismissed && (
        <div className="fixed right-5 bottom-5 z-20 w-[300px] rounded-xl border border-[#e8e8e8] bg-white p-4 shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
          <button
            className="absolute top-3 right-3 grid h-6 w-6 place-items-center rounded-md text-[#9b9b9b] transition hover:bg-black/[0.05] hover:text-[#4a4a4a]"
            onClick={() => {
              setProDismissed(true)
              try {
                window.localStorage.setItem(PRO_CARD_KEY, '1')
              } catch {
                // Best-effort persistence only.
              }
            }}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <span
            className="rounded px-1.5 py-0.5 font-bold text-[10px] tracking-wide"
            style={{ backgroundColor: `${ACCENT}1a`, color: ACCENT }}
          >
            PRO
          </span>
          <h3 className="mt-2.5 font-semibold text-[14px]">Design without limits</h3>
          <p className="mt-1 text-[#8a8a8a] text-[12.5px] leading-5">
            Remove watermarks, access all blocks and textures, and create your own templates and
            libraries.
          </p>
          <button
            className="mt-3 h-8 w-full rounded-lg bg-[#1a1a1a] font-medium text-[13px] text-white transition hover:bg-black"
            onClick={() => showToast('Plans are coming soon')}
            type="button"
          >
            Upgrade to Pro
          </button>
        </div>
      )}

      {/* ── Toast ───────────────────────────────────────── */}
      {toast && (
        <div className="-translate-x-1/2 fixed bottom-5 left-1/2 z-[70] rounded-lg bg-[#1a1a1a] px-4 py-2.5 text-[13px] text-white shadow-lg">
          {toast}
        </div>
      )}

      <input
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) importFile(file)
          event.target.value = ''
        }}
        ref={importInputRef}
        type="file"
      />
    </div>
  )
}
