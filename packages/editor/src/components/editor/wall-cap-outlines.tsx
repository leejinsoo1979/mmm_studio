'use client'

import {
  type AnyNode,
  calculateLevelMiters,
  getWallPlanFootprint,
  getWallSurfacePolygon,
  isCurvedWall,
  sceneRegistry,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { GRID_LAYER, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  type Box3,
  BufferGeometry,
  type Group,
  type Material,
  type Mesh,
  type Object3D,
  Vector3,
} from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import useEditor from '../../store/use-editor'

// Height the viewer cuts a hidden (cutaway / down) wall to.
const CUTAWAY_STUB_HEIGHT = 0.3
const LIFT = 0.002
const topWork = new Vector3()

const outlineMaterial = new LineBasicNodeMaterial({
  color: '#f0f0f0',
  opacity: 0.9,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
})

// The viewer swaps a cut-down wall to its alpha-tested stub material.
function isCutDown(mesh: Mesh) {
  const material = mesh.material as Material | Material[] | undefined
  const first = Array.isArray(material) ? material[0] : material
  return (first?.alphaTest ?? 0) >= 0.5
}

/** World Y of the wall mesh's visible top (full height, or the cutaway stub). */
function wallTopWorldY(mesh: Mesh) {
  const geometry = mesh.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox as Box3
  // The stub material clips at local y = CUTAWAY_STUB_HEIGHT (positionLocal).
  const top = isCutDown(mesh) ? Math.min(CUTAWAY_STUB_HEIGHT, box.max.y) : box.max.y
  return mesh.localToWorld(topWork.set(0, top, 0)).y
}

/**
 * Thin white lines around each wall's top cap in build mode, so rooms read
 * from above as inZOI's outlined walls rather than dull dark bands.
 */
export function WallCapOutlines() {
  const active = useEditor((s) => s.mode === 'build')
  const levelId = useViewer((s) => s.selection.levelId)
  if (!(active && levelId)) return null
  return <LevelWallCapOutlines levelId={levelId} />
}

function LevelWallCapOutlines({ levelId }: { levelId: string }) {
  const groupRef = useRef<Group>(null)
  const lineRefs = useRef(new Map<string, Object3D>())

  // Shallow-compared, so edits to other nodes don't rebuild the outlines.
  const walls = useScene(
    useShallow((s) => {
      const nodes = s.nodes as Record<string, AnyNode>
      const level = nodes[levelId]
      if (level?.type !== 'level') return []
      return level.children
        .map((id) => nodes[id])
        .filter((node): node is WallNode => node?.type === 'wall' && node.visible !== false)
    }),
  )

  const outlines = useMemo(() => {
    const miters = calculateLevelMiters(walls)
    return walls.flatMap((wall) => {
      const loop = isCurvedWall(wall)
        ? getWallSurfacePolygon(wall, 64)
        : getWallPlanFootprint(wall, miters)
      if (loop.length < 3) return []
      const segments: Vector3[] = []
      loop.forEach((point, index) => {
        const next = loop[(index + 1) % loop.length]!
        segments.push(new Vector3(point.x, 0, point.y), new Vector3(next.x, 0, next.y))
      })
      return [
        {
          id: wall.id,
          geometry: new BufferGeometry().setFromPoints(segments),
        },
      ]
    })
  }, [walls])
  useEffect(
    () => () => {
      for (const outline of outlines) outline.geometry.dispose()
    },
    [outlines],
  )

  useFrame(() => {
    const group = groupRef.current
    const level = sceneRegistry.nodes.get(levelId)
    if (!(group && level)) return
    group.matrix.copy(level.matrixWorld)
    group.matrixWorldNeedsUpdate = true
    const levelY = level.getWorldPosition(topWork).y
    for (const outline of outlines) {
      const line = lineRefs.current.get(outline.id)
      const mesh = sceneRegistry.nodes.get(outline.id) as Mesh | undefined
      if (!line) continue
      line.visible = Boolean(mesh?.geometry && mesh.visible)
      if (mesh?.geometry) line.position.y = wallTopWorldY(mesh) - levelY + LIFT
    }
  })

  return (
    <group matrixAutoUpdate={false} ref={groupRef}>
      {outlines.map((outline) => (
        <lineSegments
          frustumCulled={false}
          geometry={outline.geometry}
          key={outline.id}
          // Scene pass: walls in front hide the outlines behind them.
          layers={GRID_LAYER}
          material={outlineMaterial}
          ref={(line) => {
            if (line) lineRefs.current.set(outline.id, line)
            else lineRefs.current.delete(outline.id)
          }}
          renderOrder={2}
        />
      ))}
    </group>
  )
}
