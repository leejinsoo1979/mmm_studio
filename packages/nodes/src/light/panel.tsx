'use client'

import { type AnyNode, type LightNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Move, Trash2 } from 'lucide-react'

type TupleIndex = 0 | 1 | 2
const AXES = ['x', 'y', 'z'] as const

function tupleValue(tuple: readonly [number, number, number], index: TupleIndex): number {
  return tuple[index]
}

export default function LightPanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const node = useScene((state) =>
    selectedId ? (state.nodes[selectedId as AnyNode['id']] as LightNode | undefined) : undefined,
  )
  const updateNode = useScene((state) => state.updateNode)
  const deleteNode = useScene((state) => state.deleteNode)
  const setMovingNode = useEditor((state) => state.setMovingNode)

  if (!(selectedId && node?.type === 'light')) return null
  const update = (patch: Partial<LightNode>) => updateNode(node.id, patch)

  return (
    <PanelWrapper
      icon="/icons/building.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title={`${node.kind[0]?.toUpperCase()}${node.kind.slice(1)} Light`}
      width={300}
    >
      <PanelSection title="Light">
        <label className="flex items-center justify-between gap-3 py-1 text-sm">
          <span>Type</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            onChange={(event) => update({ kind: event.target.value as LightNode['kind'] })}
            value={node.kind}
          >
            <option value="point">Point</option>
            <option value="spot">Spot</option>
            <option value="area">Area</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 py-1 text-sm">
          <span>Enabled</span>
          <input
            checked={node.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
            type="checkbox"
          />
        </label>
        <label className="flex items-center justify-between gap-3 py-1 text-sm">
          <span>Color</span>
          <input
            className="h-8 w-12 rounded border border-border bg-transparent"
            onChange={(event) => update({ color: event.target.value })}
            type="color"
            value={node.color}
          />
        </label>
        <SliderControl
          label="Intensity"
          max={30}
          min={0}
          onChange={(value) => update({ intensity: value })}
          precision={1}
          step={0.1}
          value={node.intensity}
        />
        {node.kind !== 'area' && (
          <>
            <SliderControl
              label="Range"
              max={30}
              min={0}
              onChange={(value) => update({ distance: value })}
              precision={1}
              step={0.1}
              unit="m"
              value={node.distance}
            />
            <SliderControl
              label="Decay"
              max={4}
              min={0}
              onChange={(value) => update({ decay: value })}
              precision={1}
              step={0.1}
              value={node.decay}
            />
          </>
        )}
        {node.kind === 'spot' && (
          <>
            <SliderControl
              label="Cone"
              max={90}
              min={3}
              onChange={(value) => update({ angle: (value * Math.PI) / 180 })}
              precision={0}
              step={1}
              unit="°"
              value={(node.angle * 180) / Math.PI}
            />
            <SliderControl
              label="Softness"
              max={1}
              min={0}
              onChange={(value) => update({ penumbra: value })}
              precision={2}
              step={0.01}
              value={node.penumbra}
            />
          </>
        )}
        {node.kind === 'area' && (
          <>
            <SliderControl
              label="Width"
              max={10}
              min={0.05}
              onChange={(value) => update({ width: value })}
              precision={2}
              step={0.05}
              unit="m"
              value={node.width}
            />
            <SliderControl
              label="Height"
              max={10}
              min={0.05}
              onChange={(value) => update({ height: value })}
              precision={2}
              step={0.05}
              unit="m"
              value={node.height}
            />
          </>
        )}
        {node.kind !== 'area' && (
          <label className="flex items-center justify-between gap-3 py-1 text-sm">
            <span>Cast shadow</span>
            <input
              checked={node.castShadow}
              onChange={(event) => update({ castShadow: event.target.checked })}
              type="checkbox"
            />
          </label>
        )}
      </PanelSection>

      <PanelSection title="Position">
        {AXES.map((axis, index) => {
          const tupleIndex = index as TupleIndex
          const value = tupleValue(node.position, tupleIndex)
          return (
            <SliderControl
              key={axis}
              label={axis.toUpperCase()}
              max={value + 5}
              min={value - 5}
              onChange={(nextValue) => {
                const position = [...node.position] as LightNode['position']
                position[tupleIndex] = nextValue
                update({ position })
              }}
              precision={2}
              step={0.05}
              unit="m"
              value={value}
            />
          )
        })}
      </PanelSection>

      {node.kind !== 'point' && (
        <PanelSection title="Direction">
          {AXES.map((axis, index) => {
            const tupleIndex = index as TupleIndex
            const value = tupleValue(node.rotation, tupleIndex)
            return (
              <SliderControl
                key={axis}
                label={`${axis.toUpperCase()} rotation`}
                max={180}
                min={-180}
                onChange={(nextValue) => {
                  const rotation = [...node.rotation] as LightNode['rotation']
                  rotation[tupleIndex] = (nextValue * Math.PI) / 180
                  update({ rotation })
                }}
                precision={0}
                step={1}
                unit="°"
                value={(value * 180) / Math.PI}
              />
            )
          })}
        </PanelSection>
      )}

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-4 w-4" />}
            label="Move"
            onClick={() => {
              triggerSFX('sfx:item-pick')
              setMovingNode(node)
              setSelection({ selectedIds: [] })
            }}
          />
          <ActionButton
            className="border-red-500/40 text-red-200"
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={() => {
              deleteNode(node.id)
              setSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
