'use client'

import { type AnyNodeId, DEFAULT_WALL_HEIGHT, sceneRegistry, useScene } from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { createPortal } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { BufferGeometry, DoubleSide, Line, Matrix4, type Object3D, Vector3 } from 'three'
import { LineDashedNodeMaterial } from 'three/webgpu'
import { slotGuideFor, useSlotMode } from './slot-mode'

const MM = 0.001
/** mmmcraft's slot guide colour (its theme primary). */
const COLOR = '#7564ed'
const STRONG = '#403782'
/** mmmcraft draws the guide 1 mm off the wall face to avoid z-fighting. */
const BACK = 1 * MM
const GUIDE_DEPTH_MM = 600
const noRaycast = () => null
const fmt = (mm: number) =>
  Math.abs(mm - Math.round(mm)) < 0.05 ? String(Math.round(mm)) : mm.toFixed(1)

const labelStyle = (size: number, color: string) => ({
  color,
  fontSize: size,
  fontWeight: 700,
  whiteSpace: 'nowrap' as const,
  pointerEvents: 'none' as const,
  textShadow: '0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff',
})

/** A slot's dashed outline — the wall rectangle and its floor footprint —
 *  with the WebGPU dashed material (drei's `Line` is WebGL-only). */
function SlotOutline({ l, r, b, t, d }: { l: number; r: number; b: number; t: number; d: number }) {
  const line = useMemo(() => {
    const points = [
      [l, b, BACK],
      [l, t, BACK],
      [r, t, BACK],
      [r, b, BACK],
      [l, b, BACK],
      [l, b, d],
      [r, b, d],
      [r, b, BACK],
    ].map(([x, y, z]) => new Vector3(x, y, z))
    const geometry = new BufferGeometry().setFromPoints(points)
    const material = new LineDashedNodeMaterial({
      color: COLOR,
      dashSize: 0.012,
      gapSize: 0.008,
      transparent: true,
      opacity: 0.9,
    })
    const object = new Line(geometry, material)
    object.computeLineDistances()
    object.raycast = noRaycast
    return object
  }, [l, r, b, t, d])
  useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as LineDashedNodeMaterial).dispose()
    },
    [line],
  )
  return <primitive object={line} />
}

/**
 * mmmcraft `RoomSlotGuides`: on the reference wall, each slot is a faint
 * fill with a dashed outline (wall rectangle plus its floor footprint),
 * its number near the top and its width in the middle, and a "기준 벽 N"
 * title above the wall. Mounted as the cabinet kind's system; draws nothing
 * unless slot mode has a reference wall.
 */
export default function SlotGuides() {
  const slot = useSlotMode()
  const nodes = useScene((s) => s.nodes)
  const guide = useMemo(
    () => (slot.enabled && slot.wallId ? slotGuideFor(slot.wallId, slot, nodes) : null),
    [slot, nodes],
  )
  const levelId = guide?.run.levelId ?? null
  const [target, setTarget] = useState<Object3D | null>(null)
  useEffect(() => {
    if (!levelId) {
      setTarget(null)
      return
    }
    let frameId = 0
    const resolve = () => {
      const next = sceneRegistry.nodes.get(levelId as AnyNodeId) ?? null
      setTarget((cur) => (cur === next ? cur : next))
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frameId)
  }, [levelId])

  if (!guide || !target) return null
  const { run, layout } = guide
  // Local x along the face (left → right from the room), z into the room.
  const matrix = new Matrix4().set(
    run.along[0],
    0,
    run.normal[0],
    run.origin[0],
    0,
    1,
    0,
    0,
    run.along[1],
    0,
    run.normal[1],
    run.origin[1],
    0,
    0,
    0,
    1,
  )
  const wallTop = (guide.wall.height ?? DEFAULT_WALL_HEIGHT) + 0.025
  const first = layout.slots[0]
  const last = layout.slots.at(-1)
  const mid = first && last ? ((first.left + last.right) / 2) * MM : 0
  const b = layout.bottomMm * MM
  const t = layout.topMm * MM
  const d = GUIDE_DEPTH_MM * MM
  const label = `기준 벽 ${guide.wallNumber}${guide.segments.length > 1 ? `-${guide.segment + 1}` : ''}`

  return createPortal(
    <group matrix={matrix} matrixAutoUpdate={false} name="cabinet-slot-guides">
      <Html
        center
        position={[mid, wallTop, BACK]}
        style={labelStyle(14, COLOR)}
        distanceFactor={4}
        zIndexRange={[10, 0]}
      >
        {label}
      </Html>
      {layout.slots.map((s) => {
        const l = s.left * MM
        const r = s.right * MM
        const c = s.center * MM
        return (
          <group key={s.index} name={`cabinet-slot:${s.index}`}>
            <mesh position={[c, (b + t) / 2, BACK]} raycast={noRaycast}>
              <planeGeometry args={[s.width * MM, t - b]} />
              <meshBasicMaterial
                color={COLOR}
                depthWrite={false}
                opacity={0.08}
                side={DoubleSide}
                transparent
              />
            </mesh>
            <SlotOutline b={b} d={d} l={l} r={r} t={t} />
            <Html
              center
              position={[c, t - 0.05, BACK]}
              style={labelStyle(12, COLOR)}
              distanceFactor={4}
              zIndexRange={[10, 0]}
            >
              {s.index + 1}
            </Html>
            <Html
              center
              position={[c, (b + t) / 2, BACK]}
              style={labelStyle(16, STRONG)}
              distanceFactor={4}
              zIndexRange={[10, 0]}
            >
              {fmt(s.width)}
            </Html>
          </group>
        )
      })}
    </group>,
    target,
    undefined,
  )
}
