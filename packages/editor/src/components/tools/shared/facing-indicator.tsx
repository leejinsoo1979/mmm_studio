import { useEffect, useMemo } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'

// A flat forward-pointing triangle drawn on the floor right at the front edge
// of a placement ghost, so the direction the node will face is obvious. Tip at
// local +Z (every kind's forward face); render it inside the ghost's rotated
// group so it inherits the node's yaw. inZOI: pale cyan, sized to the front
// face (~38% of its width), with a faint larger copy for a soft edge.
const FACING_INDICATOR_DEFAULT_WIDTH = 0.36
const FACING_INDICATOR_MIN_WIDTH = 0.22
const FACING_INDICATOR_MAX_WIDTH = 0.9
const FACING_INDICATOR_GAP = 0.06
const FACING_COLOR = 0x8a_d0_f0

function triangleWidth(frontWidth: number | undefined): number {
  if (!frontWidth) return FACING_INDICATOR_DEFAULT_WIDTH
  return Math.min(
    FACING_INDICATOR_MAX_WIDTH,
    Math.max(FACING_INDICATOR_MIN_WIDTH, frontWidth * 0.38),
  )
}

/**
 * @param depth    bbox depth (along local Z) of the ghost — positions the
 *                 triangle just past the front edge.
 * @param width    bbox width (along local X) — sizes the triangle.
 * @param center   optional [x, z] of the bbox centre in the ghost's local frame.
 * @param reversed point along local -Z (the front is the -Z side, e.g. a stair
 *                 entry) instead of +Z.
 * @param y        small lift off the floor to avoid z-fighting.
 */
export function FacingIndicator({
  depth,
  width,
  center = [0, 0],
  reversed = false,
  y = 0.02,
}: {
  depth: number
  width?: number
  center?: [number, number]
  reversed?: boolean
  y?: number
}) {
  const dir = reversed ? -1 : 1
  const triW = triangleWidth(width)
  const triL = triW * 0.45
  // Per-instance geometry/material (not module singletons) so this works no
  // matter which package mounts it (the tools live in `nodes`, imported via
  // `@pascal-app/editor`). Disposed on unmount.
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, dir * triL, triW / 2, 0, 0, -triW / 2, 0, 0], 3),
    )
    return g
  }, [dir, triW, triL])
  const materials = useMemo(() => {
    const make = (opacity: number) =>
      new MeshBasicNodeMaterial({
        color: FACING_COLOR,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      })
    return { core: make(0.85), halo: make(0.25) }
  }, [])
  useEffect(
    () => () => {
      geometry.dispose()
      materials.core.dispose()
      materials.halo.dispose()
    },
    [geometry, materials],
  )

  // The halo is scaled about the triangle's centroid so the soft edge rings it.
  const haloOffset = (dir * triL) / 3
  return (
    <group position={[center[0], y, center[1] + dir * (depth / 2 + FACING_INDICATOR_GAP)]}>
      <mesh
        frustumCulled={false}
        geometry={geometry}
        layers={EDITOR_LAYER}
        material={materials.halo}
        position={[0, 0, haloOffset - haloOffset * 1.18]}
        renderOrder={1000}
        scale={1.18}
      />
      <mesh
        frustumCulled={false}
        geometry={geometry}
        layers={EDITOR_LAYER}
        material={materials.core}
        renderOrder={1001}
      />
    </group>
  )
}
