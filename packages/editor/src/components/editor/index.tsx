'use client'

import { Icon } from '@iconify/react'
import {
  emitter,
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getSceneMaterialIdFromRef,
  initSpaceDetectionSync,
  initSpatialGridSync,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
import { InteractiveSystem, SceneEnvironment, useViewer, Viewer } from '@pascal-app/viewer'
import { Move, Video } from 'lucide-react'
import { Fragment, memo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { ViewerOverlay } from '../../components/viewer-overlay'
import { ViewerZoneSystem } from '../../components/viewer-zone-system'
import { type SaveStatus, useAutoSave } from '../../hooks/use-auto-save'
import { useKeyboard } from '../../hooks/use-keyboard'
import { HUD_KEYCAP, HUD_TEXT } from '../../lib/hud'
import { type ActivePaintMaterial, hasActivePaintMaterial } from '../../lib/material-paint'
import {
  applySceneGraphToEditor,
  loadSceneFromLocalStorage,
  type SceneGraph,
  writePersistedSelection,
} from '../../lib/scene'
import { computeSceneBoundsXZ } from '../../lib/scene-bounds'
import { initSFXBus } from '../../lib/sfx-bus'
import { cn } from '../../lib/utils'
import useEditor from '../../store/use-editor'
import { useUiHidden } from '../../store/use-ui-hidden'
import { useUiTheme } from '../../store/use-ui-theme'
import { CeilingSelectionAffordanceSystem } from '../systems/ceiling/ceiling-selection-affordance-system'
import { CeilingSystem } from '../systems/ceiling/ceiling-system'
import { RoofEditSystem } from '../systems/roof/roof-edit-system'
import { SelectionAffordanceManager } from '../systems/selection-affordance-manager'
import { StairEditSystem } from '../systems/stair/stair-edit-system'
import { ZoneLabelEditorSystem } from '../systems/zone/zone-label-editor-system'
import { ZoneSystem } from '../systems/zone/zone-system'
import { BoxSelectTool } from '../tools/select/box-select-tool'
import { ToolManager } from '../tools/tool-manager'
import { ActionMenu } from '../ui/action-menu'
import { CommandPalette, type CommandPaletteEmptyAction } from '../ui/command-palette'
import { EditorCommands } from '../ui/command-palette/editor-commands'
import { HelperManager } from '../ui/helpers/helper-manager'
import { HintLine } from '../ui/helpers/hint-line'
import { PanelManager } from '../ui/panels/panel-manager'
import { ErrorBoundary } from '../ui/primitives/error-boundary'
import { type MouseButton, MouseGlyph } from '../ui/primitives/mouse-glyph'
import { useSidebarStore } from '../ui/primitives/sidebar'
import { SceneLoader } from '../ui/scene-loader'
import { AppSidebar } from '../ui/sidebar/app-sidebar'
import type { ExtraPanel } from '../ui/sidebar/icon-rail'
import { SettingsPanel, type SettingsPanelProps } from '../ui/sidebar/panels/settings-panel'
import { SitePanel, type SitePanelProps } from '../ui/sidebar/panels/site-panel'
import type { SidebarTab } from '../ui/sidebar/tab-bar'
import { usePluginPanels } from '../ui/sidebar/use-plugin-panels'
import { CameraPresetBridge } from './camera-preset-bridge'
import { CustomCameraControls } from './custom-camera-controls'
import { EditorLayoutV2 } from './editor-layout-v2'
import { ExportManager } from './export-manager'
import { FenceTangentLines3D } from './fence-tangent-lines-3d'
import { FirstPersonControls, FirstPersonOverlay } from './first-person-controls'
import { FloatingActionMenu } from './floating-action-menu'
import { FloatingBuildingActionMenu } from './floating-building-action-menu'
import { FloorplanPanel } from './floorplan-panel'
import { Grid } from './grid'
import { GroupMoveHandle } from './group-move-handle'
import { GroupRotateHandle } from './group-rotate-handle'
import { NodeArrowHandles } from './node-arrow-handles'
import { RiserDiagramPanel } from './riser-diagram-panel'
import { RuntimePresenceAvatars } from './runtime-presence-avatars'
import { SelectedWallGlass } from './selected-wall-glass'
import { SelectionManager } from './selection-manager'
import { EDITOR_HOVER_STYLES, EDITOR_SELECTION_STYLE } from './selection-styles'
import { SiteEdgeLabels } from './site-edge-labels'
import { SlabHoleHighlights } from './slab-hole-highlights'
import { SnapshotCaptureOverlay } from './snapshot-capture-overlay'
import { type SnapshotCameraData, ThumbnailGenerator } from './thumbnail-generator'
import { WallMeasurementLabel } from './wall-measurement-label'
import { WallMoveSideHandles } from './wall-move-side-handles'
import { WallOpeningHighlights } from './wall-opening-highlights'

const CAMERA_CONTROLS_HINT_DISMISSED_STORAGE_KEY = 'editor-camera-controls-hint-dismissed:v1'
const DELETE_CURSOR_BADGE_COLOR = '#ef4444'
const DELETE_CURSOR_BADGE_OFFSET_X = 14
const DELETE_CURSOR_BADGE_OFFSET_Y = 14
const PAINT_CURSOR_BADGE_COLOR = '#818cf8'
const PAINT_CURSOR_BADGE_DISABLED_COLOR = '#94a3b8'
const PAINT_CURSOR_BADGE_OFFSET_X = 14
const PAINT_CURSOR_BADGE_OFFSET_Y = 14
const SCENE_READY_FALLBACK_MS = 8000
type PaintCursorBadgeState = 'empty' | 'ready' | 'blocked'
const EDITOR_DEFAULT_RENDER = { shading: 'solid' } as const

/**
 * Wire up module-level singletons (spatial grid, space detection, SFX) for
 * an Editor mount. Returns a teardown function that detaches the scene-store
 * subscriptions and resets the shared singletons so a subsequent remount —
 * including hot navigation back to the editor in the same tab — starts from
 * a clean slate.
 */
function initializeEditorRuntime(): () => void {
  const unsubscribeSpatialGrid = initSpatialGridSync()
  const unsubscribeSpaceDetection = initSpaceDetectionSync(useScene, useEditor)
  initSFXBus()

  return () => {
    unsubscribeSpatialGrid()
    unsubscribeSpaceDetection?.()

    spatialGridManager.clear()

    const outliner = useViewer.getState().outliner
    outliner.selectedObjects.length = 0
    outliner.hoveredObjects.length = 0
  }
}
export interface EditorProps {
  // Layout version — 'v1' (default) or 'v2' (navbar + two-column)
  layoutVersion?: 'v1' | 'v2'

  // UI slots (v1)
  appMenuButton?: ReactNode
  sidebarTop?: ReactNode

  // UI slots (v2)
  navbarSlot?: ReactNode
  sidebarTabs?: (SidebarTab & { component: React.ComponentType })[]
  viewerToolbarLeft?: ReactNode
  viewerToolbarRight?: ReactNode
  /**
   * Full-bleed surface swapped in over the 3D canvas (v2) — e.g. the studio
   * gallery. The canvas stays mounted underneath (no WebGL re-init) and the
   * viewer toolbar stays on top so the host's stage switch remains reachable.
   */
  stageOverlay?: ReactNode
  /**
   * Docked below the node inspector (v2). Hosts mount the "save as preset"
   * affordance here so it reads as part of the inspector surface and shows
   * only while a node is selected.
   */
  inspectorFooter?: ReactNode

  projectId?: string | null

  // Persistence — defaults to localStorage when omitted
  onLoad?: () => Promise<SceneGraph | null>
  onSave?: (scene: SceneGraph, options?: { keepalive?: boolean }) => Promise<void>
  /** localStorage key for a client-side copy of every save (see `useAutoSave`). */
  saveBackupKey?: string
  onDirty?: () => void
  onSaveStatusChange?: (status: SaveStatus) => void

  // Version preview
  previewScene?: SceneGraph
  isVersionPreviewMode?: boolean

  // Loading indicator (e.g. project fetching in community mode)
  isLoading?: boolean

  // Fires when the full-screen scene loader shows/hides — lets hosts measure
  // open-to-interactive time without reaching into internal loader state.
  onLoaderChange?: (visible: boolean) => void

  // Thumbnail
  onThumbnailCapture?: (blob: Blob, cameraData: SnapshotCameraData) => void

  // Version preview overlays (rendered by host app)
  sidebarOverlay?: ReactNode
  viewerBanner?: ReactNode

  // Panel config (passed through to sidebar panels — v1 only)
  settingsPanelProps?: SettingsPanelProps
  sitePanelProps?: SitePanelProps
  extraSidebarPanels?: ExtraPanel[]

  // Command palette fallback when no commands match
  commandPaletteEmptyAction?: CommandPaletteEmptyAction
}

function EditorSceneCrashFallback() {
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-background/95 p-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
        <h2 className="font-semibold text-lg">The editor scene failed to render</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          You can retry the scene or return home without reloading the whole app shell.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            className="rounded-md border border-border bg-accent px-3 py-2 font-medium text-sm hover:bg-accent/80"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload editor
          </button>
          <a
            className="rounded-md border border-border bg-background px-3 py-2 font-medium text-sm hover:bg-accent/40"
            href="/"
          >
            Back to home
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Sidebar slot: in-flow, resizable, collapses to a grab strip ──────────────

function SidebarSlot({ children }: { children: ReactNode }) {
  const width = useSidebarStore((s) => s.width)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setIsCollapsed = useSidebarStore((s) => s.setIsCollapsed)
  const setWidth = useSidebarStore((s) => s.setWidth)
  const isDragging = useSidebarStore((s) => s.isDragging)
  const setIsDragging = useSidebarStore((s) => s.setIsDragging)

  const isResizing = useRef(false)
  const isExpanding = useRef(false)

  const handleResizerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      isResizing.current = true
      setIsDragging(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [setIsDragging],
  )

  const handleGrabDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      isExpanding.current = true
      setIsDragging(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [setIsDragging],
  )

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (isResizing.current) {
        setWidth(e.clientX)
      } else if (isExpanding.current && e.clientX > 60) {
        setIsCollapsed(false)
        setWidth(Math.max(240, e.clientX))
      }
    }
    const handlePointerUp = () => {
      isResizing.current = false
      isExpanding.current = false
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [setWidth, setIsCollapsed, setIsDragging])

  return (
    // Outer: no overflow-hidden so the handle can extend into the gap
    <div
      className="relative h-full flex-shrink-0 rounded-xl"
      style={{
        width: isCollapsed ? 8 : width,
        transition: isDragging ? 'none' : 'width 150ms ease',
      }}
    >
      {/* Inner: overflow-hidden clips content to rounded corners */}
      <div className="h-full w-full overflow-hidden rounded-xl">
        {isCollapsed ? (
          <div
            className="absolute inset-0 z-10 cursor-col-resize transition-colors hover:bg-primary/20"
            onPointerDown={handleGrabDown}
            title="Expand sidebar"
          />
        ) : (
          children
        )}
      </div>

      {/* Handle: extends into the gap, centered on the gap midpoint */}
      {!isCollapsed && (
        <div
          className="group absolute inset-y-0 -right-3.5 z-10 flex w-4 cursor-col-resize items-stretch justify-center py-4"
          onPointerDown={handleResizerDown}
        >
          <div className="w-px self-stretch rounded-full bg-transparent transition-colors group-hover:bg-neutral-300" />
        </div>
      )}
    </div>
  )
}

// ── UI overlays: fixed, scoped to viewer area via transform containing block ──

function ViewerOverlays({ left, children }: { left: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left,
        // Creates a containing block so position:fixed children are scoped here
        transform: 'translateZ(0)',
        zIndex: 30,
      }}
    >
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function SelectionPersistenceManager({ enabled }: { enabled: boolean }) {
  const selection = useViewer((state) => state.selection)

  useEffect(() => {
    if (!enabled) {
      return
    }

    writePersistedSelection(selection)
  }, [enabled, selection])

  return null
}

type CameraControlHint =
  | { button: MouseButton; drag?: boolean; action: string; title?: string }
  | { keys: string[]; together?: boolean; action: string }

// inZOI's order: UI toggle first, then the mouse, then the wall / floor keys.
const EDITOR_CAMERA_CONTROL_HINTS: CameraControlHint[] = [
  { keys: ['Ctrl', 'Shift', 'U'], together: true, action: 'UI 숨기기' },
  { button: 'right', drag: true, action: '카메라 회전' },
  {
    button: 'wheel',
    drag: true,
    action: '화면 이동',
    title: '가운데 버튼 드래그 · Space + 좌클릭 · W A S D',
  },
  { button: 'wheel', action: '확대 · 축소' },
  { keys: ['Home', 'End'], action: '벽 보기 변경' },
  { keys: ['PgUp', 'PgDn'], action: '층 위 / 층 아래' },
]

const PREVIEW_CAMERA_CONTROL_HINTS: CameraControlHint[] = [
  { button: 'left', drag: true, action: '화면 이동' },
  { button: 'right', drag: true, action: '카메라 회전' },
  { button: 'wheel', action: '확대 · 축소' },
]

function readCameraControlsHintDismissed(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(CAMERA_CONTROLS_HINT_DISMISSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCameraControlsHintDismissed(dismissed: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (dismissed) {
      window.localStorage.setItem(CAMERA_CONTROLS_HINT_DISMISSED_STORAGE_KEY, '1')
      return
    }

    window.localStorage.removeItem(CAMERA_CONTROLS_HINT_DISMISSED_STORAGE_KEY)
  } catch {}
}

/** inZOI-style camera legend at the top right, under the 기본 카메라 row. */
function ViewerCanvasControlsHint({
  isPreviewMode,
  onDismiss,
}: {
  isPreviewMode: boolean
  onDismiss: () => void
}) {
  const hints = isPreviewMode ? PREVIEW_CAMERA_CONTROL_HINTS : EDITOR_CAMERA_CONTROL_HINTS
  const hasSelection = useViewer((s) => s.selection.selectedIds.length > 0)
  if (hasSelection) return null

  // z-20 keeps the scene HUD under the overlay layer (z-30), so cards opened
  // over the scene (the inspector, the Archiple stage) cover it.
  return (
    <div className="pointer-events-none absolute top-[112px] right-4 z-20">
      <section
        aria-label="카메라 조작 안내"
        className={cn(
          'group pointer-events-auto relative flex flex-col items-end gap-2.5',
          HUD_TEXT,
        )}
        data-hud-avoid
      >
        {hints.map((hint) => (
          <div
            className="flex items-center gap-1.5"
            key={hint.action}
            title={'title' in hint ? hint.title : undefined}
          >
            {'button' in hint ? (
              <>
                <MouseGlyph button={hint.button} className="h-[20px] w-[15px] shrink-0" />
                {hint.drag && (
                  <>
                    <span className="text-[10px]">+</span>
                    <Move className="size-4" strokeWidth={1.75} />
                  </>
                )}
              </>
            ) : (
              hint.keys.map((key, index) => (
                <Fragment key={key}>
                  {hint.together && index > 0 && <span className="text-[10px]">+</span>}
                  <span className={HUD_KEYCAP}>{key}</span>
                </Fragment>
              ))
            )}
            <span className="ml-1 whitespace-nowrap font-medium text-[12px]">{hint.action}</span>
          </div>
        ))}
        <button
          aria-label="카메라 조작 안내 닫기"
          className="-left-2 -top-2 absolute flex size-5 items-center justify-center rounded-full bg-neutral-700 text-white opacity-0 shadow transition-opacity [text-shadow:none] hover:bg-neutral-900 group-hover:opacity-100"
          onClick={onDismiss}
          title="닫기"
          type="button"
        >
          <Icon aria-hidden="true" color="currentColor" height={12} icon="lucide:x" width={12} />
        </button>
      </section>
    </div>
  )
}

/** inZOI's 'Default Camera' row under the top-right cluster: fits the scene. */
function DefaultCameraButton() {
  const hasSelection = useViewer((s) => s.selection.selectedIds.length > 0)
  if (hasSelection) return null
  return (
    <div className="pointer-events-none absolute top-16 right-3 z-20 flex items-center gap-2">
      <span className={cn('font-medium text-[15px]', HUD_TEXT)}>기본 카메라</span>
      <button
        aria-label="기본 카메라"
        className="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-[#f8f8f8] text-[#555968] shadow-[0_2px_8px_rgba(0,0,0,0.15)] transition-colors hover:bg-white"
        data-hud-avoid
        onClick={() => {
          const bounds = computeSceneBoundsXZ(useScene.getState().nodes)
          emitter.emit('camera-controls:fit-scene', bounds ? { bounds } : {})
        }}
        title="기본 카메라"
        type="button"
      >
        <Video className="size-5" strokeWidth={1.5} />
      </button>
    </div>
  )
}

function DeleteCursorBadge({ position }: { position: { x: number; y: number } }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-40"
      style={{
        left: position.x + DELETE_CURSOR_BADGE_OFFSET_X,
        top: position.y + DELETE_CURSOR_BADGE_OFFSET_Y,
      }}
    >
      <div
        className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/95 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3),0_4px_8px_-4px_rgba(0,0,0,0.2)]"
        style={{
          boxShadow: `0 8px 16px -4px rgba(0,0,0,0.3), 0 4px 8px -4px rgba(0,0,0,0.2), 0 0 18px ${DELETE_CURSOR_BADGE_COLOR}22`,
        }}
      >
        <Icon
          aria-hidden="true"
          className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
          color={DELETE_CURSOR_BADGE_COLOR}
          height={18}
          icon="mdi:trash-can-outline"
          width={18}
        />
      </div>
    </div>
  )
}

function getActivePaintMaterialSwatchColor(
  material: ActivePaintMaterial | null,
  sceneMaterials: ReturnType<typeof useScene.getState>['materials'],
) {
  const directColor = material?.material?.properties?.color
  if (directColor) return directColor

  const sceneMaterialId = getSceneMaterialIdFromRef(material?.materialPreset)
  if (sceneMaterialId) {
    const sceneMaterial = sceneMaterials[sceneMaterialId as keyof typeof sceneMaterials]
    const sceneColor = sceneMaterial?.material.properties?.color
    if (sceneColor) return sceneColor
  }

  const catalogId =
    getLibraryMaterialIdFromRef(material?.materialPreset) ?? material?.material?.id ?? undefined
  const catalogMaterial = getCatalogMaterialById(catalogId)
  return (
    catalogMaterial?.previewColor ??
    catalogMaterial?.preset.mapProperties.color ??
    PAINT_CURSOR_BADGE_COLOR
  )
}

function getActivePaintMaterialSwatchImageUrl(
  material: ActivePaintMaterial | null,
  sceneMaterials: ReturnType<typeof useScene.getState>['materials'],
) {
  const directTextureUrl = material?.material?.texture?.url
  if (directTextureUrl) return directTextureUrl

  const sceneMaterialId = getSceneMaterialIdFromRef(material?.materialPreset)
  if (sceneMaterialId) {
    const sceneMaterial = sceneMaterials[sceneMaterialId as keyof typeof sceneMaterials]
    const sceneTextureUrl = sceneMaterial?.material.texture?.url
    if (sceneTextureUrl) return sceneTextureUrl
  }

  const catalogId =
    getLibraryMaterialIdFromRef(material?.materialPreset) ?? material?.material?.id ?? undefined
  const catalogMaterial = getCatalogMaterialById(catalogId)
  return catalogMaterial?.previewThumbnailUrl ?? catalogMaterial?.preset.maps.albedoMap
}

function PaintCursorBadge({
  position,
  state,
  swatchColor,
  swatchImageUrl,
  isEraser,
}: {
  position: { x: number; y: number }
  state: PaintCursorBadgeState
  swatchColor: string
  swatchImageUrl?: string
  isEraser: boolean
}) {
  const accentColor =
    state === 'ready'
      ? isEraser
        ? PAINT_CURSOR_BADGE_COLOR
        : swatchColor
      : PAINT_CURSOR_BADGE_DISABLED_COLOR
  const iconOpacity = state === 'ready' ? 1 : state === 'blocked' ? 0.62 : 0.42
  const lineHeight = 18

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-40"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div
        className="-translate-x-1/2 -translate-y-full absolute top-0 left-1/2"
        style={{
          backgroundColor: accentColor,
          boxShadow: `0 0 12px ${accentColor}cc`,
          height: lineHeight,
          width: 2,
        }}
      />
      <div
        className="absolute top-0 left-1/2 flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/95 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3),0_4px_8px_-4px_rgba(0,0,0,0.2)]"
        style={{
          boxShadow: `0 8px 16px -4px rgba(0,0,0,0.3), 0 4px 8px -4px rgba(0,0,0,0.2), 0 0 18px ${accentColor}22`,
          transform: `translate(-50%, calc(-100% - ${lineHeight}px))`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className="h-5 w-5 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
          src="/icons/paint.webp"
          style={{
            filter: state === 'ready' ? undefined : 'grayscale(1)',
            opacity: iconOpacity,
          }}
        />
        {state === 'ready' ? (
          isEraser ? (
            <span className="-right-1 -bottom-1 absolute flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/35 bg-zinc-950 text-white shadow-[0_2px_6px_rgba(0,0,0,0.45)]">
              <Icon
                aria-hidden="true"
                color="currentColor"
                height={10}
                icon="mdi:eraser-variant"
                width={10}
              />
            </span>
          ) : (
            <span
              className="-right-1 -bottom-1 absolute h-3.5 w-3.5 rounded-full border border-white/70 dark:border-white/10 bg-cover bg-center shadow-[0_2px_6px_rgba(0,0,0,0.45)]"
              style={{
                backgroundColor: swatchColor,
                backgroundImage: swatchImageUrl
                  ? `url(${JSON.stringify(swatchImageUrl)})`
                  : undefined,
              }}
            />
          )
        ) : state === 'blocked' ? (
          <span className="-right-1 -bottom-1 absolute flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/30 bg-zinc-950 text-rose-300 shadow-[0_2px_6px_rgba(0,0,0,0.45)]">
            <Icon
              aria-hidden="true"
              color="currentColor"
              height={12}
              icon="mdi:cancel"
              width={12}
            />
          </span>
        ) : (
          <span className="-right-1 -bottom-1 absolute flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/30 bg-zinc-950 font-semibold text-[9px] text-slate-300 shadow-[0_2px_6px_rgba(0,0,0,0.45)]">
            ?
          </span>
        )}
      </div>
    </div>
  )
}

// Subscribes to `gridSnapStep` so the visible grid cell size matches whatever
// the wall draft tool snaps to — otherwise the cursor lands between visible
// grid lines when the user picks a finer snap (0.25 / 0.1 / 0.05).
function SnapAwareGrid() {
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  return <Grid cellColor="#aaa" cellSize={gridSnapStep} fadeDistance={500} sectionColor="#ccc" />
}

// ── Viewer scene content: memoized so <Viewer> doesn't re-render on mode/viewMode changes ──

const ViewerSceneContent = memo(function ViewerSceneContent({
  isVersionPreviewMode,
  isLoading,
  isFirstPersonMode,
  isStudioMode,
  onThumbnailCapture,
}: {
  isVersionPreviewMode: boolean
  isLoading: boolean
  isFirstPersonMode: boolean
  isStudioMode: boolean
  onThumbnailCapture?: (blob: Blob, cameraData: SnapshotCameraData) => void
}) {
  // Studio mode is a clean render/snapshot surface — no selection or editing
  // affordances. It mirrors version-preview's chrome gating on the canvas.
  // Capture (snapshot) mode is camera-only for the same reason: suppress
  // selection, editing handles, and the tool manager (which mounts the site
  // boundary flags) so the framed shot stays clean.
  const isCaptureMode = useEditor((s) => s.isCaptureMode)
  const noEditing = isVersionPreviewMode || isFirstPersonMode || isStudioMode || isCaptureMode
  return (
    <>
      <SceneEnvironment />
      {!(isFirstPersonMode || isStudioMode || isCaptureMode) && <SelectionManager />}
      {!noEditing && <BoxSelectTool />}
      {!noEditing && <NodeArrowHandles />}
      {!noEditing && <GroupRotateHandle />}
      {!noEditing && <GroupMoveHandle />}
      {!noEditing && <WallOpeningHighlights />}
      {!noEditing && <SlabHoleHighlights />}
      {!noEditing && <SelectedWallGlass />}
      {!noEditing && <WallMoveSideHandles />}
      {!noEditing && <FenceTangentLines3D />}
      {!noEditing && <FloatingActionMenu />}
      {!noEditing && <FloatingBuildingActionMenu />}
      {!isFirstPersonMode && <WallMeasurementLabel />}
      <ExportManager />
      {isFirstPersonMode ? <ViewerZoneSystem /> : <ZoneSystem />}
      <CeilingSystem />
      <CeilingSelectionAffordanceSystem />
      {!noEditing && <SelectionAffordanceManager />}
      <RoofEditSystem />
      <StairEditSystem />
      {!(isLoading || isFirstPersonMode) && <SnapAwareGrid />}
      {!(isLoading || noEditing) && <ToolManager />}
      {isFirstPersonMode && <FirstPersonControls />}
      <CustomCameraControls />
      <CameraPresetBridge />
      <RuntimePresenceAvatars />
      <ThumbnailGenerator onThumbnailCapture={onThumbnailCapture} />
      {!isFirstPersonMode && <SiteEdgeLabels />}
      <InteractiveSystem />
    </>
  )
})

// ── Delete cursor badge: isolated component so cursor moves don't re-render ViewerCanvas ──
// Subscribes to mode itself and manages cursor position state independently.

function DeleteCursorLayer({
  containerRef,
  isVersionPreviewMode,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  isVersionPreviewMode: boolean
}) {
  const mode = useEditor((s) => s.mode)
  const badgeRef = useRef<HTMLDivElement>(null)
  const active = mode === 'delete' && !isVersionPreviewMode

  useEffect(() => {
    if (!active) {
      if (badgeRef.current) {
        badgeRef.current.style.display = 'none'
      }
      return
    }
    const el = containerRef.current
    if (!el) return
    let frame = 0
    let nextX = 0
    let nextY = 0
    const badge = badgeRef.current

    const flushPosition = () => {
      frame = 0
      if (!badge) return
      badge.style.display = 'block'
      badge.style.transform = `translate(${nextX + DELETE_CURSOR_BADGE_OFFSET_X}px, ${nextY + DELETE_CURSOR_BADGE_OFFSET_Y}px)`
    }

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      nextX = e.clientX - rect.left
      nextY = e.clientY - rect.top

      if (frame === 0) {
        frame = window.requestAnimationFrame(flushPosition)
      }
    }
    const onLeave = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      if (badge) {
        badge.style.display = 'none'
      }
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
      }
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [active, containerRef])

  if (!active) return null

  return (
    <div
      className="pointer-events-none z-40"
      ref={badgeRef}
      style={{ display: 'none', position: 'absolute', left: 0, top: 0 }}
    >
      <DeleteCursorBadge position={{ x: 0, y: 0 }} />
    </div>
  )
}

function PaintCursorLayer({
  containerRef,
  isVersionPreviewMode,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  isVersionPreviewMode: boolean
}) {
  const mode = useEditor((s) => s.mode)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  const paintEraser = useEditor((s) => s.paintEraser)
  const paintHover = useEditor((s) => s.paintHover)
  const sceneMaterials = useScene((s) => s.materials)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const active = mode === 'material-paint' && !isVersionPreviewMode

  useEffect(() => {
    if (!active) {
      setPosition(null)
      return
    }
    const el = containerRef.current
    if (!el) return
    let frame = 0
    let nextX = 0
    let nextY = 0

    const flushPosition = () => {
      frame = 0
      setPosition({ x: nextX, y: nextY })
    }

    const updateFromEvent = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      nextX = e.clientX - rect.left
      nextY = e.clientY - rect.top
      if (frame === 0) {
        frame = window.requestAnimationFrame(flushPosition)
      }
    }
    const onLeave = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      setPosition(null)
    }
    el.addEventListener('pointermove', updateFromEvent)
    el.addEventListener('pointerenter', updateFromEvent)
    el.addEventListener('pointerdown', updateFromEvent)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
      }
      el.removeEventListener('pointermove', updateFromEvent)
      el.removeEventListener('pointerenter', updateFromEvent)
      el.removeEventListener('pointerdown', updateFromEvent)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [active, containerRef])

  const hasPaint = paintEraser || hasActivePaintMaterial(activePaintMaterial)
  const isEyedropper = active && !hasPaint
  const badgeState: PaintCursorBadgeState = !hasPaint
    ? 'empty'
    : paintHover != null
      ? 'ready'
      : 'blocked'
  const swatchColor = getActivePaintMaterialSwatchColor(activePaintMaterial, sceneMaterials)
  const swatchImageUrl = getActivePaintMaterialSwatchImageUrl(activePaintMaterial, sceneMaterials)

  if (!active) return null

  return (
    <>
      {isEyedropper ? (
        <style>
          {
            '[data-pascal-viewer-3d], [data-pascal-viewer-3d] canvas { cursor: url("/icons/eyedropper-cursor.svg") 4 20, crosshair !important; }'
          }
        </style>
      ) : null}
      {position && !isEyedropper ? (
        <div
          className="pointer-events-none absolute z-40"
          style={{ left: 0, top: 0, transform: `translate(${position.x}px, ${position.y}px)` }}
        >
          <PaintCursorBadge
            isEraser={paintEraser}
            position={{ x: 0, y: 0 }}
            state={badgeState}
            swatchColor={swatchColor}
            swatchImageUrl={swatchImageUrl}
          />
        </div>
      ) : null}
    </>
  )
}

// ── Viewer canvas: memoized, subscribes to viewMode/floorplanPaneRatio internally ──
// This prevents Editor from re-rendering when those values change.

const ViewerCanvas = memo(function ViewerCanvas({
  isVersionPreviewMode,
  isLoading,
  isFirstPersonMode,
  isStudioMode,
  hasLoadedInitialScene,
  showLoader,
  sceneReadyKey,
  onSceneReadyChange,
  onThumbnailCapture,
}: {
  isVersionPreviewMode: boolean
  isLoading: boolean
  isFirstPersonMode: boolean
  isStudioMode: boolean
  hasLoadedInitialScene: boolean
  showLoader: boolean
  sceneReadyKey: number
  onSceneReadyChange: (ready: boolean) => void
  onThumbnailCapture?: (blob: Blob, cameraData: SnapshotCameraData) => void
}) {
  const viewMode = useEditor((s) => s.viewMode)
  const floorplanPaneRatio = useEditor((s) => s.floorplanPaneRatio)
  const setFloorplanPaneRatio = useEditor((s) => s.setFloorplanPaneRatio)
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const uiHidden = useUiHidden((s) => s.hidden)

  const [isCameraControlsHintVisible, setIsCameraControlsHintVisible] = useState<boolean | null>(
    null,
  )

  const viewerAreaRef = useRef<HTMLDivElement>(null)
  // State mirror of `viewerAreaRef` so the floorplan compass portal re-renders
  // once the container exists (a plain ref mutation wouldn't trigger it).
  const [viewerAreaEl, setViewerAreaEl] = useState<HTMLDivElement | null>(null)
  const setViewerAreaNode = useCallback((el: HTMLDivElement | null) => {
    viewerAreaRef.current = el
    setViewerAreaEl(el)
  }, [])
  const viewer3dRef = useRef<HTMLDivElement>(null)
  const isResizingFloorplan = useRef(false)

  const handleFloorplanDividerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    isResizingFloorplan.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isResizingFloorplan.current) return
      if (!viewerAreaRef.current) return
      const rect = viewerAreaRef.current.getBoundingClientRect()
      // Split view is padded clear of the floating build panel; the pane
      // ratio is a share of the remaining content box.
      const inset = Number.parseFloat(getComputedStyle(viewerAreaRef.current).paddingLeft) || 0
      const newRatio = (e.clientX - rect.left - inset) / (rect.width - inset)
      setFloorplanPaneRatio(Math.max(0.15, Math.min(0.85, newRatio)))
    }
    const handlePointerUp = () => {
      isResizingFloorplan.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [setFloorplanPaneRatio])

  useEffect(() => {
    setIsCameraControlsHintVisible(!readCameraControlsHintDismissed())
  }, [])

  const dismissCameraControlsHint = useCallback(() => {
    setIsCameraControlsHintVisible(false)
    writeCameraControlsHintDismissed(true)
  }, [])

  const show2d = viewMode === '2d' || viewMode === 'split'
  const show3d = viewMode === '3d' || viewMode === 'split'

  return (
    <ErrorBoundary fallback={<EditorSceneCrashFallback />}>
      {/* `relative` so the floorplan compass (portaled here to stay visible in
          2d / 3d / split alike) can anchor to this container's bottom-left. */}
      <div
        className="relative flex h-full"
        ref={setViewerAreaNode}
        style={{
          paddingLeft: viewMode === 'split' ? 'var(--viewer-left-inset, 0px)' : undefined,
        }}
      >
        {/* 2D floorplan — always mounted once shown, hidden via CSS to preserve state */}
        <div
          className="relative h-full flex-shrink-0"
          style={{
            width: viewMode === '2d' ? '100%' : `${floorplanPaneRatio * 100}%`,
            display: show2d ? undefined : 'none',
          }}
        >
          <div className="h-full w-full overflow-hidden">
            <FloorplanPanel compassHost={viewerAreaEl} />
          </div>
          {viewMode === 'split' && (
            <div
              className="absolute inset-y-0 -right-3 z-10 flex w-6 cursor-col-resize items-center justify-center"
              onPointerDown={handleFloorplanDividerDown}
            >
              <div className="h-8 w-1 rounded-full bg-neutral-400" />
            </div>
          )}
        </div>

        {/* 3D viewer — always mounted, hidden via CSS to avoid destroying the WebGL context */}
        <div
          className="relative min-w-0 flex-1 overflow-hidden"
          data-pascal-viewer-3d
          ref={viewer3dRef}
          style={{ display: show3d ? undefined : 'none' }}
        >
          <DeleteCursorLayer
            containerRef={viewer3dRef}
            isVersionPreviewMode={isVersionPreviewMode}
          />
          <PaintCursorLayer
            containerRef={viewer3dRef}
            isVersionPreviewMode={isVersionPreviewMode}
          />
          {!showLoader && !isFirstPersonMode && !uiHidden && !isPreviewMode && viewMode !== '2d' ? (
            <DefaultCameraButton />
          ) : null}
          {!showLoader && isCameraControlsHintVisible && !isFirstPersonMode && !uiHidden ? (
            <ViewerCanvasControlsHint
              isPreviewMode={isPreviewMode}
              onDismiss={dismissCameraControlsHint}
            />
          ) : null}
          <SelectionPersistenceManager enabled={hasLoadedInitialScene && !showLoader} />
          <Viewer
            defaultRender={EDITOR_DEFAULT_RENDER}
            hoverStyles={EDITOR_HOVER_STYLES}
            onSceneReadyChange={onSceneReadyChange}
            renderContext="editor"
            sceneReadyKey={sceneReadyKey}
            selectionManager={isFirstPersonMode ? 'default' : 'custom'}
            selectionStyle={EDITOR_SELECTION_STYLE}
            // SelectedWallGlass marks selected walls while editing; the modes
            // that don't mount it keep the viewer's tint.
            wallSelectionTint={isFirstPersonMode || isVersionPreviewMode}
          >
            <ViewerSceneContent
              isFirstPersonMode={isFirstPersonMode}
              isLoading={showLoader}
              isStudioMode={isStudioMode}
              isVersionPreviewMode={isVersionPreviewMode}
              onThumbnailCapture={onThumbnailCapture}
            />
          </Viewer>
        </div>
      </div>
      {!(showLoader || isVersionPreviewMode) && <ZoneLabelEditorSystem />}
    </ErrorBoundary>
  )
})

export default function Editor({
  layoutVersion = 'v1',
  appMenuButton,
  sidebarTop,
  navbarSlot,
  sidebarTabs,
  viewerToolbarLeft,
  viewerToolbarRight,
  stageOverlay,
  inspectorFooter,
  projectId,
  onLoad,
  onSave,
  saveBackupKey,
  onDirty,
  onSaveStatusChange,
  previewScene,
  isVersionPreviewMode = false,
  isLoading = false,
  onLoaderChange,
  onThumbnailCapture,
  sidebarOverlay,
  viewerBanner,
  settingsPanelProps,
  sitePanelProps,
  extraSidebarPanels,
  commandPaletteEmptyAction,
}: EditorProps) {
  const isFirstPersonMode = useEditor((s) => s.isFirstPersonMode)
  const isStudioMode = useEditor((s) => s.workspaceMode === 'studio')

  useKeyboard({ isVersionPreviewMode, disabled: isFirstPersonMode || isStudioMode })

  const { isLoadingSceneRef } = useAutoSave({
    onSave,
    onDirty,
    onSaveStatusChange,
    isVersionPreviewMode,
    backupKey: saveBackupKey,
  })

  const [isSceneLoading, setIsSceneLoading] = useState(false)
  const [hasLoadedInitialScene, setHasLoadedInitialScene] = useState(false)
  const [sceneReadyKey, setSceneReadyKey] = useState(0)
  const [isViewerSceneReady, setIsViewerSceneReady] = useState(false)
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const isCaptureMode = useEditor((s) => s.isCaptureMode)
  const uiTheme = useUiTheme((s) => s.theme)

  // On <body> so portaled popovers, menus and dialogs switch with the chrome.
  useEffect(() => {
    document.body.classList.toggle('dark', uiTheme === 'dark')
    return () => document.body.classList.remove('dark')
  }, [uiTheme])

  const sidebarWidth = useSidebarStore((s) => s.width)
  const isSidebarCollapsed = useSidebarStore((s) => s.isCollapsed)

  // Plugin-contributed rail panels (registry-only). Called unconditionally so
  // hook order is stable across the v1 / v2 layout branches below; the v1
  // AppSidebar path merges its own copy internally, the v2 path merges these
  // into its tab bar.
  const pluginRailPanels = usePluginPanels()

  useEffect(() => {
    const teardown = initializeEditorRuntime()
    return teardown
  }, [])

  useEffect(() => {
    useViewer.getState().setProjectId(projectId ?? null)

    return () => {
      useViewer.getState().setProjectId(null)
    }
  }, [projectId])

  // Load scene on mount (or when onLoad identity changes, e.g. project switch)
  useEffect(() => {
    let cancelled = false

    async function load() {
      isLoadingSceneRef.current = true
      setHasLoadedInitialScene(false)
      setIsViewerSceneReady(false)
      setIsSceneLoading(true)
      useScene.getState().unloadScene()
      useViewer.getState().resetSelection()

      try {
        const sceneGraph = onLoad ? await onLoad() : loadSceneFromLocalStorage()
        if (!cancelled) {
          applySceneGraphToEditor(sceneGraph)
          setIsViewerSceneReady(false)
          setSceneReadyKey((key) => key + 1)
        }
      } catch {
        if (!cancelled) {
          applySceneGraphToEditor(null)
          setIsViewerSceneReady(false)
          setSceneReadyKey((key) => key + 1)
        }
      } finally {
        if (!cancelled) {
          setIsSceneLoading(false)
          setHasLoadedInitialScene(true)
          requestAnimationFrame(() => {
            isLoadingSceneRef.current = false
          })
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [onLoad, isLoadingSceneRef])

  // Apply preview scene when version preview mode changes
  useEffect(() => {
    if (isVersionPreviewMode && previewScene) {
      applySceneGraphToEditor(previewScene)
    }
  }, [isVersionPreviewMode, previewScene])

  // Lock scene graph and reset to select mode when entering version preview
  useEffect(() => {
    useScene.getState().setReadOnly(isVersionPreviewMode)
    if (isVersionPreviewMode) {
      useEditor.getState().setMode('select')
    }
    return () => {
      useScene.getState().setReadOnly(false)
    }
  }, [isVersionPreviewMode])

  const handleSceneReadyChange = useCallback((ready: boolean) => {
    setIsViewerSceneReady(ready)
  }, [])

  useEffect(() => {
    if (isLoading || isSceneLoading || !hasLoadedInitialScene || isViewerSceneReady) return

    const timer = window.setTimeout(() => {
      console.warn('[editor] viewer scene readiness timed out; showing editor shell anyway', {
        sceneReadyKey,
      })
      setIsViewerSceneReady(true)
    }, SCENE_READY_FALLBACK_MS)

    return () => window.clearTimeout(timer)
  }, [hasLoadedInitialScene, isLoading, isSceneLoading, isViewerSceneReady, sceneReadyKey])

  const showLoader = isLoading || isSceneLoading || !hasLoadedInitialScene || !isViewerSceneReady

  useEffect(() => {
    onLoaderChange?.(showLoader)
  }, [showLoader, onLoaderChange])

  const firstPersonPreviousLevelRef = useRef(useViewer.getState().selection.levelId)
  const wasFirstPersonModeRef = useRef(isFirstPersonMode)

  useEffect(() => {
    const wasFirstPersonMode = wasFirstPersonModeRef.current
    wasFirstPersonModeRef.current = isFirstPersonMode

    if (isFirstPersonMode && !wasFirstPersonMode) {
      const viewer = useViewer.getState()
      firstPersonPreviousLevelRef.current = viewer.selection.levelId
      viewer.setCameraMode('perspective')
      viewer.setWallMode('up')
      viewer.setWalkthroughMode(true)
      viewer.setSelection({ selectedIds: [], zoneId: null })
      return
    }

    if (!(wasFirstPersonMode && !isFirstPersonMode)) return

    const viewer = useViewer.getState()
    const previousLevelId = firstPersonPreviousLevelRef.current
    firstPersonPreviousLevelRef.current = null
    viewer.setWalkthroughMode(false)

    if (!previousLevelId) return

    const previousLevelNode = useScene.getState().nodes[previousLevelId]
    if (previousLevelNode?.type === 'level') {
      viewer.setSelection({
        levelId: previousLevelId,
        zoneId: null,
        selectedIds: [],
      })
    }
  }, [isFirstPersonMode])

  const previewViewerContent = (
    <Viewer
      defaultRender={EDITOR_DEFAULT_RENDER}
      hoverStyles={EDITOR_HOVER_STYLES}
      renderContext="editor"
      selectionManager="default"
      selectionStyle={EDITOR_SELECTION_STYLE}
    >
      <ExportManager />
      <ViewerZoneSystem />
      <CeilingSystem />
      <RoofEditSystem />
      <StairEditSystem />
      {isFirstPersonMode && <FirstPersonControls />}
      <CustomCameraControls />
      <ThumbnailGenerator onThumbnailCapture={onThumbnailCapture} />
      <InteractiveSystem />
    </Viewer>
  )

  const viewerCanvas = (
    <ViewerCanvas
      hasLoadedInitialScene={hasLoadedInitialScene}
      isFirstPersonMode={isFirstPersonMode}
      isLoading={isLoading}
      isStudioMode={isStudioMode}
      isVersionPreviewMode={isVersionPreviewMode}
      onSceneReadyChange={handleSceneReadyChange}
      onThumbnailCapture={onThumbnailCapture}
      sceneReadyKey={sceneReadyKey}
      showLoader={showLoader}
    />
  )

  // ── V2 layout ──
  if (layoutVersion === 'v2') {
    // Plugin panels join the host's `sidebarTabs` as first-class tabs. Host
    // tabs keep precedence (already in the map first); a plugin panel id can't
    // collide with a host tab because it's namespaced by plugin id.
    const tabMap = new Map<string, SidebarTab & { component: React.ComponentType }>(
      sidebarTabs?.map((t) => [t.id, t]) ?? [],
    )
    for (const p of pluginRailPanels) {
      if (!tabMap.has(p.id)) {
        tabMap.set(p.id, { id: p.id, label: p.label, icon: p.icon, component: p.component })
      }
    }

    const renderTabContent = (tabId: string) => {
      // Built-in panels
      if (tabId === 'site') {
        return <SitePanel {...sitePanelProps} />
      }
      if (tabId === 'settings') {
        return <SettingsPanel {...settingsPanelProps} />
      }
      // External tabs (AI chat, catalog, etc.)
      const tab = tabMap.get(tabId)
      if (!tab) return null
      const Component = tab.component
      return <Component />
    }

    const tabBarTabs = [
      ...(sidebarTabs?.map(({ id, label, mobileDefaultSnap, mobileIcon, icon }) => ({
        id,
        label,
        mobileDefaultSnap,
        mobileIcon,
        icon,
      })) ?? []),
      // Plugin panels appear after the host's tabs in the rail. The icon
      // doubles as the mobile icon; a half-height sheet is a sensible default.
      ...pluginRailPanels.map((p) => ({
        id: p.id,
        label: p.label,
        mobileDefaultSnap: 0.5,
        mobileIcon: p.icon,
        icon: p.icon,
      })),
    ]

    return (
      <>
        {showLoader && (
          <div className="fixed inset-0 z-60">
            <SceneLoader className="bg-background" />
          </div>
        )}

        {!isLoading && isPreviewMode ? (
          <div className="dark flex h-full w-full flex-col bg-neutral-100 text-foreground">
            {isFirstPersonMode ? (
              <FirstPersonOverlay onExit={() => useEditor.getState().setFirstPersonMode(false)} />
            ) : (
              <ViewerOverlay onBack={() => useEditor.getState().setPreviewMode(false)} />
            )}
            <div className="h-full w-full" data-pascal-viewer-3d>
              {previewViewerContent}
            </div>
          </div>
        ) : (
          <>
            <EditorLayoutV2
              navbarSlot={navbarSlot}
              overlays={
                <>
                  {!(isVersionPreviewMode || isCaptureMode || isStudioMode) && (
                    <div className="pointer-events-auto">
                      <ActionMenu />
                    </div>
                  )}
                  {!(isVersionPreviewMode || isCaptureMode || isStudioMode) && (
                    <div className="pointer-events-auto">
                      <PanelManager inspectorFooter={inspectorFooter} />
                    </div>
                  )}
                  {!isCaptureMode && (
                    <div className="pointer-events-auto">
                      <HelperManager />
                    </div>
                  )}
                  {!(isCaptureMode || isVersionPreviewMode || isStudioMode) && <HintLine />}
                  {isFirstPersonMode && (
                    <FirstPersonOverlay
                      onExit={() => useEditor.getState().setFirstPersonMode(false)}
                    />
                  )}
                  {viewerBanner}
                  {projectId ? <SnapshotCaptureOverlay projectId={projectId} /> : null}
                </>
              }
              renderTabContent={renderTabContent}
              sidebarOverlay={sidebarOverlay}
              sidebarTabs={tabBarTabs}
              stageOverlay={stageOverlay}
              viewerContent={viewerCanvas}
              viewerToolbarLeft={viewerToolbarLeft}
              viewerToolbarRight={viewerToolbarRight}
            />
            <EditorCommands />
            <CommandPalette emptyAction={commandPaletteEmptyAction} />
          </>
        )}
      </>
    )
  }

  // ── V1 layout (existing) ──
  // p-3 (12px) padding on root + gap-3 (12px) between sidebar and viewer + sidebar width
  const LAYOUT_PADDING = 12
  const LAYOUT_GAP = 12
  const overlayLeft = LAYOUT_PADDING + (isSidebarCollapsed ? 8 : sidebarWidth) + LAYOUT_GAP

  return (
    <div className="dark flex h-full w-full gap-3 bg-neutral-100 p-3 text-foreground">
      {showLoader && (
        <div className="fixed inset-0 z-60">
          <SceneLoader className="bg-background" />
        </div>
      )}

      {!isLoading && isPreviewMode ? (
        <>
          {isFirstPersonMode ? (
            <FirstPersonOverlay onExit={() => useEditor.getState().setFirstPersonMode(false)} />
          ) : (
            <ViewerOverlay onBack={() => useEditor.getState().setPreviewMode(false)} />
          )}
          <div className="h-full w-full" data-pascal-viewer-3d>
            {previewViewerContent}
          </div>
        </>
      ) : (
        <>
          {/* Sidebar */}
          <SidebarSlot>
            <AppSidebar
              appMenuButton={appMenuButton}
              commandPaletteEmptyAction={commandPaletteEmptyAction}
              extraPanels={extraSidebarPanels}
              settingsPanelProps={settingsPanelProps}
              sidebarTop={sidebarTop}
              sitePanelProps={sitePanelProps}
            />
          </SidebarSlot>

          {/* Viewer area */}
          <div className="relative flex-1 overflow-hidden rounded-xl">{viewerCanvas}</div>

          {/* Fixed UI overlays scoped to the viewer area */}
          <ViewerOverlays left={overlayLeft}>
            <div className="pointer-events-auto">
              <ActionMenu />
            </div>
            <div className="pointer-events-auto">
              <PanelManager />
            </div>
            <div className="pointer-events-auto">
              <HelperManager />
            </div>
            <RiserDiagramPanel />
            {isFirstPersonMode && (
              <FirstPersonOverlay onExit={() => useEditor.getState().setFirstPersonMode(false)} />
            )}
          </ViewerOverlays>
        </>
      )}
    </div>
  )
}
