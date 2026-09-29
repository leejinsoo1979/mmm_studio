'use client'

import {
  type AnyNode,
  getRenderableSlabPolygon,
  type SlabNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { GRID_LAYER, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type Group, Path, Shape, ShapeGeometry, Vector2 } from 'three'
import { color, float, fract, fwidth, mix, positionWorld, uniform } from 'three/tsl'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import useEditor from '../../store/use-editor'

/** Tools while which a closed room's floor shows inZOI's build fill. */
const WALL_DRAFT_TOOLS = new Set<string>(['wall', 'wall-arc', 'rectangle-room'])

const FILL_COLOR = '#5b7395'
const FILL_ALPHA = 0.6
const LINE_ALPHA = 0.5
const LIFT = 0.003

const cellSize = uniform(0.5)

// Slate blue with the building lattice over it, in world XZ so its lines
// continue the ground grid outside the room. Once a cell shrinks to a few
// pixels the fine lines give way to every fifth one instead of aliasing.
function latticeLines(size: Node<'float'>) {
  const r = positionWorld.xz.div(size)
  const fw = fwidth(r)
  const g = fract(r.sub(0.5)).sub(0.5).abs()
  const lineX = float(1).sub(g.x.div(fw.x).sub(0.25).min(1))
  const lineZ = float(1).sub(g.y.div(fw.y).sub(0.25).min(1))
  return { line: lineX.max(lineZ).clamp(0, 1), density: fw.x.max(fw.y) }
}

const fillMaterial = (() => {
  const fine = latticeLines(cellSize)
  const coarse = latticeLines(cellSize.mul(5))
  const fineVisible = float(1).sub(fine.density.smoothstep(1 / 14, 1 / 6))
  const line = fine.line.mul(fineVisible).max(coarse.line)
  return new MeshBasicNodeMaterial({
    colorNode: mix(color(FILL_COLOR), color('#ffffff'), line.mul(LINE_ALPHA)),
    opacityNode: float(FILL_ALPHA),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  })
})()

function slabGeometry(slab: SlabNode) {
  const polygon = getRenderableSlabPolygon(slab)
  if (polygon.length < 3) return null
  const shape = new Shape(polygon.map(([x, z]) => new Vector2(x, -z)))
  for (const hole of slab.holes ?? []) {
    if (hole.length < 3) continue
    shape.holes.push(new Path(hole.map(([x, z]) => new Vector2(x, -z))))
  }
  const geometry = new ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, (slab.elevation ?? 0.05) + LIFT, 0)
  return geometry
}

/**
 * inZOI shows a closed room's floor as slate blue with the white lattice while
 * walls are being built. Editor-only and render-only: the slab and its finish
 * are untouched, so leaving the wall tools shows the real floor again.
 */
export function RoomFloorBuildOverlay() {
  const active = useEditor(
    (s) => s.mode === 'build' && s.tool !== null && WALL_DRAFT_TOOLS.has(s.tool),
  )
  const levelId = useViewer((s) => s.selection.levelId)
  if (!(active && levelId)) return null
  return <RoomFloorFill levelId={levelId} />
}

function RoomFloorFill({ levelId }: { levelId: string }) {
  const groupRef = useRef<Group>(null)

  // Shallow-compared, so edits to other nodes don't rebuild the fill.
  const slabs = useScene(
    useShallow((s) => {
      const nodes = s.nodes as Record<string, AnyNode>
      const level = nodes[levelId]
      if (level?.type !== 'level') return []
      return level.children
        .map((id) => nodes[id])
        .filter((node): node is SlabNode => node?.type === 'slab' && node.visible !== false)
    }),
  )
  const geometries = useMemo(
    () =>
      slabs
        .map((slab) => ({ id: slab.id, geometry: slabGeometry(slab) }))
        .filter((entry): entry is { id: SlabNode['id']; geometry: ShapeGeometry } =>
          Boolean(entry.geometry),
        ),
    [slabs],
  )
  useEffect(
    () => () => {
      for (const entry of geometries) entry.geometry.dispose()
    },
    [geometries],
  )

  useFrame(() => {
    cellSize.value = useEditor.getState().gridSnapStep
    const group = groupRef.current
    const level = sceneRegistry.nodes.get(levelId)
    if (!(group && level)) return
    group.matrix.copy(level.matrixWorld)
    group.matrixWorldNeedsUpdate = true
  })

  return (
    <group matrixAutoUpdate={false} ref={groupRef}>
      {geometries.map(({ id, geometry }) => (
        <mesh
          geometry={geometry}
          key={id}
          // Scene pass, so the walls around the room occlude the fill.
          layers={GRID_LAYER}
          material={fillMaterial}
          renderOrder={1}
        />
      ))}
    </group>
  )
}
