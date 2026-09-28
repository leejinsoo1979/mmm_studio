'use client'

import {
  type AnyNodeId,
  isCurvedWall,
  nodeRegistry,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { createPortal, useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { BoxGeometry, type BufferGeometry, type Group, type Mesh, type Object3D } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import { EDITOR_LAYER } from '../../lib/constants'
import { resolvePaintScopeTargets } from '../../lib/paint-scope'
import useEditor from '../../store/use-editor'
import { NO_RAYCAST } from './handles/handle-arrow'
import { usePaintFocus } from './paint-focus'

// inZOI's customize trace: the face being painted is outlined along its top
// edge and the floor line by a thin pale cyan-white stroke with a soft glow,
// over the untinted finish. With the room in scope every wall is traced.
const TRACE_COLOR = '#d8eef8'
const CORE_SIZE = 0.012
const GLOW_SIZE = 0.045
// Just off the face so the trace never sinks into it.
const FACE_LIFT = 0.004
// A wall has at most two painted faces (a wall with both sides tagged
// interior puts both in the interior group).
const MAX_FACES = 2

// The wall mesh's material groups: 0 = cap/edges, 1 = interior, 2 = exterior.
const FACE_GROUP: Record<string, number> = { interior: 1, exterior: 2 }

const UNIT_BOX = new BoxGeometry(1, 1, 1)
const coreMaterial = new MeshBasicNodeMaterial({
  color: TRACE_COLOR,
  opacity: 0.95,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})
const glowMaterial = new MeshBasicNodeMaterial({
  color: TRACE_COLOR,
  opacity: 0.25,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})

type FaceExtent = { minX: number; maxX: number; minY: number; maxY: number; z: number }

/**
 * Extents of one material group's broad faces in the wall mesh's local frame
 * (x along the wall, z across it), one per side. Triangles that don't face
 * ±z (jambs, caps) are skipped.
 */
function measureFaces(geometry: BufferGeometry, materialIndex: number): FaceExtent[] {
  const position = geometry.getAttribute('position')
  if (!position) return []
  const index = geometry.getIndex()
  const vertexAt = (i: number) => (index ? index.getX(i) : i)
  const sides: FaceExtent[] = [1, -1].map((sign) => ({
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    z: sign * -Infinity,
  }))
  const total = index ? index.count : position.count
  for (const group of geometry.groups) {
    if (group.materialIndex !== materialIndex) continue
    const end = Math.min(group.start + group.count, total)
    for (let i = group.start; i + 2 < end; i += 3) {
      const a = vertexAt(i)
      const b = vertexAt(i + 1)
      const c = vertexAt(i + 2)
      const abx = position.getX(b) - position.getX(a)
      const aby = position.getY(b) - position.getY(a)
      const acx = position.getX(c) - position.getX(a)
      const acy = position.getY(c) - position.getY(a)
      const abz = position.getZ(b) - position.getZ(a)
      const acz = position.getZ(c) - position.getZ(a)
      const nx = aby * acz - abz * acy
      const ny = abz * acx - abx * acz
      const nz = abx * acy - aby * acx
      const length = Math.hypot(nx, ny, nz)
      if (length < 1e-9 || Math.abs(nz) / length < 0.7) continue
      const side = sides[nz > 0 ? 0 : 1]!
      for (const vertex of [a, b, c]) {
        const x = position.getX(vertex)
        const y = position.getY(vertex)
        const z = position.getZ(vertex)
        side.minX = Math.min(side.minX, x)
        side.maxX = Math.max(side.maxX, x)
        side.minY = Math.min(side.minY, y)
        side.maxY = Math.max(side.maxY, y)
        side.z = nz > 0 ? Math.max(side.z, z) : Math.min(side.z, z)
      }
    }
  }
  return sides.filter((side) => side.maxX - side.minX > 1e-3)
}

export function PaintFaceOutlines() {
  const focus = usePaintFocus((s) => s.focus)
  // `nodeId:role` keys, so the shallow compare holds across unrelated edits.
  const faces = useScene(
    useShallow((s) => {
      const node = focus ? s.nodes[focus.nodeId] : null
      if (!(focus && node?.type === 'wall')) return []
      const role =
        focus.role ?? nodeRegistry.get('wall')?.capabilities?.slots?.(node)[0]?.slotId ?? 'interior'
      const targets = focus.roomScope
        ? resolvePaintScopeTargets({
            node,
            role,
            scope: 'room',
            nodes: s.nodes,
            spaces: useEditor.getState().spaces,
            slotRolesOf: () => [role],
          })
        : [{ nodeId: node.id as AnyNodeId, role }]
      return targets
        .filter((target) => {
          const wall = s.nodes[target.nodeId]
          // A curved face has no straight top line to trace.
          return (
            FACE_GROUP[target.role] !== undefined && wall?.type === 'wall' && !isCurvedWall(wall)
          )
        })
        .map((target) => `${target.nodeId}:${target.role}`)
    }),
  )
  return (
    <>
      {faces.map((key) => {
        const split = key.lastIndexOf(':')
        return (
          <FacePortal
            id={key.slice(0, split) as AnyNodeId}
            key={key}
            materialIndex={FACE_GROUP[key.slice(split + 1)]!}
          />
        )
      })}
    </>
  )
}

// Inside the wall mesh, like the selection glass: part of the selected
// subtree, so the outline's occluder pass never treats the trace as cover.
function FacePortal({ id, materialIndex }: { id: AnyNodeId; materialIndex: number }) {
  const [object, setObject] = useState<Object3D | null>(null)
  useFrame(() => {
    const next = sceneRegistry.nodes.get(id) ?? null
    if (next !== object) setObject(next)
  })
  if (!object) return null
  return createPortal(<FaceTrace materialIndex={materialIndex} wall={object as Mesh} />, object)
}

function FaceTrace({ wall, materialIndex }: { wall: Mesh; materialIndex: number }) {
  const lineRefs = useRef<Array<Group | null>>([])
  const measured = useRef<BufferGeometry | null>(null)

  useFrame(() => {
    const geometry = wall.geometry
    if (!geometry || measured.current === geometry) return
    measured.current = geometry
    const faces = measureFaces(geometry, materialIndex)
    for (let face = 0; face < MAX_FACES; face += 1) {
      const extent = faces[face]
      const top = lineRefs.current[face * 2]
      const bottom = lineRefs.current[face * 2 + 1]
      if (!(top && bottom)) continue
      top.visible = bottom.visible = !!extent
      if (!extent) continue
      const z = extent.z + Math.sign(extent.z || 1) * FACE_LIFT
      const x = (extent.minX + extent.maxX) / 2
      top.position.set(x, extent.maxY, z)
      bottom.position.set(x, extent.minY + CORE_SIZE / 2, z)
      top.scale.x = bottom.scale.x = extent.maxX - extent.minX
    }
  })

  return (
    <>
      {Array.from({ length: MAX_FACES * 2 }, (_, line) => (
        <group
          key={line}
          layers={EDITOR_LAYER}
          ref={(group) => {
            lineRefs.current[line] = group
          }}
          visible={false}
        >
          <mesh
            geometry={UNIT_BOX}
            layers={EDITOR_LAYER}
            material={glowMaterial}
            raycast={NO_RAYCAST}
            renderOrder={3}
            scale={[1, GLOW_SIZE, GLOW_SIZE]}
          />
          <mesh
            geometry={UNIT_BOX}
            layers={EDITOR_LAYER}
            material={coreMaterial}
            raycast={NO_RAYCAST}
            renderOrder={4}
            scale={[1, CORE_SIZE, CORE_SIZE]}
          />
        </group>
      ))}
    </>
  )
}
