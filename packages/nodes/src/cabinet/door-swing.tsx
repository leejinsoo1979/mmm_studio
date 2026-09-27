'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Object3D } from 'three'
import { useCabinetDoors } from './doors'

/** Seconds for a full swing. */
const SWING_S = 0.6
const QUARTER = Math.PI / 2

function swing(pivot: Object3D, t: number) {
  const hinge = pivot.userData.cabinetDoorHinge
  if (hinge === 'left') pivot.rotation.y = -QUARTER * t
  else if (hinge === 'right') pivot.rotation.y = QUARTER * t
  else if (hinge === 'top') pivot.rotation.x = -QUARTER * t
}

/**
 * Swings every cabinet door to the shared open / closed state (mmmcraft's
 * 90° hinge rotation). Rebuilt geometry comes back closed, so the pivots are
 * re-posed every frame while any door is (or is going) open.
 */
export function CabinetDoorSwing() {
  const amount = useRef(0)
  useFrame((_, delta) => {
    const target = useCabinetDoors.getState().open ? 1 : 0
    if (amount.current === 0 && target === 0) return
    const step = Math.min(delta, 0.1) / SWING_S
    amount.current =
      target > amount.current
        ? Math.min(target, amount.current + step)
        : Math.max(target, amount.current - step)
    const a = amount.current
    const eased = a * a * (3 - 2 * a)
    for (const id of sceneRegistry.byType.cabinet ?? []) {
      sceneRegistry.nodes.get(id)?.traverse((object) => {
        if (object.userData.cabinetDoorHinge) swing(object, eased)
      })
    }
  })
  return null
}
