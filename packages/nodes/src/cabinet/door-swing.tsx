'use client'

import { sceneRegistry, useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Object3D, Raycaster, Vector2 } from 'three'
import { isCabinetOpen, useCabinetDoors } from './doors'
import { type CabinetNode, resolveCabinetNode } from './schema'

/** Seconds for a full swing. */
const SWING_S = 0.6
const QUARTER = Math.PI / 2
/** Reach for opening a cabinet in first person (the room doors' reach). */
const REACH_M = 2.5

function swing(pivot: Object3D, t: number) {
  const hinge = pivot.userData.cabinetDoorHinge
  if (hinge === 'left') pivot.rotation.y = -QUARTER * t
  else if (hinge === 'right') pivot.rotation.y = QUARTER * t
  else if (hinge === 'top') pivot.rotation.x = -QUARTER * t
}

const raycaster = new Raycaster()
const screenCentre = new Vector2(0, 0)

/**
 * Swings each cabinet's doors to its open / closed state (mmmcraft's 90°
 * hinge rotation). Rebuilt geometry comes back closed, so the pivots are
 * re-posed every frame while a cabinet is (or is going) open. In first
 * person, E on the cabinet in the crosshair opens or closes just that one,
 * as E does for room doors.
 */
export function CabinetDoorSwing() {
  const amounts = useRef(new Map<string, number>())
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    // Capture on window runs ahead of the first-person controls' document
    // listener, so a cabinet in reach takes the E press.
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyE' || e.repeat || !useEditor.getState().isFirstPersonMode) return
      raycaster.setFromCamera(screenCentre, camera)
      raycaster.far = REACH_M
      const nodes = useScene.getState().nodes
      let hit: { id: string; distance: number } | null = null
      for (const id of sceneRegistry.byType.cabinet ?? []) {
        const node = nodes[id as keyof typeof nodes] as unknown as CabinetNode | undefined
        if (!(node && resolveCabinetNode(node).hasDoor)) continue
        const object = sceneRegistry.nodes.get(id)
        const first = object ? raycaster.intersectObject(object, true)[0] : undefined
        if (first && (!hit || first.distance < hit.distance)) hit = { id, distance: first.distance }
      }
      if (!hit) return
      e.preventDefault()
      e.stopImmediatePropagation()
      useCabinetDoors.getState().toggleCabinet(hit.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [camera])

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.1) / SWING_S
    for (const id of sceneRegistry.byType.cabinet ?? []) {
      const target = isCabinetOpen(id) ? 1 : 0
      const current = amounts.current.get(id) ?? 0
      if (current === 0 && target === 0) continue
      const a =
        target > current ? Math.min(target, current + step) : Math.max(target, current - step)
      amounts.current.set(id, a)
      const eased = a * a * (3 - 2 * a)
      sceneRegistry.nodes.get(id)?.traverse((object) => {
        if (object.userData.cabinetDoorHinge) swing(object, eased)
      })
    }
  })
  return null
}
