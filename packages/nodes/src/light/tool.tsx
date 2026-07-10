'use client'

import { emitter, type GridEvent, LightNode, useScene } from '@pascal-app/core'
import { CursorSphere, isGridSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import type { Group } from 'three'

type LightToolDefaults = { kind?: LightNode['kind']; height?: number }

const LightTool = () => {
  const levelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)

  useEffect(() => {
    if (!levelId) return
    let lastPosition: [number, number, number] | null = null

    const defaults = (useEditor.getState().toolDefaults.light ?? {}) as LightToolDefaults
    const kind = defaults.kind ?? 'point'
    const placementHeight = defaults.height ?? (kind === 'area' ? 2.2 : 2.4)

    const onMove = (event: GridEvent) => {
      const step = useEditor.getState().gridSnapStep
      const x = isGridSnapActive()
        ? Math.round(event.localPosition[0] / step) * step
        : event.localPosition[0]
      const z = isGridSnapActive()
        ? Math.round(event.localPosition[2] / step) * step
        : event.localPosition[2]
      lastPosition = [x, placementHeight, z]
      cursorRef.current?.position.set(x, placementHeight, z)
    }

    const onClick = (event: GridEvent) => {
      const position = lastPosition ?? [
        event.localPosition[0],
        placementHeight,
        event.localPosition[2],
      ]
      const light = LightNode.parse({
        name: `${kind[0]?.toUpperCase()}${kind.slice(1)} Light`,
        kind,
        position,
        rotation: kind === 'area' ? [-Math.PI / 2, 0, 0] : [0, 0, 0],
        intensity: kind === 'area' ? 6 : 4,
      })
      useScene.getState().createNode(light, levelId)
      useViewer.getState().setSelection({ selectedIds: [light.id] })
      triggerSFX('sfx:structure-build')
      useEditor.getState().setMode('select')
      useEditor.getState().setTool(null)
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
    }
  }, [levelId])

  if (!levelId) return null
  return <CursorSphere color="#ffd88a" height={0.25} ref={cursorRef} />
}

export default LightTool
