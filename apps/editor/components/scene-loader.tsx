'use client'

// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` — no per-page side-effect
// import here.
import { type AssetInput, emitter, saveAsset } from '@pascal-app/core'
import {
  applySceneGraphToEditor,
  Editor,
  ItemsPanel,
  type SceneGraph,
  type SidebarTab,
  useEditor,
} from '@pascal-app/editor'
import {
  Bot,
  Box,
  Brush,
  DraftingCompass,
  Layers,
  Lightbulb,
  Loader2,
  PanelTop,
  Sparkles,
  SwatchBook,
  Upload,
  UserRound,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Box3, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BuildTab } from './build-tab'
import { EditorHeader } from './editor-header'
import { LightingTab } from './lighting-tab'
import { MaterialTab } from './material-tab'
import { CommunityViewerToolbarLeft, CommunityViewerToolbarRight } from './viewer-toolbar'

export interface SceneMeta {
  id: string
  name: string
  projectId: string | null
  thumbnailUrl: string | null
  version: number
  createdAt: string
  updatedAt: string
  ownerId: string | null
  sizeBytes: number
  nodeCount: number
}

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
    icon: <Layers />,
  },
  {
    id: 'draw',
    label: 'Draw',
    component: BuildTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <DraftingCompass className="h-5 w-5" />,
    icon: <DraftingCompass />,
  },
  {
    id: 'asset',
    label: 'Asset',
    component: AssetTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Box className="h-5 w-5" />,
    icon: <Box />,
  },
  {
    id: 'material',
    label: 'Material',
    component: MaterialTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <SwatchBook className="h-5 w-5" />,
    icon: <SwatchBook />,
  },
  {
    id: 'lighting',
    label: 'Lighting',
    component: LightingTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Lightbulb className="h-5 w-5" />,
    icon: <Lightbulb />,
  },
  {
    id: 'public',
    label: 'Public',
    component: () => <CategoryPanel title="Public" />,
    mobileDefaultSnap: 0.5,
    mobileIcon: <PanelTop className="h-5 w-5" />,
    icon: <PanelTop />,
  },
  {
    id: 'advanced-tool',
    label: 'Advanced Tool',
    component: () => <CategoryPanel title="Advanced Tool" />,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Sparkles className="h-5 w-5" />,
    icon: <Sparkles />,
  },
  {
    id: 'ai',
    label: 'AI',
    component: () => <CategoryPanel title="AI" />,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Bot className="h-5 w-5" />,
    icon: <Bot />,
  },
  {
    id: 'my-page',
    label: 'My Page',
    component: () => <CategoryPanel title="My Page" />,
    mobileDefaultSnap: 0.5,
    mobileIcon: <UserRound className="h-5 w-5" />,
    icon: <UserRound />,
  },
]

const LOCAL_GLB_ITEMS_KEY = 'mmm-studio.local-glb-items.v1'
const LOCAL_GLB_THUMBNAIL = 'https://editor.pascal.app/icons/mesh.webp'
const FALLBACK_GLB_DIMENSIONS: [number, number, number] = [1, 1, 1]

function loadLocalGlbItems(): AssetInput[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(LOCAL_GLB_ITEMS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLocalGlbItem)
  } catch {
    return []
  }
}

function persistLocalGlbItems(items: AssetInput[]) {
  window.localStorage.setItem(LOCAL_GLB_ITEMS_KEY, JSON.stringify(items))
}

function isLocalGlbItem(value: unknown): value is AssetInput {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.src === 'string' &&
    item.src.startsWith('asset://') &&
    Array.isArray(item.dimensions)
  )
}

function glbDisplayName(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return base || 'Local GLB'
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.max(value, 0.01)
}

async function inspectGlb(file: File): Promise<{
  dimensions: [number, number, number]
  offset: [number, number, number]
}> {
  const buffer = await file.arrayBuffer()
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>>(
    (resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, reject)
    },
  )
  const box = new Box3().setFromObject(gltf.scene)

  if (box.isEmpty()) {
    return { dimensions: FALLBACK_GLB_DIMENSIONS, offset: [0, 0, 0] }
  }

  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  return {
    dimensions: [
      normalizeDimension(size.x),
      normalizeDimension(size.y),
      normalizeDimension(size.z),
    ],
    offset: [-center.x, -box.min.y, -center.z],
  }
}

async function createLocalGlbItem(file: File): Promise<AssetInput> {
  const lowerName = file.name.toLowerCase()
  if (!lowerName.endsWith('.glb')) {
    throw new Error('GLB 파일만 불러올 수 있습니다.')
  }

  const [inspection, assetUrl] = await Promise.all([
    inspectGlb(file).catch(() => ({
      dimensions: FALLBACK_GLB_DIMENSIONS,
      offset: [0, 0, 0] as [number, number, number],
    })),
    saveAsset(file),
  ])
  const { dimensions, offset } = inspection
  const id = crypto.randomUUID()

  return {
    id: `local-glb-${id}`,
    category: 'furniture',
    name: glbDisplayName(file.name),
    thumbnail: LOCAL_GLB_THUMBNAIL,
    src: assetUrl,
    dimensions,
    offset,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    source: 'mine',
    isDraft: true,
    tags: ['floor', 'local', 'glb'],
  }
}

function AssetTab() {
  const [localItems, setLocalItems] = useState<AssetInput[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLocalItems(loadLocalGlbItems())
  }, [])

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploading(true)
    setUploadError(null)
    try {
      const item = await createLocalGlbItem(file)
      const nextItems = [item, ...loadLocalGlbItems().filter((existing) => existing.id !== item.id)]
      persistLocalGlbItems(nextItems)
      setLocalItems(nextItems)
      useEditor.getState().setSelectedItem(item)
      useEditor.getState().setTool('item')
      useEditor.getState().setMode('build')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not import that GLB.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="h-full bg-[#1b1b1b] text-[#efefef]">
      <ItemsPanel
        extraItems={localItems}
        leadingTile={
          <button
            className="group relative flex min-h-[122px] flex-col gap-1.5 rounded-xl border border-dashed border-[#555] bg-[#242424] p-1.5 text-left transition-colors hover:border-[#7779ff] hover:bg-[#2b2b32]"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-[#202035] text-[#9a9cff]">
              {uploading ? (
                <Loader2 className="h-7 w-7 animate-spin" />
              ) : (
                <Upload className="h-7 w-7" />
              )}
            </div>
            <span className="truncate px-0.5 font-medium text-[11px] text-[#d8d8d8]">
              {uploading ? 'Importing...' : 'Import GLB'}
            </span>
            <input
              accept=".glb,model/gltf-binary"
              className="hidden"
              onChange={handleFileChange}
              ref={inputRef}
              type="file"
            />
          </button>
        }
        showSourceFilter={false}
        showTagFilters={false}
      />
      {uploadError && (
        <div className="border-[#343434] border-t bg-[#251b1b] px-3 py-2 text-[#ff9a9a] text-xs">
          {uploadError}
        </div>
      )}
    </div>
  )
}

function CategoryPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col bg-[#1b1b1b] text-[#efefef]">
      <div className="flex h-[124px] shrink-0 items-center border-[#343434] border-b px-8">
        <h1 className="font-bold text-[32px] tracking-[-0.02em]">{title}</h1>
      </div>
      <div className="flex flex-1 items-center justify-center px-8 text-center">
        <div className="max-w-[320px] rounded-[10px] border border-[#444] bg-[#202020] px-6 py-8 text-[#bdbdbd]">
          <Brush className="mx-auto mb-4 h-9 w-9 text-[#7779ff]" />
          <p className="font-semibold text-lg text-[#f0f0f0]">{title}</p>
          <p className="mt-2 text-sm">This category is ready for its tools.</p>
        </div>
      </div>
    </div>
  )
}

interface SceneLoaderProps {
  initialScene: SceneGraph
  meta: SceneMeta
}

type SceneGraphWithCollections = SceneGraph & {
  collections?: Record<string, unknown>
}

interface LiveSceneEvent {
  eventId: number
  sceneId: string
  version: number
  kind: string
  createdAt: string
  graph: SceneGraphWithCollections
}

function sceneGraphSignature(graph: SceneGraphWithCollections): string {
  return JSON.stringify({
    nodes: graph.nodes,
    rootNodeIds: graph.rootNodeIds,
    collections: graph.collections,
  })
}

function computeInitialSceneBounds(graph: SceneGraph) {
  const nodes = Object.values(graph.nodes ?? {}) as Array<Record<string, unknown>>
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    hasPoint: false,
  }

  const extend = (x: unknown, z: unknown) => {
    if (typeof x !== 'number' || typeof z !== 'number') return
    if (!(Number.isFinite(x) && Number.isFinite(z))) return
    bounds.minX = Math.min(bounds.minX, x)
    bounds.minZ = Math.min(bounds.minZ, z)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.maxZ = Math.max(bounds.maxZ, z)
    bounds.hasPoint = true
  }

  for (const node of nodes) {
    const start = node.start
    const end = node.end
    const polygon = node.polygon
    const position = node.position

    if (Array.isArray(start)) extend(start[0], start[1])
    if (Array.isArray(end)) extend(end[0], end[1])
    if (Array.isArray(polygon)) {
      for (const point of polygon) {
        if (Array.isArray(point)) extend(point[0], point[1])
      }
    }
    if (Array.isArray(position)) extend(position[0], position[2])
  }

  if (!bounds.hasPoint) return null

  const min: [number, number] = [bounds.minX, bounds.minZ]
  const max: [number, number] = [bounds.maxX, bounds.maxZ]
  const center: [number, number] = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ]
  const size: [number, number] = [
    Math.max(bounds.maxX - bounds.minX, 0.001),
    Math.max(bounds.maxZ - bounds.minZ, 0.001),
  ]

  return { min, max, center, size }
}

export function SceneLoader({ initialScene, meta }: SceneLoaderProps) {
  const router = useRouter()
  const versionRef = useRef(meta.version)
  const lastRemoteGraphJsonRef = useRef<string | null>(null)
  const suppressRemoteSaveUntilRef = useRef(0)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [sceneName, setSceneName] = useState(meta.name)

  useEffect(() => {
    const bounds = computeInitialSceneBounds(initialScene)
    const forceVisible3d = () => {
      const editor = useEditor.getState()
      editor.setActiveSidebarPanel('draw')
      editor.setViewMode('3d')
      emitter.emit('camera-controls:fit-scene', bounds ? { bounds } : {})
    }

    forceVisible3d()
    const timers = [
      window.setTimeout(forceVisible3d, 100),
      window.setTimeout(forceVisible3d, 500),
      window.setTimeout(forceVisible3d, 1500),
    ]

    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [initialScene])

  const handleLoad = useCallback(async () => initialScene, [initialScene])

  const handleSave = useCallback(
    async (graph: SceneGraph, options?: { keepalive?: boolean }) => {
      const graphJson = sceneGraphSignature(graph)
      const isRecentRemoteApply = Date.now() < suppressRemoteSaveUntilRef.current
      if (lastRemoteGraphJsonRef.current === graphJson) {
        lastRemoteGraphJsonRef.current = null
        suppressRemoteSaveUntilRef.current = 0
        return
      }
      if (isRecentRemoteApply) return

      try {
        const response = await fetch(`/api/scenes/${meta.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(versionRef.current),
          },
          body: JSON.stringify({ name: sceneName, graph }),
          // `keepalive` lets the request outlive a page unload (the autosave
          // flush on refresh/close). Browsers cap keepalive bodies at 64KB, so
          // only the unload flush opts in — normal debounced saves omit it and
          // can carry arbitrarily large scenes.
          keepalive: options?.keepalive,
        })

        if (response.status === 409) {
          setConflict(true)
          return
        }

        if (!response.ok) {
          setSaveError(`Save failed (${response.status})`)
          return
        }

        const next = (await response.json()) as SceneMeta
        versionRef.current = next.version
        setSaveError(null)
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Save failed')
      }
    },
    [meta.id, sceneName],
  )

  const handleRename = useCallback(
    async (name: string) => {
      const response = await fetch(`/api/scenes/${meta.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(versionRef.current),
        },
        body: JSON.stringify({ name }),
      })
      if (response.status === 409) {
        setConflict(true)
        throw new Error('Version conflict')
      }
      if (!response.ok) {
        const message = `Rename failed (${response.status})`
        setSaveError(message)
        throw new Error(message)
      }
      const next = (await response.json()) as SceneMeta
      versionRef.current = next.version
      setSceneName(next.name)
      setSaveError(null)
    },
    [meta.id],
  )

  useEffect(() => {
    const source = new EventSource(`/api/scenes/${meta.id}/events`)

    source.addEventListener('scene', (event) => {
      let payload: LiveSceneEvent
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as LiveSceneEvent
      } catch {
        return
      }
      if (payload.sceneId !== meta.id) return
      if (payload.version <= versionRef.current) return

      versionRef.current = payload.version
      lastRemoteGraphJsonRef.current = sceneGraphSignature(payload.graph)
      suppressRemoteSaveUntilRef.current = Date.now() + 2500
      applySceneGraphToEditor(payload.graph)
      setConflict(false)
      setSaveError(null)
    })

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        setSaveError('Live scene connection closed')
      }
    })

    return () => source.close()
  }, [meta.id])

  const handleThumb = useCallback(
    async (_blob: Blob) => {
      // TODO(phase7): upload thumbnail via POST /api/scenes/[id]/thumbnail.
      // Stub endpoint is not yet implemented in v0.1 — skip upload for now.
      await fetch(`/api/scenes/${meta.id}/thumbnail`, {
        method: 'POST',
        // Intentionally no body — endpoint is a stub.
      }).catch(() => {
        // Swallow errors silently; thumbnail upload is best-effort.
      })
    },
    [meta.id],
  )

  return (
    <div className="relative h-screen w-screen">
      {conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-4 shadow-xl">
          <h2 className="font-semibold text-sm">Another session saved first — refresh?</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Your changes haven&apos;t been saved. Reload to pick up the latest version.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80"
              onClick={() => router.refresh()}
              type="button"
            >
              Reload
            </button>
            <button
              className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
              onClick={() => setConflict(false)}
              type="button"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {saveError && !conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background p-3 shadow-xl">
          <p className="font-medium text-destructive text-xs">{saveError}</p>
        </div>
      )}
      <Editor
        layoutVersion="v2"
        navbarSlot={
          <EditorHeader onRename={handleRename} sceneId={meta.id} sceneName={sceneName} />
        }
        onLoad={handleLoad}
        onSave={handleSave}
        onThumbnailCapture={handleThumb}
        projectId={meta.projectId ?? 'default'}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
