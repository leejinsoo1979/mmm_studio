'use client'

import { emitter, type GridEvent, LightNode, useScene } from '@pascal-app/core'
import { CursorSphere, isGridSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { forwardRef, useEffect, useRef } from 'react'
import { DoubleSide, type Group } from 'three'
import {
  type FloorPlacementClickTriggerEvent,
  getLevelLocalSnappedPosition,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'

type LightToolDefaults = { kind?: LightNode['kind']; height?: number }

const DEFAULT_LIGHT_PROPS: Record<
  LightNode['kind'],
  Pick<LightNode, 'decay' | 'distance' | 'intensity'>
> = {
  point: { decay: 1.25, distance: 18, intensity: 90 },
  spot: { decay: 1.15, distance: 22, intensity: 140 },
  area: { decay: 1, distance: 0, intensity: 180 },
}

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
      cursorRef.current?.position.set(x, 0, z)
    }

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      const fallback = getLevelLocalSnappedPosition(
        levelId,
        event,
        useEditor.getState().gridSnapStep,
        !isGridSnapActive(),
      )
      const position = lastPosition ?? [fallback[0], placementHeight, fallback[2]]
      const lightProps = DEFAULT_LIGHT_PROPS[kind]
      const light = LightNode.parse({
        name: `${kind[0]?.toUpperCase()}${kind.slice(1)} Light`,
        kind,
        position,
        rotation: kind === 'area' ? [-Math.PI / 2, 0, 0] : [0, 0, 0],
        intensity: lightProps.intensity,
        distance: lightProps.distance,
        decay: lightProps.decay,
        castShadow: kind !== 'area',
      })
      useScene.getState().createNode(light, levelId)
      useViewer.getState().setSelection({ selectedIds: [light.id] })
      stopPlacementCommitPropagation(event)
      triggerSFX('sfx:structure-build')
      useEditor.getState().setMode('select')
      useEditor.getState().setTool(null)
    }

    emitter.on('grid:move', onMove)
    const unsubscribeClicks = subscribeFloorPlacementClicks(onClick)
    return () => {
      emitter.off('grid:move', onMove)
      unsubscribeClicks()
    }
  }, [levelId])

  if (!levelId) return null
  return <LightPlacementPreview ref={cursorRef} />
}

const LightPlacementPreview = forwardRef<Group>(function LightPlacementPreview(_, ref) {
  const defaults = useEditor((state) => state.toolDefaults.light ?? {}) as LightToolDefaults
  const kind = defaults.kind ?? 'point'
  const placementHeight = defaults.height ?? (kind === 'area' ? 2.2 : 2.4)

  return (
    <group ref={ref}>
      <CursorSphere color="#ffd88a" dotAtTip height={placementHeight} showTooltip={false} />
      <group position={[0, placementHeight, 0]}>
        <mesh>
          <sphereGeometry args={[0.16, 24, 16]} />
          <meshBasicMaterial color="#fff1d6" toneMapped={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.34, 32, 20]} />
          <meshBasicMaterial color="#ffd88a" opacity={0.16} toneMapped={false} transparent />
        </mesh>
        {kind === 'spot' && (
          <mesh position={[0, -0.34, 0]} rotation={[0, 0, Math.PI]}>
            <coneGeometry args={[0.28, 0.65, 28, 1, true]} />
            <meshBasicMaterial color="#ffd88a" opacity={0.2} toneMapped={false} transparent />
          </mesh>
        )}
        {kind === 'area' && (
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.2, 0.6]} />
            <meshBasicMaterial
              color="#fff1d6"
              opacity={0.42}
              side={DoubleSide}
              toneMapped={false}
              transparent
            />
          </mesh>
        )}
      </group>
    </group>
  )
})

export default LightTool
