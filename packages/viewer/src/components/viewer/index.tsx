'use client'

import {
  type AnyNodeId,
  nodeRegistry,
  StairOpeningSystem,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { Canvas, extend, type ThreeElement, useFrame, useThree } from '@react-three/fiber'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import * as THREE from 'three/webgpu'
import { PERF_OVERLAY_ENABLED, pushGpuSample } from '../../lib/gpu-perf'
import { applyIsolation, clearIsolation } from '../../lib/isolation'
import { ensureKtx2Support } from '../../lib/ktx2-loader'
import type { ColorPreset, RenderShading } from '../../lib/materials'
import { getSceneTheme } from '../../lib/scene-themes'
import { installSheenSafeMaterial } from '../../lib/sheen-safe-material'
import { toneMappingFor } from '../../lib/tone-mapping'
import { installDrawGuards, rendererForCanvas, watchGpuDevice } from '../../lib/webgpu-renderer'
import useViewer, { type RenderContext } from '../../store/use-viewer'
import { FloorElevationSystem } from '../../systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../systems/geometry/geometry-system'
import { ErrorBoundary } from '../error-boundary'
import { SceneRenderer } from '../renderers/scene-renderer'
import FrameLimiter from './frame-limiter'
import { Lights } from './lights'
import { PerfMonitor } from './perf-monitor'
import PostProcessing, {
  DEFAULT_HOVER_STYLES,
  DEFAULT_SELECTION_STYLE,
  type HoverStyles,
  type SelectionOutlineStyle,
} from './post-processing'
import { RegisteredSystems } from './registered-systems'
import { SceneBvh } from './scene-bvh'
import { SelectionManager } from './selection-manager'
import { ViewerCamera } from './viewer-camera'
import { WeatherSystem } from './weather-system'

declare module '@react-three/fiber' {
  // The TS 7 native compiler (tsgo) rejects mapping the entire `three/webgpu`
  // namespace into JSX — `ThreeToJSXElements<typeof THREE>` triggers a TS2320
  // heritage conflict with R3F's core-three base plus a TS2590 "union too
  // complex". tsc 6 tolerates it; tsgo does not. R3F's base ThreeElements
  // already covers core three, so we extract only the webgpu/TSL node materials
  // we actually use as JSX (see r3f.docs.pmnd.rs/api/typescript).
  interface ThreeElements {
    lineBasicNodeMaterial: ThreeElement<typeof THREE.LineBasicNodeMaterial>
  }
}

extend(THREE as any)

const SCENE_READY_SETTLED_FRAMES = 2
const SCENE_READY_MAX_WAIT_FRAMES = 180
const DIRTY_BUILD_KINDS = new Set([
  'ceiling',
  'door',
  'item',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'wall',
  'window',
])

function canCreateWebGLContext() {
  if (typeof document === 'undefined') return false

  const canvas = document.createElement('canvas')
  try {
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function canMountGpuViewer() {
  if (typeof window === 'undefined') return false
  if (!('gpu' in navigator) && !canCreateWebGLContext()) return false

  return true
}

function UnsupportedGpuViewerFallback() {
  return (
    <div className="flex h-full min-h-64 w-full items-center justify-center bg-[#fafafa] p-6 text-center text-neutral-900">
      <div className="max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-lg">3D viewer unavailable</h2>
        <p className="mt-2 text-neutral-600 text-sm">
          This browser or environment does not expose WebGPU or WebGL, so Pascal cannot render the
          3D scene here. Try opening the editor in a browser with hardware acceleration enabled.
        </p>
      </div>
    </div>
  )
}

/** Monitors the WebGPU device for loss and uncaptured errors (see `watchGpuDevice`). */
function GPUDeviceWatcher() {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    // Detect KTX2 transcode support as soon as the renderer exists, so catalog
    // `.ktx2` finish textures load even in scenes with no GLB items (whose
    // loader would otherwise be the only thing to call this).
    ensureKtx2Support(gl)

    const device = (gl as any).backend?.device as
      | { label?: string; features?: Set<string> }
      | undefined
    if (device) {
      console.log('[viewer] WebGPU device ready', {
        label: device.label,
        features: Array.from(device.features ?? []),
      })
    }
    return watchGpuDevice(gl as unknown as THREE.WebGPURenderer)
  }, [gl])

  return null
}

function ToneMappingExposure() {
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const shading = useViewer((state) => state.shading)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    gl.toneMapping = toneMappingFor(shading)
    gl.toneMappingExposure = getSceneTheme(sceneTheme).toneMappingExposure
    invalidate()
  }, [gl, invalidate, sceneTheme, shading])

  return null
}

function hasPendingSceneBuildWork() {
  const { dirtyNodes, nodes } = useScene.getState()

  for (const id of dirtyNodes) {
    const node = nodes[id]
    if (!node) continue
    const def = nodeRegistry.get(node.type)
    if (def?.geometry || def?.capabilities?.floorPlaced || DIRTY_BUILD_KINDS.has(node.type)) {
      return true
    }
  }

  return false
}

function hasCommittedSceneRoot() {
  const { nodes, rootNodeIds } = useScene.getState()
  if (rootNodeIds.length === 0) return Object.keys(nodes).length === 0
  return rootNodeIds.some((id) => sceneRegistry.nodes.has(id))
}

function SceneReadyTracker({
  onSceneReadyChange,
  sceneReadyKey,
}: {
  onSceneReadyChange?: (ready: boolean) => void
  sceneReadyKey?: string | number | null
}) {
  const readyRef = useRef(false)
  const settledFramesRef = useRef(0)
  const waitedFramesRef = useRef(0)
  const onSceneReadyChangeRef = useRef(onSceneReadyChange)

  useEffect(() => {
    onSceneReadyChangeRef.current = onSceneReadyChange
  }, [onSceneReadyChange])

  useEffect(() => {
    void sceneReadyKey
    readyRef.current = false
    settledFramesRef.current = 0
    waitedFramesRef.current = 0
    onSceneReadyChangeRef.current?.(false)
  }, [sceneReadyKey])

  useFrame(() => {
    if (!(onSceneReadyChangeRef.current && !readyRef.current)) return

    waitedFramesRef.current += 1
    if (
      waitedFramesRef.current < SCENE_READY_MAX_WAIT_FRAMES &&
      (!hasCommittedSceneRoot() || hasPendingSceneBuildWork())
    ) {
      settledFramesRef.current = 0
      return
    }

    settledFramesRef.current += 1
    if (settledFramesRef.current < SCENE_READY_SETTLED_FRAMES) return

    readyRef.current = true
    onSceneReadyChangeRef.current(true)
  }, 10)

  return null
}

interface ViewerProps {
  children?: React.ReactNode
  hoverStyles?: HoverStyles
  /** Outline drawn around the selected objects (colour, width, blend). */
  selectionStyle?: SelectionOutlineStyle
  /** Tint selected walls (default). Off when the host draws its own wall selection. */
  wallSelectionTint?: boolean
  selectionManager?: 'default' | 'custom'
  perf?: boolean
  useBvh?: boolean
  renderContext?: RenderContext
  transparent?: boolean
  defaultRender?: {
    shading?: RenderShading
    textures?: boolean
    colorPreset?: ColorPreset
  }
  /**
   * Visibility filter on the live canvas. When non-null, every registered
   * node group whose id is not in `isolate` (or in the isolated set's
   * ancestor / descendant closure) is hidden. Pass `null` (or omit) to
   * clear. Powers the unified preset-capture flow (community modal sets
   * this to the subtree it wants to thumbnail) and is the building block
   * for a future focus-mode UX.
   */
  isolate?: AnyNodeId[] | null
  /**
   * Host-controlled key for scene readiness. Change it whenever a new scene
   * graph is being loaded; the viewer will report not-ready until the graph is
   * mounted, build systems have had a frame to settle, and one rendered frame
   * has presented the new content.
   */
  sceneReadyKey?: string | number | null
  onSceneReadyChange?: (ready: boolean) => void
  /**
   * Skip the TSL post-processing pipeline (SSGI/denoise/ink/outline) and render
   * the scene directly. For headless/capture surfaces (the bake page) where
   * frame quality is irrelevant: on a software-rasterised worker the pipeline
   * consumes the whole CPU budget and bakes time out. Equivalent to the
   * `?disable=postFx` diagnostic URL flag, but host-controlled.
   */
  disablePostFx?: boolean
}

/** Imperative handle exposed via `ref` on `<Viewer>`. */
export type ViewerHandle = {
  /**
   * Apply / clear the same visibility filter as the `isolate` prop. Useful
   * for transient cases (a temporary hover-to-isolate UX) where holding
   * the value in React state would be over-engineering. Passing `null`
   * clears.
   */
  setIsolated(ids: AnyNodeId[] | null): void
}

const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer(
  {
    children,
    hoverStyles = DEFAULT_HOVER_STYLES,
    selectionStyle = DEFAULT_SELECTION_STYLE,
    wallSelectionTint = true,
    selectionManager = 'default',
    perf = false,
    useBvh = true,
    renderContext = 'editor',
    transparent,
    defaultRender,
    isolate,
    sceneReadyKey,
    onSceneReadyChange,
    disablePostFx = false,
  },
  ref,
) {
  useImperativeHandle(
    ref,
    () => ({
      setIsolated: (ids) => applyIsolation(ids),
    }),
    [],
  )

  // Track the most recently-applied isolation so the cleanup path can
  // restore visibility even if the prop is removed while the component is
  // still mounted. `clearIsolation()` is a no-op when nothing was applied.
  const isolateRef = useRef<AnyNodeId[] | null | undefined>(undefined)
  useEffect(() => {
    isolateRef.current = isolate ?? null
    applyIsolation(isolate ?? null)
    return () => {
      // Only clear if this effect was the one that applied — protects
      // against a parent unmount racing with a setIsolated() consumer.
      if (isolateRef.current === isolate) clearIsolation()
    }
  }, [isolate])

  const [rendererInitFailed, setRendererInitFailed] = useState(false)
  // Capability detection runs after mount. We start optimistic (true) so the
  // server-rendered markup and the first client render agree (no hydration
  // mismatch); the effect flips it to false only on environments that expose
  // neither WebGPU nor WebGL.
  const [canMountViewer, setCanMountViewer] = useState(true)
  useEffect(() => {
    if (!canMountGpuViewer()) setCanMountViewer(false)
  }, [])

  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  const shading = useViewer((state) => state.shading)
  const transparentBackground = useViewer((state) => state.transparentBackground)
  useLayoutEffect(() => {
    useViewer.getState().setWallSelectionTint(wallSelectionTint)
    return () => useViewer.getState().setWallSelectionTint(true)
  }, [wallSelectionTint])

  useLayoutEffect(() => {
    if (transparent === undefined) return

    useViewer.getState().setTransparentBackground(transparent)
    return () => {
      useViewer.getState().setTransparentBackground(false)
    }
  }, [transparent])

  const defaultShading = defaultRender?.shading
  const defaultTextures = defaultRender?.textures
  const defaultColorPreset = defaultRender?.colorPreset
  const hasDefaultRender = defaultRender != null
  useEffect(() => {
    const ctx = renderContext
    useViewer.getState().setRenderContext(ctx)
    const { shading, shadingByContext, setShading } = useViewer.getState()
    setShading(shadingByContext[ctx] ?? defaultShading ?? shading)

    if (!hasDefaultRender || typeof window === 'undefined') return

    let persistedState: Record<string, unknown> = {}
    const rawPreferences = window.localStorage.getItem('viewer-preferences')
    if (rawPreferences) {
      try {
        const parsed = JSON.parse(rawPreferences)
        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.state &&
          typeof parsed.state === 'object'
        ) {
          persistedState = parsed.state as Record<string, unknown>
        }
      } catch {}
    }

    if (defaultTextures !== undefined && !('textures' in persistedState)) {
      useViewer.getState().setTextures(defaultTextures)
    }
    if (defaultColorPreset && !('colorPreset' in persistedState)) {
      useViewer.getState().setColorPreset(defaultColorPreset)
    }
  }, [defaultColorPreset, defaultShading, defaultTextures, hasDefaultRender, renderContext])

  // Coarse-pointer devices (phones/tablets) get a tighter DPR ceiling to keep
  // fragment-shader cost down. Hyper raises both ceilings, while retaining a
  // conservative mobile limit to avoid excessive heat and render-target memory.
  const coarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  const maxDpr =
    shading === 'performance'
      ? 1
      : shading === 'hyper'
        ? coarsePointer
          ? 1.5
          : 2
        : coarsePointer
          ? 1.25
          : 1.5
  const showGpuFallback = !canMountViewer || rendererInitFailed
  // When we can't mount the GPU canvas, the SceneReadyTracker never mounts and
  // the host editor would otherwise wait on its scene-readiness timeout. Signal
  // readiness explicitly so the host can drop its loader immediately.
  useEffect(() => {
    if (showGpuFallback) onSceneReadyChange?.(true)
  }, [showGpuFallback, onSceneReadyChange])

  if (showGpuFallback) {
    return <UnsupportedGpuViewerFallback />
  }
  return (
    <Canvas
      camera={{ position: [50, 50, 50], fov: 50 }}
      className={`transition-colors duration-700 ${
        transparentBackground ? 'bg-transparent' : isDark ? 'bg-[#1f2433]' : 'bg-[#fafafa]'
      }`}
      dpr={[1, maxDpr]}
      frameloop="never"
      gl={
        ((props: { canvas?: HTMLCanvasElement }) =>
          rendererForCanvas(props.canvas, async () => {
            try {
              const renderer = new THREE.WebGPURenderer({ ...(props as any), alpha: true })
              renderer.toneMapping = toneMappingFor(useViewer.getState().shading)
              renderer.toneMappingExposure = getSceneTheme(
                useViewer.getState().sceneTheme,
              ).toneMappingExposure
              await renderer.init()
              installDrawGuards(renderer)
              installSheenSafeMaterial(renderer)
              return renderer
            } catch (err) {
              console.error('[viewer] WebGPURenderer init failed', err)
              setRendererInitFailed(true)
              throw err
            }
          })) as any
      }
      resize={{
        debounce: 100,
      }}
      shadows={{
        type: THREE.PCFShadowMap,
        enabled: shading !== 'performance',
      }}
    >
      <FrameLimiter fps={shading === 'performance' ? 30 : shading === 'hyper' ? 60 : 50} />
      <ViewerCamera />
      <GPUDeviceWatcher />
      <ToneMappingExposure />
      <SceneReadyTracker onSceneReadyChange={onSceneReadyChange} sceneReadyKey={sceneReadyKey} />

      <ErrorBoundary fallback={null} scope="viewer-scene">
        {/* <directionalLight position={[10, 10, 5]} intensity={0.5} castShadow
          /> */}
        <Lights />
        <WeatherSystem />
        {useBvh ? (
          <SceneBvh>
            <SceneRenderer />
          </SceneBvh>
        ) : (
          <SceneRenderer />
        )}

        {/* Generic slab-elevation lift for any kind that declares
            `capabilities.floorPlaced`. Runs at frame priority 1 so it
            lands its mesh.position.y override before the priority-2
            systems below clear the dirty mark. */}
        <FloorElevationSystem />
        {/* Generic geometry rebuild loop for any registered kind that
            ships `def.geometry`. Reads dirtyNodes, calls the kind's pure
            builder, swaps the registered group's children. See
            wiki/architecture/node-definitions.md. */}
        <GeometrySystem />
        {/* Automated stair opening sync — updates slab/ceiling cutouts
            whenever stairs, slabs, or levels change. */}
        <StairOpeningSystem />
        {/* Mounts systems contributed by registry-backed kinds. Each
            kind's `def.system` is loaded via lazy() and rendered here,
            ordered by `system.priority`. */}
        <RegisteredSystems />
        <PostProcessing
          disablePostFx={disablePostFx}
          hoverStyles={hoverStyles}
          selectionStyle={selectionStyle}
        />
        {selectionManager === 'default' && <SelectionManager />}
        {(perf || PERF_OVERLAY_ENABLED) && <PerfMonitor />}
        {children}
      </ErrorBoundary>
    </Canvas>
  )
})

const DebugRenderer = () => {
  useFrame(({ gl, scene, camera }) => {
    const submittedAt = PERF_OVERLAY_ENABLED ? performance.now() : 0
    gl.render(scene, camera)
    if (PERF_OVERLAY_ENABLED) {
      const queue = (gl as any).backend?.device?.queue as
        | { onSubmittedWorkDone?: () => Promise<void> }
        | undefined
      queue?.onSubmittedWorkDone?.().then(() => {
        pushGpuSample(performance.now() - submittedAt)
      })
    }
  })
  return null
}

export default Viewer
