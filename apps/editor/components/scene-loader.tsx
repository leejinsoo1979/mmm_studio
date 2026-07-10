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
import { Box3, Matrix4, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BuildTab } from './build-tab'
import { EditorHeader } from './editor-header'
import { LightingTab } from './lighting-tab'
import { MaterialTab } from './material-tab'
import { MaterialSurfaceInspector } from './material-surface-inspector'
import { CommunityViewerToolbarLeft, CommunityViewerToolbarRight } from './viewer-toolbar'
import { getStudioAuthHeaders } from '@/lib/auth-client'

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
const CENTIMETER_MODEL_THRESHOLD = 20
const MILLIMETER_MODEL_THRESHOLD = 1000

type GlbInspection = {
  dimensions: [number, number, number]
  offset: [number, number, number]
  scale: [number, number, number]
}

type GltfAccessor = {
  max?: number[]
  min?: number[]
  type?: string
}

type GltfMeshPrimitive = {
  attributes?: {
    POSITION?: number
  }
}

type GltfMesh = {
  primitives?: GltfMeshPrimitive[]
}

type GltfNode = {
  children?: number[]
  matrix?: number[]
  mesh?: number
  rotation?: number[]
  scale?: number[]
  translation?: number[]
}

type GltfJson = {
  accessors?: GltfAccessor[]
  meshes?: GltfMesh[]
  nodes?: GltfNode[]
  scene?: number
  scenes?: Array<{ nodes?: number[] }>
}

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

function inferLocalGlbUnitScale(size: Vector3): number {
  const longestSide = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(longestSide) || longestSide <= 0) return 1
  if (longestSide >= MILLIMETER_MODEL_THRESHOLD) return 0.001
  if (longestSide >= CENTIMETER_MODEL_THRESHOLD) return 0.01
  return 1
}

function inspectionFromBox(box: Box3): GlbInspection {
  if (box.isEmpty()) {
    return { dimensions: FALLBACK_GLB_DIMENSIONS, offset: [0, 0, 0], scale: [1, 1, 1] }
  }

  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  const unitScale = inferLocalGlbUnitScale(size)

  return {
    dimensions: [
      normalizeDimension(size.x * unitScale),
      normalizeDimension(size.y * unitScale),
      normalizeDimension(size.z * unitScale),
    ],
    offset: [-center.x * unitScale, -box.min.y * unitScale, -center.z * unitScale],
    scale: [unitScale, unitScale, unitScale],
  }
}

function parseGlbJson(buffer: ArrayBuffer): GltfJson | null {
  const view = new DataView(buffer)
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return null

  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    offset += 8
    if (offset + chunkLength > view.byteLength) return null

    if (chunkType === 0x4e4f534a) {
      const jsonText = new TextDecoder().decode(buffer.slice(offset, offset + chunkLength))
      return JSON.parse(jsonText.replace(/\0+$/g, '')) as GltfJson
    }
    offset += chunkLength
  }

  return null
}

function matrixFromGltfNode(node: GltfNode): Matrix4 {
  if (node.matrix?.length === 16) return new Matrix4().fromArray(node.matrix)

  const translation = new Vector3(
    node.translation?.[0] ?? 0,
    node.translation?.[1] ?? 0,
    node.translation?.[2] ?? 0,
  )
  const rotation = new Quaternion(
    node.rotation?.[0] ?? 0,
    node.rotation?.[1] ?? 0,
    node.rotation?.[2] ?? 0,
    node.rotation?.[3] ?? 1,
  )
  const scale = new Vector3(node.scale?.[0] ?? 1, node.scale?.[1] ?? 1, node.scale?.[2] ?? 1)
  return new Matrix4().compose(translation, rotation, scale)
}

function expandBoxByAccessor(box: Box3, accessor: GltfAccessor, matrix: Matrix4): boolean {
  if (accessor.type !== 'VEC3' || accessor.min?.length !== 3 || accessor.max?.length !== 3) {
    return false
  }

  const [minX, minY, minZ] = accessor.min
  const [maxX, maxY, maxZ] = accessor.max
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return false

  const corners = [
    new Vector3(minX, minY, minZ),
    new Vector3(minX, minY, maxZ),
    new Vector3(minX, maxY, minZ),
    new Vector3(minX, maxY, maxZ),
    new Vector3(maxX, minY, minZ),
    new Vector3(maxX, minY, maxZ),
    new Vector3(maxX, maxY, minZ),
    new Vector3(maxX, maxY, maxZ),
  ]

  for (const corner of corners) box.expandByPoint(corner.applyMatrix4(matrix))
  return true
}

function inspectGlbJsonBounds(buffer: ArrayBuffer): Box3 | null {
  const json = parseGlbJson(buffer)
  if (!json?.nodes?.length || !json.meshes?.length || !json.accessors?.length) return null

  const box = new Box3()
  let hasBounds = false
  const sceneIndex = json.scene ?? 0
  const rootNodeIds =
    json.scenes?.[sceneIndex]?.nodes ??
    json.nodes.map((_node, index) => index)

  const visitNode = (nodeIndex: number, parentMatrix: Matrix4) => {
    const node = json.nodes?.[nodeIndex]
    if (!node) return

    const worldMatrix = parentMatrix.clone().multiply(matrixFromGltfNode(node))
    const mesh = node.mesh === undefined ? undefined : json.meshes?.[node.mesh]
    for (const primitive of mesh?.primitives ?? []) {
      const positionAccessorIndex = primitive.attributes?.POSITION
      const accessor =
        positionAccessorIndex === undefined ? undefined : json.accessors?.[positionAccessorIndex]
      if (accessor && expandBoxByAccessor(box, accessor, worldMatrix)) {
        hasBounds = true
      }
    }

    for (const childIndex of node.children ?? []) visitNode(childIndex, worldMatrix)
  }

  for (const rootNodeId of rootNodeIds) visitNode(rootNodeId, new Matrix4())
  return hasBounds ? box : null
}

async function inspectGlb(file: File): Promise<GlbInspection> {
  const buffer = await file.arrayBuffer()
  try {
    const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>>(
      (resolve, reject) => {
        new GLTFLoader().parse(buffer, '', resolve, reject)
      },
    )
    return inspectionFromBox(new Box3().setFromObject(gltf.scene))
  } catch (error) {
    const jsonBox = inspectGlbJsonBounds(buffer)
    if (jsonBox) return inspectionFromBox(jsonBox)
    throw error
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
      scale: [1, 1, 1] as [number, number, number],
    })),
    saveAsset(file),
  ])
  const { dimensions, offset, scale } = inspection
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
    scale,
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
  const thumbnailTimerRef = useRef<number | null>(null)
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

  const requestThumbnail = useCallback(
    (delayMs = 1200) => {
      if (thumbnailTimerRef.current !== null) window.clearTimeout(thumbnailTimerRef.current)
      thumbnailTimerRef.current = window.setTimeout(() => {
        thumbnailTimerRef.current = null
        if (document.visibilityState !== 'visible') return
        emitter.emit('camera-controls:generate-thumbnail', {
          projectId: meta.id,
          snapLevels: true,
          standardSize: { w: 960, h: 540 },
        })
      }, delayMs)
    },
    [meta.id],
  )

  useEffect(() => {
    requestThumbnail(meta.thumbnailUrl ? 4000 : 2200)
    return () => {
      if (thumbnailTimerRef.current !== null) window.clearTimeout(thumbnailTimerRef.current)
    }
  }, [meta.thumbnailUrl, requestThumbnail])

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
            ...(await getStudioAuthHeaders()),
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
        requestThumbnail()
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Save failed')
      }
    },
    [meta.id, requestThumbnail, sceneName],
  )

  const handleRename = useCallback(
    async (name: string) => {
      const response = await fetch(`/api/scenes/${meta.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(versionRef.current),
          ...(await getStudioAuthHeaders()),
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
    async (blob: Blob) => {
      const response = await fetch(`/api/scenes/${meta.id}/thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'image/png', ...(await getStudioAuthHeaders()) },
        body: blob,
      })
      if (!response.ok) return
      const next = (await response.json()) as SceneMeta
      versionRef.current = next.version
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
      <MaterialSurfaceInspector />
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
