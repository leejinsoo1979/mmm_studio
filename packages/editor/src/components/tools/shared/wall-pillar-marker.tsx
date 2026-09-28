'use client'

import { GRID_LAYER } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { color, float, mix, smoothstep, uv } from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'

const MIN_WIDTH = 0.12
const BODY_BOTTOM = '#2ad4e1'
const BODY_TOP = '#6d8fa8'
const EDGE_COLOR = '#7ff3ff'
const CAP_COLOR = '#eef6fb'
const HALO_COLOR = '#87cdd2'
const SEAM_HEIGHT = 0.6

const UNIT_BOX = new BoxGeometry(1, 1, 1)

// The body and edges render in the scene pass (GRID_LAYER) so walls hide them
// as in inZOI; the cap and halo stay in the overlay pass and ignore depth, so
// the vertex still reads when it is occluded.
const bodyMaterial = (() => {
  const t = smoothstep(0.3, 0.65, uv().y)
  return new MeshBasicNodeMaterial({
    colorNode: mix(color(BODY_BOTTOM), color(BODY_TOP), t),
    opacityNode: mix(float(0.9), float(0.5), t),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
})()
const edgeMaterial = new LineBasicNodeMaterial({
  color: EDGE_COLOR,
  opacity: 0.9,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
})
const seamMaterial = new LineBasicNodeMaterial({
  color: EDGE_COLOR,
  opacity: 0.35,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
})
const capMaterial = new MeshBasicNodeMaterial({
  color: CAP_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})
const haloMaterial = new MeshBasicNodeMaterial({
  color: HALO_COLOR,
  opacity: 0.3,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})

/**
 * inZOI's wall-start post: a glass column as thick and as tall as the wall
 * about to be drawn, cyan at the foot fading to slate at the top, with bright
 * edges and a glowing white cap.
 */
export function WallPillarMarker({ height, width }: { height: number; width: number }) {
  const w = Math.max(width, MIN_WIDTH)
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(w, height, w)), [w, height])
  const seam = useMemo(() => new EdgesGeometry(new BoxGeometry(w * 1.001, 0.0001, w * 1.001)), [w])
  useEffect(() => () => edges.dispose(), [edges])
  useEffect(() => () => seam.dispose(), [seam])

  return (
    <group>
      <mesh
        geometry={UNIT_BOX}
        layers={GRID_LAYER}
        material={bodyMaterial}
        position={[0, height / 2, 0]}
        renderOrder={2}
        scale={[w, height, w]}
      />
      <lineSegments
        geometry={edges}
        layers={GRID_LAYER}
        material={edgeMaterial}
        position={[0, height / 2, 0]}
        renderOrder={3}
      />
      <lineSegments
        geometry={seam}
        layers={GRID_LAYER}
        material={seamMaterial}
        position={[0, height * SEAM_HEIGHT, 0]}
        renderOrder={3}
      />
      <mesh
        geometry={UNIT_BOX}
        layers={EDITOR_LAYER}
        material={haloMaterial}
        position={[0, height, 0]}
        renderOrder={3}
        scale={[w * 2.2, 0.02, w * 2.2]}
      />
      <mesh
        geometry={UNIT_BOX}
        layers={EDITOR_LAYER}
        material={capMaterial}
        position={[0, height, 0]}
        renderOrder={4}
        scale={[w * 1.1, 0.04, w * 1.1]}
      />
    </group>
  )
}
