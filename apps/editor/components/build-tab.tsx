'use client'

import { type AssetInput, constructionBuildUpMm, nodeRegistry } from '@pascal-app/core'
import { triggerSFX, useEditor } from '@pascal-app/editor'
import {
  LevelTakeoffSummary,
  useLiquidLineToolOptions,
  WallConstructionFields,
} from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { Check, type LucideIcon, Minus, Search, Spline, Square, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TooltipProvider } from '@/components/toolbar-tooltip'
import { cn } from '@/lib/utils'
import {
  FULL_WALL_HEIGHTS,
  PARTIAL_WALL_HEIGHTS,
  useWallDrawingDefaults,
  wallDrawingToolDefaults,
} from '@/lib/wall-drawing-defaults'
import { CatalogHover } from './catalog-hover-card'

type BuildToolKind =
  | 'wall'
  | 'fence'
  | 'custom-room'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'stair'
  | 'elevator'
  | 'door'
  | 'window'
  | 'column'
  | 'shelf'
  | 'spawn'

type MepToolKind =
  | 'duct-segment'
  | 'duct-fitting'
  | 'duct-terminal'
  | 'hvac-equipment'
  | 'lineset'
  | 'liquid-line'
  | 'pipe-segment'
  | 'pipe-fitting'
  | 'pipe-trap'

type BuildType = {
  id: string
  label: string
  description?: string
  iconSrc: string
  asset?: AssetInput
  kind?: BuildToolKind
  defaults?: Record<string, unknown>
}

type BuildSection = {
  id: string
  title: string
  items: BuildType[]
}

type MepItem = {
  id: string
  label: string
  iconSrc: string
  kind: MepToolKind
}

const IMPORT_ITEMS: BuildType[] = [
  { id: 'import-3d', label: '3D 모델 가져오기', iconSrc: '/icons/mesh.webp' },
  { id: 'import-cad', label: 'CAD 가져오기', iconSrc: '/icons/blueprint.webp' },
  { id: 'import-image', label: '도면 이미지 가져오기', iconSrc: '/icons/floorplan.webp' },
]

const DOOR1_ASSET: AssetInput = {
  id: 'door1-glb',
  category: 'furniture',
  name: 'Door1',
  thumbnail: '/icons/door.webp',
  src: '/items/door1/model.glb',
  dimensions: [0.9, 2.1, 0.12],
  offset: [0, 0.005, -0.014],
  rotation: [0, Math.PI / 2, 0],
  scale: [0.23, 0.1, 0.1125],
  attachTo: 'wall-side',
  source: 'library',
  tags: ['door', 'wall', 'glb'],
}

const BUILD_SECTIONS: BuildSection[] = [
  {
    id: 'walls',
    title: '그리기 방식',
    items: [
      { id: 'wall', label: '직선', iconSrc: '/icons/wall.webp', kind: 'wall' },
      { id: 'wall-arc', label: '곡선', iconSrc: '/icons/wallcut.webp', kind: 'wall' },
      {
        id: 'custom-room',
        label: '사각형 방',
        iconSrc: '/icons/custom-room.webp',
        kind: 'custom-room',
      },
    ],
  },
  {
    id: 'door',
    title: '문',
    items: [
      {
        id: 'door',
        label: '여닫이문',
        iconSrc: '/images/room-library/doors/hinged.jpg',
        kind: 'door',
      },
      {
        id: 'double-door',
        label: '양개문',
        iconSrc: '/images/room-library/doors/hinged.jpg',
        kind: 'door',
      },
      {
        id: 'sliding-door',
        label: '미닫이문',
        iconSrc: '/images/room-library/doors/sliding.jpg',
        kind: 'door',
      },
      {
        id: 'hidden-door',
        label: '히든도어 (목상·떡가베 벽)',
        description: '목상 또는 떡가베로 지은 벽에만 설치할 수 있습니다.',
        iconSrc: '/images/room-library/doors/hidden.jpg',
        kind: 'door',
        defaults: { hidden: true },
      },
      {
        id: 'step-door-yerim',
        label: '예림·인쇼 스텝도어',
        description: '문틀 깊이가 설치하는 벽의 마감 두께에 맞춰집니다.',
        iconSrc: '/images/room-library/doors/step.jpg',
        kind: 'door',
        defaults: { stepProduct: 'yerim-inshow' },
      },
      {
        id: 'step-door-younglim',
        label: '영림 스텝도어',
        description: '문틀 깊이가 설치하는 벽의 마감 두께에 맞춰집니다.',
        iconSrc: '/images/room-library/doors/step.jpg',
        kind: 'door',
        defaults: { stepProduct: 'younglim' },
      },
      {
        id: 'door1-glb',
        label: 'Door1 GLB',
        iconSrc: '/images/room-library/doors/hinged.jpg',
        asset: DOOR1_ASSET,
      },
    ],
  },
  {
    id: 'window',
    title: '창문',
    items: [
      {
        id: 'window',
        label: '단창',
        iconSrc: '/images/room-library/windows/fixed.jpg',
        kind: 'window',
      },
      {
        id: 'dual-window',
        label: '쌍창',
        iconSrc: '/images/room-library/windows/sliding.jpg',
        kind: 'window',
      },
      {
        id: 'unequal-double-window',
        label: '비대칭 쌍창',
        iconSrc: '/images/room-library/windows/sliding.jpg',
        kind: 'window',
      },
      {
        id: 'corner-bay-window',
        label: '코너 돌출창',
        iconSrc: '/images/room-library/windows/fixed.jpg',
        kind: 'window',
      },
      {
        id: 'corner-window',
        label: '코너창',
        iconSrc: '/images/room-library/windows/fixed.jpg',
        kind: 'window',
      },
      {
        id: 'bay-window',
        label: '돌출창',
        iconSrc: '/images/room-library/windows/fixed.jpg',
        kind: 'window',
      },
      {
        id: 'arc-window',
        label: '아치창',
        iconSrc: '/images/room-library/windows/fixed.jpg',
        kind: 'window',
      },
    ],
  },
  {
    id: 'structure',
    title: '구조',
    items: [
      { id: 'slab', label: '바닥', iconSrc: '/icons/floor.webp', kind: 'slab' },
      { id: 'ceiling', label: '천장', iconSrc: '/icons/ceiling.webp', kind: 'ceiling' },
      { id: 'roof', label: '지붕', iconSrc: '/icons/roof.webp', kind: 'roof' },
      { id: 'stair', label: '계단', iconSrc: '/icons/stairs.webp', kind: 'stair' },
      { id: 'elevator', label: '엘리베이터', iconSrc: '/icons/elevator.webp', kind: 'elevator' },
      { id: 'column', label: '기둥', iconSrc: '/icons/column.webp', kind: 'column' },
      { id: 'shelf', label: '선반', iconSrc: '/icons/shelf.webp', kind: 'shelf' },
      { id: 'fence', label: '울타리', iconSrc: '/icons/fence.webp', kind: 'fence' },
      { id: 'spawn', label: '시작 위치', iconSrc: '/icons/spawn-point.webp', kind: 'spawn' },
      { id: 'mep', label: '설비 (MEP)', iconSrc: '/icons/HVAC.webp' },
    ],
  },
]

const MEP_ITEMS: MepItem[] = [
  { id: 'duct-segment', label: '덕트', iconSrc: '/icons/duct.webp', kind: 'duct-segment' },
  {
    id: 'duct-terminal',
    label: '디퓨저',
    iconSrc: '/icons/registers.webp',
    kind: 'duct-terminal',
  },
  { id: 'hvac-equipment', label: '냉난방기', iconSrc: '/icons/HVAC.webp', kind: 'hvac-equipment' },
  { id: 'lineset', label: '냉매 배관', iconSrc: '/icons/lineset.webp', kind: 'lineset' },
  { id: 'liquid-line', label: '액관', iconSrc: '/icons/lineset.webp', kind: 'liquid-line' },
  { id: 'pipe-segment', label: '오배수관', iconSrc: '/icons/dwv-pipes.webp', kind: 'pipe-segment' },
]

const MEP_TOOL_KINDS = new Set<string>([
  ...MEP_ITEMS.map((item) => item.kind),
  'duct-fitting',
  'pipe-fitting',
  'pipe-trap',
])

const ROOF_FEATURE_FALLBACK_ICON = '/icons/roof.webp'

type RoofFeature = { kind: string; label: string; iconSrc: string }

function activateBuildTool(
  kind: BuildToolKind | MepToolKind,
  defaults?: Record<string, unknown>,
): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setToolDefaults(kind, kind === 'wall' ? wallDrawingToolDefaults() : (defaults ?? null))
  if (kind === 'wall') ed.setSnappingMode('wall', 'lines')
  ed.setMode('build')
  ed.setTool(kind)
}

function activateRectangleRoomTool(): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setToolDefaults('wall', {
    placementMode: 'rectangle-room',
    ...wallDrawingToolDefaults(),
  })
  ed.setSnappingMode('wall', 'lines')
  ed.setMode('build')
  ed.setTool('rectangle-room')
}

function activateArcWallTool(): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setToolDefaults('wall', {
    placementMode: 'arc-wall',
    ...wallDrawingToolDefaults(),
  })
  ed.setSnappingMode('wall', 'lines')
  ed.setMode('build')
  ed.setTool('wall-arc')
}

function activateItemAssetTool(asset: AssetInput): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setSelectedItem(asset)
  ed.setToolDefaults('item', null)
  ed.setMode('build')
  ed.setTool('item')
}

function activateRoofFeatureTool(kind: string): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setMode('build')
  ed.setTool(kind as Parameters<typeof ed.setTool>[0])
}

function BuildTile({
  active,
  caption,
  disabled = false,
  item,
  onClick,
}: {
  active?: boolean
  caption?: string
  disabled?: boolean
  item: BuildType | MepItem | RoofFeature
  onClick?: () => void
}) {
  return (
    <CatalogHover
      info={{
        title: item.label,
        description: 'description' in item ? item.description : undefined,
        image: isPhoto(item.iconSrc) ? item.iconSrc : undefined,
        meta: caption,
      }}
    >
      <button
        aria-label={item.label}
        aria-pressed={active}
        className={cn(
          'group relative flex aspect-square min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-white dark:bg-neutral-900 shadow-[0_1px_3px_rgba(0,0,0,0.12)] ring-1 transition-all duration-150',
          active ? 'ring-2 ring-sky-400' : 'ring-black/5 dark:ring-white/10 hover:ring-neutral-400',
          disabled && 'cursor-not-allowed opacity-50 hover:ring-black/5',
        )}
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={() => triggerSFX('sfx:menu-hover')}
        type="button"
      >
        {isPhoto(item.iconSrc) ? (
          <Image
            alt=""
            aria-hidden
            className="object-cover transition-transform duration-200 group-hover:scale-105"
            fill
            sizes="80px"
            src={item.iconSrc}
          />
        ) : (
          <Image
            alt=""
            aria-hidden
            className="mb-3 h-[50%] w-[50%] object-contain transition-transform duration-150 group-hover:scale-105"
            height={48}
            src={item.iconSrc}
            width={48}
          />
        )}
        {caption ? (
          <span className="absolute bottom-1 left-1.5 font-bold text-[11px] text-neutral-700 tabular-nums [text-shadow:0_0_3px_#fff,0_0_3px_#fff]">
            {caption}
          </span>
        ) : (
          <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-white/95 via-white/85 to-white/0 px-1 pt-2 pb-1 text-center font-medium text-[9.5px] text-neutral-700 leading-[1.15] dark:from-neutral-900/95 dark:via-neutral-900/85 dark:to-neutral-900/0 dark:text-neutral-200">
            {item.label}
          </span>
        )}
        {active && (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-sky-400 text-white">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </button>
    </CatalogHover>
  )
}

const isPhoto = (src: string) => src.endsWith('.jpg')

/** inZOI catalog group: grey header bar over a 4-up grid of square cards. */
function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="scroll-mt-1 px-2 pt-3" data-build-section={title}>
      <h2 className="mb-2 rounded-md bg-neutral-200/80 dark:bg-white/10 px-3 py-1.5 font-semibold text-[12px] text-neutral-600 dark:text-neutral-300 leading-none">
        {title}
      </h2>
      {children}
    </section>
  )
}

const CARD_GRID = 'grid grid-cols-4 gap-1.5'

const DRAW_MODE_ICONS: Record<string, LucideIcon> = {
  wall: Minus,
  'wall-arc': Spline,
  'custom-room': Square,
}

/** mmmcraft: the construction new walls are drawn with (existing walls are
 *  changed in their own panel). */
function NewWallConstruction() {
  const construction = useWallDrawingDefaults((s) => s.construction)
  const setConstruction = useWallDrawingDefaults((s) => s.setConstruction)
  return (
    <div className="rounded-lg bg-white dark:bg-neutral-900 p-3 shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
      <div className="mb-2 text-muted-foreground text-xs">새로 그릴 벽</div>
      <NewWallThickness />
      <WallConstructionFields onChange={setConstruction} value={construction} />
    </div>
  )
}

const CORE_THICKNESS_PRESETS_MM = [100, 150, 200]

/** mmmcraft 벽 두께 / 벽체 두께 (mm) for new walls; finishes add on top. */
function NewWallThickness() {
  const construction = useWallDrawingDefaults((s) => s.construction)
  const coreThickness = useWallDrawingDefaults((s) => s.coreThickness)
  const setCoreThickness = useWallDrawingDefaults((s) => s.setCoreThickness)
  const coreMm = Math.round(coreThickness * 1000)
  const [draft, setDraft] = useState(String(coreMm))
  useEffect(() => setDraft(String(coreMm)), [coreMm])
  const commit = () => {
    const mm = Number(draft)
    if (Number.isFinite(mm) && mm >= 30 && mm <= 1000) setCoreThickness(mm / 1000)
    else setDraft(String(coreMm))
  }
  const buildUpMm = constructionBuildUpMm(construction)
  return (
    <div className="mb-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-muted-foreground text-xs">
          {construction ? '벽체 두께' : '벽 두께'}
        </span>
        {CORE_THICKNESS_PRESETS_MM.map((mm) => (
          <button
            className={cn(
              'rounded-md px-2 py-1 text-xs tabular-nums transition-colors',
              coreMm === mm
                ? 'bg-neutral-800 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'bg-muted text-foreground hover:bg-accent',
            )}
            key={mm}
            onClick={() => {
              triggerSFX('sfx:menu-click')
              setCoreThickness(mm / 1000)
            }}
            type="button"
          >
            {mm}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 rounded-md bg-muted px-1.5 py-1 text-xs">
          <input
            aria-label="새 벽 두께 (mm)"
            className="w-10 bg-transparent text-right tabular-nums outline-none"
            inputMode="numeric"
            onBlur={commit}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            value={draft}
          />
          <span className="text-muted-foreground">mm</span>
        </label>
      </div>
      {buildUpMm > 0 && (
        <div className="text-[11px] text-muted-foreground">
          마감 포함 {Number((coreMm + buildUpMm).toFixed(2))} mm
        </div>
      )}
    </div>
  )
}

/** Level-wide 자재 산출 of the 목상 / 경량 / 떡가베 walls. */
function LevelWallTakeoff() {
  const levelId = useViewer((s) => s.selection.levelId)
  return (
    <div className="mt-1.5 rounded-lg bg-white dark:bg-neutral-900 p-3 shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
      <div className="mb-2 text-muted-foreground text-xs">벽 마감 자재 산출 (현재 층)</div>
      <LevelTakeoffSummary levelId={levelId ?? null} />
    </div>
  )
}

export function BuildTab() {
  const activeTool = useEditor((s) => s.tool)
  const wallPlacementMode = useEditor((s) => s.toolDefaults.wall?.placementMode)
  const mode = useEditor((s) => s.mode)
  const selectedItem = useEditor((s) => s.selectedItem)
  const doorDefaults = useEditor(
    (s) => s.toolDefaults.door as { stepProduct?: string; hidden?: boolean } | null | undefined,
  )
  const follow = useLiquidLineToolOptions((s) => s.follow)
  const toggleFollow = useLiquidLineToolOptions((s) => s.toggleFollow)
  const wallHeight = useWallDrawingDefaults((s) => s.height)
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const needle = query.trim()
  const matches = (text: string) => !needle || text.includes(needle)

  const ductContext =
    mode === 'build' && (activeTool === 'duct-segment' || activeTool === 'duct-fitting')
  const pipeContext =
    mode === 'build' &&
    (activeTool === 'pipe-segment' || activeTool === 'pipe-fitting' || activeTool === 'pipe-trap')
  const liquidLineContext = mode === 'build' && activeTool === 'liquid-line'

  const roofFeatures = useMemo<RoofFeature[]>(() => {
    const features: RoofFeature[] = []
    for (const [kind, def] of nodeRegistry.entries()) {
      if (def.capabilities.roofAccessory === undefined) continue
      if (def.capabilities.wallOpeningPlacement) continue
      const icon = def.presentation?.icon
      features.push({
        kind,
        label: def.presentation?.label ?? kind,
        iconSrc: icon?.kind === 'url' ? icon.src : ROOF_FEATURE_FALLBACK_ICON,
      })
    }
    return features
  }, [])

  const isRoofFeatureActive =
    mode === 'build' && !!activeTool && roofFeatures.some((f) => f.kind === activeTool)
  const isMepActive = mode === 'build' && !!activeTool && MEP_TOOL_KINDS.has(activeTool)

  const isTypeActive = (type: BuildType) => {
    if (type.asset)
      return mode === 'build' && activeTool === 'item' && selectedItem?.id === type.asset.id
    if (type.id === 'mep') return isMepActive
    if (type.id === 'roof')
      return mode === 'build' && (activeTool === 'roof' || isRoofFeatureActive)
    if (type.id === 'custom-room') return mode === 'build' && activeTool === 'rectangle-room'
    if (type.id === 'wall-arc') return mode === 'build' && activeTool === 'wall-arc'
    if (type.id === 'wall')
      return mode === 'build' && activeTool === 'wall' && wallPlacementMode !== 'rectangle-room'
    if (
      type.kind === 'door' &&
      (type.id === 'door' || type.defaults?.stepProduct || type.defaults?.hidden)
    )
      return (
        mode === 'build' &&
        activeTool === 'door' &&
        doorDefaults?.stepProduct === type.defaults?.stepProduct &&
        !!doorDefaults?.hidden === !!type.defaults?.hidden
      )
    return mode === 'build' && activeTool === type.kind && type.id === type.kind
  }

  const isMepItemActive = (item: MepItem) =>
    item.kind === 'duct-segment'
      ? ductContext
      : item.kind === 'pipe-segment'
        ? pipeContext
        : item.kind === 'liquid-line'
          ? liquidLineContext
          : mode === 'build' && activeTool === item.kind

  const handleTypeClick = useCallback((type: BuildType) => {
    if (type.asset) {
      activateItemAssetTool(type.asset)
      return
    }
    if (type.id === 'mep') {
      activateBuildTool('duct-segment')
      return
    }
    if (type.id === 'custom-room') {
      activateRectangleRoomTool()
      return
    }
    if (type.id === 'wall-arc') {
      activateArcWallTool()
      return
    }
    if (type.kind) activateBuildTool(type.kind, type.defaults)
  }, [])

  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    const ed = useEditor.getState()
    if (ed.mode === 'build' && ed.tool) return
    activateBuildTool('wall')
  }, [])

  const heightCard = (h: number) => {
    const item = {
      id: `wall-${h}`,
      label: `${h.toFixed(1)} m 벽 그리기`,
      description: `${FULL_WALL_HEIGHTS.includes(h) ? '온 벽' : '부분 벽'} · 누르면 바로 이 높이로 벽을 그립니다. 새로 그리는 벽에만 적용됩니다.`,
      iconSrc: '/images/room-library/construction/plain.jpg',
    }
    const active =
      mode === 'build' &&
      activeTool === 'wall' &&
      wallPlacementMode !== 'rectangle-room' &&
      wallHeight === h
    return (
      <BuildTile
        active={active}
        caption={`${h.toFixed(1)}m`}
        item={item}
        key={item.id}
        onClick={() => {
          triggerSFX('sfx:menu-click')
          useWallDrawingDefaults.getState().setHeight(active ? undefined : h)
          activateBuildTool('wall')
        }}
      />
    )
  }
  const showWallHeights = matches('온 벽') || matches('부분 벽') || matches('벽')
  const visibleSections = BUILD_SECTIONS.map((section) => ({
    ...section,
    items: matches(section.title) ? section.items : section.items.filter((t) => matches(t.label)),
  })).filter((section) => section.items.length > 0)
  const visibleImports = IMPORT_ITEMS.filter(
    (item) => matches('도면 가져오기') || matches(item.label),
  )
  // inZOI's sub-category row: one chip per visible group, jumping to it.
  const jumpTitles = [
    ...(showWallHeights ? ['온 벽', '부분 벽'] : []),
    ...visibleSections.map((section) => section.title),
    ...(visibleImports.length > 0 ? ['도면 가져오기'] : []),
  ]

  return (
    <div className="flex h-full flex-col text-foreground">
      <div className="shrink-0 px-2 pt-3 pb-1">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-white dark:bg-neutral-900 px-3 shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-800 dark:text-neutral-100 outline-none placeholder:text-neutral-400"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="검색"
            type="text"
            value={query}
          />
          {query ? (
            <button aria-label="검색 지우기" onClick={() => setQuery('')} type="button">
              <X className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
            </button>
          ) : (
            <Search className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
          )}
        </label>
      </div>

      {jumpTitles.length > 1 && (
        <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto px-2 pt-1 pb-1.5">
          {jumpTitles.map((title) => (
            <button
              className="shrink-0 rounded-full bg-white px-2.5 py-1 font-medium text-[11px] text-neutral-600 shadow-[0_1px_2px_rgba(0,0,0,0.1)] transition-colors hover:bg-sky-100 hover:text-sky-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-sky-400/20 dark:hover:text-sky-100"
              key={title}
              onClick={() => {
                triggerSFX('sfx:menu-click')
                scrollRef.current
                  ?.querySelector(`[data-build-section="${title}"]`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              type="button"
            >
              {title}
            </button>
          ))}
        </div>
      )}

      <div className="dark-scrollbar min-h-0 flex-1 overflow-y-auto pb-3" ref={scrollRef}>
        <TooltipProvider delayDuration={0} disableHoverableContent>
          {showWallHeights && (
            <>
              <Section title="온 벽">
                <div className={CARD_GRID}>{FULL_WALL_HEIGHTS.map(heightCard)}</div>
              </Section>
              <Section title="부분 벽">
                <div className={CARD_GRID}>{PARTIAL_WALL_HEIGHTS.map(heightCard)}</div>
              </Section>
            </>
          )}

          {visibleSections.map((section) =>
            section.id === 'walls' ? (
              <Section key={section.id} title={section.title}>
                <div className="flex gap-1 rounded-lg bg-white p-1 shadow-[0_1px_3px_rgba(0,0,0,0.12)] dark:bg-neutral-900">
                  {section.items.map((type) => {
                    const ModeIcon = DRAW_MODE_ICONS[type.id] ?? Minus
                    const active = isTypeActive(type)
                    return (
                      <button
                        aria-pressed={active}
                        className={cn(
                          'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] transition-colors',
                          active
                            ? 'bg-neutral-800 font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900'
                            : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/10',
                        )}
                        key={type.id}
                        onClick={() => {
                          triggerSFX('sfx:menu-click')
                          handleTypeClick(type)
                        }}
                        type="button"
                      >
                        <ModeIcon className="h-3.5 w-3.5" />
                        {type.label}
                      </button>
                    )
                  })}
                </div>
                {!needle && (
                  <div className="mt-3">
                    <NewWallConstruction />
                    <LevelWallTakeoff />
                  </div>
                )}
              </Section>
            ) : (
              <Section key={section.id} title={section.title}>
                <div className={CARD_GRID}>
                  {section.items.map((type) => (
                    <BuildTile
                      active={isTypeActive(type)}
                      item={type}
                      key={type.id}
                      onClick={() => {
                        triggerSFX('sfx:menu-click')
                        handleTypeClick(type)
                      }}
                    />
                  ))}
                </div>
              </Section>
            ),
          )}

          {visibleImports.length > 0 && (
            <Section title="도면 가져오기">
              <div className={CARD_GRID}>
                {visibleImports.map((item) => (
                  <BuildTile disabled item={item} key={item.id} />
                ))}
              </div>
            </Section>
          )}

          {mode === 'build' &&
          (activeTool === 'roof' || isRoofFeatureActive) &&
          roofFeatures.length > 0 ? (
            <Section title="지붕 요소">
              <div className={CARD_GRID}>
                {roofFeatures.map((feature) => (
                  <BuildTile
                    active={mode === 'build' && activeTool === feature.kind}
                    item={feature}
                    key={feature.kind}
                    onClick={() => {
                      triggerSFX('sfx:menu-click')
                      activateRoofFeatureTool(feature.kind)
                    }}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          {isMepActive ? (
            <Section title="설비 (MEP)">
              <div className={CARD_GRID}>
                {MEP_ITEMS.map((item) => (
                  <BuildTile
                    active={isMepItemActive(item)}
                    item={item}
                    key={item.id}
                    onClick={() => {
                      triggerSFX('sfx:menu-click')
                      activateBuildTool(item.kind)
                    }}
                  />
                ))}
              </div>

              {ductContext ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <ActionButton
                    active={activeTool === 'duct-fitting'}
                    iconSrc="/icons/duct-fitting.webp"
                    label="피팅 추가"
                    onClick={() =>
                      activateBuildTool(
                        activeTool === 'duct-fitting' ? 'duct-segment' : 'duct-fitting',
                      )
                    }
                  />
                </div>
              ) : null}

              {pipeContext ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <ActionButton
                    active={activeTool === 'pipe-fitting'}
                    iconSrc="/icons/duct-fitting.webp"
                    label="피팅 추가"
                    onClick={() =>
                      activateBuildTool(
                        activeTool === 'pipe-fitting' ? 'pipe-segment' : 'pipe-fitting',
                      )
                    }
                  />
                  <ActionButton
                    active={activeTool === 'pipe-trap'}
                    iconSrc="/icons/dwv-pipes.webp"
                    label="트랩 추가"
                    onClick={() =>
                      activateBuildTool(activeTool === 'pipe-trap' ? 'pipe-segment' : 'pipe-trap')
                    }
                  />
                </div>
              ) : null}

              {liquidLineContext ? (
                <div className="mt-4">
                  <button
                    className={cn(
                      'flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-xs transition-colors',
                      follow ? 'bg-[#eceeff] text-[#3c3fc4]' : 'bg-card text-muted-foreground',
                    )}
                    onClick={() => {
                      triggerSFX('sfx:menu-click')
                      toggleFollow()
                    }}
                    type="button"
                  >
                    <span>냉매 배관 따라가기</span>
                    <span className="text-muted-foreground text-xs">
                      {follow ? '켜짐' : '꺼짐'}
                    </span>
                  </button>
                </div>
              ) : null}
            </Section>
          ) : null}
        </TooltipProvider>
      </div>
    </div>
  )
}

function ActionButton({
  active,
  iconSrc,
  label,
  onClick,
}: {
  active?: boolean
  iconSrc: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-left text-xs transition-colors',
        active ? 'bg-[#eceeff] text-[#3c3fc4]' : 'bg-card text-muted-foreground hover:bg-card',
      )}
      onClick={() => {
        triggerSFX('sfx:menu-click')
        onClick()
      }}
      type="button"
    >
      <Image
        alt=""
        aria-hidden
        className="h-4 w-4 object-contain"
        height={16}
        src={iconSrc}
        width={16}
      />
      {label}
    </button>
  )
}
