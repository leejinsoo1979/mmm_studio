'use client'

import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef } from 'react'
import { useIsMobile } from '../../hooks/use-mobile'
import { hudVars } from '../../lib/hud'
import { cn } from '../../lib/utils'
import useEditor from '../../store/use-editor'
import { useUiHidden } from '../../store/use-ui-hidden'

import { useSidebarStore } from '../ui/primitives/sidebar'
import { IconTabRow, type SidebarTab } from '../ui/sidebar/tab-bar'
import { EditorLayoutMobile } from './editor-layout-mobile'

const SIDEBAR_MIN_WIDTH = 300
const SIDEBAR_DEFAULT_WIDTH = 340
const SIDEBAR_MAX_WIDTH = 800
const SIDEBAR_COLLAPSE_THRESHOLD = 220
/** inZOI: the build panel floats over the full-screen scene, inset by this much. */
const PANEL_MARGIN = 12
/** The panel starts below the "‹ 돌아가기 | 프로젝트" title row. */
const PANEL_TOP = 64
/** Room left under the panel for the navbar's 48px bottom card (inZOI's 소지금) plus a 12px gap. */
const PANEL_BOTTOM = 72

// ── Left column: resizable panel with tab bar ────────────────────────────────

function LeftColumn({
  tabs,
  renderTabContent,
  sidebarOverlay,
}: {
  tabs: SidebarTab[]
  renderTabContent: (tabId: string) => ReactNode
  sidebarOverlay?: ReactNode
}) {
  const width = useSidebarStore((s) => s.width)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setIsCollapsed = useSidebarStore((s) => s.setIsCollapsed)
  const setWidth = useSidebarStore((s) => s.setWidth)
  const isDragging = useSidebarStore((s) => s.isDragging)
  const setIsDragging = useSidebarStore((s) => s.setIsDragging)
  const activePanel = useEditor((s) => s.activeSidebarPanel)
  const setActivePanel = useEditor((s) => s.setActiveSidebarPanel)

  const isResizing = useRef(false)
  const didNormalizeInitialWidth = useRef(false)

  useEffect(() => {
    if (isCollapsed || didNormalizeInitialWidth.current) return
    didNormalizeInitialWidth.current = true
    if (Math.abs(width - SIDEBAR_DEFAULT_WIDTH) > 8) {
      setWidth(SIDEBAR_DEFAULT_WIDTH)
    }
  }, [isCollapsed, setWidth, width])

  // Ensure active panel is a valid tab
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activePanel)) {
      setActivePanel(tabs[0]!.id)
    }
  }, [tabs, activePanel, setActivePanel])

  // Leaving the items tab while furnishing should drop back to select mode
  useEffect(() => {
    if (activePanel === 'items') return
    const { phase, mode, setMode } = useEditor.getState()
    if (phase === 'furnish' && mode === 'build') {
      setMode('select')
    }
  }, [activePanel])

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

  // Rail click: reopen a collapsed panel, collapse when re-clicking the open
  // tab, otherwise switch tabs. Reopening clamps below-min persisted widths
  // up to the minimum so the panel always returns to a usable size.
  const handleRailClick = useCallback(
    (id: string) => {
      if (isCollapsed) {
        setIsCollapsed(false)
        if (width < SIDEBAR_MIN_WIDTH) setWidth(SIDEBAR_MIN_WIDTH)
        setActivePanel(id)
        return
      }
      if (id === activePanel) {
        setIsCollapsed(true)
        return
      }
      setActivePanel(id)
    },
    [isCollapsed, width, activePanel, setIsCollapsed, setWidth, setActivePanel],
  )

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isResizing.current) return
      const newWidth = e.clientX - PANEL_MARGIN
      if (newWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
        setIsCollapsed(true)
      } else {
        setIsCollapsed(false)
        setWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(newWidth, SIDEBAR_MAX_WIDTH)))
      }
    }
    const handlePointerUp = () => {
      isResizing.current = false
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
    <div className="relative flex min-h-0 flex-1 flex-col text-sidebar-foreground">
      <IconTabRow
        activeTab={activePanel}
        collapsed={isCollapsed}
        onIconClick={handleRailClick}
        tabs={tabs}
      />
      {!isCollapsed && (
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          style={{
            width,
            transition: isDragging ? 'none' : 'width 150ms ease',
          }}
        >
          <div className="relative flex flex-1 flex-col overflow-hidden">
            {renderTabContent(activePanel)}
            {sidebarOverlay && <div className="absolute inset-0 z-50">{sidebarOverlay}</div>}
          </div>

          {/* Resize handle + hit area */}
          <div
            className="group/resize absolute inset-y-0 right-0 z-[100] flex w-3 cursor-col-resize items-center justify-center"
            onPointerDown={handleResizerDown}
          >
            <div
              className={cn(
                'h-8 w-1 rounded-full bg-neutral-400/80 transition-opacity group-hover/resize:opacity-100',
                isDragging ? 'opacity-100' : 'opacity-0',
              )}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Right column: viewer area with toolbar ───────────────────────────────────

function RightColumn({
  toolbarLeft,
  toolbarRight,
  children,
  overlays,
  stageOverlay,
}: {
  toolbarLeft?: ReactNode
  toolbarRight?: ReactNode
  children: ReactNode
  overlays?: ReactNode
  stageOverlay?: ReactNode
}) {
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* inZOI top row: breadcrumb, the tool bar centred on the screen
          (ActionMenu) and the day / night slider at the right, all 44px tall
          at top 12. */}
      {toolbarRight && (
        <div
          className="pointer-events-auto absolute top-3 right-3 z-20 flex h-11 items-center gap-2"
          data-hud-avoid
        >
          {toolbarRight}
        </div>
      )}
      {toolbarLeft && (
        <div
          className="pointer-events-auto absolute bottom-3 z-20 flex items-center gap-2"
          style={{ left: 'calc(var(--viewer-left-inset, 0px) + 12px)' }}
        >
          {toolbarLeft}
        </div>
      )}
      {/* Canvas area */}
      <div className="relative flex-1 overflow-hidden">{children}</div>
      {/* Stage overlay — replaces the canvas visually (e.g. studio gallery)
          while keeping it mounted. Sits below the viewer toolbar (z-20) so
          the stage switch stays reachable. */}
      {stageOverlay && <div className="absolute inset-0 z-10">{stageOverlay}</div>}
      {/* Overlays scoped to the viewer column. `data-viewer-bounds` marks the
          draggable region the floating inspector clamps itself to. */}
      {overlays && (
        <div
          className="pointer-events-none absolute inset-0 z-30"
          data-viewer-bounds
          style={{ transform: 'translateZ(0)' }}
        >
          {overlays}
        </div>
      )}
    </div>
  )
}

// ── Main v2 layout ───────────────────────────────────────────────────────────

export interface EditorLayoutV2Props {
  navbarSlot?: ReactNode
  sidebarTabs?: SidebarTab[]
  renderTabContent: (tabId: string) => ReactNode
  sidebarOverlay?: ReactNode
  viewerToolbarLeft?: ReactNode
  viewerToolbarRight?: ReactNode
  viewerContent: ReactNode
  overlays?: ReactNode
  stageOverlay?: ReactNode
}

export function EditorLayoutV2({
  navbarSlot,
  sidebarTabs = [],
  renderTabContent,
  sidebarOverlay,
  viewerToolbarLeft,
  viewerToolbarRight,
  viewerContent,
  overlays,
  stageOverlay,
}: EditorLayoutV2Props) {
  const isCaptureMode = useEditor((s) => s.isCaptureMode)
  const uiHidden = useUiHidden((s) => s.hidden)
  const customizing = useUiHidden((s) => s.customizing)
  const sceneAppearance = useViewer((s) => getSceneTheme(s.sceneTheme).appearance)
  const hideChrome = isCaptureMode || uiHidden
  const sidebarWidth = useSidebarStore((s) => s.width)
  const sidebarCollapsed = useSidebarStore((s) => s.isCollapsed)
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <EditorLayoutMobile
        navbarSlot={navbarSlot}
        overlays={overlays}
        renderTabContent={renderTabContent}
        sidebarOverlay={sidebarOverlay}
        sidebarTabs={sidebarTabs}
        viewerContent={viewerContent}
        viewerToolbarLeft={viewerToolbarLeft}
        viewerToolbarRight={viewerToolbarRight}
      />
    )
  }

  const showPanel = !(hideChrome || customizing) && sidebarTabs.length > 0
  const leftInset = showPanel ? PANEL_MARGIN + Math.max(sidebarWidth, SIDEBAR_MIN_WIDTH) : 0

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-sidebar text-foreground"
      style={
        { '--viewer-left-inset': `${leftInset}px`, ...hudVars(sceneAppearance) } as CSSProperties
      }
    >
      {/* Full-screen scene; the build panel floats over it (inZOI). */}
      <div className="absolute inset-0">
        <RightColumn
          overlays={uiHidden ? undefined : overlays}
          stageOverlay={stageOverlay}
          toolbarLeft={hideChrome || customizing ? undefined : viewerToolbarLeft}
          toolbarRight={hideChrome ? undefined : viewerToolbarRight}
        >
          {viewerContent}
        </RightColumn>
      </div>
      {!hideChrome && navbarSlot && (
        <div
          className="absolute z-40 flex h-11 items-center"
          data-hud-avoid
          style={{ top: PANEL_MARGIN, left: PANEL_MARGIN }}
        >
          {navbarSlot}
        </div>
      )}
      {showPanel && (
        <div
          data-floating-panel
          className={cn(
            'absolute z-40 flex flex-col overflow-hidden rounded-[20px] bg-[var(--panel-body)] shadow-[0_2px_12px_rgba(0,0,0,0.08)] backdrop-blur-[30px] backdrop-saturate-150',
            // inZOI panel bands: opaque tabs, frosted search band, light
            // sub-row, frosted grey body, translucent headers, near-white cards.
            '[--panel-accent:#8ec3f2] [--panel-band:rgba(170,170,178,0.55)] [--panel-body:rgba(176,177,181,0.55)] [--panel-card-fg:#4a4a4a] [--panel-card-hover:#ffffff] [--panel-card:rgba(247,247,247,0.94)] [--panel-header:rgba(80,80,90,0.3)] [--panel-hero:#edebea] [--panel-subrow:#f2f2f2] [--panel-tabs:#f8f8f8]',
            'dark:[--panel-band:rgba(44,44,48,0.62)] dark:[--panel-body:rgba(26,26,28,0.62)] dark:[--panel-card-fg:#e5e5e5] dark:[--panel-card-hover:rgba(72,72,74,0.96)] dark:[--panel-card:rgba(56,56,58,0.94)] dark:[--panel-header:rgba(255,255,255,0.12)] dark:[--panel-hero:#2c2c2c] dark:[--panel-subrow:#262626] dark:[--panel-tabs:#242424]',
          )}
          style={{
            top: PANEL_TOP,
            bottom: sidebarCollapsed ? undefined : navbarSlot ? PANEL_BOTTOM : PANEL_MARGIN,
            left: PANEL_MARGIN,
            width: leftInset - PANEL_MARGIN,
          }}
        >
          <LeftColumn
            renderTabContent={renderTabContent}
            sidebarOverlay={sidebarOverlay}
            tabs={sidebarTabs}
          />
        </div>
      )}
    </div>
  )
}
