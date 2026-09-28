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
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ColorSection } from './customize/color-section'
import { ColumnDivider, CustomizeDock } from './customize/customize-dock'
import { MaterialColumn } from './customize/material-column'
import { resolveSchema, withColor } from './customize/material-schema'
import { MaterialSphere, type SphereMaterial } from './customize/material-sphere'
import { PaintHints } from './customize/paint-hints'
import { PaintPickPin } from './customize/paint-pick-pin'
import { PartList } from './customize/part-list'
import { PropertiesSection } from './customize/properties-section'

/**
 * inZOI-style material palette. The paint button on the selected object's
 * action menu opens it: the parts that can be painted as pills at the bottom
 * left, then one compact card with the colour picker, 속성 sliders and the
 * finishes. Hovering a swatch previews it on the model, clicking applies it,
 * 확인 or Esc closes.
 */

type Section = { title: string; categories: MaterialCategory[] }

const SECTIONS: Section[] = [
  { title: '페인트', categories: ['colors'] },
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
  /** The applied finish as a ref (`library:` / `scene:`) or `#hex`, for matching swatches. */
  current?: string
  /** The applied finish as an editable schema (null when it can't be tuned). */
  base: MaterialSchema | null
  apply: (material: MaterialCatalogItem) => void
  /** Show the material on the model without committing; returns the restore. */
  preview?: (material: MaterialCatalogItem) => (() => void) | null
  applyColor: (hex: string) => void
  previewColor?: (hex: string) => (() => void) | null
  applySchema?: (material: MaterialSchema) => void
  previewSchema?: (material: MaterialSchema) => (() => void) | null
  /** Back to the kind's default finish. */
  clear?: () => void
}

/** Kinds whose paint can spread to the whole room (walls, floors). */
function offersRoomScope(node: AnyNode): boolean {
  return nodeRegistry.get(node.type)?.capabilities?.paint?.roomScope === true
}

function slotTargets(node: AnyNode, slotIds: string[], roomScope: boolean): Target[] {
  const def = nodeRegistry.get(node.type)
  const paint = def?.capabilities?.paint
  if (!paint) return []
  const slots = (node as { slots?: Record<string, string> }).slots
  const defaults = new Map(
    (def.capabilities?.slots?.(node) ?? []).map((slot) => [slot.slotId, slot.default]),
  )
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
  return slotIds.map((role) => {
    // The finish the face shows now: its slot, a pre-migration inline
    // material, else the kind's declared default.
    const effective = slots?.[role]
      ? null
      : paint.getEffectiveMaterial?.({ node, role, nodes: useScene.getState().nodes })
    const current =
      slots?.[role] ??
      effective?.materialPreset ??
      (effective?.material ? undefined : defaults.get(role))
    const base = effective?.material ?? resolveSchema(current)
    return {
      key: role,
      label: SLOT_LABELS[role] ?? slotLabelFromId(role),
      current,
      base,
      apply: (material) => commit(role, undefined, toLibraryMaterialRef(material.id)),
      preview: (material) => preview(role, undefined, toLibraryMaterialRef(material.id)),
      applyColor: (hex) => commit(role, withColor(base, hex)),
      previewColor: (hex) => preview(role, withColor(base, hex)),
      applySchema: (material) => commit(role, material),
      previewSchema: (material) => preview(role, material),
      clear: () => commit(role, undefined, undefined),
    }
  })
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
      base: null,
      apply: (m) => m.previewColor && set({ bodyColor: m.previewColor }),
      applyColor: (hex) => set({ bodyColor: hex }),
    },
    {
      key: 'front',
      label: '도어',
      current: cabinet.frontColor,
      base: null,
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

type HistoryMark = { entry: unknown; length: number }

function markHistory(): HistoryMark {
  const past = useScene.temporal.getState().pastStates
  return { entry: past[past.length - 1], length: past.length }
}

/**
 * Undo steps recorded since `mark`, found by the entry that was on top then
 * (the history is capped, so its length alone stops growing).
 */
function stepsSince(mark: HistoryMark): number {
  const past = useScene.temporal.getState().pastStates
  const index = mark.entry === undefined ? -1 : past.lastIndexOf(mark.entry as never)
  if (index >= 0) return past.length - 1 - index
  // Undone past the mark: nothing of ours is left. Otherwise it fell off the cap.
  return past.length < mark.length ? 0 : past.length
}

/** Undo steps since the card opened, so 처음으로 되돌리기 can enable itself. */
function useStepsSince(mark: HistoryMark) {
  return useSyncExternalStore(
    (onChange) => useScene.temporal.subscribe(onChange),
    () => stepsSince(mark),
    () => 0,
  )
}

export function MaterialPalette() {
  const [nodeId, setNodeId] = useState<AnyNodeId | null>(null)
  const [targetKey, setTargetKey] = useState<string | null>(null)
  const [hovered, setHovered] = useState<MaterialCatalogItem | null>(null)
  // Swatch under the pointer: inZOI's name + sphere card over the header tab.
  const [bubble, setBubble] = useState<{
    x: number
    bottom: number
    material: MaterialCatalogItem
  } | null>(null)
  const [roomScope, setRoomScope] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const node = useScene((s) => (nodeId ? (s.nodes[nodeId] ?? null) : null))
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const moving = useMovingNode()
  const restorePreview = useRef<(() => void) | null>(null)
  const faceClickAt = useRef(Number.NEGATIVE_INFINITY)
  // Where the history stood when the card opened, and each part's colour then.
  const openedAt = useRef<HistoryMark>({ entry: undefined, length: 0 })
  const originals = useRef(new Map<string, string | undefined>())
  const stepsSinceOpen = useStepsSince(openedAt.current)

  useEffect(() => {
    useEditor.getState().setCanPaintNode(canPaintNode)
    const open = (target: AnyNode) => {
      setNodeId(target.id as AnyNodeId)
      setTargetKey(null)
      // Opening another object starts on the single-face brush, so a roller
      // armed earlier can't repaint a whole room unnoticed.
      setRoomScope(false)
      openedAt.current = markHistory()
      originals.current.clear()
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

  const showPreview = (restore: (() => void) | null | undefined) => {
    restorePreview.current?.()
    restorePreview.current = restore ?? null
  }

  const close = () => {
    endPreview()
    setNodeId(null)
  }

  // The palette belongs to the selected object: closes with the selection.
  useEffect(() => {
    if (!nodeId) return
    // Clicking the object picks a part here; select mode's click-to-pick-up
    // would carry it off (and drop the selection) instead, so undo both.
    if (moving?.id === nodeId && performance.now() - faceClickAt.current < 500) {
      emitter.emit('tool:cancel')
      useEditor.getState().setMovingNode(null)
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      return
    }
    if (selectedIds.length !== 1 || selectedIds[0] !== nodeId || moving) close()
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
  const sections = target
    ? SECTIONS.map((section) => ({ ...section, materials: materialsFor(node, section) })).filter(
        (section) => section.materials.length > 0,
      )
    : []
  const currentItem = sections.flatMap((s) => s.materials).find((m) => isCurrent(target, m))
  const currentHex = target?.current?.startsWith('#')
    ? target.current
    : (target?.base?.properties?.color ?? currentItem?.previewColor)
  const current: SphereMaterial | undefined = currentItem ?? {
    previewColor: currentHex,
    previewThumbnailUrl: target?.base?.texture?.url,
  }
  const shown = hovered ?? current
  const originalKey = target ? `${node.id}:${target.key}` : ''
  if (target && !originals.current.has(originalKey)) {
    originals.current.set(originalKey, currentHex)
  }
  const original = originals.current.get(originalKey)
  const hasPartList = targets.length > 1

  const reset = () => {
    endPreview()
    const steps = stepsSince(openedAt.current)
    if (steps <= 0) return
    useScene.temporal.getState().undo(steps)
    const state = useScene.getState()
    for (const id of Object.keys(state.nodes)) state.markDirty(id as AnyNodeId)
  }

  return (
    <>
      {hasPartList && (
        <PartList
          activeKey={target?.key}
          name={name}
          onPick={(key) => {
            endPreview()
            setTargetKey(key)
          }}
          parts={targets}
        />
      )}
      <CustomizeDock
        canReset={stepsSinceOpen > 0}
        cardRef={cardRef}
        hasPartList={hasPartList}
        onConfirm={close}
        onReset={reset}
        onShape={() => {
          close()
          useInspectorCollapsed.getState().setCollapsed(false)
        }}
        previewing={!!hovered}
        scope={
          canSpread
            ? {
                room: roomScope,
                onChange: (room) => {
                  endPreview()
                  setRoomScope(room)
                },
              }
            : undefined
        }
        shown={shown}
      >
        {target && (
          <>
            <ColorSection
              onClear={
                target.clear &&
                (() => {
                  endPreview()
                  target.clear?.()
                })
              }
              onCommit={(hex) => {
                endPreview()
                target.applyColor(hex)
                triggerSFX('sfx:menu-click')
              }}
              onPreview={(hex) => showPreview(target.previewColor?.(hex))}
              original={original}
              value={currentHex ?? '#FFFFFF'}
            />
            <ColumnDivider />
            <PropertiesSection
              base={target.applySchema ? target.base : null}
              onApply={(material) => {
                endPreview()
                target.applySchema?.(material)
              }}
              onPreview={(material) => showPreview(target.previewSchema?.(material))}
            />
            <ColumnDivider />
          </>
        )}
        <MaterialColumn
          emptyText="칠할 수 있는 부분이 없습니다"
          isSelected={(m) => hovered?.id === m.id || isCurrent(target, m)}
          onApply={(material) => {
            if (!target) return
            endPreview()
            target.apply(material)
            triggerSFX('sfx:menu-click')
          }}
          onHover={(material, el) => {
            if (!target) return
            showPreview(target.preview?.(material))
            setHovered(material)
            const card = cardRef.current?.getBoundingClientRect()
            const swatch = el.getBoundingClientRect()
            const x = swatch.left + swatch.width / 2
            setBubble({
              x: card ? Math.min(Math.max(x, card.left + 62), card.right - 62) : x,
              bottom: window.innerHeight - (card?.top ?? swatch.top) - 2,
              material,
            })
          }}
          onLeave={endPreview}
          partLabel={target?.label ?? ''}
          sections={sections}
        />
      </CustomizeDock>
      <PaintHints wall={node.type === 'wall'} />
      <PaintPickPin
        node={node}
        onFaceClick={(role) => {
          faceClickAt.current = performance.now()
          if (!targets.some((t) => t.key === role)) return
          endPreview()
          setTargetKey(role)
        }}
      />
      {/* inZOI: the hovered finish's name and a large sphere, rising out of the header tab. */}
      {bubble &&
        createPortal(
          <div
            className="-translate-x-1/2 pointer-events-none fixed z-[200] flex w-[124px] flex-col items-center gap-1.5 rounded-[14px] bg-[#f3f3f5] px-2 pt-2 pb-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] dark:bg-neutral-900"
            style={{ left: bubble.x, bottom: bubble.bottom }}
          >
            <span className="max-w-full truncate text-[12px] text-[#333] dark:text-neutral-100">
              {bubble.material.label}
            </span>
            <MaterialSphere material={bubble.material} size={56} />
          </div>,
          document.body,
        )}
    </>
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
