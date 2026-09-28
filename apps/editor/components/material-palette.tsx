'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  getMaterialsForCategory,
  type MaterialCatalogItem,
  type MaterialCategory,
  type MaterialSchema,
  type MaterialSurface,
  nodeRegistry,
  sceneRegistry,
  slotLabelFromId,
  toLibraryMaterialRef,
  useScene,
} from '@pascal-app/core'
import {
  commitPaintScopeFanout,
  materialKoName,
  resolvePaintScopeTargets,
  triggerSFX,
  useEditor,
  useInspectorCollapsed,
  useMovingNode,
} from '@pascal-app/editor'
import { type CabinetNode, resolveCabinetNode } from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { Check } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ColorPicker } from './color-picker'

/**
 * inZOI-style material palette. The paint button on the selected object's
 * action menu opens it: the parts that can be painted on the left, then
 * colour / wood / tile / stone swatches. Hovering a swatch previews it on the
 * model, clicking applies it, ✓ or Esc closes.
 */

type Section = { title: string; categories: MaterialCategory[] }

const SECTIONS: Section[] = [
  { title: '색상', categories: ['colors'] },
  { title: '나무', categories: ['wood'] },
  { title: '타일', categories: ['tile'] },
  { title: '돌·벽돌', categories: ['stone', 'brick', 'concrete'] },
  { title: '기타', categories: ['metal', 'fabric', 'leather', 'glass', 'ground', 'roofing'] },
]

/** The palette tab that holds the free colour picker. */
const CUSTOM_TAB = '직접 고르기'

const SURFACE_BY_KIND: Record<string, MaterialSurface> = {
  wall: 'wall',
  slab: 'floor',
  ceiling: 'ceiling',
  roof: 'roof',
  'roof-segment': 'roof',
  fence: 'outdoor',
  item: 'furniture',
  shelf: 'furniture',
}

const KIND_NAMES: Record<string, string> = {
  wall: '벽',
  slab: '바닥',
  ceiling: '천장',
  roof: '지붕',
  'roof-segment': '지붕',
  door: '문',
  window: '창문',
  fence: '울타리',
  item: '가구',
  shelf: '선반',
  cabinet: '붙박이장',
}

const SLOT_LABELS: Record<string, string> = {
  interior: '안쪽 면',
  exterior: '바깥쪽 면',
  surface: '윗면',
  side: '옆면',
  panel: '문짝',
  frame: '문틀',
  glass: '유리',
  hardware: '손잡이·철물',
}

type Target = {
  key: string
  label: string
  current?: string
  apply: (material: MaterialCatalogItem) => void
  /** Show the material on the model without committing; returns the restore. */
  preview?: (material: MaterialCatalogItem) => (() => void) | null
  /** A one-off colour from the picker (roughness from the 광택 slider). */
  applyColor?: (hex: string, roughness: number) => void
  previewColor?: (hex: string, roughness: number) => (() => void) | null
}

function customColorMaterial(hex: string, roughness: number): MaterialSchema {
  return {
    preset: 'custom',
    properties: {
      color: hex,
      roughness,
      metalness: 0,
      opacity: 1,
      transparent: false,
      side: 'front',
    },
  }
}

/** Kinds whose paint can spread to the whole room (walls, floors). */
function offersRoomScope(node: AnyNode): boolean {
  return nodeRegistry.get(node.type)?.capabilities?.paint?.roomScope === true
}

function slotTargets(node: AnyNode, slotIds: string[], roomScope: boolean): Target[] {
  const paint = nodeRegistry.get(node.type)?.capabilities?.paint
  if (!paint) return []
  const slots = (node as { slots?: Record<string, string> }).slots
  // inZOI's 방 단위: the same face of every wall (or floor) around the room.
  const spread = (role: string) =>
    roomScope
      ? resolvePaintScopeTargets({
          node,
          role,
          scope: 'room',
          nodes: useScene.getState().nodes,
          spaces: useEditor.getState().spaces,
          slotRolesOf: () => [role],
        })
      : [{ nodeId: node.id as AnyNodeId, role }]
  const commit = (role: string, material: MaterialSchema | undefined, preset?: string) => {
    const targets = spread(role)
    if (targets.length > 1) {
      commitPaintScopeFanout(targets, material, preset)
      return
    }
    const args = { node, role, material, materialPreset: preset }
    if (paint.commit) paint.commit(args)
    else useScene.getState().updateNode(node.id, paint.buildPatch(args))
  }
  const preview = (role: string, material: MaterialSchema | undefined, preset?: string) => {
    const nodes = useScene.getState().nodes
    const restores = spread(role).flatMap(({ nodeId }) => {
      const target = nodes[nodeId]
      const root = sceneRegistry.nodes.get(nodeId)
      if (!(target && root)) return []
      const restore = paint.applyPreview({
        node: target,
        role,
        material,
        materialPreset: preset,
        root,
      })
      return restore ? [restore] : []
    })
    if (restores.length === 0) return null
    return () => {
      for (const restore of restores) restore()
    }
  }
  return slotIds.map((role) => ({
    key: role,
    label: SLOT_LABELS[role] ?? slotLabelFromId(role),
    current: slots?.[role],
    apply: (material) => commit(role, undefined, toLibraryMaterialRef(material.id)),
    preview: (material) => preview(role, undefined, toLibraryMaterialRef(material.id)),
    applyColor: (hex, roughness) => commit(role, customColorMaterial(hex, roughness)),
    previewColor: (hex, roughness) => preview(role, customColorMaterial(hex, roughness)),
  }))
}

function cabinetTargets(node: AnyNode): Target[] {
  const cabinet = resolveCabinetNode(node as unknown as CabinetNode)
  const set = (patch: Partial<CabinetNode>) =>
    useScene.getState().updateNode(node.id, patch as Partial<AnyNode>)
  return [
    {
      key: 'body',
      label: '몸통',
      current: cabinet.bodyColor,
      apply: (m) => m.previewColor && set({ bodyColor: m.previewColor }),
      applyColor: (hex) => set({ bodyColor: hex }),
    },
    {
      key: 'front',
      label: '도어',
      current: cabinet.frontColor,
      apply: (m) => m.previewColor && set({ frontColor: m.previewColor }),
      applyColor: (hex) => set({ frontColor: hex }),
    },
  ]
}

/** The slot ids a node's mesh is tagged with (a furniture model's `slot_` materials). */
function meshSlotIds(node: AnyNode): string[] {
  const found = new Set<string>()
  sceneRegistry.nodes.get(node.id)?.traverse((object) => {
    const slotId = (object.userData as { slotId?: unknown }).slotId
    if (typeof slotId === 'string') found.add(slotId)
  })
  return [...found]
}

function paintTargets(node: AnyNode, roomScope: boolean): Target[] {
  if ((node.type as string) === 'cabinet') return cabinetTargets(node)
  const def = nodeRegistry.get(node.type)
  if (!def?.capabilities?.paint) return []
  const declared = def.capabilities.slots?.(node).map((slot) => slot.slotId)
  return slotTargets(node, declared ?? meshSlotIds(node), roomScope)
}

export function canPaintNode(node: AnyNode): boolean {
  if ((node.type as string) === 'cabinet') return true
  const def = nodeRegistry.get(node.type)
  if (!def?.capabilities?.paint) return false
  return node.type === 'item' || (def.capabilities.slots?.(node).length ?? 0) > 0
}

function materialsFor(node: AnyNode, section: Section): MaterialCatalogItem[] {
  if ((node.type as string) === 'cabinet' && !section.categories.includes('colors')) return []
  const surface = SURFACE_BY_KIND[node.type]
  return section.categories.flatMap((category) =>
    getMaterialsForCategory(category)
      .filter(
        (m) =>
          (m.previewColor || m.previewThumbnailUrl) &&
          (!(surface && m.surfaces) || m.surfaces.includes(surface)),
      )
      .map((m) => ({ ...m, label: materialKoName(m) })),
  )
}

function isCurrent(target: Target | undefined, material: MaterialCatalogItem) {
  if (!target?.current) return false
  return (
    target.current === toLibraryMaterialRef(material.id) ||
    (!!material.previewColor &&
      target.current.toLowerCase() === material.previewColor.toLowerCase())
  )
}

function swatchStyle(material: MaterialCatalogItem) {
  return material.previewThumbnailUrl
    ? {
        backgroundImage: `url(${material.previewThumbnailUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { backgroundColor: material.previewColor }
}

export function MaterialPalette() {
  const [nodeId, setNodeId] = useState<AnyNodeId | null>(null)
  const [targetKey, setTargetKey] = useState<string | null>(null)
  const [hovered, setHovered] = useState<MaterialCatalogItem | null>(null)
  // Swatch under the pointer, for inZOI's name bubble above the card.
  const [bubble, setBubble] = useState<{
    x: number
    y: number
    label: string
    style: CSSProperties
  } | null>(null)
  const [gloss, setGloss] = useState(50)
  const [roomScope, setRoomScope] = useState(false)
  const [tab, setTab] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const node = useScene((s) => (nodeId ? (s.nodes[nodeId] ?? null) : null))
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const moving = useMovingNode()
  const restorePreview = useRef<(() => void) | null>(null)

  useEffect(() => {
    useEditor.getState().setCanPaintNode(canPaintNode)
    const open = (target: AnyNode) => {
      setNodeId(target.id as AnyNodeId)
      setTargetKey(null)
    }
    emitter.on('selection:paint-node' as never, open as never)
    return () => {
      useEditor.getState().setCanPaintNode(null)
      emitter.off('selection:paint-node' as never, open as never)
    }
  }, [])

  const endPreview = () => {
    restorePreview.current?.()
    restorePreview.current = null
    setHovered(null)
    setBubble(null)
  }

  const close = () => {
    endPreview()
    setNodeId(null)
  }

  // The palette belongs to the selected object: closes with the selection.
  useEffect(() => {
    if (nodeId && (selectedIds.length !== 1 || selectedIds[0] !== nodeId || moving)) close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, moving, nodeId])

  useEffect(() => {
    if (!nodeId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  useEffect(() => () => restorePreview.current?.(), [])

  if (!node) return <SelectionHint />
  const canSpread = offersRoomScope(node)
  const targets = paintTargets(node, canSpread && roomScope)
  const target = targets.find((t) => t.key === targetKey) ?? targets[0]
  const def = nodeRegistry.get(node.type)
  const name =
    (node as { name?: string }).name ||
    KIND_NAMES[node.type] ||
    def?.presentation?.label ||
    node.type
  const all = SECTIONS.flatMap((section) => materialsFor(node, section))
  // A colour picked outside the palette (a cabinet's default hex) has no swatch.
  const current =
    all.find((m) => isCurrent(target, m)) ??
    (target?.current?.startsWith('#')
      ? ({
          id: 'custom',
          label: target.current,
          previewColor: target.current,
        } as MaterialCatalogItem)
      : undefined)
  const shown = hovered ?? current

  const sections = target
    ? SECTIONS.map((section) => ({ ...section, materials: materialsFor(node, section) })).filter(
        (section) => section.materials.length > 0,
      )
    : []
  const tabs = [
    ...sections.map((section) => section.title),
    ...(target?.applyColor ? [CUSTOM_TAB] : []),
  ]
  const activeTab = tab && tabs.includes(tab) ? tab : tabs[0]
  const activeSection = sections.find((section) => section.title === activeTab)

  return (
    <div
      className="pointer-events-auto fixed bottom-[68px] z-50 flex w-[640px] max-w-[calc(100vw-var(--viewer-left-inset,0px)-32px)] -translate-x-1/2 flex-col gap-1.5 text-neutral-800 dark:text-neutral-100"
      onPointerDown={(e) => e.stopPropagation()}
      // Centred over the free scene strip, like inZOI's customize card.
      style={{
        left: 'calc(var(--viewer-left-inset, 0px) + (100% - var(--viewer-left-inset, 0px)) / 2)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        {/* inZOI's customize tabs: 외형 hands over to the object's inspector. */}
        <div className="flex items-center rounded-full bg-white/95 p-0.5 shadow-[0_4px_16px_rgba(0,0,0,0.16)] dark:bg-neutral-900/95">
          <button
            className="rounded-full px-3 py-1 font-medium text-[11px] text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            onClick={() => {
              close()
              useInspectorCollapsed.getState().setCollapsed(false)
            }}
            type="button"
          >
            외형
          </button>
          <span className="rounded-full bg-sky-400 px-3 py-1 font-semibold text-[11px] text-white">
            색상과 재질
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 rounded-full bg-white/95 py-0.5 pr-0.5 pl-3 shadow-[0_4px_16px_rgba(0,0,0,0.16)] dark:bg-neutral-900/95">
          <span className="whitespace-nowrap text-[11px] text-neutral-500 dark:text-neutral-400">
            {hovered ? '미리보기' : '현재'}
          </span>
          <span
            className="size-4 shrink-0 rounded-full border border-black/10 bg-neutral-200 dark:bg-neutral-700"
            style={shown ? swatchStyle(shown) : undefined}
          />
          <span className="max-w-36 truncate font-medium text-[11px]">
            {shown ? materialKoName(shown) : '기본'}
          </span>
          <button
            className="ml-1 flex h-6 items-center gap-1 rounded-full bg-sky-500 px-2.5 font-semibold text-[11px] text-white transition-colors hover:bg-sky-600"
            onClick={close}
            title="확인 (Esc)"
            type="button"
          >
            <Check className="h-3 w-3" strokeWidth={3} />
            확인
          </button>
        </div>
      </div>
      <div
        className="flex overflow-hidden rounded-2xl bg-white/95 shadow-[0_8px_28px_rgba(0,0,0,0.18)] backdrop-blur-md dark:bg-neutral-900/95"
        ref={cardRef}
      >
        {/* The object and its parts (inZOI's left column). */}
        <aside className="flex w-32 shrink-0 flex-col gap-1 border-neutral-200 border-r bg-neutral-50/80 p-2 dark:border-white/10 dark:bg-white/5">
          <span className="truncate px-1 pb-0.5 font-semibold text-[12px]">{name}</span>
          {targets.map((t) => (
            <button
              className={`truncate rounded-lg px-2 py-1 text-left text-[11px] transition-colors ${
                t.key === target?.key
                  ? 'bg-sky-400 font-semibold text-white'
                  : 'text-neutral-600 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-white/10'
              }`}
              key={t.key}
              onClick={() => {
                endPreview()
                setTargetKey(t.key)
              }}
              type="button"
            >
              {t.label}
            </button>
          ))}
          {targets.length === 0 && (
            <span className="px-1 text-[10.5px] text-neutral-500">
              칠할 수 있는 부분이 없습니다
            </span>
          )}
          {canSpread && (
            <div className="mt-auto flex rounded-lg bg-neutral-200/70 p-0.5 dark:bg-white/10">
              {(
                [
                  [false, node.type === 'wall' ? '이 벽만' : '이 바닥만'],
                  [true, '방 전체'],
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-pressed={roomScope === value}
                  className={`flex-1 rounded-md py-1 text-[10.5px] transition-colors ${
                    roomScope === value
                      ? 'bg-white font-semibold text-sky-700 shadow-sm dark:bg-neutral-800 dark:text-sky-300'
                      : 'text-neutral-500 dark:text-neutral-400'
                  }`}
                  key={label}
                  onClick={() => {
                    endPreview()
                    setRoomScope(value)
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5">
          <div className="no-scrollbar flex gap-1 overflow-x-auto">
            {tabs.map((title) => (
              <button
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                  title === activeTab
                    ? 'bg-neutral-800 font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900'
                    : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/10'
                }`}
                key={title}
                onClick={() => {
                  endPreview()
                  setTab(title)
                }}
                type="button"
              >
                {title}
              </button>
            ))}
          </div>
          {target && activeSection && (
            <div className="no-scrollbar grid h-[134px] auto-cols-max grid-flow-col grid-rows-4 gap-1.5 overflow-x-auto p-0.5">
              {activeSection.materials.map((material) => (
                <button
                  aria-label={`${target.label} ${material.label}`}
                  className={`size-7 shrink-0 rounded-full border shadow-sm transition-transform hover:scale-110 ${isCurrent(target, material) ? 'border-sky-500 ring-2 ring-sky-400' : 'border-black/10'}`}
                  key={material.id}
                  onClick={() => {
                    endPreview()
                    target.apply(material)
                    triggerSFX('sfx:menu-click')
                  }}
                  onMouseEnter={(e) => {
                    restorePreview.current?.()
                    restorePreview.current = target.preview?.(material) ?? null
                    setHovered(material)
                    const card = cardRef.current?.getBoundingClientRect()
                    const swatch = e.currentTarget.getBoundingClientRect()
                    setBubble({
                      x: swatch.left + swatch.width / 2,
                      y: (card?.top ?? swatch.top) - 36,
                      label: material.label,
                      style: swatchStyle(material),
                    })
                  }}
                  onMouseLeave={endPreview}
                  style={swatchStyle(material)}
                  title={material.label}
                  type="button"
                />
              ))}
            </div>
          )}
          {target?.applyColor && activeTab === CUSTOM_TAB && (
            <div className="flex h-[134px] items-start gap-4 overflow-hidden p-0.5">
              <ColorPicker
                onCommit={(hex) => {
                  endPreview()
                  target.applyColor?.(hex, 1 - gloss / 100)
                  triggerSFX('sfx:menu-click')
                }}
                onPreview={(hex) => {
                  restorePreview.current?.()
                  restorePreview.current = target.previewColor?.(hex, 1 - gloss / 100) ?? null
                }}
                value={
                  target.current?.startsWith('#')
                    ? target.current
                    : (current?.previewColor ?? '#FFFFFF')
                }
              />
              {target.previewColor && (
                <label className="flex w-28 flex-col gap-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                  <span className="flex justify-between">
                    광택 <span className="tabular-nums">{gloss}</span>
                  </span>
                  <input
                    aria-label="광택"
                    className="accent-sky-500"
                    max={100}
                    min={0}
                    onChange={(e) => setGloss(Number(e.target.value))}
                    type="range"
                    value={gloss}
                  />
                </label>
              )}
            </div>
          )}
        </div>
      </div>
      {/* inZOI: the hovered material's name in a bubble over the card. */}
      {bubble &&
        createPortal(
          <div
            className="-translate-x-1/2 -translate-y-full pointer-events-none fixed z-[200] flex items-center gap-2 rounded-full bg-white py-1 pr-3 pl-1 text-neutral-800 shadow-[0_6px_20px_rgba(0,0,0,0.2)] dark:bg-neutral-900 dark:text-neutral-100"
            style={{ left: bubble.x, top: bubble.y }}
          >
            <span className="size-7 rounded-full border border-black/10" style={bubble.style} />
            <span className="whitespace-nowrap font-medium text-[12px]">{bubble.label}</span>
          </div>,
          document.body,
        )}
    </div>
  )
}

/**
 * inZOI's bottom-centre line (under the palette's spot, so shown while it is
 * closed): what to do next when nothing is selected, the
 * keys for the selected object otherwise.
 */
function SelectionHint() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const node = useScene((s) => (selectedId ? (s.nodes[selectedId as AnyNodeId] ?? null) : null))
  const mode = useEditor((s) => s.mode)
  const moving = useMovingNode()

  if (mode !== 'select' || moving || selectedIds.length > 1) return null
  const turnable =
    !!node &&
    Array.isArray((node as { rotation?: unknown }).rotation) &&
    node.type !== 'door' &&
    node.type !== 'window'
  const text = !node
    ? '구조물 또는 가구를 선택하세요.'
    : `${turnable ? '클릭: 집기 · R / T · 우클릭 45° · Alt + R / T 5° · G 격자 · 더블클릭: 시점 · ' : ''}Delete 삭제 · Esc 선택 해제`

  return (
    <div
      className="pointer-events-none fixed bottom-[68px] z-40 -translate-x-1/2 whitespace-nowrap text-center font-medium text-[13px] text-neutral-800 [text-shadow:0_0_4px_rgba(255,255,255,0.95),0_0_2px_rgba(255,255,255,0.95)] dark:text-neutral-100 dark:[text-shadow:0_0_4px_rgba(0,0,0,0.9)]"
      // Centred over the free scene strip, above the bottom 3D / 2D row.
      style={{
        left: 'calc(var(--viewer-left-inset, 0px) + (100% - var(--viewer-left-inset, 0px)) / 2)',
      }}
    >
      {text}
    </div>
  )
}
