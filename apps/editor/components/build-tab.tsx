'use client'

import { type AssetInput, constructionBuildUpMm, nodeRegistry } from '@pascal-app/core'
import {
  CATALOG_SCROLL,
  CatalogBandPill,
  CatalogCard,
  CatalogHero,
  CatalogIconRow,
  CatalogSearchBand,
  CatalogSection,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import {
  LevelTakeoffSummary,
  useLiquidLineToolOptions,
  WallConstructionFields,
} from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import {
  AppWindow,
  BrickWall,
  DoorOpen,
  Fence,
  FileUp,
  House,
  Layers2,
  Minus,
  PenLine,
  Spline,
  Square,
} from 'lucide-react'
import Image from 'next/image'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  FULL_WALL_HEIGHTS,
  PARTIAL_WALL_HEIGHTS,
  useWallDrawingDefaults,
  wallDrawingToolDefaults,
} from '@/lib/wall-drawing-defaults'
import { StructureHero } from './catalog/build-hero-art'
import { useBuildPanelPrefs } from './catalog/build-panel-prefs'
import { type RailingStyle, RailingThumb, WallHeightThumb } from './catalog/build-thumbnails'
import { ROOM_PRESET_SECTION_TITLES, RoomPresetSection } from './room-preset-section'

type BuildToolKind =
  | 'wall'
  | 'fence'
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
  /** Short card line; defaults to the label. */
  meta?: string
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

type RailingPreset = {
  id: string
  label: string
  style: RailingStyle
  color: string
  height: number
  description: string
  defaults: Record<string, unknown>
}

const RAILING_PRESETS: RailingPreset[] = [
  {
    id: 'fence-basic',
    label: '기본 울타리',
    style: 'slat',
    color: '#ffffff',
    height: 1.8,
    description: '흰색 세로 살 울타리입니다. 바닥을 눌러 이어 그립니다.',
    defaults: {},
  },
  {
    id: 'rail-metal',
    label: '철제 난간',
    style: 'slat',
    color: '#2e2e2e',
    height: 1.1,
    description: '가는 철제 살이 촘촘한 난간입니다. 발코니와 계단참에 어울립니다.',
    defaults: {
      style: 'slat',
      color: '#2e2e2e',
      height: 1.1,
      thickness: 0.05,
      postSpacing: 1.2,
      baseStyle: 'floating',
      postCap: 'flat',
    },
  },
  {
    id: 'rail-wood',
    label: '목재 난간',
    style: 'rail',
    color: '#a57a52',
    height: 1.0,
    description: '가로대 두 줄의 목재 난간입니다.',
    defaults: { style: 'rail', color: '#a57a52', height: 1.0 },
  },
  {
    id: 'rail-white',
    label: '화이트 난간',
    style: 'slat',
    color: '#f2f2f2',
    height: 1.1,
    description: '흰색 세로 살 난간입니다. 바닥에서 살짝 떠 있습니다.',
    defaults: { style: 'slat', color: '#f2f2f2', height: 1.1, baseStyle: 'floating' },
  },
  {
    id: 'privacy-wood',
    label: '목재 가림막',
    style: 'privacy',
    color: '#8a5a3a',
    height: 1.8,
    description: '시선을 가리는 높은 목재 판 울타리입니다.',
    defaults: { style: 'privacy', color: '#8a5a3a', height: 1.8 },
  },
  {
    id: 'louver-charcoal',
    label: '차콜 루버',
    style: 'horizontal',
    color: '#3a3a3a',
    height: 1.5,
    description: '가로 판을 틈을 두고 쌓은 차콜색 루버 울타리입니다.',
    defaults: { style: 'horizontal', color: '#3a3a3a', slatGap: 0.02, height: 1.5 },
  },
  {
    id: 'louver-redwood',
    label: '레드우드 루버',
    style: 'horizontal',
    color: '#8b4a36',
    height: 1.8,
    description: '적갈색 가로 판 루버 울타리입니다.',
    defaults: { style: 'horizontal', color: '#8b4a36', slatGap: 0.02 },
  },
  {
    id: 'picket-low',
    label: '낮은 울타리',
    style: 'slat',
    color: '#c8a27a',
    height: 0.9,
    description: '기둥 머리가 뾰족한 낮은 나무 울타리입니다. 화단 경계에 씁니다.',
    defaults: { style: 'slat', color: '#c8a27a', height: 0.9, postCap: 'pyramid' },
  },
]

const IMPORT_ITEMS: BuildType[] = [
  { id: 'import-3d', label: '3D 모델 가져오기', meta: '3D 모델', iconSrc: '/icons/mesh.webp' },
  { id: 'import-cad', label: 'CAD 가져오기', meta: 'CAD', iconSrc: '/icons/blueprint.webp' },
  {
    id: 'import-image',
    label: '도면 이미지 가져오기',
    meta: '도면 이미지',
    iconSrc: '/icons/floorplan.webp',
  },
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

const DRAW_MODE_ICONS: Record<string, typeof Minus> = {
  wall: Minus,
  'wall-arc': Spline,
}

const BUILD_SECTIONS: BuildSection[] = [
  {
    id: 'walls',
    title: '그리기 방식',
    items: [
      {
        id: 'wall',
        label: '직선 벽',
        meta: '직선',
        description: '두 점을 눌러 곧은 벽을 이어 그립니다.',
        iconSrc: '/icons/wall.webp',
        kind: 'wall',
      },
      {
        id: 'wall-arc',
        label: '곡선 벽',
        meta: '곡선',
        description: '시작점·끝점을 누른 뒤 휘는 정도를 정해 곡선 벽을 그립니다.',
        iconSrc: '/icons/wallcut.webp',
        kind: 'wall',
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
        meta: '히든도어',
        description: '목상 또는 떡가베로 지은 벽에만 설치할 수 있습니다.',
        iconSrc: '/images/room-library/doors/hidden.jpg',
        kind: 'door',
        defaults: { hidden: true },
      },
      {
        id: 'step-door-yerim',
        label: '예림·인쇼 스텝도어',
        meta: '예림 스텝',
        description: '문틀 깊이가 설치하는 벽의 마감 두께에 맞춰집니다.',
        iconSrc: '/images/room-library/doors/step.jpg',
        kind: 'door',
        defaults: { stepProduct: 'yerim-inshow' },
      },
      {
        id: 'step-door-younglim',
        label: '영림 스텝도어',
        meta: '영림 스텝',
        description: '문틀 깊이가 설치하는 벽의 마감 두께에 맞춰집니다.',
        iconSrc: '/images/room-library/doors/step.jpg',
        kind: 'door',
        defaults: { stepProduct: 'younglim' },
      },
      {
        id: 'door1-glb',
        label: 'GLB 문 (Door1)',
        meta: 'GLB 문',
        description: '3D 모델로 만든 문입니다. 벽에 붙여 배치합니다.',
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
      { id: 'spawn', label: '시작 위치', iconSrc: '/icons/spawn-point.webp', kind: 'spawn' },
      { id: 'mep', label: '설비 (MEP)', meta: '설비', iconSrc: '/icons/HVAC.webp' },
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

/** Tools that draw walls at the chosen wall height. */
const WALL_HEIGHT_TOOLS = new Set<string>(['wall', 'wall-arc', 'rectangle-room', 'room-preset'])

const ROOF_FEATURE_FALLBACK_ICON = '/icons/roof.webp'

type RoofFeature = { kind: string; label: string; iconSrc: string }

/** Sub-category row: one glyph per catalogue section, in list order. */
const SECTION_ICONS: Record<string, ReactNode> = {
  '온 벽': <BrickWall />,
  '부분 벽': (
    <span className="grid size-5 place-items-end overflow-hidden">
      <BrickWall className="origin-bottom scale-y-[0.6]" />
    </span>
  ),
  난간: <Fence />,
  방: <Square />,
  플랫폼: <Layers2 />,
  '그리기 방식': <PenLine />,
  문: <DoorOpen />,
  창문: <AppWindow />,
  구조: <House />,
  '도면 가져오기': <FileUp />,
}

function activateBuildTool(
  kind: BuildToolKind | MepToolKind,
  defaults?: Record<string, unknown>,
): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setToolDefaults(kind, kind === 'wall' ? wallDrawingToolDefaults() : (defaults ?? null))
  if (kind === 'wall') ed.setSnappingMode('wall', 'grid')
  ed.setMode('build')
  ed.setTool(kind)
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
  ed.setSnappingMode('wall', 'grid')
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

const isPhoto = (src: string) => src.endsWith('.jpg')

/** A catalogue card for a build tool / MEP / roof feature entry. */
function BuildCard({
  active,
  disabled,
  item,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  item: BuildType | MepItem | RoofFeature
  onClick?: () => void
}) {
  const photo = isPhoto(item.iconSrc)
  const DrawIcon = 'id' in item ? DRAW_MODE_ICONS[item.id] : undefined
  const meta = 'meta' in item && item.meta ? item.meta : item.label
  return (
    <CatalogCard
      active={active}
      disabled={disabled}
      hover={{
        description:
          ('description' in item ? item.description : undefined) ??
          (disabled ? '준비 중인 기능입니다.' : undefined),
        meta: meta === item.label ? undefined : meta,
      }}
      image={DrawIcon ? undefined : item.iconSrc}
      imageClassName={photo ? undefined : 'p-[8%]'}
      imageFit={photo ? 'cover' : 'contain'}
      label={item.label}
      meta={meta}
      onClick={onClick}
      thumb={
        DrawIcon ? (
          <DrawIcon className="size-7 text-[#555] dark:text-neutral-300" strokeWidth={1.5} />
        ) : undefined
      }
    />
  )
}

const CORE_THICKNESS_PRESETS_MM = [100, 150, 200]

const CONSTRUCTION_LABELS: Record<string, string> = {
  timber: '목상',
  steel: '경량',
  bonded: '떡가베',
}

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
                ? 'bg-[#8ec3f2] font-semibold text-white'
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

/** The band pill summarising how new walls are built; opens their settings
 *  (thickness, construction) and the level's 자재 산출 beside the panel. */
function WallSettingsPill() {
  const construction = useWallDrawingDefaults((s) => s.construction)
  const coreThickness = useWallDrawingDefaults((s) => s.coreThickness)
  const setConstruction = useWallDrawingDefaults((s) => s.setConstruction)
  const levelId = useViewer((s) => s.selection.levelId)
  const kindLabel = construction ? (CONSTRUCTION_LABELS[construction.kind] ?? '일반 벽') : '일반 벽'
  return (
    <CatalogBandPill label={`벽 ${Math.round(coreThickness * 1000)} mm · ${kindLabel}`}>
      <div className="mb-2 font-semibold text-[13px]">새로 그릴 벽</div>
      <NewWallThickness />
      <WallConstructionFields onChange={setConstruction} value={construction} />
      <div className="mt-3 border-neutral-200 border-t pt-3 dark:border-white/10">
        <div className="mb-2 font-semibold text-[13px]">벽 마감 자재 산출 (현재 층)</div>
        <LevelTakeoffSummary levelId={levelId ?? null} />
      </div>
    </CatalogBandPill>
  )
}

export function BuildTab() {
  const activeTool = useEditor((s) => s.tool)
  const wallPlacementMode = useEditor((s) => s.toolDefaults.wall?.placementMode)
  // Platforms are wall-less slabs, so a wall height card switches to walls.
  const platformArmed = useEditor(
    (s) =>
      s.tool === 'room-preset' &&
      (s.toolDefaults.wall?.roomPreset as { kind?: string } | undefined)?.kind === 'platform',
  )
  const mode = useEditor((s) => s.mode)
  const selectedItem = useEditor((s) => s.selectedItem)
  const doorDefaults = useEditor(
    (s) => s.toolDefaults.door as { stepProduct?: string; hidden?: boolean } | null | undefined,
  )
  const fencePresetId = useEditor(
    (s) => (s.toolDefaults.fence as { presetId?: string } | null | undefined)?.presetId,
  )
  const follow = useLiquidLineToolOptions((s) => s.follow)
  const toggleFollow = useLiquidLineToolOptions((s) => s.toggleFollow)
  const wallHeight = useWallDrawingDefaults((s) => s.height)
  const heroCollapsed = useBuildPanelPrefs((s) => s.heroCollapsed)
  const toggleHero = useBuildPanelPrefs((s) => s.toggleHero)
  const [query, setQuery] = useState('')
  const [activeSection, setActiveSection] = useState<string | null>(null)
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

  // The height check stays on while walls are drawn (straight, curved, room
  // shapes) or nothing is armed; any other build tool carries its own check.
  const wallToolArmed =
    mode === 'build' && !!activeTool && WALL_HEIGHT_TOOLS.has(activeTool) && !platformArmed
  const wallHeightShown = mode !== 'build' || !activeTool || wallToolArmed
  const heightCard = (partial: boolean) => (h: number) => {
    const heights = partial ? PARTIAL_WALL_HEIGHTS : FULL_WALL_HEIGHTS
    const label = `${Number.isInteger(h * 10) ? h.toFixed(1) : h.toFixed(2)}m`
    return (
      <CatalogCard
        active={wallHeightShown && wallHeight === h}
        caption={
          <span className="pointer-events-none absolute inset-x-0 bottom-[7%] text-center font-bold text-[12px] text-[#7c7c74] tabular-nums leading-none dark:text-neutral-300">
            {label}
          </span>
        }
        hover={{
          description: `${partial ? '부분 벽' : '온 벽'} · 누르면 바로 이 높이로 벽을 그립니다. 새로 그리는 벽에만 적용됩니다.`,
          meta: `높이 ${Math.round(h * 1000)} mm`,
        }}
        key={h}
        label={`${label} ${partial ? '부분 벽' : '온 벽'}`}
        onClick={() => {
          // An armed wall-drawing tool keeps its shape and picks the height up
          // for the next wall; anything else switches to straight walls.
          useWallDrawingDefaults.getState().setHeight(h)
          if (!wallToolArmed) activateBuildTool('wall')
        }}
        thumb={
          <span className="-translate-y-[12%] block h-full w-full">
            <WallHeightThumb height={h} max={heights[heights.length - 1]!} partial={partial} />
          </span>
        }
      />
    )
  }

  const showFullWalls = matches('온 벽') || matches('벽')
  const showPartialWalls = matches('부분 벽') || matches('벽')
  const visibleRailings = RAILING_PRESETS.filter(
    (preset) => matches('난간') || matches('울타리') || matches(preset.label),
  )
  const visibleSections = BUILD_SECTIONS.map((section) => ({
    ...section,
    items: matches(section.title)
      ? section.items
      : section.items.filter((t) => matches(t.label) || matches(t.meta ?? '')),
  })).filter((section) => section.items.length > 0)
  const visibleImports = IMPORT_ITEMS.filter(
    (item) => matches('도면 가져오기') || matches(item.label),
  )
  const jumpTitles = [
    ...(showFullWalls ? ['온 벽'] : []),
    ...(showPartialWalls ? ['부분 벽'] : []),
    ...(visibleRailings.length > 0 ? ['난간'] : []),
    ...ROOM_PRESET_SECTION_TITLES.filter((title) => matches(title) || !needle),
    ...visibleSections.map((section) => section.title),
    ...(visibleImports.length > 0 ? ['도면 가져오기'] : []),
  ]
  const jumpKey = jumpTitles.join('|')

  // Scroll spy: the section whose header last passed the list's top edge.
  const syncActiveSection = useCallback(() => {
    const root = scrollRef.current
    if (!root) return
    const sections = [
      ...root.querySelectorAll<HTMLElement>('[data-catalog-section],[data-build-section]'),
    ]
    if (sections.length === 0) return
    const rootTop = root.getBoundingClientRect().top
    let current = sections[0]!
    for (const section of sections) {
      if (section.getBoundingClientRect().top - rootTop <= 24) current = section
    }
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2)
      current = sections[sections.length - 1]!
    setActiveSection(current.dataset.catalogSection ?? current.dataset.buildSection ?? null)
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync when the visible sections change
  useEffect(() => syncActiveSection(), [jumpKey, syncActiveSection])

  const jumpTo = (title: string) => {
    setActiveSection(title)
    scrollRef.current
      ?.querySelector(`[data-catalog-section="${title}"],[data-build-section="${title}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex h-full flex-col text-foreground">
      <CatalogSearchBand left={<WallSettingsPill />} onChange={setQuery} value={query} />

      {jumpTitles.length > 1 && (
        <CatalogIconRow
          activeId={activeSection}
          items={jumpTitles.map((title) => ({
            id: title,
            label: title,
            icon: SECTION_ICONS[title],
          }))}
          onSelect={jumpTo}
        />
      )}

      {!needle && (
        <CatalogHero collapsed={heroCollapsed} label="집" onToggle={toggleHero}>
          <StructureHero />
        </CatalogHero>
      )}

      <div
        className={cn(CATALOG_SCROLL, 'pb-3')}
        onScroll={() => requestAnimationFrame(syncActiveSection)}
        ref={scrollRef}
      >
        {showFullWalls && (
          <CatalogSection title="온 벽">{FULL_WALL_HEIGHTS.map(heightCard(false))}</CatalogSection>
        )}
        {showPartialWalls && (
          <CatalogSection title="부분 벽">
            {PARTIAL_WALL_HEIGHTS.map(heightCard(true))}
          </CatalogSection>
        )}

        {visibleRailings.length > 0 && (
          <CatalogSection title="난간">
            {visibleRailings.map((preset) => (
              <CatalogCard
                active={
                  mode === 'build' &&
                  activeTool === 'fence' &&
                  (fencePresetId ?? 'fence-basic') === preset.id
                }
                hover={{
                  description: preset.description,
                  meta: `높이 ${Math.round(preset.height * 1000)} mm`,
                }}
                key={preset.id}
                label={preset.label}
                meta={`${preset.height.toFixed(1)}m`}
                onClick={() =>
                  activateBuildTool('fence', { ...preset.defaults, presetId: preset.id })
                }
                thumb={
                  <RailingThumb color={preset.color} height={preset.height} style={preset.style} />
                }
              />
            ))}
          </CatalogSection>
        )}

        <RoomPresetSection needle={needle} />

        {visibleSections.map((section) => (
          <CatalogSection key={section.id} title={section.title}>
            {section.items.map((type) => (
              <BuildCard
                active={isTypeActive(type)}
                item={type}
                key={type.id}
                onClick={() => handleTypeClick(type)}
              />
            ))}
          </CatalogSection>
        ))}

        {visibleImports.length > 0 && (
          <CatalogSection title="도면 가져오기">
            {visibleImports.map((item) => (
              <BuildCard disabled item={item} key={item.id} />
            ))}
          </CatalogSection>
        )}

        {mode === 'build' &&
        (activeTool === 'roof' || isRoofFeatureActive) &&
        roofFeatures.length > 0 ? (
          <CatalogSection title="지붕 요소">
            {roofFeatures.map((feature) => (
              <BuildCard
                active={mode === 'build' && activeTool === feature.kind}
                item={feature}
                key={feature.kind}
                onClick={() => activateRoofFeatureTool(feature.kind)}
              />
            ))}
          </CatalogSection>
        ) : null}

        {isMepActive ? (
          <>
            <CatalogSection title="설비 (MEP)">
              {MEP_ITEMS.map((item) => (
                <BuildCard
                  active={isMepItemActive(item)}
                  item={item}
                  key={item.id}
                  onClick={() => activateBuildTool(item.kind)}
                />
              ))}
            </CatalogSection>

            {ductContext ? (
              <div className="mt-2 grid grid-cols-2 gap-[5px] px-2.5">
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
              <div className="mt-2 grid grid-cols-2 gap-[5px] px-2.5">
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
              <div className="mt-2 px-2.5">
                <button
                  className={cn(
                    'flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-xs transition-colors',
                    follow
                      ? 'bg-[#8ec3f2] text-white'
                      : 'bg-[var(--panel-card)] text-[var(--panel-card-fg)]',
                  )}
                  onClick={() => {
                    triggerSFX('sfx:menu-click')
                    toggleFollow()
                  }}
                  type="button"
                >
                  <span>냉매 배관 따라가기</span>
                  <span className="text-xs opacity-80">{follow ? '켜짐' : '꺼짐'}</span>
                </button>
              </div>
            ) : null}
          </>
        ) : null}
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
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-xs transition-colors',
        active
          ? 'bg-[#8ec3f2] font-semibold text-white'
          : 'bg-[var(--panel-card)] text-[var(--panel-card-fg)] hover:bg-[var(--panel-card-hover)]',
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
