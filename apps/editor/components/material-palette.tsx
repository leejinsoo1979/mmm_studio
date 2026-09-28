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
  usePaintFocus,
  useUiHidden,
} from '@pascal-app/editor'
import { type CabinetNode, resolveCabinetNode } from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Material, Mesh, MeshStandardMaterial } from 'three'
import { CATALOG_KO_NAMES } from '@/lib/catalog-ko-names'
import { ColorSection } from './customize/color-section'
import { ColumnDivider, CustomizeDock } from './customize/customize-dock'
import { MaterialColumn } from './customize/material-column'
import { customColorMaterial, resolveSchema, withColor } from './customize/material-schema'
import { MaterialSphere, type SphereMaterial } from './customize/material-sphere'
import { PaintHints } from './customize/paint-hints'
import { PaintPickPin } from './customize/paint-pick-pin'
import { PartList } from './customize/part-list'
import { furniturePartName } from './customize/part-names'
import { PropertiesSection } from './customize/properties-section'
import { textureColor, useTextureColors } from './customize/texture-color'

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
  /** The part's own slot value (undefined while it shows the kind's default). */
  slot?: string
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
  /** Puts a slot value back as it was (a ref, or none for the default). */
  applyRef?: (ref: string | undefined) => void
}

/** The part as the model draws it before any paint (a furniture GLB's own material). */
type MeshFinish = (role: string) => MaterialSchema | null

/** Kinds whose paint can spread to the whole room (walls, floors). */
function offersRoomScope(node: AnyNode): boolean {
  return nodeRegistry.get(node.type)?.capabilities?.paint?.roomScope === true
}

function partLabel(node: AnyNode, role: string, index: number): string {
  const furniture = node.type === 'item' || node.type === 'shelf'
  return (
    (furniture ? furniturePartName(role) : (SLOT_LABELS[role] ?? furniturePartName(role))) ??
    `부분 ${index + 1}`
  )
}

function slotTargets(
  node: AnyNode,
  slotIds: string[],
  roomScope: boolean,
  meshFinish: MeshFinish,
): Target[] {
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
  return slotIds.map((role, index) => {
    // The finish the face shows now: its slot, a pre-migration inline
    // material, the kind's declared default, else the model's own material.
    const effective = slots?.[role]
      ? null
      : paint.getEffectiveMaterial?.({ node, role, nodes: useScene.getState().nodes })
    const current =
      slots?.[role] ??
      effective?.materialPreset ??
      (effective?.material ? undefined : defaults.get(role))
    const base =
      effective?.material ?? resolveSchema(current) ?? (current ? null : meshFinish(role))
    return {
      key: role,
      label: partLabel(node, role, index),
      current,
      slot: slots?.[role],
      base,
      apply: (material) => commit(role, undefined, toLibraryMaterialRef(material.id)),
      preview: (material) => preview(role, undefined, toLibraryMaterialRef(material.id)),
      applyColor: (hex) => commit(role, withColor(base, hex)),
      previewColor: (hex) => preview(role, withColor(base, hex)),
      applySchema: (material) => commit(role, material),
      previewSchema: (material) => preview(role, material),
      clear: () => commit(role, undefined, undefined),
      applyRef: (ref) => commit(role, undefined, ref),
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

/** A mesh's slot tag: one id, or one per material of a multi-material mesh. */
function slotTagOf(object: { userData: unknown }): (string | null)[] {
  const tag = (object.userData as { slotId?: unknown }).slotId
  if (typeof tag === 'string') return [tag]
  return Array.isArray(tag) ? tag.map((id) => (typeof id === 'string' ? id : null)) : []
}

/** The slot ids a node's mesh is tagged with (a furniture model's `slot_` materials). */
function meshSlotIds(node: AnyNode): string[] {
  const found = new Set<string>()
  sceneRegistry.nodes.get(node.id)?.traverse((object) => {
    for (const id of slotTagOf(object)) if (id) found.add(id)
  })
  return [...found]
}

/**
 * The colour and gloss the model gives a part it hasn't been painted, so the
 * card starts from what the user sees. Null for a textured part: a flat
 * colour can't stand for it.
 */
function modelFinish(node: AnyNode, role: string): MaterialSchema | null {
  let found: Material | undefined
  sceneRegistry.nodes.get(node.id)?.traverse((object) => {
    const mesh = object as Mesh
    if (found || !mesh.isMesh) return
    const index = slotTagOf(mesh).indexOf(role)
    if (index < 0) return
    found = Array.isArray(mesh.material) ? mesh.material[index] : mesh.material
  })
  const standard = found as MeshStandardMaterial | undefined
  if (!standard?.color || standard.map) return null
  const base = customColorMaterial(`#${standard.color.getHexString()}`, standard.roughness ?? 0.5)
  return { ...base, properties: { ...base.properties!, metalness: standard.metalness ?? 0 } }
}

function paintTargets(node: AnyNode, roomScope: boolean, meshFinish: MeshFinish): Target[] {
  if ((node.type as string) === 'cabinet') return cabinetTargets(node)
  const def = nodeRegistry.get(node.type)
  if (!def?.capabilities?.paint) return []
  const declared = def.capabilities.slots?.(node).map((slot) => slot.slotId)
  return slotTargets(node, declared ?? meshSlotIds(node), roomScope, meshFinish)
}

/** Furniture is paintable part by part, so only a model with tagged parts offers it. */
export function canPaintNode(node: AnyNode): boolean {
  if ((node.type as string) === 'cabinet') return true
  const def = nodeRegistry.get(node.type)
  if (!def?.capabilities?.paint) return false
  const declared = def.capabilities.slots?.(node)
  return declared ? declared.length > 0 : meshSlotIds(node).length > 0
}

/** The name the object goes by: its own, its catalog item's, else its kind. */
function objectName(node: AnyNode): string {
  const own = (node as { name?: string }).name
  if (own) return own
  const asset = (node as { asset?: { id?: string; name?: string } }).asset
  const catalog = asset?.id ? CATALOG_KO_NAMES[asset.id] : undefined
  return (
    catalog ||
    asset?.name ||
    KIND_NAMES[node.type] ||
    nodeRegistry.get(node.type)?.presentation?.label ||
    node.type
  )
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
  const originals = useRef(new Map<string, { hex?: string; slot?: string }>())
  // Each unpainted part's model finish, read once before any preview swaps it.
  const modelFinishes = useRef(new Map<string, MaterialSchema | null>())
  const stepsSinceOpen = useStepsSince(openedAt.current)
  useTextureColors()

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
      modelFinishes.current.clear()
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: `close` is recreated every render; the selection values are the triggers.
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
  }, [selectedIds, moving, nodeId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `close` is recreated every render; the listener only needs re-binding per node.
  useEffect(() => {
    if (!nodeId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [nodeId])

  useEffect(() => () => restorePreview.current?.(), [])

  // inZOI's 건축 커스터마이즈: the rest of the build chrome steps aside.
  useEffect(() => {
    if (!nodeId) return
    useUiHidden.getState().setCustomizing(true)
    return () => useUiHidden.getState().setCustomizing(false)
  }, [nodeId])

  // The canvas traces the surface being painted (or the whole room's).
  useEffect(() => {
    if (!nodeId) return
    usePaintFocus.getState().setFocus({ nodeId, role: targetKey, roomScope })
    return () => usePaintFocus.getState().setFocus(null)
  }, [nodeId, targetKey, roomScope])

  if (!node) return null
  const canSpread = offersRoomScope(node)
  const meshFinish: MeshFinish = (role) => {
    const key = `${node.id}:${role}`
    if (!modelFinishes.current.has(key)) modelFinishes.current.set(key, modelFinish(node, role))
    return modelFinishes.current.get(key) ?? null
  }
  const targets = paintTargets(node, canSpread && roomScope, meshFinish)
  const target = targets.find((t) => t.key === targetKey) ?? targets[0]
  const name = objectName(node)
  const sections = target
    ? SECTIONS.map((section) => ({ ...section, materials: materialsFor(node, section) })).filter(
        (section) => section.materials.length > 0,
      )
    : []
  const allMaterials = sections.flatMap((s) => s.materials)
  const currentItem = allMaterials.find((m) => isCurrent(target, m))
  // A textured finish's own colour is only a tint (often white): show the
  // texture's average colour instead.
  const texture = target?.base?.texture
  const currentHex = target?.current?.startsWith('#')
    ? target.current
    : texture
      ? (currentItem?.previewColor ?? textureColor(texture.url))
      : (target?.base?.properties?.color ?? currentItem?.previewColor)
  const current: SphereMaterial | undefined = currentItem ?? {
    previewColor: currentHex,
    previewThumbnailUrl: target?.base?.texture?.url,
  }
  const shown = hovered ?? current
  const originalKey = target ? `${node.id}:${target.key}` : ''
  const known = originals.current.get(originalKey)
  // A texture's colour arrives a moment after the card opens.
  if (target && (!known || (!known.hex && known.slot === target.slot))) {
    originals.current.set(originalKey, { hex: currentHex, slot: target.slot })
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
              onRestore={() => {
                endPreview()
                // The finish the part had, as it was stored: a catalog
                // finish stays one instead of turning into a custom colour.
                if (target.applyRef) target.applyRef(original?.slot)
                else if (original?.hex) target.applyColor(original.hex)
              }}
              original={original?.hex}
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
          isSelected={(m) => isCurrent(target, m)}
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
      <PaintHints roomScope={canSpread} wall={node.type === 'wall'} />
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
