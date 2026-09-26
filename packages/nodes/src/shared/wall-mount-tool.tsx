'use client'

import { type AnyNode, emitter, type GridEvent, useScene } from '@pascal-app/core'
import { triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { attachToWall, collectPlacementContext } from '../cabinet/placement'
import {
  type FloorPlacementClickTriggerEvent,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from './floor-placement'
import { LevelOffsetGroup } from './level-offset-group'

export type WallMount = { position: [number, number, number]; rotationY: number }

/**
 * Placement tool for wall-mounted devices (switches, panels): the cursor
 * snaps the device's back onto the nearest wall face, facing the room, at
 * `heightM`. `build` turns the mount into the node to create.
 */
export function WallMountTool({
  widthM,
  depthM,
  heightM,
  build,
  preview,
}: {
  widthM: number
  depthM: number
  heightM: number
  build: (mount: WallMount) => AnyNode
  preview: (mount: WallMount) => React.ReactNode
}) {
  const levelId = useViewer((s) => s.selection.levelId)
  const [mount, setMount] = useState<WallMount | null>(null)
  const mountRef = useRef<WallMount | null>(null)

  useEffect(() => {
    if (!levelId) return
    const resolve = (x: number, z: number): WallMount | null => {
      const { walls } = collectPlacementContext(useScene.getState().nodes, levelId)
      const a = attachToWall({
        point: [x, z],
        footprint: { widthM, depthM },
        walls,
        neighbours: [],
      })
      return a
        ? { position: [a.position[0], heightM, a.position[1]], rotationY: a.rotationY }
        : null
    }
    const onMove = (event: GridEvent) => {
      const next = resolve(event.localPosition[0], event.localPosition[2])
      mountRef.current = next
      setMount(next)
    }
    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      const m = mountRef.current
      if (!m) return
      const node = build(m)
      useScene.getState().createNode(node, levelId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      stopPlacementCommitPropagation(event)
      triggerSFX('sfx:item-place')
      useEditor.getState().setMode('select')
      useEditor.getState().setTool(null)
    }
    emitter.on('grid:move', onMove)
    const unsubscribe = subscribeFloorPlacementClicks(onClick)
    return () => {
      emitter.off('grid:move', onMove)
      unsubscribe()
    }
  }, [levelId, widthM, depthM, heightM, build])

  if (!(levelId && mount)) return null
  return (
    <LevelOffsetGroup>
      <group position={mount.position} rotation={[0, mount.rotationY, 0]}>
        {preview(mount)}
      </group>
    </LevelOffsetGroup>
  )
}
