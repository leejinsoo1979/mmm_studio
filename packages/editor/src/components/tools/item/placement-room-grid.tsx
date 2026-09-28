import {
  type AnyNodeId,
  pointInPolygon,
  type SlabNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { GRID_LAYER, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Mesh, Path, Shape, ShapeGeometry, Vector2 } from 'three'
import { getPlacementSurface } from '../../../lib/active-placement-surface'
import useEditor from '../../../store/use-editor'
import { createRoomGridMaterial } from '../shared/placement-ghost-materials'

const NO_RAYCAST = () => null
const GRID_LIFT = 0.003

function findSlabAt(levelId: string, x: number, z: number): SlabNode | null {
  const nodes = useScene.getState().nodes
  const level = nodes[levelId as AnyNodeId]
  if (!level || !('children' in level)) return null
  let best: SlabNode | null = null
  for (const childId of level.children as string[]) {
    const child = nodes[childId as AnyNodeId]
    if (child?.type !== 'slab') continue
    const slab = child as SlabNode
    if (slab.polygon.length < 3 || !pointInPolygon(x, z, slab.polygon)) continue
    if ((slab.holes ?? []).some((hole) => hole.length >= 3 && pointInPolygon(x, z, hole))) continue
    if (!best || (slab.elevation ?? 0.05) > (best.elevation ?? 0.05)) best = slab
  }
  return best
}

/**
 * inZOI: while a floor item is held, the floor of the room under it shows a
 * thin white grid clipped to that room; other rooms and the bare lot show
 * none. The room is the level slab containing the ghost. Mounted in the
 * building-local tool group, next to the placement cursor.
 */
export function PlacementRoomGrid({ isActive }: { isActive: () => boolean }) {
  const [slabId, setSlabId] = useState<string | null>(null)
  const slabIdRef = useRef<string | null>(null)
  const meshRef = useRef<Mesh>(null)
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  const slab = useScene((s) =>
    slabId ? ((s.nodes[slabId as AnyNodeId] as SlabNode | undefined) ?? null) : null,
  )

  const material = useMemo(() => createRoomGridMaterial(), [])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => material.setStep(Math.max(gridSnapStep, 0.25)), [material, gridSnapStep])

  const geometry = useMemo(() => {
    if (!slab || slab.polygon.length < 3) return null
    // Shape XY = plan (x, -z); rotating -90° about X lays it flat on XZ.
    const shape = new Shape(slab.polygon.map(([x, z]) => new Vector2(x, -z)))
    for (const hole of slab.holes ?? []) {
      if (hole.length >= 3) shape.holes.push(new Path(hole.map(([x, z]) => new Vector2(x, -z))))
    }
    const next = new ShapeGeometry(shape)
    next.rotateX(-Math.PI / 2)
    return next
  }, [slab])
  useEffect(() => () => geometry?.dispose(), [geometry])

  useFrame(() => {
    const surface = getPlacementSurface()
    const levelId = useViewer.getState().selection.levelId
    const found =
      levelId && surface && isActive()
        ? findSlabAt(levelId, surface.point.x, surface.point.z)
        : null
    const nextId = found?.id ?? null
    if (nextId !== slabIdRef.current) {
      slabIdRef.current = nextId
      setSlabId(nextId)
    }
    const mesh = meshRef.current
    if (mesh && found && levelId) {
      const levelY = sceneRegistry.nodes.get(levelId)?.position.y ?? 0
      mesh.position.y = levelY + (found.elevation ?? 0.05) + GRID_LIFT
    }
  })

  if (!geometry) return null
  return (
    <mesh
      geometry={geometry}
      layers={GRID_LAYER}
      material={material}
      raycast={NO_RAYCAST}
      ref={meshRef}
      renderOrder={995}
    />
  )
}
