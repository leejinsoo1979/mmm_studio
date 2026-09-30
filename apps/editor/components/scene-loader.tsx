'use client'

// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` — no per-page side-effect
// import here.
import {
  type AnyNodeId,
  type AssetInput,
  emitter,
  type ItemNode,
  loadAssetUrl,
  useScene,
} from '@pascal-app/core'
import {
  applySceneGraphToEditor,
  CatalogCard,
  CatalogHero,
  Editor,
  ItemsPanel,
  type SceneGraph,
  type SidebarTab,
  useEditor,
} from '@pascal-app/editor'
import { CATALOG_ITEMS } from '@pascal-app/editor/catalog'
import { CabinetDoorControls } from '@pascal-app/nodes'
import TreesPanel from '@pascal-app/plugin-trees/panel'
import {
  Archive,
  DoorOpen,
  Flower2,
  LampCeiling,
  LandPlot,
  Loader2,
  PaintRoller,
  Sofa,
  Upload,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box3,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getStudioAuthHeaders } from '@/lib/auth-client'
import { CATALOG_ROOM_TREE, withMyModelTag, withRoomTags } from '@/lib/catalog-rooms'
import { SCENE_BACKUP_PREFIX } from '@/lib/scene-backup'
import { ArchipleFloorplanBridge } from './archiple-floorplan-bridge'
import { BuildTab } from './build-tab'
import { RoomHero } from './catalog/build-hero-art'
import { useBuildPanelPrefs } from './catalog/build-panel-prefs'
import { EditorHeader } from './editor-header'
import { FurnitureTab } from './furniture-tab'
import { LightingTab } from './lighting-tab'
import { MaterialPalette } from './material-palette'
import { MaterialSurfaceInspector } from './material-surface-inspector'
import { MaterialTab } from './material-tab'
import { SceneStatusBanner } from './scene-status-banner'
import { CommunityViewerToolbarRight } from './viewer-toolbar'
import { TourEnvironment } from './world-environment'

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
    label: '장면',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <LandPlot className="h-5 w-5" />,
    icon: <LandPlot />,
  },
  {
    id: 'draw',
    label: '짓기',
    component: BuildTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <DoorOpen className="h-5 w-5" />,
    icon: <DoorOpen />,
  },
  {
    id: 'asset',
    label: '사물',
    // The F shortcut opens the generic 'items' panel.
    aliases: ['items'],
    component: AssetTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Sofa className="h-5 w-5" />,
    icon: <Sofa />,
  },
  {
    id: 'furniture',
    label: '가구',
    component: FurnitureTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Archive className="h-5 w-5" />,
    icon: <Archive />,
  },
  {
    id: 'material',
    label: '재질',
    component: MaterialTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <PaintRoller className="h-5 w-5" />,
    icon: <PaintRoller />,
  },
  {
    id: 'lighting',
    label: '조명',
    component: LightingTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <LampCeiling className="h-5 w-5" />,
    icon: <LampCeiling />,
  },
]

const LOCAL_GLB_ITEMS_KEY = 'mmm-studio.local-glb-items.v1'
const LOCAL_GLB_THUMBNAIL = '/icons/item.webp'
const FALLBACK_GLB_DIMENSIONS: [number, number, number] = [1, 1, 1]
const CENTIMETER_MODEL_THRESHOLD = 20
const MILLIMETER_MODEL_THRESHOLD = 1000
const LOCAL_GLB_FLOORPLAN_MAX_PIXELS = 512
const LOCAL_GLB_PLACEHOLDER_FLOOR_PLAN_URLS = new Set([
  '/icons/mesh.webp',
  '/icons/item.webp',
  'https://editor.pascal.app/icons/mesh.webp',
  'https://editor.pascal.app/icons/item.webp',
])
const LOCAL_GLB_FLOORPLAN_MARKER = 'mmm-topview-visible-v3'

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
    isLocalGlbSource(item.src) &&
    Array.isArray(item.dimensions)
  )
}

function isLocalGlbSource(src: string): boolean {
  return src.startsWith('asset://') || src.startsWith('data:model/gltf-binary')
}

function isLocalGlbPlaceholderFloorPlan(url: string | undefined): boolean {
  return (
    !!url &&
    (LOCAL_GLB_PLACEHOLDER_FLOOR_PLAN_URLS.has(url) ||
      url.startsWith('data:image/png') ||
      (url.startsWith('data:image/svg+xml') && !url.includes(LOCAL_GLB_FLOORPLAN_MARKER)))
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
  const rootNodeIds = json.scenes?.[sceneIndex]?.nodes ?? json.nodes.map((_node, index) => index)

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
        const loader = new GLTFLoader()
        loader.setMeshoptDecoder(MeshoptDecoder)
        loader.parse(buffer, '', resolve, reject)
      },
    )
    return inspectionFromBox(new Box3().setFromObject(gltf.scene))
  } catch (error) {
    const jsonBox = inspectGlbJsonBounds(buffer)
    if (jsonBox) return inspectionFromBox(jsonBox)
    throw error
  }
}

async function parseGlbScene(buffer: ArrayBuffer): Promise<Object3D> {
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>>(
    (resolve, reject) => {
      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)
      loader.parse(buffer.slice(0), '', resolve, reject)
    },
  )
  return gltf.scene
}

function renderTopViewFloorPlanImage(source: Object3D): string | null {
  if (typeof document === 'undefined') return null

  const root = source.clone(true)
  const box = new Box3().setFromObject(root)
  if (box.isEmpty()) return null

  const size = box.getSize(new Vector3())
  if (size.x <= 0 || size.z <= 0) return null

  const center = box.getCenter(new Vector3())
  root.position.x -= center.x
  root.position.y -= center.y
  root.position.z -= center.z

  const fillMaterial = new MeshBasicMaterial({ color: '#ffffff' })
  const edgeMaterial = new LineBasicMaterial({
    color: '#111111',
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  })
  const edgePairs: Array<{ mesh: Mesh; edge: LineSegments }> = []

  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.geometry) return

    mesh.material = fillMaterial
    const edges = new LineSegments(new EdgesGeometry(mesh.geometry, 35), edgeMaterial)
    edges.position.copy(mesh.position)
    edges.quaternion.copy(mesh.quaternion)
    edges.scale.copy(mesh.scale)
    edges.renderOrder = 10
    edgePairs.push({ mesh, edge: edges })
    mesh.renderOrder = 1
  })

  for (const { mesh, edge } of edgePairs) mesh.parent?.add(edge)

  const longest = Math.max(size.x, size.z)
  const pixelWidth = Math.max(96, Math.round((LOCAL_GLB_FLOORPLAN_MAX_PIXELS * size.x) / longest))
  const pixelHeight = Math.max(96, Math.round((LOCAL_GLB_FLOORPLAN_MAX_PIXELS * size.z) / longest))
  const margin = 1.08
  const halfWidth = Math.max((size.x * margin) / 2, 0.05)
  const halfDepth = Math.max((size.z * margin) / 2, 0.05)
  const camera = new OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfDepth,
    -halfDepth,
    0.01,
    Math.max(size.y * 4, 10),
  )
  camera.position.set(0, Math.max(size.y * 2, 2), 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()

  const renderScene = new Scene()
  renderScene.add(root)

  const renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setClearColor(0xffffff, 0)
  renderer.setSize(pixelWidth, pixelHeight, false)
  renderer.render(renderScene, camera)
  const dataUrl = renderer.domElement.toDataURL('image/png')

  renderer.dispose()
  fillMaterial.dispose()
  edgeMaterial.dispose()
  root.traverse((child) => {
    if (child instanceof LineSegments) child.geometry.dispose()
  })

  return dataUrl
}

function pointToSvg(
  point: Vector3,
  bounds: Box3,
  scale: number,
  padding: number,
): [number, number] {
  return [(point.x - bounds.min.x + padding) * scale, (point.z - bounds.min.z + padding) * scale]
}

function renderTopViewFloorPlanSvg(source: Object3D): string | null {
  const root = source.clone(true)
  const sourceBox = new Box3().setFromObject(root)
  if (sourceBox.isEmpty()) return null

  const sourceSize = sourceBox.getSize(new Vector3())
  if (sourceSize.x <= 0 || sourceSize.z <= 0) return null

  const center = sourceBox.getCenter(new Vector3())
  root.position.x -= center.x
  root.position.y -= center.y
  root.position.z -= center.z
  root.updateWorldMatrix(true, true)

  const bounds = new Box3().setFromObject(root)
  const size = bounds.getSize(new Vector3())
  const longest = Math.max(size.x, size.z)
  if (longest <= 0) return null

  const padding = longest * 0.04
  const scale = LOCAL_GLB_FLOORPLAN_MAX_PIXELS / (longest + padding * 2)
  const width = Math.max(96, Math.ceil((size.x + padding * 2) * scale))
  const height = Math.max(96, Math.ceil((size.z + padding * 2) * scale))
  const fillPaths: string[] = []
  const edgeCounts = new Map<string, { count: number; path: string }>()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const ab = new Vector3()
  const ac = new Vector3()
  const normal = new Vector3()

  const addBoundaryEdge = (p1: Vector3, p2: Vector3): void => {
    const [x1, y1] = pointToSvg(p1, bounds, scale, padding)
    const [x2, y2] = pointToSvg(p2, bounds, scale, padding)
    const start = `${x1.toFixed(2)} ${y1.toFixed(2)}`
    const end = `${x2.toFixed(2)} ${y2.toFixed(2)}`
    const key = start < end ? `${start}|${end}` : `${end}|${start}`
    const existing = edgeCounts.get(key)
    if (existing) {
      existing.count += 1
    } else {
      edgeCounts.set(key, { count: 1, path: `M${start}L${end}` })
    }
  }

  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.geometry || mesh.name === 'cutout') return

    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    if (!position || position.count <= 0) return

    const index = geometry.getIndex()
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3)
    const triangleStep = Math.max(1, Math.ceil(triangleCount / 6000))

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += triangleStep) {
      const ia = index ? index.getX(triangleIndex * 3) : triangleIndex * 3
      const ib = index ? index.getX(triangleIndex * 3 + 1) : triangleIndex * 3 + 1
      const ic = index ? index.getX(triangleIndex * 3 + 2) : triangleIndex * 3 + 2
      a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld)

      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize()
      if (normal.y < 0.28) continue

      const [ax, ay] = pointToSvg(a, bounds, scale, padding)
      const [bx, by] = pointToSvg(b, bounds, scale, padding)
      const [cx, cy] = pointToSvg(c, bounds, scale, padding)
      fillPaths.push(
        `M${ax.toFixed(2)} ${ay.toFixed(2)}L${bx.toFixed(2)} ${by.toFixed(2)}L${cx.toFixed(2)} ${cy.toFixed(2)}Z`,
      )
      addBoundaryEdge(a, b)
      addBoundaryEdge(b, c)
      addBoundaryEdge(c, a)
    }
  })

  if (!fillPaths.length) return null

  const edgePaths = [...edgeCounts.values()]
    .filter((edge) => edge.count === 1)
    .map((edge) => edge.path)

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" data-mmm-topview="${LOCAL_GLB_FLOORPLAN_MARKER}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<path d="${fillPaths.join('')}" fill="#fff" stroke="none"/>`,
    edgePaths.length
      ? `<path d="${edgePaths.join('')}" fill="none" stroke="#222" stroke-width="0.45" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
      : '',
    '</svg>',
  ].join('')

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

async function createLocalGlbFloorPlanUrlFromBuffer(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const scene = await parseGlbScene(buffer)
    return renderTopViewFloorPlanSvg(scene) ?? renderTopViewFloorPlanImage(scene)
  } catch {
    return null
  }
}

async function createLocalGlbFloorPlanUrl(file: File): Promise<string | null> {
  return createLocalGlbFloorPlanUrlFromBuffer(await file.arrayBuffer())
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

async function createPersistentGlbDataUrl(file: File): Promise<string> {
  return `data:model/gltf-binary;base64,${arrayBufferToBase64(await file.arrayBuffer())}`
}

async function createLocalGlbItem(file: File): Promise<AssetInput> {
  const lowerName = file.name.toLowerCase()
  if (!lowerName.endsWith('.glb')) {
    throw new Error('GLB 파일만 불러올 수 있습니다.')
  }

  const [inspection, assetUrl, floorPlanUrl] = await Promise.all([
    inspectGlb(file).catch(() => ({
      dimensions: FALLBACK_GLB_DIMENSIONS,
      offset: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    })),
    createPersistentGlbDataUrl(file),
    createLocalGlbFloorPlanUrl(file),
  ])
  const { dimensions, offset, scale } = inspection
  const id = crypto.randomUUID()

  return {
    id: `local-glb-${id}`,
    category: 'furniture',
    name: glbDisplayName(file.name),
    thumbnail: LOCAL_GLB_THUMBNAIL,
    ...(floorPlanUrl ? { floorPlanUrl } : {}),
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

const ROOM_TAGGED_CATALOG = withRoomTags(CATALOG_ITEMS)

function AssetHero({ name, slug }: { name: string; slug: string }) {
  const collapsed = useBuildPanelPrefs((s) => s.heroCollapsed)
  const toggle = useBuildPanelPrefs((s) => s.toggleHero)
  // '자연 (나무·꽃·풀)' → '자연'; '내 모델' stays whole.
  return (
    <CatalogHero collapsed={collapsed} label={name.replace(/\s*\(.*\)$/, '')} onToggle={toggle}>
      <RoomHero room={slug} />
    </CatalogHero>
  )
}

/** Left-rail asset catalog, browsed inZOI-style: room tabs, then kinds. */
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
      setUploadError(error instanceof Error ? error.message : 'GLB를 가져오지 못했습니다.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex h-full flex-col text-foreground">
      <ItemsPanel
        customCategories={[
          {
            id: 'nature',
            label: '자연 (나무·꽃·풀)',
            icon: <Flower2 />,
            content: <TreesPanel />,
          },
        ]}
        extraItems={withMyModelTag(localItems)}
        functionTree={CATALOG_ROOM_TREE}
        items={ROOM_TAGGED_CATALOG}
        leadingTile={
          <>
            <CatalogCard
              disabled={uploading}
              hover={{ description: '내 컴퓨터의 GLB 모델을 가져와 바로 배치합니다.' }}
              label={uploading ? '가져오는 중…' : 'GLB 가져오기'}
              meta="GLB"
              onClick={() => inputRef.current?.click()}
              thumb={
                uploading ? (
                  <Loader2 className="size-7 animate-spin text-[#555]" strokeWidth={1.5} />
                ) : (
                  <Upload className="size-7 text-[#555] dark:text-neutral-300" strokeWidth={1.5} />
                )
              }
            />
            <input
              accept=".glb,model/gltf-binary"
              className="hidden"
              onChange={handleFileChange}
              ref={inputRef}
              type="file"
            />
          </>
        }
        renderHero={(room) => <AssetHero name={room.name} slug={room.slug} />}
        showSourceFilter={false}
        showTagFilters={false}
      />
      {uploadError && (
        <div className="mx-2.5 mb-2 shrink-0 rounded-lg bg-white/90 px-3 py-2 text-[#d64545] text-xs dark:bg-neutral-900/90 dark:text-[#ff9a9a]">
          {uploadError}
        </div>
      )}
    </div>
  )
}

function LocalGlbFloorPlanSync() {
  const generatingRef = useRef(new Set<string>())
  const missingSignature = useScene((state) =>
    Object.values(state.nodes)
      .filter(
        (node): node is ItemNode =>
          node.type === 'item' &&
          isLocalGlbSource(node.asset.src) &&
          (!node.asset.floorPlanUrl || isLocalGlbPlaceholderFloorPlan(node.asset.floorPlanUrl)),
      )
      .map((node) => `${node.id}:${node.asset.src}`)
      .join('|'),
  )

  useEffect(() => {
    if (!missingSignature) return

    const candidates = Object.values(useScene.getState().nodes).filter(
      (node): node is ItemNode =>
        node.type === 'item' &&
        isLocalGlbSource(node.asset.src) &&
        (!node.asset.floorPlanUrl || isLocalGlbPlaceholderFloorPlan(node.asset.floorPlanUrl)),
    )

    for (const node of candidates) {
      if (generatingRef.current.has(node.id)) continue
      generatingRef.current.add(node.id)

      void (async () => {
        try {
          const resolvedUrl = await loadAssetUrl(node.asset.src)
          if (!resolvedUrl) return

          const response = await fetch(resolvedUrl)
          if (!response.ok) return

          const floorPlanUrl = await createLocalGlbFloorPlanUrlFromBuffer(
            await response.arrayBuffer(),
          )
          if (!floorPlanUrl) return

          const current = useScene.getState().nodes[node.id as AnyNodeId]
          if (
            current?.type !== 'item' ||
            current.asset.src !== node.asset.src ||
            (current.asset.floorPlanUrl &&
              !isLocalGlbPlaceholderFloorPlan(current.asset.floorPlanUrl))
          ) {
            return
          }

          useScene.getState().updateNode(
            node.id as AnyNodeId,
            {
              asset: { ...current.asset, floorPlanUrl },
            } as Partial<ItemNode>,
          )
        } finally {
          generatingRef.current.delete(node.id)
        }
      })()
    }
  }, [missingSignature])

  return null
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
  const lastSavedGraphJsonRef = useRef<string | null>(null)
  // Saves, renames and thumbnail uploads each bump the scene version, so they
  // run one at a time: an overlapping request would carry a stale If-Match.
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [liveLost, setLiveLost] = useState(false)
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

  const enqueueWrite = useCallback(<T,>(write: () => Promise<T>): Promise<T> => {
    const run = writeChainRef.current.then(write, write)
    writeChainRef.current = run.catch(() => undefined)
    return run
  }, [])

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
        const put = async () =>
          fetch(`/api/scenes/${meta.id}`, {
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
        // The unload flush can't wait behind a queued write.
        const response = options?.keepalive ? await put() : await enqueueWrite(put)

        if (response.status === 409) {
          setConflict(true)
          return
        }

        if (!response.ok) {
          setSaveError(`저장하지 못했습니다 (${response.status}). 다음 변경 때 다시 저장합니다.`)
          return
        }

        const next = (await response.json()) as SceneMeta
        versionRef.current = next.version
        lastSavedGraphJsonRef.current = graphJson
        setSaveError(null)
        requestThumbnail()
      } catch (error) {
        setSaveError(
          error instanceof Error && error.message
            ? `저장하지 못했습니다: ${error.message}`
            : '저장하지 못했습니다. 연결을 확인하세요.',
        )
      }
    },
    [enqueueWrite, meta.id, requestThumbnail, sceneName],
  )

  const handleRename = useCallback(
    async (name: string) => {
      const response = await enqueueWrite(async () =>
        fetch(`/api/scenes/${meta.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(versionRef.current),
            ...(await getStudioAuthHeaders()),
          },
          body: JSON.stringify({ name }),
        }),
      )
      if (response.status === 409) {
        setConflict(true)
        throw new Error('Version conflict')
      }
      if (!response.ok) {
        const message = `이름을 바꾸지 못했습니다 (${response.status})`
        setSaveError(message)
        throw new Error(message)
      }
      const next = (await response.json()) as SceneMeta
      versionRef.current = next.version
      setSceneName(next.name)
      setSaveError(null)
    },
    [enqueueWrite, meta.id],
  )

  useEffect(() => {
    let source: EventSource | null = null
    let retryTimer: number | undefined
    let failures = 0

    const onScene = (event: Event) => {
      let payload: LiveSceneEvent
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as LiveSceneEvent
      } catch {
        return
      }
      if (payload.sceneId !== meta.id) return
      if (payload.version <= versionRef.current) return

      versionRef.current = payload.version
      // Our own graph echoed back (a rename or thumbnail upload): re-applying
      // it would drop edits made since that save.
      const remoteGraphJson = sceneGraphSignature(payload.graph)
      if (remoteGraphJson === lastSavedGraphJsonRef.current) return
      lastSavedGraphJsonRef.current = remoteGraphJson
      lastRemoteGraphJsonRef.current = remoteGraphJson
      suppressRemoteSaveUntilRef.current = Date.now() + 2500
      applySceneGraphToEditor(payload.graph)
      setConflict(false)
      setSaveError(null)
    }

    // The browser retries a dropped stream itself but gives up on a failed
    // response (a server restart or a route still compiling), so reconnect
    // with a backoff and only report a connection that keeps failing.
    const connect = () => {
      const current = new EventSource(`/api/scenes/${meta.id}/events`)
      source = current
      current.addEventListener('open', () => {
        failures = 0
        setLiveLost(false)
      })
      current.addEventListener('scene', onScene)
      current.addEventListener('error', () => {
        if (current.readyState !== EventSource.CLOSED) return
        failures += 1
        if (failures >= 3) setLiveLost(true)
        retryTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** failures))
      })
    }
    connect()

    return () => {
      window.clearTimeout(retryTimer)
      source?.close()
    }
  }, [meta.id])

  const handleThumb = useCallback(
    async (blob: Blob) => {
      await enqueueWrite(async () => {
        const response = await fetch(`/api/scenes/${meta.id}/thumbnail`, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'image/png', ...(await getStudioAuthHeaders()) },
          body: blob,
        })
        if (!response.ok) return
        const next = (await response.json()) as SceneMeta
        versionRef.current = Math.max(versionRef.current, next.version)
      })
    },
    [enqueueWrite, meta.id],
  )

  return (
    <div className="relative h-screen w-screen">
      <MaterialSurfaceInspector />
      <LocalGlbFloorPlanSync />
      <Editor
        layoutVersion="v2"
        navbarSlot={<EditorHeader onRename={handleRename} sceneName={sceneName} />}
        onLoad={handleLoad}
        onSave={handleSave}
        saveBackupKey={`${SCENE_BACKUP_PREFIX}${meta.id}`}
        onThumbnailCapture={handleThumb}
        projectId={meta.projectId ?? 'default'}
        sidebarTabs={SIDEBAR_TABS}
        viewerBanner={
          <>
            <SceneStatusBanner
              conflict={conflict}
              error={
                saveError ??
                (liveLost ? '실시간 동기화 연결이 끊겼습니다. 다시 연결하는 중입니다.' : null)
              }
              onDismiss={() => {
                setConflict(false)
                setSaveError(null)
                setLiveLost(false)
              }}
              onReload={() => router.refresh()}
            />
            <ArchipleFloorplanBridge />
            <CabinetDoorControls />
            <MaterialPalette />
            <TourEnvironment />
          </>
        }
        viewerToolbarRight={<CommunityViewerToolbarRight sceneId={meta.id} sceneName={sceneName} />}
      />
    </div>
  )
}
