'use client'

import { type AnyNode, type CeilingNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  holeEditScope,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useEditingHole,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Edit, Move, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'

/**
 * Phase 5 Stage E — ceiling inspector (kind-owned).
 *
 * 1:1 port of the legacy `CeilingPanel`. Mounted via
 * `parametrics.customPanel`. Same rationale as slab/panel.tsx — the
 * holes list + height presets need richer field kinds before this
 * panel can collapse into auto-derived groups.
 */
export function CeilingPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const editingHole = useEditingHole()
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as CeilingNode | undefined) : undefined,
  )

  // Panel slider-drag fix recipe (plans/editor-node-registry.md): stable
  // handler refs so slider drags don't trigger Maximum update depth.
  const nodeRef = useRef(node)
  nodeRef.current = node

  const handleUpdate = useCallback(
    (updates: Partial<CeilingNode>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
    useInteractionScope
      .getState()
      .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'hole')
  }, [setSelection])

  useEffect(() => {
    if (!node) {
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'hole')
    }
  }, [node])

  useEffect(() => {
    return () => {
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'hole')
    }
  }, [])

  const handleAddHole = useCallback(() => {
    if (!(node && selectedId)) return

    const polygon = node.polygon
    let cx = 0
    let cz = 0
    for (const [x, z] of polygon) {
      cx += x
      cz += z
    }
    cx /= polygon.length
    cz /= polygon.length

    const holeSize = 0.5
    const newHole: Array<[number, number]> = [
      [cx - holeSize, cz - holeSize],
      [cx + holeSize, cz - holeSize],
      [cx + holeSize, cz + holeSize],
      [cx - holeSize, cz + holeSize],
    ]
    const currentHoles = node?.holes || []
    const currentMetadata = currentHoles.map(
      (_, index) => node?.holeMetadata?.[index] ?? { source: 'manual' as const },
    )
    handleUpdate({
      holes: [...currentHoles, newHole],
      holeMetadata: [...currentMetadata, { source: 'manual' }],
    })
    useInteractionScope
      .getState()
      .begin(holeEditScope({ nodeId: selectedId, holeIndex: currentHoles.length }))
  }, [node, selectedId, handleUpdate])

  const handleEditHole = useCallback(
    (index: number) => {
      if (!selectedId) return
      useInteractionScope.getState().begin(holeEditScope({ nodeId: selectedId, holeIndex: index }))
    },
    [selectedId],
  )

  const handleDeleteHole = useCallback(
    (index: number) => {
      if (!selectedId) return
      const currentHoles = node?.holes || []
      if ((node?.holeMetadata?.[index]?.source ?? 'manual') !== 'manual') return
      const newHoles = currentHoles.filter((_, i) => i !== index)
      const currentMetadata = currentHoles.map(
        (_, metadataIndex) => node?.holeMetadata?.[metadataIndex] ?? { source: 'manual' as const },
      )
      const newMetadata = currentMetadata.filter((_, i) => i !== index)
      handleUpdate({ holes: newHoles, holeMetadata: newMetadata })
      if (editingHole?.nodeId === selectedId && editingHole?.holeIndex === index) {
        useInteractionScope
          .getState()
          .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'hole')
      }
    },
    [selectedId, node?.holes, node?.holeMetadata, handleUpdate, editingHole],
  )

  const handleMove = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  if (!(node && node.type === 'ceiling' && selectedId)) return null

  const calculateArea = (polygon: Array<[number, number]>): number => {
    if (polygon.length < 3) return 0
    let area = 0
    const n = polygon.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const current = polygon[i]!
      const next = polygon[j]!
      area += current[0] * next[1]
      area -= next[0] * current[1]
    }
    return Math.abs(area) / 2
  }

  const area = calculateArea(node.polygon)

  return (
    <PanelWrapper
      icon="/icons/ceiling.webp"
      onClose={handleClose}
      title={node.name || '천장'}
      width={320}
    >
      <PanelSection title="높이">
        <SliderControl
          label="높이"
          max={6}
          min={0}
          onChange={(v) => handleUpdate({ height: v })}
          precision={3}
          step={0.01}
          unit="m"
          value={Math.round(node.height * 1000) / 1000}
        />

        <div className="mt-2 grid grid-cols-3 gap-1.5 px-1 pb-1">
          <ActionButton label="낮게 (2.4m)" onClick={() => handleUpdate({ height: 2.4 })} />
          <ActionButton label="표준 (2.5m)" onClick={() => handleUpdate({ height: 2.5 })} />
          <ActionButton label="높게 (3.0m)" onClick={() => handleUpdate({ height: 3.0 })} />
        </div>
      </PanelSection>

      <PanelSection title="정보">
        <div className="flex items-center justify-between px-2 py-1 text-muted-foreground text-sm">
          <span>면적</span>
          <span className="font-mono text-foreground">{area.toFixed(2)} m²</span>
        </div>
      </PanelSection>

      <PanelSection title="구멍">
        {node.holes && node.holes.length > 0 ? (
          <div className="flex flex-col gap-1 pb-2">
            {node.holes.map((hole, index) => {
              const holeArea = calculateArea(hole)
              const isEditing =
                editingHole?.nodeId === selectedId && editingHole?.holeIndex === index
              const source = node.holeMetadata?.[index]?.source ?? 'manual'
              const isAutoHole = source !== 'manual'
              const autoLabel = source === 'elevator' ? '엘리베이터 자동 개구' : '계단 자동 개구'
              return (
                <div
                  className={`flex items-center justify-between rounded-lg border p-2 transition-colors ${
                    isEditing
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-transparent hover:bg-accent/30'
                  }`}
                  key={index}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`font-medium text-xs ${isEditing ? 'text-primary' : 'text-foreground'}`}
                    >
                      Hole {index + 1} {isEditing && '(Editing)'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {holeArea.toFixed(2)} m² · {hole.length} pts ·{' '}
                      {isAutoHole ? autoLabel : '직접 추가'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <ActionButton
                        className="h-7 bg-primary text-primary-foreground hover:bg-primary/90"
                        label="완료"
                        onClick={() =>
                          useInteractionScope
                            .getState()
                            .endIf(
                              (scope) => scope.kind === 'reshaping' && scope.reshape === 'hole',
                            )
                        }
                      />
                    ) : isAutoHole ? (
                      <div className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                        Auto
                      </div>
                    ) : (
                      <>
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                          onClick={() => handleEditHole(index)}
                          type="button"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300"
                          onClick={() => handleDeleteHole(index)}
                          type="button"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-2 py-3 text-center text-muted-foreground text-xs">구멍 없음</div>
        )}

        <div className="px-1 pt-1 pb-1">
          <ActionButton
            className="w-full"
            disabled={editingHole?.nodeId === selectedId}
            icon={<Plus className="h-3.5 w-3.5" />}
            label="구멍 추가"
            onClick={handleAddHole}
          />
        </div>
      </PanelSection>

      <ActionGroup>
        <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="이동" onClick={handleMove} />
      </ActionGroup>
    </PanelWrapper>
  )
}

export default CeilingPanel
