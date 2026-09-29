'use client'

import { type AnyNodeId, sceneRegistry } from '@pascal-app/core'
import { nearestHit, registerWalkthroughInteraction } from '@pascal-app/editor'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Material, Mesh } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { ScreenProjections } from './projector'
import { screenMeshes, screenSlots, useItemScreens } from './screen'
import { panelTexture, SCREEN_GAIN } from './screen-textures'

/**
 * Puts `material` on a mesh's screen slot(s), keeping the model's own to
 * restore. The item renderer may put new materials on meanwhile (a shading
 * change): those become the ones to restore.
 */
function showOnScreen(mesh: Mesh, material: Material) {
  if (mesh.material === mesh.userData.screenShown) return
  const original = mesh.material
  const slots = screenSlots(mesh)
  const shown = Array.isArray(original)
    ? original.map((slot, index) => (slots[index] ? material : slot))
    : material
  mesh.userData.screenOriginal = original
  mesh.userData.screenShown = shown
  mesh.material = shown
}

function restoreScreen(mesh: Mesh) {
  if (mesh.material === mesh.userData.screenShown) mesh.material = mesh.userData.screenOriginal
  delete mesh.userData.screenOriginal
  delete mesh.userData.screenShown
}

/**
 * TVs and monitors in the walkthrough: E switches the one in the aim on or
 * off, and a switched-on screen shows its standby picture, a video, a shared
 * screen or presentation slides on its `slot_screen` surface — and on the
 * surface its picture is projected onto, if any.
 */
export function ItemScreenSystem() {
  const materials = useRef(new Map<string, MeshBasicNodeMaterial>())
  const lit = useRef(new Set<string>())

  useEffect(
    () =>
      registerWalkthroughInteraction('item-screen', {
        resolve: (raycaster) => {
          const hit = nearestHit(
            raycaster,
            [...(sceneRegistry.byType.item ?? [])].map(
              (id) => [id, sceneRegistry.nodes.get(id)] as const,
            ),
          )
          if (!(hit && screenMeshes(hit.object).length > 0)) return null
          const on = Boolean(useItemScreens.getState().screens[hit.key])
          return { id: hit.key, distance: hit.distance, label: on ? 'TV 끄기' : 'TV 켜기' }
        },
        activate: (id) => {
          const screens = useItemScreens.getState()
          screens.setOn(id, !screens.screens[id])
        },
      }),
    [],
  )

  useFrame(() => {
    const { screens } = useItemScreens.getState()
    for (const id of lit.current) {
      if (screens[id]) continue
      const object = sceneRegistry.nodes.get(id as AnyNodeId)
      if (object) for (const mesh of screenMeshes(object)) restoreScreen(mesh)
      lit.current.delete(id)
    }
    for (const [id, screen] of Object.entries(screens)) {
      const object = sceneRegistry.nodes.get(id as AnyNodeId)
      if (!object) continue
      let material = materials.current.get(id)
      if (!material) {
        material = new MeshBasicNodeMaterial({ fog: false })
        material.color.setScalar(SCREEN_GAIN)
        materials.current.set(id, material)
      }
      const texture = panelTexture(screen.content)
      if (texture && material.map !== texture) {
        material.map = texture
        material.needsUpdate = true
      }
      for (const mesh of screenMeshes(object)) showOnScreen(mesh, material)
      lit.current.add(id)
    }
  })

  useEffect(
    () => () => {
      for (const material of materials.current.values()) material.dispose()
    },
    [],
  )

  return <ScreenProjections />
}
