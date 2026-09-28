'use client'

import { useScene } from '@pascal-app/core'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Slider,
  useEditor,
  useUiTheme,
} from '@pascal-app/editor'
import {
  CLAY_PALETTE,
  type EdgeMode,
  getSceneTheme,
  SCENE_THEMES,
  useViewer,
} from '@pascal-app/viewer'
import {
  Box,
  Camera,
  Check,
  Contrast,
  Diamond,
  Eye,
  EyeOff,
  Footprints,
  Gauge,
  Gem,
  Grid2X2,
  Layers,
  Layers3,
  Magnet,
  Map as MapIcon,
  Moon,
  Palette,
  PenLine,
  Ruler,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  SunMedium,
  SwatchBook,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useArchipleBridge } from './archiple-floorplan-bridge'
import { ExportCenter } from './export-center'
import { Tooltip, TooltipContent, TooltipTrigger } from './toolbar-tooltip'

// inZOI's round avatar-slot buttons at the top right.
const ROUND_BTN =
  'flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[#f5f5f5]/95 text-[#6b6b6b] shadow-[0_2px_8px_rgba(0,0,0,0.15)] backdrop-blur-md transition-colors hover:bg-white hover:text-[#333] dark:bg-neutral-900/90 dark:text-neutral-300 dark:hover:bg-neutral-800'

function requestWalkthroughPointerLock() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-pascal-viewer-3d] canvas')
  if (!canvas) return

  if (!canvas.hasAttribute('tabindex')) {
    canvas.tabIndex = -1
  }
  canvas.focus({ preventScroll: true })

  if (document.pointerLockElement === canvas) return

  try {
    canvas.requestPointerLock?.()
  } catch {
    return
  }
}

function ToolbarTooltip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

const SHADING_OPTIONS = [
  {
    id: 'performance',
    name: '가볍게',
    detail: '가장 가벼운 렌더 — 효과 최소화',
    icon: Gauge,
  },
  { id: 'solid', name: '단색', detail: '평면 음영, 빠름 — 앰비언트 오클루전 없음', icon: Box },
  { id: 'rendered', name: '기본 렌더', detail: '앰비언트 오클루전 포함', icon: Sparkles },
  { id: 'hyper', name: '고품질', detail: '선명한 조명 · 그림자 · 디테일', icon: Gem },
] as const

const TEXTURE_OPTIONS = [
  { id: 'colored', name: '재질 표시', detail: '재질 · 텍스처 · 색상 표시', icon: Palette },
  {
    id: 'monochrome-outline',
    name: '단색 + 윤곽선',
    detail: '클레이 표면에 옅은 윤곽선',
    icon: PenLine,
  },
  { id: 'monochrome', name: '단색', detail: '용도별 클레이 표면', icon: Square },
] as const

const LEVEL_MODES = [
  { id: 'stacked', label: '층 쌓기', icon: Layers },
  { id: 'exploded', label: '층 펼치기', icon: Layers3 },
  { id: 'solo', label: '한 층만', icon: Diamond },
] as const

/** Saves the current view as a walkthrough camera in the scene's experience. */
function saveCameraView() {
  window.dispatchEvent(
    new CustomEvent('mmm-camera-capture', {
      detail: (snapshot: {
        position: [number, number, number]
        target: [number, number, number]
        fov?: number
      }) => {
        const { experience, setExperience } = useScene.getState()
        setExperience({
          ...experience,
          cameras: [
            ...experience.cameras,
            {
              id: crypto.randomUUID(),
              label: `시점 ${experience.cameras.length + 1}`,
              ...snapshot,
            },
          ],
        })
      },
    }),
  )
}

function startWalkthrough() {
  const { isFirstPersonMode, setFirstPersonMode } = useEditor.getState()
  if (isFirstPersonMode) {
    setFirstPersonMode(false)
    return
  }
  flushSync(() => setFirstPersonMode(true))
  requestWalkthroughPointerLock()
}

// One dropdown that gathers every "how the scene looks" control: grid, shadows,
// camera projection, units, render mode, edges and scene theme.

const EDGE_OPTIONS = [
  { id: 'off', name: '끄기', detail: '윤곽선 없음' },
  { id: 'soft', name: '옅게', detail: '주요 모서리만 옅게' },
  { id: 'strong', name: '진하게', detail: '선명한 윤곽선' },
] as const satisfies readonly { id: EdgeMode; name: string; detail: string }[]

const UNIT_OPTIONS = [
  { id: 'millimeter', icon: 'mm', label: '밀리미터' },
  { id: 'centimeter', icon: 'cm', label: '센티미터' },
  { id: 'imperial', icon: 'ft', label: '피트' },
] as const

const SUBMENU_CONTENT_CLASS = 'min-w-56 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl'

function SunSlider({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  onValueChange,
}: {
  label: string
  value: number
  displayValue: string
  min: number
  max: number
  step: number
  onValueChange: (value: number) => void
}) {
  return (
    <div className="space-y-2 px-2 py-2" onKeyDown={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{displayValue}</span>
      </div>
      <Slider
        aria-label={label}
        max={max}
        min={min}
        onValueChange={([next]) => next !== undefined && onValueChange(next)}
        step={step}
        value={[value]}
      />
    </div>
  )
}

function DisplayMenu() {
  const showGrid = useViewer((state) => state.showGrid)
  const setShowGrid = useViewer((state) => state.setShowGrid)
  const unit = useViewer((state) => state.unit)
  const setUnit = useViewer((state) => state.setUnit)
  const cameraMode = useViewer((state) => state.cameraMode)
  const setCameraMode = useViewer((state) => state.setCameraMode)
  const shading = useViewer((state) => state.shading)
  const setShading = useViewer((state) => state.setShading)
  const textures = useViewer((state) => state.textures)
  const setTextures = useViewer((state) => state.setTextures)
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const setSceneTheme = useViewer((state) => state.setSceneTheme)
  const edges = useViewer((state) => state.edges)
  const setEdges = useViewer((state) => state.setEdges)
  const shadows = useViewer((state) => state.shadows)
  const setShadows = useViewer((state) => state.setShadows)
  const sunTime = useViewer((state) => state.sunTime)
  const setSunTime = useViewer((state) => state.setSunTime)
  const sunMonth = useViewer((state) => state.sunMonth)
  const setSunMonth = useViewer((state) => state.setSunMonth)
  const sunAzimuth = useViewer((state) => state.sunAzimuth)
  const setSunAzimuth = useViewer((state) => state.setSunAzimuth)
  const magneticSnap = useEditor((state) => state.magneticSnap)
  const setMagneticSnap = useEditor((state) => state.setMagneticSnap)
  const showDimensions = useEditor((state) => state.showDimensions)
  const setShowDimensions = useEditor((state) => state.setShowDimensions)
  const isFirstPersonMode = useEditor((state) => state.isFirstPersonMode)
  const levelMode = useViewer((state) => state.levelMode)
  const setLevelMode = useViewer((state) => state.setLevelMode)
  const savedCameraCount = useScene((state) => state.experience.cameras.length)
  const uiTheme = useUiTheme((state) => state.theme)
  const toggleUiTheme = useUiTheme((state) => state.toggle)

  const activeShading =
    SHADING_OPTIONS.find((option) => option.id === shading) ?? SHADING_OPTIONS[0]
  const activeEdges = EDGE_OPTIONS.find((option) => option.id === edges) ?? EDGE_OPTIONS[0]
  const activeTheme = getSceneTheme(sceneTheme)
  const activeUnit = UNIT_OPTIONS.find((option) => option.id === unit) ?? UNIT_OPTIONS[0]
  const activeLevelMode = LEVEL_MODES.find((option) => option.id === levelMode) ?? LEVEL_MODES[0]
  const nextUnit =
    UNIT_OPTIONS[(UNIT_OPTIONS.findIndex((option) => option.id === unit) + 1) % UNIT_OPTIONS.length]
      ?.id ?? 'millimeter'

  // Keep the menu open when flipping a toggle.
  const keepOpen = (event: Event, fn: () => void) => {
    event.preventDefault()
    fn()
  }

  return (
    <DropdownMenu>
      <ToolbarTooltip label="보기 설정">
        <DropdownMenuTrigger asChild>
          <button aria-label="보기 설정" className={ROUND_BTN} type="button">
            <SlidersHorizontal className="size-5 shrink-0" strokeWidth={1.5} />
          </button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent
        align="end"
        className="w-60 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl"
        // Walkthrough locks the pointer to the canvas; don't pull focus back.
        onCloseAutoFocus={(event) => event.preventDefault()}
        side="bottom"
        sideOffset={8}
      >
        <DropdownMenuItem onSelect={startWalkthrough}>
          <Footprints className="h-4 w-4" />
          <span>{isFirstPersonMode ? '1인칭 투어 끝내기' : '1인칭 투어'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useEditor.getState().setPreviewMode(true)}>
          <Eye className="h-4 w-4" />
          <span>미리보기</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={saveCameraView}>
          <Camera className="h-4 w-4" />
          <span>현재 시점 저장</span>
          <span className="ml-auto text-muted-foreground text-xs tabular-nums">
            {savedCameraCount}개
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => keepOpen(e, toggleUiTheme)}>
          {uiTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          <span>{uiTheme === 'dark' ? '밝은 화면' : '어두운 화면'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useArchipleBridge.getState().setOpen(true)}>
          <MapIcon className="h-4 w-4" />
          <span>Archiple 2D 도면 (실험)</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShowGrid(!showGrid))}>
          <Grid2X2 className="h-4 w-4" />
          <span>격자</span>
          {showGrid ? (
            <Eye className="ml-auto h-4 w-4 text-foreground" />
          ) : (
            <EyeOff className="ml-auto h-4 w-4 text-muted-foreground" />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShowDimensions(!showDimensions))}>
          <Ruler className="h-4 w-4" />
          <span>치수</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {showDimensions ? '켜짐' : '꺼짐'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setMagneticSnap(!magneticSnap))}>
          <Magnet className="h-4 w-4" />
          <span>자석 스냅</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {magneticSnap ? '켜짐' : '꺼짐'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShadows(!shadows))}>
          <Contrast className="h-4 w-4" />
          <span>그림자</span>
          <span className="ml-auto text-muted-foreground text-xs">{shadows ? '켜짐' : '꺼짐'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) =>
            keepOpen(e, () =>
              setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective'),
            )
          }
        >
          {cameraMode === 'perspective' ? (
            <Box className="h-4 w-4" />
          ) : (
            <Grid2X2 className="h-4 w-4" />
          )}
          <span>카메라</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {cameraMode === 'perspective' ? '원근' : '평행 투영'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setUnit(nextUnit))}>
          <span className="flex h-4 w-4 items-center justify-center font-semibold text-[10px]">
            {activeUnit.icon}
          </span>
          <span>단위</span>
          <span className="ml-auto text-muted-foreground text-xs">{activeUnit.label}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <activeLevelMode.icon className="h-4 w-4" />
            <span>층 보기</span>
            <span className="ml-auto text-muted-foreground text-xs">{activeLevelMode.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
            {LEVEL_MODES.map((option) => (
              <DropdownMenuItem key={option.id} onSelect={() => setLevelMode(option.id)}>
                <option.icon className="h-4 w-4" />
                <span className="text-foreground">{option.label}</span>
                {activeLevelMode.id === option.id ? (
                  <Check className="ml-auto h-4 w-4 text-foreground" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunMedium className="h-4 w-4" />
            <span>태양 위치</span>
            <span className="ml-auto text-muted-foreground text-xs">
              {`${Math.floor(sunTime).toString().padStart(2, '0')}:${Math.round((sunTime % 1) * 60)
                .toString()
                .padStart(2, '0')}`}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64 rounded-xl border-border/45 bg-popover/95 p-2 backdrop-blur-xl">
            <SunSlider
              displayValue={`${Math.floor(sunTime).toString().padStart(2, '0')}:${Math.round(
                (sunTime % 1) * 60,
              )
                .toString()
                .padStart(2, '0')}`}
              label="시간"
              max={24}
              min={0}
              onValueChange={setSunTime}
              step={0.25}
              value={sunTime}
            />
            <SunSlider
              displayValue={`${Math.round(sunMonth)}월`}
              label="계절"
              max={12}
              min={1}
              onValueChange={setSunMonth}
              step={1}
              value={sunMonth}
            />
            <SunSlider
              displayValue={`${Math.round(sunAzimuth)}°`}
              label="북쪽 방향"
              max={359}
              min={0}
              onValueChange={setSunAzimuth}
              step={1}
              value={sunAzimuth}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <activeShading.icon className="h-4 w-4" />
            <span>렌더</span>
            <span className="ml-auto text-muted-foreground text-xs">{activeShading.name}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
            {SHADING_OPTIONS.map((option) => {
              const OptionIcon = option.icon
              return (
                <DropdownMenuItem key={option.id} onSelect={() => setShading(option.id)}>
                  <OptionIcon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="text-foreground">{option.name}</span>
                    <span className="text-muted-foreground text-xs">{option.detail}</span>
                  </div>
                  {shading === option.id ? (
                    <Check className="ml-auto h-4 w-4 text-foreground" />
                  ) : null}
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            {TEXTURE_OPTIONS.map((option) => {
              const OptionIcon = option.icon
              const isActive =
                option.id === 'colored'
                  ? textures
                  : option.id === 'monochrome-outline'
                    ? !textures && edges === 'soft'
                    : !textures && edges === 'off'
              return (
                <DropdownMenuItem
                  key={option.name}
                  onSelect={() => {
                    if (option.id === 'colored') {
                      setTextures(true)
                    } else if (option.id === 'monochrome-outline') {
                      setTextures(false)
                      setEdges('soft')
                    } else {
                      setTextures(false)
                      setEdges('off')
                    }
                  }}
                >
                  <OptionIcon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="text-foreground">{option.name}</span>
                    <span className="text-muted-foreground text-xs">{option.detail}</span>
                  </div>
                  {isActive ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PenLine className="h-4 w-4" />
            <span>윤곽선</span>
            <span className="ml-auto text-muted-foreground text-xs">{activeEdges.name}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
            {EDGE_OPTIONS.map((option) => (
              <DropdownMenuItem key={option.id} onSelect={() => setEdges(option.id)}>
                <div className="flex flex-col">
                  <span className="text-foreground">{option.name}</span>
                  <span className="text-muted-foreground text-xs">{option.detail}</span>
                </div>
                {edges === option.id ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SwatchBook className="h-4 w-4" />
            <span>테마</span>
            <span className="ml-auto truncate text-muted-foreground text-xs">
              {activeTheme.name}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl">
            {SCENE_THEMES.map((theme) => {
              const swatches = (['wall', 'roof', 'floor', 'glazing'] as const).map(
                (role) => theme.clayTints?.[role] ?? CLAY_PALETTE[role],
              )
              return (
                <DropdownMenuItem key={theme.id} onSelect={() => setSceneTheme(theme.id)}>
                  <span
                    className="grid h-5 w-5 shrink-0 grid-cols-2 overflow-hidden rounded-sm border border-black/10"
                    style={{ backgroundColor: theme.background }}
                  >
                    {swatches.map((color, index) => (
                      <span key={`${theme.id}-${index}`} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span className="text-foreground">{theme.name}</span>
                  {sceneTheme === theme.id ? (
                    <Check className="ml-auto h-4 w-4 text-foreground" />
                  ) : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Theme shown for each part of the day; daytime keeps the user's theme. */
function themeForTime(time: number): 'night' | 'twilight' | null {
  if (time < 5.5 || time >= 19.5) return 'night'
  if (time < 7 || time >= 18) return 'twilight'
  return null
}

let dayTheme = 'studio'

/**
 * inZOI's sun ↔ moon slider: drags the time of day (the sun position) and
 * brings in the twilight / night themes after dusk, restoring the daytime
 * theme at dawn.
 */
function TimeOfDaySlider() {
  const sunTime = useViewer((s) => s.sunTime)
  const setTime = (time: number) => {
    const viewer = useViewer.getState()
    if (
      !themeForTime(viewer.sunTime) &&
      viewer.sceneTheme !== 'night' &&
      viewer.sceneTheme !== 'twilight'
    )
      dayTheme = viewer.sceneTheme
    viewer.setSunTime(time)
    viewer.setSceneTheme(themeForTime(time) ?? dayTheme)
  }
  const hh = Math.floor(sunTime)
  const mm = Math.round((sunTime - hh) * 60)
  return (
    <div
      className="flex h-11 items-center gap-2"
      onKeyDown={(event) => event.stopPropagation()}
      title={`시간대 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`}
    >
      <SunMedium className="size-5 shrink-0 fill-[#f5b41e] text-[#f5b41e] drop-shadow-[0_0_6px_rgba(245,180,30,0.75)]" />
      <Slider
        aria-label="시간대"
        className="w-16 min-[1500px]:w-28 min-[1600px]:w-44 min-[1800px]:w-56 [&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-[#ddd2a3] [&_[data-slot=slider-thumb]]:shadow-[0_1px_3px_rgba(0,0,0,0.3)] [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-[linear-gradient(90deg,#ebd964,#dedece_50%,#7ba6ef)]"
        max={24}
        min={0}
        onValueChange={([next]) => next !== undefined && setTime(next)}
        step={0.25}
        value={[sunTime]}
      />
      <Moon className="size-5 shrink-0 fill-[#5f8fe0] text-[#5f8fe0] drop-shadow-[0_0_6px_rgba(95,143,224,0.75)]" />
    </div>
  )
}

/**
 * inZOI's top right: a free-floating day / night slider, then round buttons in
 * the avatar slot (export, and the settings menu that also holds the tour,
 * preview, saved views, UI theme and the Archiple floor plan).
 */
export function CommunityViewerToolbarRight({
  sceneId,
  sceneName,
}: {
  sceneId: string
  sceneName: string
}) {
  return (
    <div className="flex h-11 items-center gap-2 min-[1500px]:gap-3">
      <TimeOfDaySlider />
      <ExportCenter sceneId={sceneId} sceneName={sceneName} />
      <DisplayMenu />
    </div>
  )
}
