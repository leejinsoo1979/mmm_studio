'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  getMaterialsForCategory,
  nodeRegistry,
  sceneRegistry,
  slotLabelFromId,
  toLibraryMaterialRef,
  useScene,
} from '@pascal-app/core'
import {
  emitDeleteSFX,
  triggerSFX,
  turnRotation,
  useEditor,
  useMovingNode,
} from '@pascal-app/editor'
import { type CabinetNode, resolveCabinetNode } from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Focus, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * inZOI-style settings bar: with one object selected, a bar above the bottom
 * toolbar gives its quick colours (wall faces, cabinet body / doors, or a
 * furniture model's paintable parts), 45° turns, duplicate and delete, plus
 * the key guide.
 */

const SWATCH_IDS = [
  'preset-white',
  'preset-softwhite',
  'preset-cream',
  'preset-beige',
  'preset-lightgrey',
  'preset-midgrey',
  'preset-charcoal',
  'preset-sage',
  'preset-softblue',
  'preset-tan',
  'preset-espresso',
  'preset-nearblack',
]
const SWATCHES = SWATCH_IDS.flatMap((id) => {
  const material = getMaterialsForCategory('colors').find((m) => m.id === id)
  return material?.previewColor ? [{ id, label: material.label, hex: material.previewColor }] : []
})

type Swatch = (typeof SWATCHES)[number]
type ColorRow = { key: string; label: string; current?: string; apply: (swatch: Swatch) => void }

/** Apply a library colour to one paintable slot through the kind's paint capability. */
function paintSlot(node: AnyNode, role: string, swatch: Swatch) {
  const paint = nodeRegistry.get(node.type)?.capabilities?.paint
  if (!paint) return
  const args = { node, role, material: undefined, materialPreset: toLibraryMaterialRef(swatch.id) }
  if (paint.commit) paint.commit(args)
  else useScene.getState().updateNode(node.id, paint.buildPatch(args))
}

/** The slot ids a furniture model exposes (its `slot_` materials), read off the mesh. */
function useItemSlots(node: AnyNode | null): string[] {
  const [slots, setSlots] = useState<string[]>([])
  useEffect(() => {
    if (node?.type !== 'item') {
      setSlots([])
      return
    }
    const found = new Set<string>()
    sceneRegistry.nodes.get(node.id)?.traverse((object) => {
      const slotId = (object.userData as { slotId?: unknown }).slotId
      if (typeof slotId === 'string') found.add(slotId)
    })
    setSlots([...found])
  }, [node])
  return slots
}

function colorRows(node: AnyNode, itemSlots: string[]): ColorRow[] {
  if (node.type === 'wall') {
    const slots = (node as { slots?: Record<string, string> }).slots
    return (['interior', 'exterior'] as const).map((role) => ({
      key: role,
      label: role === 'interior' ? '안쪽 면' : '바깥쪽 면',
      current: slots?.[role],
      apply: (swatch) => paintSlot(node, role, swatch),
    }))
  }
  if ((node.type as string) === 'cabinet') {
    const cabinet = resolveCabinetNode(node as unknown as CabinetNode)
    const set = (patch: Partial<CabinetNode>) =>
      useScene.getState().updateNode(node.id, patch as Partial<AnyNode>)
    return [
      {
        key: 'body',
        label: '몸통',
        current: cabinet.bodyColor,
        apply: (swatch) => set({ bodyColor: swatch.hex }),
      },
      {
        key: 'front',
        label: '도어',
        current: cabinet.frontColor,
        apply: (swatch) => set({ frontColor: swatch.hex }),
      },
    ]
  }
  if (node.type === 'item') {
    const slots = (node as { slots?: Record<string, string> }).slots
    return itemSlots.map((role) => ({
      key: role,
      label: slotLabelFromId(role),
      current: slots?.[role],
      apply: (swatch) => paintSlot(node, role, swatch),
    }))
  }
  return []
}

function isCurrent(row: ColorRow, swatch: Swatch) {
  if (!row.current) return false
  return (
    row.current.toLowerCase() === swatch.hex.toLowerCase() ||
    row.current === toLibraryMaterialRef(swatch.id)
  )
}

function duplicate(node: AnyNode) {
  const def = nodeRegistry.get(node.type)
  if (!def || def.capabilities.duplicable === false) return
  useScene.temporal.getState().pause()
  const cloned = structuredClone(node) as Record<string, unknown>
  delete cloned.id
  cloned.metadata = { ...((node.metadata as Record<string, unknown>) ?? {}), isNew: true }
  const parsed = def.schema.parse(cloned) as AnyNode
  useScene.getState().createNode(parsed, node.parentId as AnyNodeId)
  useEditor.getState().setMovingNode(parsed as never)
  useScene.temporal.getState().resume()
  useViewer.getState().setSelection({ selectedIds: [] })
  triggerSFX('sfx:item-pick')
}

function remove(node: AnyNode) {
  if (nodeRegistry.get(node.type)?.capabilities.deletable === false) return
  emitDeleteSFX(node.type)
  useViewer.getState().setSelection({ selectedIds: [] })
  useScene.getState().deleteNode(node.id)
}

function turn(node: AnyNode, direction: 1 | -1) {
  const rotation = (node as { rotation?: unknown }).rotation
  if (!Array.isArray(rotation)) return
  useScene.getState().updateNode(node.id, {
    rotation: [rotation[0], turnRotation(rotation[1] as number, direction, false), rotation[2]],
  } as Partial<AnyNode>)
  triggerSFX('sfx:item-rotate')
}

const iconButton =
  'flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs transition-colors hover:bg-white/10 disabled:opacity-40'

export function SelectionQuickBar() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const node = useScene((s) => (selectedId ? (s.nodes[selectedId as AnyNodeId] ?? null) : null))
  const mode = useEditor((s) => s.mode)
  const moving = useMovingNode()
  const itemSlots = useItemSlots(node)
  const [rowKey, setRowKey] = useState<string | null>(null)

  if (!node || mode !== 'select' || moving) return null
  const def = nodeRegistry.get(node.type)
  if (!def) return null

  const rows = colorRows(node, itemSlots)
  const row = rows.find((r) => r.key === rowKey) ?? rows[0]
  const turnable =
    Array.isArray((node as { rotation?: unknown }).rotation) &&
    node.type !== 'door' &&
    node.type !== 'window'
  const name = (node as { name?: string }).name || def.presentation?.label || node.type

  return (
    <div className="pointer-events-auto fixed bottom-24 left-1/2 z-50 flex w-max -translate-x-1/2 flex-col gap-1.5 rounded-2xl border border-border bg-background/90 px-3 py-2 text-foreground shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-3">
        <span className="max-w-40 truncate font-semibold text-sm">{name}</span>
        {row && (
          <div className="flex items-center gap-2 border-border/60 border-l pl-3">
            {rows.length > 1 && (
              <div className="flex rounded-lg bg-muted p-0.5">
                {rows.map((r) => (
                  <button
                    className={`whitespace-nowrap rounded-md px-2 py-1 text-[11px] ${r.key === row.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                    key={r.key}
                    onClick={() => setRowKey(r.key)}
                    type="button"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
            {rows.length === 1 && (
              <span className="whitespace-nowrap text-muted-foreground text-xs">{row.label}</span>
            )}
            <div className="flex items-center gap-1">
              {SWATCHES.map((swatch) => (
                <button
                  aria-label={`${row.label} ${swatch.label}`}
                  className={`h-6 w-6 shrink-0 rounded-full border transition-transform hover:scale-110 ${isCurrent(row, swatch) ? 'border-primary ring-2 ring-primary/60' : 'border-white/20'}`}
                  key={swatch.id}
                  onClick={() => {
                    row.apply(swatch)
                    triggerSFX('sfx:menu-click')
                  }}
                  style={{ backgroundColor: swatch.hex }}
                  title={swatch.label}
                  type="button"
                />
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-0.5 border-border/60 border-l pl-2">
          {turnable && (
            <>
              <button
                className={iconButton}
                onClick={() => turn(node, -1)}
                title="45° 반시계 (T)"
                type="button"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                className={iconButton}
                onClick={() => turn(node, 1)}
                title="45° 시계 (R)"
                type="button"
              >
                <RotateCw className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            className={iconButton}
            onClick={() => emitter.emit('camera-controls:focus', { nodeId: node.id })}
            title="카메라를 이 오브젝트 중심으로 (더블클릭)"
            type="button"
          >
            <Focus className="h-4 w-4" />
            시점
          </button>
          <button
            className={iconButton}
            disabled={def.capabilities.duplicable === false}
            onClick={() => duplicate(node)}
            title="복제"
            type="button"
          >
            <Copy className="h-4 w-4" />
            복제
          </button>
          <button
            className={`${iconButton} text-red-300`}
            disabled={def.capabilities.deletable === false}
            onClick={() => remove(node)}
            title="삭제 (Delete)"
            type="button"
          >
            <Trash2 className="h-4 w-4" />
            삭제
          </button>
        </div>
      </div>
      <div className="text-center text-[10px] text-muted-foreground">
        {turnable ? '클릭: 집기 · R / T · 우클릭 45° · Alt + R / T 5° · G 격자 · ' : ''}Delete 삭제
        · Esc 선택 해제
      </div>
    </div>
  )
}
