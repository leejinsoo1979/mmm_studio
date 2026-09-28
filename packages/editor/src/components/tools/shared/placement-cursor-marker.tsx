import { forwardRef, useEffect, useMemo } from 'react'
import { ConeGeometry, EdgesGeometry, type Group } from 'three'
import { color, mix, positionLocal } from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'

const RADIUS = 0.16
const HEIGHT = 0.26
const LIFT = 0.2
const NO_RAYCAST = () => null

/**
 * inZOI's floor cursor for a picked item that has no host yet (a wall picture
 * or ceiling lamp over open floor): a glowing cyan down-pointing triangular
 * prism floating just above the floor, drawn over geometry.
 */
export const PlacementCursorMarker = forwardRef<Group, { visible?: boolean }>(
  function PlacementCursorMarker({ visible = true }, ref) {
    const resources = useMemo(() => {
      const cone = new ConeGeometry(RADIUS, HEIGHT, 3)
      cone.rotateX(Math.PI)
      const edges = new EdgesGeometry(cone)
      const body = new MeshBasicNodeMaterial({
        transparent: true,
        opacity: 0.55,
        depthTest: false,
        depthWrite: false,
      })
      body.colorNode = mix(
        color('#2ed8df'),
        color('#ffffff'),
        positionLocal.y
          .add(HEIGHT / 2)
          .div(HEIGHT)
          .mul(0.6),
      )
      const edge = new LineBasicNodeMaterial({
        color: '#9fedeb',
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      })
      const glow = new LineBasicNodeMaterial({
        color: '#9fedeb',
        transparent: true,
        opacity: 0.3,
        depthTest: false,
        depthWrite: false,
      })
      return { cone, edges, body, edge, glow }
    }, [])
    useEffect(
      () => () => {
        for (const resource of Object.values(resources)) resource.dispose()
      },
      [resources],
    )

    return (
      <group ref={ref} visible={visible}>
        <group position-y={LIFT + HEIGHT / 2}>
          <mesh
            geometry={resources.cone}
            layers={EDITOR_LAYER}
            material={resources.body}
            raycast={NO_RAYCAST}
            renderOrder={1001}
          />
          <lineSegments
            geometry={resources.edges}
            layers={EDITOR_LAYER}
            material={resources.edge}
            raycast={NO_RAYCAST}
            renderOrder={1002}
          />
          <lineSegments
            geometry={resources.edges}
            layers={EDITOR_LAYER}
            material={resources.glow}
            raycast={NO_RAYCAST}
            renderOrder={1002}
            scale={1.1}
          />
        </group>
      </group>
    )
  },
)
