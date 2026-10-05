'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  EDITOR_LAYER,
  isGridSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
  usePlacementPreview,
} from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { Route } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, type Group, Line, LineBasicMaterial, Vector3 } from 'three'
import {
  type FloorPlacementClickTriggerEvent,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { NPC_ROLE_COLORS } from './presets'
import type { NpcNode } from './schema'

/** `NpcBehavior.patrol`'s cap. */
export const NPC_PATROL_MAX_POINTS = 32

/**
 * Arms the NPC tool to draw `nodeId`'s patrol path. It rides on the `npc`
 * build tool, so the floor plan forwards its grid events like any registry
 * tool's and the same code draws in 2D and 3D.
 */
export function startNpcPatrolDrawing(nodeId: string) {
  const editor = useEditor.getState()
  editor.setToolDefaults('npc', { patrolFor: nodeId })
  editor.setTool('npc')
  editor.setMode('build')
}

/** Back to select mode, the NPC still selected; each point was saved as it was drawn. */
export function finishNpcPatrolDrawing() {
  const editor = useEditor.getState()
  editor.setToolDefaults('npc', null)
  editor.setMode('select')
}

export function useNpcPatrolDrawing(nodeId: string): boolean {
  return useEditor(
    (s) =>
      s.mode === 'build' &&
      s.tool === 'npc' &&
      (s.toolDefaults.npc as { patrolFor?: unknown } | undefined)?.patrolFor === nodeId,
  )
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

/**
 * Draws an NPC's patrol path: a click appends a point (and makes the NPC a
 * patroller), Backspace takes the last one back, Enter or Esc finishes. Each
 * point is written as it is placed, so the inspector's list and the selected
 * NPC's plan / 3D path follow along; this tool only draws the rubber band from
 * the last point to the cursor.
 */
export default function NpcPatrolTool({ node }: { node: NpcNode }) {
  const cursorRef = useRef<Group>(null)
  const [visible, setVisible] = useState(false)
  // drei's Html ignores its parent's visibility, and the plan hides the 3D cursor.
  const floorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const color = NPC_ROLE_COLORS[node.role]
  const count = node.behavior.patrol.length

  const band = useMemo(() => {
    const line = new Line(
      new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }),
    )
    line.layers.set(EDITOR_LAYER)
    line.renderOrder = 2
    line.frustumCulled = false
    line.visible = false
    return line
  }, [color])
  useEffect(
    () => () => {
      band.geometry.dispose()
      band.material.dispose()
    },
    [band],
  )

  useEffect(() => {
    const npcId = node.id as AnyNodeId
    let cursor: [number, number] | null = null
    let floorY = 0

    const behaviorOf = () =>
      (useScene.getState().nodes[npcId] as unknown as NpcNode | undefined)?.behavior
    const writePatrol = (patrol: [number, number][]) => {
      const behavior = behaviorOf()
      if (!behavior) return
      useScene.getState().updateNode(npcId, {
        behavior: { ...behavior, mode: 'patrol', patrol },
      } as Partial<AnyNode>)
    }

    const draw = () => {
      if (!cursor) return
      const last = behaviorOf()?.patrol.at(-1)
      cursorRef.current?.position.set(cursor[0], floorY, cursor[1])
      band.visible = !!last
      if (last) {
        band.geometry.setFromPoints([
          new Vector3(last[0], floorY + 0.02, last[1]),
          new Vector3(cursor[0], floorY + 0.02, cursor[1]),
        ])
      }
      usePlacementPreview.getState().setGeometry({
        kind: 'group',
        children: [
          ...(last
            ? [
                {
                  kind: 'line' as const,
                  x1: last[0],
                  y1: last[1],
                  x2: cursor[0],
                  y2: cursor[1],
                  stroke: color,
                  strokeWidth: 2,
                  strokeDasharray: '6 4',
                  vectorEffect: 'non-scaling-stroke' as const,
                },
              ]
            : []),
          { kind: 'circle', cx: cursor[0], cy: cursor[1], r: 0.12, fill: color },
        ],
      })
    }

    const onMove = (event: GridEvent) => {
      const raw: [number, number] = [event.localPosition[0], event.localPosition[2]]
      const [x, z] = isGridSnapActive()
        ? snapPointToGrid(raw, useEditor.getState().gridSnapStep)
        : raw
      if (!cursor || cursor[0] !== x || cursor[1] !== z) triggerSFX('sfx:grid-snap')
      cursor = [x, z]
      floorY = event.localPosition[1]
      setVisible(true)
      draw()
    }

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      stopPlacementCommitPropagation(event)
      const behavior = behaviorOf()
      if (!(behavior && cursor) || behavior.patrol.length >= NPC_PATROL_MAX_POINTS) return
      writePatrol([...behavior.patrol, cursor])
      triggerSFX('sfx:structure-build-start')
      draw()
    }

    // Window capture runs before the editor's shortcuts, which would delete
    // the selected NPC on Backspace.
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      if (event.key === 'Backspace') {
        event.preventDefault()
        event.stopPropagation()
        const patrol = behaviorOf()?.patrol
        if (!patrol?.length) return
        writePatrol(patrol.slice(0, -1))
        triggerSFX('sfx:item-delete')
        draw()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        finishNpcPatrolDrawing()
      }
    }

    // Esc finishes too, and keeps the NPC selected (the editor's Esc would clear it).
    const onCancel = () => {
      markToolCancelConsumed()
      finishNpcPatrolDrawing()
    }

    emitter.on('grid:move', onMove)
    const unsubscribeClicks = subscribeFloorPlacementClicks(onClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    return () => {
      emitter.off('grid:move', onMove)
      unsubscribeClicks()
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      usePlacementPreview.getState().clear()
    }
  }, [node.id, band, color])

  return (
    <group>
      <group ref={cursorRef} visible={visible}>
        <CursorSphere
          color={color}
          height={1.2}
          tooltipContent={<Route className="size-5 text-white" />}
        />
        {visible && !floorplanHovered && (
          <Html
            center
            position={[0, 1.85, 0]}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
            zIndexRange={[100, 0]}
          >
            <div className="whitespace-nowrap rounded-full bg-black/70 px-3 py-1 text-white text-xs tabular-nums">
              순찰 지점 {count}/{NPC_PATROL_MAX_POINTS} · Backspace 되돌리기 · Enter 끝내기
            </div>
          </Html>
        )}
      </group>
      <primitive object={band} />
    </group>
  )
}
