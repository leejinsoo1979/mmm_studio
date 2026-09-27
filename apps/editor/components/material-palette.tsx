'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  getMaterialsForCategory,
  type MaterialCatalogItem,
  type MaterialCategory,
  type MaterialSurface,
  nodeRegistry,
  sceneRegistry,
  slotLabelFromId,
  toLibraryMaterialRef,
  useScene,
} from '@pascal-app/core'
import { triggerSFX, useEditor, useMovingNode } from '@pascal-app/editor'
import { type CabinetNode, resolveCabinetNode } from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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
}

function slotTargets(node: AnyNode, slotIds: string[]): Target[] {
  const paint = nodeRegistry.get(node.type)?.capabilities?.paint
  if (!paint) return []
  const slots = (node as { slots?: Record<string, string> }).slots
  return slotIds.map((role) => ({
    key: role,
    label: SLOT_LABELS[role] ?? slotLabelFromId(role),
    current: slots?.[role],
    apply: (material) => {
      const args = {
        node,
        role,
        material: undefined,
        materialPreset: toLibraryMaterialRef(material.id),
      }
      if (paint.commit) paint.commit(args)
      else useScene.getState().updateNode(node.id, paint.buildPatch(args))
    },
    preview: (material) => {
      const root = sceneRegistry.nodes.get(node.id)
      if (!root) return null
      return paint.applyPreview({
        node,
        role,
        material: undefined,
        materialPreset: toLibraryMaterialRef(material.id),
        root,
      })
    },
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
    },
    {
      key: 'front',
      label: '도어',
      current: cabinet.frontColor,
      apply: (m) => m.previewColor && set({ frontColor: m.previewColor }),
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

function paintTargets(node: AnyNode): Target[] {
  if ((node.type as string) === 'cabinet') return cabinetTargets(node)
  const def = nodeRegistry.get(node.type)
  if (!def?.capabilities?.paint) return []
  const declared = def.capabilities.slots?.(node).map((slot) => slot.slotId)
  return slotTargets(node, declared ?? meshSlotIds(node))
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
    getMaterialsForCategory(category).filter(
      (m) =>
        (m.previewColor || m.previewThumbnailUrl) &&
        (!(surface && m.surfaces) || m.surfaces.includes(surface)),
    ),
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
  const targets = paintTargets(node)
  const target = targets.find((t) => t.key === targetKey) ?? targets[0]
  const def = nodeRegistry.get(node.type)
  const name = (node as { name?: string }).name || def?.presentation?.label || node.type
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

  return (
    <div
      className="pointer-events-auto fixed bottom-[84px] left-1/2 z-50 flex w-[min(1100px,calc(100%-32px))] -translate-x-1/2 flex-col items-center gap-2 text-neutral-800"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 rounded-full bg-white/95 py-1 pr-1 pl-4 shadow-[0_6px_24px_rgba(0,0,0,0.25)]">
        <span className="whitespace-nowrap text-neutral-500 text-xs">
          {hovered ? '미리보기' : '현재 재질'}
        </span>
        <span
          className="size-5 shrink-0 rounded-full border border-black/10 bg-neutral-200"
          style={shown ? swatchStyle(shown) : undefined}
        />
        <span className="max-w-48 truncate font-medium text-xs">{shown?.label ?? '기본'}</span>
        <button
          aria-label="완료"
          className="ml-2 flex size-8 items-center justify-center rounded-full bg-sky-500 text-white transition-colors hover:bg-sky-600"
          onClick={close}
          title="완료 (Esc)"
          type="button"
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </button>
      </div>
      <div className="flex w-full gap-4 rounded-2xl bg-white/95 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.28)] backdrop-blur-md">
        <aside className="flex w-36 shrink-0 flex-col gap-1 border-neutral-200 border-r pr-3">
          <span className="truncate font-semibold text-sm">{name}</span>
          <span className="mb-1 text-[11px] text-neutral-500">칠할 부분</span>
          {targets.map((t) => (
            <button
              className={`truncate rounded-lg px-2 py-1 text-left text-xs transition-colors ${t.key === target?.key ? 'bg-sky-100 font-medium text-sky-700' : 'text-neutral-600 hover:bg-neutral-100'}`}
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
            <span className="text-[11px] text-neutral-400">칠할 수 있는 부분이 없습니다</span>
          )}
        </aside>
        <div className="flex min-w-0 flex-1 gap-5 overflow-x-auto pb-1">
          {target &&
            SECTIONS.map((section) => {
              const materials = materialsFor(node, section)
              if (materials.length === 0) return null
              return (
                <section className="flex shrink-0 flex-col gap-1.5" key={section.title}>
                  <h4 className="font-semibold text-neutral-600 text-xs">{section.title}</h4>
                  <div className="grid grid-flow-col grid-rows-3 gap-1.5">
                    {materials.map((material) => (
                      <button
                        aria-label={`${target.label} ${material.label}`}
                        className={`size-8 shrink-0 rounded-full border transition-transform hover:scale-110 ${isCurrent(target, material) ? 'border-sky-500 ring-2 ring-sky-400' : 'border-black/10'}`}
                        key={material.id}
                        onClick={() => {
                          endPreview()
                          target.apply(material)
                          triggerSFX('sfx:menu-click')
                        }}
                        onMouseEnter={() => {
                          restorePreview.current?.()
                          restorePreview.current = target.preview?.(material) ?? null
                          setHovered(material)
                        }}
                        onMouseLeave={endPreview}
                        style={swatchStyle(material)}
                        title={material.label}
                        type="button"
                      />
                    ))}
                  </div>
                </section>
              )
            })}
        </div>
      </div>
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
    <div className="pointer-events-none fixed bottom-[92px] left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-neutral-900/60 px-4 py-1.5 text-center font-medium text-[13px] text-white backdrop-blur-sm">
      {text}
    </div>
  )
}
