'use client'

import { type AnyNode, type AnyNodeId, emitter, type GridEvent, useScene } from '@pascal-app/core'
import {
  isGridSnapActive,
  triggerSFX,
  useEditor,
  useFacingPose,
  usePlacementPreview,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import {
  type FloorPlacementClickTriggerEvent,
  getLevelLocalSnappedPosition,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { COUNTERTOP_DEPTH_MM } from './engine/rules'
import { attachToWall, collectPlacementContext } from './placement'
import { CabinetPreview } from './preview'
import { type CabinetNode, CountertopNode } from './schema'
import { cabinetFromBrush, useCabinetBrush } from './store'

type Pose = { position: [number, number, number]; rotationY: number; wallId: string | null }

/**
 * Shared placement loop for cabinets and countertops: on `grid:move` the
 * footprint attaches to the nearest wall (back to the wall face, front into
 * the room, butting up to neighbours) or follows the grid when no wall is
 * near; `grid:click` (or a click on a wall / cabinet) commits at the last
 * resolved pose. Works from both the 3D view and the 2D plan, which re-emits
 * grid events to registry tools.
 */
export function useWallPlacement(args: {
  levelId: string | null
  footprintM: () => { widthM: number; depthM: number; elevationM: number }
  facingDepthM: number
  preview: (pose: Pose) => AnyNode
  onCommit: (pose: Pose) => void
}) {
  const cursorRef = useRef<Group>(null)
  const [visible, setVisible] = useState(false)
  const argsRef = useRef(args)
  argsRef.current = args
  const { levelId } = args

  useEffect(() => {
    if (!levelId) return
    setVisible(false)
    let last: Pose | null = null
    let lastKey = ''

    const resolve = (x: number, z: number): Pose => {
      const { widthM, depthM, elevationM } = argsRef.current.footprintM()
      const context = collectPlacementContext(useScene.getState().nodes, levelId)
      const attach = attachToWall({
        point: [x, z],
        footprint: { widthM, depthM },
        walls: context.walls,
        neighbours: context.neighbours,
      })
      if (attach) {
        return {
          position: [attach.position[0], elevationM, attach.position[1]],
          rotationY: attach.rotationY,
          wallId: attach.wallId,
        }
      }
      const step = useEditor.getState().gridSnapStep
      const snap = (v: number) => (isGridSnapActive() ? Math.round(v / step) * step : v)
      return {
        position: [snap(x), elevationM, snap(z)],
        rotationY: useCabinetBrush.getState().freeRotationY,
        wallId: null,
      }
    }

    const show = (pose: Pose) => {
      cursorRef.current?.position.set(...pose.position)
      if (cursorRef.current) cursorRef.current.rotation.y = pose.rotationY
      useFacingPose.getState().set({
        position: pose.position,
        rotationY: pose.rotationY,
        depth: argsRef.current.facingDepthM,
      })
      usePlacementPreview.getState().set(argsRef.current.preview(pose))
      const key = `${pose.position[0].toFixed(3)},${pose.position[2].toFixed(3)},${pose.rotationY.toFixed(3)}`
      if (key !== lastKey) {
        triggerSFX('sfx:grid-snap')
        lastKey = key
      }
    }

    const onMove = (event: GridEvent) => {
      setVisible(true)
      last = resolve(event.localPosition[0], event.localPosition[2])
      show(last)
    }

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      const pose =
        last ??
        (() => {
          const p = getLevelLocalSnappedPosition(
            levelId,
            event,
            useEditor.getState().gridSnapStep,
            true,
          )
          return resolve(p[0], p[2])
        })()
      argsRef.current.onCommit(pose)
      triggerSFX('sfx:item-place')
      if (useEditor.getState().getContinuation('point') !== 'repeat') {
        setVisible(false)
        usePlacementPreview.getState().clear()
        useFacingPose.getState().clear()
        useEditor.getState().setTool(null)
      }
      stopPlacementCommitPropagation(event)
    }

    // `R` turns a free-standing cabinet by 90°; wall-attached ones follow the wall.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'r' && event.key !== 'R') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      useCabinetBrush.getState().rotateFree(Math.PI / 2)
      if (last && !last.wallId) {
        last = { ...last, rotationY: useCabinetBrush.getState().freeRotationY }
        show(last)
      }
    }

    emitter.on('grid:move', onMove)
    const unsubscribe = subscribeFloorPlacementClicks(onClick)
    const cabinetClick = onClick as never
    emitter.on('cabinet:click' as never, cabinetClick)
    emitter.on('countertop:click' as never, cabinetClick)
    window.addEventListener('keydown', onKey)
    return () => {
      emitter.off('grid:move', onMove)
      unsubscribe()
      emitter.off('cabinet:click' as never, cabinetClick)
      emitter.off('countertop:click' as never, cabinetClick)
      window.removeEventListener('keydown', onKey)
      usePlacementPreview.getState().clear()
      useFacingPose.getState().clear()
    }
  }, [levelId])

  return { cursorRef, visible }
}

/** Registry tool for `tool === 'cabinet'`: places the current brush. */
export default function CabinetTool() {
  const levelId = useViewer((s) => s.selection.levelId)
  const brush = useCabinetBrush((s) => s.brush)
  const { node: previewNode, elevationMm } = useMemo(() => cabinetFromBrush(brush), [brush])

  const { cursorRef, visible } = useWallPlacement({
    levelId,
    footprintM: () => ({
      widthM: previewNode.widthMm / 1000,
      depthM: previewNode.depthMm / 1000,
      elevationM: elevationMm / 1000,
    }),
    facingDepthM: previewNode.depthMm / 1000,
    preview: (pose) =>
      ({
        ...previewNode,
        position: pose.position,
        rotation: [0, pose.rotationY, 0],
      }) as unknown as AnyNode,
    onCommit: (pose) => {
      if (!levelId) return
      const { node } = cabinetFromBrush(useCabinetBrush.getState().brush)
      const placed: CabinetNode = {
        ...node,
        position: pose.position,
        rotation: [0, pose.rotationY, 0],
      }
      useScene.getState().createNode(placed as unknown as AnyNode, levelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [placed.id as AnyNodeId] })
    },
  })

  if (!levelId) return null
  return (
    <group ref={cursorRef} visible={visible}>
      <CabinetPreview node={previewNode} />
    </group>
  )
}

/** Default countertop for manual placement (the kitchen generator sizes its own). */
export function defaultCountertop(): CountertopNode {
  return CountertopNode.parse({
    name: '상판',
    lengthMm: 2400,
    depthMm: COUNTERTOP_DEPTH_MM,
    cutouts: [],
  })
}
