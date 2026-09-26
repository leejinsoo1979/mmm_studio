'use client'

import {
  type AnyNode,
  deviceTerminals,
  emitter,
  type GridEvent,
  useScene,
  WireNode,
} from '@pascal-app/core'
import { EDITOR_LAYER, markToolCancelConsumed, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { ceilingHeightAt } from '../shared/ceiling-height'
import { LevelOffsetGroup } from '../shared/level-offset-group'

const PICK_RADIUS = 0.25
const COLOR = '#f08c00'

type Pick = { nodeId: string; terminal: string; point: [number, number]; y: number }

/** Terminals of the lights, switches and panels on a level. */
function levelTerminals(nodes: Readonly<Record<string, AnyNode>>, levelId: string): Pick[] {
  const out: Pick[] = []
  for (const n of Object.values(nodes)) {
    if (!n || n.parentId !== levelId) continue
    if (n.type !== 'light' && n.type !== 'light-switch' && n.type !== 'electric-panel') continue
    const y = (n as { position: number[] }).position[1] as number
    for (const t of deviceTerminals(n))
      out.push({ nodeId: n.id, terminal: t.terminal, point: t.point, y })
  }
  return out
}

function nearest(list: Pick[], x: number, z: number, skip?: Pick | null): Pick | null {
  let best: Pick | null = null
  let bestD = PICK_RADIUS
  for (const p of list) {
    if (skip && p.nodeId === skip.nodeId && p.terminal === skip.terminal) continue
    const d = Math.hypot(p.point[0] - x, p.point[1] - z)
    if (d < bestD) {
      best = p
      bestD = d
    }
  }
  return best
}

/**
 * 배선: click a terminal (panel circuit, switch L / gang, light), then the
 * terminal to join it to. Esc drops the first pick.
 */
export default function WireTool() {
  const levelId = useViewer((s) => s.selection.levelId)
  const [start, setStart] = useState<Pick | null>(null)
  const [hover, setHover] = useState<Pick | null>(null)
  const startRef = useRef<Pick | null>(null)

  useEffect(() => {
    if (!levelId) return
    const onMove = (event: GridEvent) => {
      const list = levelTerminals(useScene.getState().nodes, levelId)
      setHover(nearest(list, event.localPosition[0], event.localPosition[2], startRef.current))
    }
    const onClick = (event: GridEvent) => {
      const nodes = useScene.getState().nodes
      const pick = nearest(
        levelTerminals(nodes, levelId),
        event.localPosition[0],
        event.localPosition[2],
        startRef.current,
      )
      if (!pick) return
      const first = startRef.current
      if (!first) {
        startRef.current = pick
        setStart(pick)
        // Highlights the device on the plan until the wire is finished.
        useViewer.getState().setSelection({ selectedIds: [pick.nodeId] })
        triggerSFX('sfx:grid-snap')
        return
      }
      const mid: [number, number] = [
        (first.point[0] + pick.point[0]) / 2,
        (first.point[1] + pick.point[1]) / 2,
      ]
      const ceiling = ceilingHeightAt(nodes, levelId, mid[0], mid[1])
      const wire = WireNode.parse({
        name: '배선',
        path: [first.point, pick.point],
        height: ceiling !== null ? ceiling - 0.05 : 2.4,
        from: { nodeId: first.nodeId, terminal: first.terminal },
        to: { nodeId: pick.nodeId, terminal: pick.terminal },
      })
      useScene.getState().createNode(wire, levelId)
      triggerSFX('sfx:item-place')
      startRef.current = null
      setStart(null)
      useViewer.getState().setSelection({ selectedIds: [] })
    }
    const onCancel = () => {
      if (!startRef.current) return
      markToolCancelConsumed()
      startRef.current = null
      setStart(null)
      useViewer.getState().setSelection({ selectedIds: [] })
    }
    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('tool:cancel', onCancel)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [levelId])

  if (!levelId) return null
  const marker = (p: Pick, r: number) => (
    <mesh layers={EDITOR_LAYER} position={[p.point[0], p.y, p.point[1]]}>
      <sphereGeometry args={[r, 20, 14]} />
      <meshBasicMaterial color={COLOR} depthTest={false} opacity={0.6} transparent />
    </mesh>
  )
  return (
    <LevelOffsetGroup>
      {start && marker(start, 0.07)}
      {hover && marker(hover, 0.05)}
    </LevelOffsetGroup>
  )
}
