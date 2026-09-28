'use client'

import { type AnyNodeId, isCurvedWall, sceneRegistry, useScene } from '@pascal-app/core'
import { GRID_LAYER, useViewer } from '@pascal-app/viewer'
import { createPortal, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BoxGeometry,
  type BufferGeometry,
  EdgesGeometry,
  type Group,
  type Mesh,
  type Object3D,
  Vector3,
} from 'three'
import {
  abs,
  color,
  float,
  fract,
  fwidth,
  max,
  min,
  mix,
  normalLocal,
  positionLocal,
  uniform,
} from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import {
  useEndpointReshape,
  useIsCurveReshape,
  useMovingNode,
} from '../../store/use-interaction-scope'
import { useUiHidden } from '../../store/use-ui-hidden'
import { NO_RAYCAST } from './handles/handle-arrow'
import { PaintFaceOutlines } from './paint-face-outline'

// inZOI's selected wall: the wall's own finish seen through a pale cyan glass
// volume with a 1 m white lattice and bright white edges.
const WALL_GLASS_COLOR = '#8fdcf7'
const GLASS_OPACITY = 0.2
const GRID_OPACITY = 0.7
// Keeps the glass just proud of the wall faces so it never z-fights them.
const GLASS_PAD = 0.006

const UNIT_BOX = new BoxGeometry(1, 1, 1)
const UNIT_EDGES = new EdgesGeometry(UNIT_BOX)

const edgeMaterial = new LineBasicNodeMaterial({
  color: '#ffffff',
  opacity: 0.95,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
})

/**
 * Glass with a 1 m lattice computed per fragment in the wall's own frame
 * (metres from its start and floor), so a live height / length drag only
 * rescales the box. Lines along an axis are dropped on the faces that axis is
 * normal to (the top gets no horizontal rules, the end caps no verticals).
 */
function createGlassMaterial() {
  const size = uniform(new Vector3(1, 1, 1))
  const center = uniform(new Vector3())
  const meters = positionLocal.mul(size).add(center)
  const rule = (coord: typeof meters.x) =>
    float(1).sub(min(abs(fract(coord.add(0.5)).sub(0.5)).div(max(fwidth(coord), 1e-4)), 1))
  const grid = max(
    rule(meters.x).mul(float(1).sub(abs(normalLocal.x))),
    rule(meters.y).mul(float(1).sub(abs(normalLocal.y))),
  )
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  material.colorNode = mix(color(WALL_GLASS_COLOR), color('#ffffff'), grid)
  material.opacityNode = mix(float(GLASS_OPACITY), float(GRID_OPACITY), grid)
  return { material, size, center }
}

export function SelectedWallGlass() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const customizing = useUiHidden((s) => s.customizing)
  const movingNode = useMovingNode()
  const endpointReshape = useEndpointReshape()
  const isCurveReshape = useIsCurveReshape()
  const wallIds = useScene(
    useShallow((s) =>
      selectedIds.filter((id) => {
        const node = s.nodes[id as AnyNodeId]
        return node?.type === 'wall' && !isCurvedWall(node)
      }),
    ),
  )

  // The paint card judges the real finish: the glass gives way to a trace of
  // the face being painted.
  if (customizing) return <PaintFaceOutlines />
  if (movingNode || endpointReshape || isCurveReshape) return null

  return (
    <>
      {wallIds.map((id) => (
        <WallGlassPortal id={id as AnyNodeId} key={id} />
      ))}
    </>
  )
}

/**
 * Portalled into the wall mesh, so the glass rides its transform and
 * visibility and is part of the selected subtree: the outline's occluder
 * pass skips it (at the scene root it would hide the wall's own outline).
 */
function WallGlassPortal({ id }: { id: AnyNodeId }) {
  const [object, setObject] = useState<Object3D | null>(null)

  useFrame(() => {
    const next = sceneRegistry.nodes.get(id) ?? null
    if (next !== object) setObject(next)
  })

  if (!object) return null
  return createPortal(<WallGlass wall={object as Mesh} />, object)
}

function WallGlass({ wall }: { wall: Mesh }) {
  const groupRef = useRef<Group>(null)
  const glass = useMemo(createGlassMaterial, [])
  const measured = useRef<BufferGeometry | null>(null)
  useEffect(() => () => glass.material.dispose(), [glass])

  // The wall system swaps the mesh geometry on every rebuild (including live
  // drags), so re-measure only when the geometry object changes.
  useFrame(() => {
    const group = groupRef.current
    const geometry = wall.geometry
    if (!(group && geometry) || measured.current === geometry) return
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const bounds = geometry.boundingBox
    if (!bounds || bounds.isEmpty()) return
    measured.current = geometry
    bounds.getCenter(group.position)
    bounds.getSize(group.scale).addScalar(GLASS_PAD * 2)
    glass.size.value.copy(group.scale)
    glass.center.value.copy(group.position)
    group.visible = true
  })

  // Zero scale until measured: the action menu anchors on the wall subtree's
  // bounds, which an unmeasured unit box would skew. The group sits off the
  // scene layer too, so a GLB export drops it with its children.
  return (
    <group layers={GRID_LAYER} ref={groupRef} scale={0} visible={false}>
      <mesh
        geometry={UNIT_BOX}
        layers={GRID_LAYER}
        material={glass.material}
        raycast={NO_RAYCAST}
        renderOrder={1}
      />
      <lineSegments
        geometry={UNIT_EDGES}
        layers={GRID_LAYER}
        material={edgeMaterial}
        raycast={NO_RAYCAST}
        renderOrder={2}
      />
    </group>
  )
}
