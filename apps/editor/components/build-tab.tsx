'use client'

import { nodeRegistry } from '@pascal-app/core'
import { MaterialPaintPanel, triggerSFX, useEditor } from '@pascal-app/editor'
import { useLiquidLineToolOptions } from '@pascal-app/nodes'
import { ChevronLeft, Search } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/toolbar-tooltip'
import { cn } from '@/lib/utils'

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
  iconSrc: string
  kind?: BuildToolKind
  mode?: 'material-paint'
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
  { id: 'import-3d', label: 'Import 3D', iconSrc: '/icons/mesh.webp' },
  { id: 'import-cad', label: 'Import CAD', iconSrc: '/icons/blueprint.webp' },
  { id: 'import-image', label: 'Import Image', iconSrc: '/icons/floorplan.webp' },
]

const BUILD_SECTIONS: BuildSection[] = [
  {
    id: 'walls',
    title: 'Walls',
    items: [
      { id: 'wall', label: 'Draw Straight Walls', iconSrc: '/icons/wall.webp', kind: 'wall' },
      { id: 'wall-arc', label: 'Draw Arc Walls', iconSrc: '/icons/wallcut.webp', kind: 'wall' },
      { id: 'custom-room', label: 'Draw Rooms', iconSrc: '/icons/custom-room.webp', kind: 'wall' },
    ],
  },
  {
    id: 'door',
    title: 'Door',
    items: [
      { id: 'door', label: 'Single Door', iconSrc: '/icons/door.webp', kind: 'door' },
      { id: 'double-door', label: 'Double Door', iconSrc: '/icons/door.webp', kind: 'door' },
      { id: 'sliding-door', label: 'Sliding Door', iconSrc: '/icons/door.webp', kind: 'door' },
    ],
  },
  {
    id: 'window',
    title: 'Window',
    items: [
      { id: 'window', label: 'Single Window', iconSrc: '/icons/window.webp', kind: 'window' },
      { id: 'dual-window', label: 'Dual Window', iconSrc: '/icons/window.webp', kind: 'window' },
      {
        id: 'unequal-double-window',
        label: 'Unequal Double Window',
        iconSrc: '/icons/window.webp',
        kind: 'window',
      },
      {
        id: 'corner-bay-window',
        label: 'Corner Bay Window',
        iconSrc: '/icons/window.webp',
        kind: 'window',
      },
      {
        id: 'corner-window',
        label: 'Corner Window',
        iconSrc: '/icons/window.webp',
        kind: 'window',
      },
      { id: 'bay-window', label: 'Bay Window', iconSrc: '/icons/window.webp', kind: 'window' },
      { id: 'arc-window', label: 'Arc Window', iconSrc: '/icons/window.webp', kind: 'window' },
    ],
  },
  {
    id: 'structure',
    title: 'Structure',
    items: [
      { id: 'slab', label: 'Slab', iconSrc: '/icons/floor.webp', kind: 'slab' },
      { id: 'ceiling', label: 'Ceiling', iconSrc: '/icons/ceiling.webp', kind: 'ceiling' },
      { id: 'roof', label: 'Roof', iconSrc: '/icons/roof.webp', kind: 'roof' },
      { id: 'stair', label: 'Stairs', iconSrc: '/icons/stairs.webp', kind: 'stair' },
      { id: 'elevator', label: 'Elevator', iconSrc: '/icons/elevator.webp', kind: 'elevator' },
      { id: 'column', label: 'Column', iconSrc: '/icons/column.webp', kind: 'column' },
      { id: 'shelf', label: 'Shelf', iconSrc: '/icons/shelf.webp', kind: 'shelf' },
      { id: 'fence', label: 'Fence', iconSrc: '/icons/fence.webp', kind: 'fence' },
      { id: 'spawn', label: 'Spawn Point', iconSrc: '/icons/spawn-point.webp', kind: 'spawn' },
      { id: 'mep', label: 'MEP', iconSrc: '/icons/HVAC.webp' },
      { id: 'painting', label: 'Painting', iconSrc: '/icons/paint.webp', mode: 'material-paint' },
    ],
  },
]

const MEP_ITEMS: MepItem[] = [
  { id: 'duct-segment', label: 'Duct', iconSrc: '/icons/duct.webp', kind: 'duct-segment' },
  {
    id: 'duct-terminal',
    label: 'Register',
    iconSrc: '/icons/registers.webp',
    kind: 'duct-terminal',
  },
  { id: 'hvac-equipment', label: 'HVAC Unit', iconSrc: '/icons/HVAC.webp', kind: 'hvac-equipment' },
  { id: 'lineset', label: 'Lineset', iconSrc: '/icons/lineset.webp', kind: 'lineset' },
  { id: 'liquid-line', label: 'Liquid Line', iconSrc: '/icons/lineset.webp', kind: 'liquid-line' },
  { id: 'pipe-segment', label: 'DWV Pipe', iconSrc: '/icons/dwv-pipes.webp', kind: 'pipe-segment' },
]

const MEP_TOOL_KINDS = new Set<string>([
  ...MEP_ITEMS.map((item) => item.kind),
  'duct-fitting',
  'pipe-fitting',
  'pipe-trap',
])

const ROOF_FEATURE_FALLBACK_ICON = '/icons/roof.webp'

type RoofFeature = { kind: string; label: string; iconSrc: string }

function activateBuildTool(kind: BuildToolKind | MepToolKind): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setToolDefaults(kind, null)
  ed.setMode('build')
  ed.setTool(kind)
}

function activatePaintMode(): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setMode('material-paint')
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
  disabled = false,
  item,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  item: BuildType | MepItem | RoofFeature
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            'group flex h-[86px] min-w-0 flex-col items-center justify-center gap-2 rounded-md border border-[#444] bg-[#1f1f1f] px-1.5 text-center transition-all duration-200',
            active
              ? 'border-[#7779ff] bg-[#26263b] text-white shadow-[0_0_0_1px_rgba(119,121,255,0.35)]'
              : 'text-[#bebebe] hover:border-[#666] hover:bg-[#252525] hover:text-white',
            disabled &&
              'cursor-not-allowed opacity-60 hover:border-[#444] hover:bg-[#1f1f1f] hover:text-[#bebebe]',
          )}
          disabled={disabled}
          onClick={onClick}
          onMouseEnter={() => triggerSFX('sfx:menu-hover')}
          type="button"
        >
          <span className="flex h-9 w-9 items-center justify-center overflow-hidden">
            <Image
              alt=""
              aria-hidden
              className="h-8 w-8 object-contain opacity-90 transition-transform duration-200 group-hover:scale-105"
              height={32}
              src={item.iconSrc}
              width={32}
            />
          </span>
          <span className="line-clamp-2 text-balance font-semibold text-[11px] leading-[1.05] tracking-normal">
            {item.label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="pointer-events-none" side="top">
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="border-[#343434] border-b px-4 py-5">
      <h2 className="mb-4 font-bold text-[#f0f0f0] text-[17px] leading-none">{title}</h2>
      {children}
    </section>
  )
}

export function BuildTab() {
  const activeTool = useEditor((s) => s.tool)
  const mode = useEditor((s) => s.mode)
  const follow = useLiquidLineToolOptions((s) => s.follow)
  const toggleFollow = useLiquidLineToolOptions((s) => s.toggleFollow)

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
    if (type.mode === 'material-paint') return mode === 'material-paint'
    if (type.id === 'mep') return isMepActive
    if (type.id === 'roof')
      return mode === 'build' && (activeTool === 'roof' || isRoofFeatureActive)
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
    if (type.mode === 'material-paint') {
      activatePaintMode()
      return
    }
    if (type.id === 'mep') {
      activateBuildTool('duct-segment')
      return
    }
    if (type.kind) activateBuildTool(type.kind)
  }, [])

  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    const ed = useEditor.getState()
    if (ed.mode === 'build' && ed.tool) return
    activateBuildTool('wall')
  }, [])

  return (
    <div className="flex h-full flex-col bg-[#1b1b1b] text-[#efefef]">
      <div className="flex h-16 shrink-0 items-center justify-between border-[#343434] border-b px-4">
        <h1 className="font-bold text-[20px] tracking-normal">Create Room</h1>
        <div className="flex items-center gap-3 text-[#c9c9c9]">
          <button
            aria-label="Search"
            className="rounded-full p-1 transition-colors hover:text-white"
            type="button"
          >
            <Search className="h-5 w-5 stroke-[1.9]" />
          </button>
          <button
            aria-label="Back"
            className="rounded-full p-1 transition-colors hover:text-white"
            type="button"
          >
            <ChevronLeft className="h-5 w-5 stroke-[2.4]" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TooltipProvider delayDuration={0} disableHoverableContent>
          <Section title="Import Floor Plan">
            <div className="grid grid-cols-3 gap-2">
              {IMPORT_ITEMS.map((item) => (
                <BuildTile disabled item={item} key={item.id} />
              ))}
            </div>
          </Section>

          {BUILD_SECTIONS.map((section) => (
            <Section key={section.id} title={section.title}>
              <div className="grid grid-cols-3 gap-2">
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
          ))}

          {mode === 'material-paint' ? (
            <Section title="Material Paint">
              <div className="rounded-[10px] border border-[#444] bg-[#202020] p-3">
                <MaterialPaintPanel />
              </div>
            </Section>
          ) : null}

          {mode === 'build' &&
          (activeTool === 'roof' || isRoofFeatureActive) &&
          roofFeatures.length > 0 ? (
            <Section title="Roof Features">
              <div className="grid grid-cols-3 gap-2">
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
            <Section title="MEP">
              <div className="grid grid-cols-3 gap-2">
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
                    label="Add Fitting"
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
                    label="Add Fitting"
                    onClick={() =>
                      activateBuildTool(
                        activeTool === 'pipe-fitting' ? 'pipe-segment' : 'pipe-fitting',
                      )
                    }
                  />
                  <ActionButton
                    active={activeTool === 'pipe-trap'}
                    iconSrc="/icons/dwv-pipes.webp"
                    label="Add Trap"
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
                      'flex w-full items-center justify-between rounded-md border border-[#444] px-3 py-2 text-left text-xs transition-colors',
                      follow ? 'bg-[#26263b] text-white' : 'bg-[#202020] text-[#c9c9c9]',
                    )}
                    onClick={() => {
                      triggerSFX('sfx:menu-click')
                      toggleFollow()
                    }}
                    type="button"
                  >
                    <span>Follow lineset</span>
                    <span className="text-[#8f8f8f] text-xs">{follow ? 'On' : 'Off'}</span>
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
        'flex items-center gap-2 rounded-md border border-[#444] px-2.5 py-2 text-left text-xs transition-colors',
        active ? 'bg-[#26263b] text-white' : 'bg-[#202020] text-[#c9c9c9] hover:bg-[#252525]',
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
