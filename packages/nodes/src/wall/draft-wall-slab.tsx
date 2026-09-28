import { EDITOR_LAYER, type WallPlanPoint } from '@pascal-app/editor'
import { GRID_LAYER } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { BoxGeometry, BufferGeometry, DoubleSide, EdgesGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { color, float, mix, uv } from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'

const UNIT_BOX = new BoxGeometry(1, 1, 1)
const UNIT_EDGES = new EdgesGeometry(UNIT_BOX)
const TOP_STRIP_HEIGHT = 0.035
const HALO_SIZE = 0.05
const FACE_GRID_STEP = 1

// inZOI's draft wall (variant B): pale icy glass, lighter toward the top. The
// body, halo and face lines render in the scene pass (GRID_LAYER) so an
// existing wall in front hides them; the white edges and top strip stay in the
// overlay pass and ignore depth, so the outline of the draft always reads.
const bodyMaterial = new MeshBasicNodeMaterial({
  colorNode: mix(color('#8fb0bb'), color('#e3f1f7'), uv().y),
  opacityNode: mix(float(0.55), float(0.28), uv().y),
  transparent: true,
  depthWrite: false,
  side: DoubleSide,
  toneMapped: false,
})
const topStripMaterial = new MeshBasicNodeMaterial({
  color: '#ffffff',
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})
const outlineMaterial = new LineBasicNodeMaterial({
  color: '#ffffff',
  depthTest: false,
  depthWrite: false,
  transparent: true,
  toneMapped: false,
})
const haloMaterial = new MeshBasicNodeMaterial({
  color: '#dff6ff',
  opacity: 0.28,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
})
const faceGridMaterial = new LineBasicNodeMaterial({
  color: '#ffffff',
  opacity: 0.22,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
})

/** Soft glow boxes along the two top edges and the four vertical edges. */
function haloGeometry(length: number, height: number, thickness: number) {
  const hx = length / 2
  const hz = thickness / 2
  const parts: BufferGeometry[] = []
  for (const z of [-hz, hz]) {
    parts.push(new BoxGeometry(length + HALO_SIZE, HALO_SIZE, HALO_SIZE).translate(0, height, z))
    for (const x of [-hx, hx]) {
      parts.push(new BoxGeometry(HALO_SIZE, height, HALO_SIZE).translate(x, height / 2, z))
    }
  }
  const merged = mergeGeometries(parts, false) ?? new BufferGeometry()
  for (const part of parts) part.dispose()
  return merged
}

/** Faint 1 m lattice on both faces, in the slab's local frame (base at y = 0). */
function faceGridGeometry(length: number, height: number, thickness: number) {
  const points: Vector3[] = []
  const hx = length / 2
  const hz = thickness / 2
  for (const z of [-hz, hz]) {
    for (let x = -hx + FACE_GRID_STEP; x < hx - 0.05; x += FACE_GRID_STEP) {
      points.push(new Vector3(x, 0, z), new Vector3(x, height, z))
    }
    for (let y = FACE_GRID_STEP; y < height - 0.05; y += FACE_GRID_STEP) {
      points.push(new Vector3(-hx, y, z), new Vector3(hx, y, z))
    }
  }
  return new BufferGeometry().setFromPoints(points)
}

/**
 * The wall being drawn, as inZOI shows it: a translucent glass slab at the
 * final height and thickness with a solid white top edge, bright white
 * outline, a soft halo and faint 1 m face lines.
 */
export function DraftWallSlab({
  baseY = 0,
  end,
  height,
  start,
  thickness,
}: {
  baseY?: number
  end: WallPlanPoint
  height: number
  start: WallPlanPoint
  thickness: number
}) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  const halo = useMemo(
    () => (length < 0.01 ? null : haloGeometry(length, height, thickness)),
    [length, height, thickness],
  )
  const grid = useMemo(
    () => (length < 0.01 ? null : faceGridGeometry(length, height, thickness)),
    [length, height, thickness],
  )
  useEffect(() => () => halo?.dispose(), [halo])
  useEffect(() => () => grid?.dispose(), [grid])
  if (!(halo && grid)) return null

  return (
    <group
      position={[(start[0] + end[0]) / 2, baseY, (start[1] + end[1]) / 2]}
      rotation={[0, -Math.atan2(dz, dx), 0]}
    >
      <mesh
        geometry={UNIT_BOX}
        layers={GRID_LAYER}
        material={bodyMaterial}
        position={[0, height / 2, 0]}
        renderOrder={1}
        scale={[length, height, thickness]}
      />
      <mesh geometry={halo} layers={GRID_LAYER} material={haloMaterial} renderOrder={2} />
      <lineSegments
        frustumCulled={false}
        geometry={grid}
        layers={GRID_LAYER}
        material={faceGridMaterial}
        renderOrder={2}
      />
      <lineSegments
        frustumCulled={false}
        geometry={UNIT_EDGES}
        layers={EDITOR_LAYER}
        material={outlineMaterial}
        position={[0, height / 2, 0]}
        renderOrder={3}
        scale={[length, height, thickness]}
      />
      <mesh
        geometry={UNIT_BOX}
        layers={EDITOR_LAYER}
        material={topStripMaterial}
        position={[0, height, 0]}
        renderOrder={4}
        scale={[length, TOP_STRIP_HEIGHT, thickness + 0.01]}
      />
    </group>
  )
}
