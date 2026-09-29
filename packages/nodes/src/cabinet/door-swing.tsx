'use client'

import { sceneRegistry, useScene } from '@pascal-app/core'
import { registerWalkthroughInteraction } from '@pascal-app/editor'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Object3D } from 'three'
import { isCabinetOpen, useCabinetDoors } from './doors'
import { type CabinetNode, resolveCabinetNode } from './schema'

/** Seconds for a full swing. */
const SWING_S = 0.6
const QUARTER = Math.PI / 2
/** Drawers pull out this share of the cabinet's depth. */
const DRAWER_PULL = 0.6
const MM = 0.001

function swing(pivot: Object3D, t: number) {
  const hinge = pivot.userData.cabinetDoorHinge
  if (hinge === 'left') pivot.rotation.y = -QUARTER * t
  else if (hinge === 'right') pivot.rotation.y = QUARTER * t
  else if (hinge === 'top') pivot.rotation.x = -QUARTER * t
}

/** Drawer fronts and boxes (not the fixed filler strips) slide out along +Z. */
const isDrawerPart = (object: Object3D) =>
  object.name.startsWith('cabinet-drawer-') && !object.name.startsWith('cabinet-drawer-filler')

function hasDrawers(object: Object3D) {
  let found = false
  object.traverse((child) => {
    if (!found && isDrawerPart(child)) found = true
  })
  return found
}

/**
 * Swings each cabinet's doors to its open / closed state (mmmcraft's 90°
 * hinge rotation) and slides its drawers out. Rebuilt geometry comes back
 * closed, so the parts are re-posed every frame while a cabinet is (or is
 * going) open. In the walkthrough, E on the cabinet in the aim opens or closes
 * just that one, as E does for room doors.
 */
export function CabinetDoorSwing() {
  const amounts = useRef(new Map<string, number>())

  useEffect(
    () =>
      registerWalkthroughInteraction('cabinet', {
        resolve: (raycaster) => {
          const nodes = useScene.getState().nodes
          let hit: { id: string; distance: number; object: Object3D } | null = null
          for (const id of sceneRegistry.byType.cabinet ?? []) {
            const node = nodes[id as keyof typeof nodes] as unknown as CabinetNode | undefined
            const object = sceneRegistry.nodes.get(id)
            if (!(node && object)) continue
            const first = raycaster.intersectObject(object, true)[0]
            if (first && (!hit || first.distance < hit.distance)) {
              hit = { id, distance: first.distance, object }
            }
          }
          if (!hit) return null
          const node = nodes[hit.id as keyof typeof nodes] as unknown as CabinetNode
          const doors = resolveCabinetNode(node).hasDoor
          if (!(doors || hasDrawers(hit.object))) return null
          const open = isCabinetOpen(hit.id)
          const what = doors ? '수납장' : '서랍'
          return { id: hit.id, distance: hit.distance, label: `${what} ${open ? '닫기' : '열기'}` }
        },
        activate: (id) => useCabinetDoors.getState().toggleCabinet(id),
      }),
    [],
  )

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
      const node = useScene.getState().nodes[
        id as keyof ReturnType<typeof useScene.getState>['nodes']
      ] as unknown | undefined
      const pull = node ? resolveCabinetNode(node as CabinetNode).depthMm * MM * DRAWER_PULL : 0
      sceneRegistry.nodes.get(id)?.traverse((object) => {
        if (object.userData.cabinetDoorHinge) swing(object, eased)
        else if (isDrawerPart(object)) {
          if (object.userData.drawerClosedZ === undefined) {
            object.userData.drawerClosedZ = object.position.z
          }
          object.position.z = object.userData.drawerClosedZ + pull * eased
        }
      })
    }
  })
  return null
}
