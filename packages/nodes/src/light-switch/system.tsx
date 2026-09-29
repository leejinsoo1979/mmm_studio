'use client'

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { nearestHit, registerWalkthroughInteraction } from '@pascal-app/editor'
import { useEffect } from 'react'
import type { Object3D } from 'three'

/** The rocker (gang) a hit landed on: `switch-gang-<n>`, or the plate's first. */
function gangOf(object: Object3D | null): number {
  for (let o = object; o; o = o.parent) {
    const match = /^switch-gang-(\d+)$/.exec(o.name)
    if (match) return Number(match[1])
  }
  return 0
}

const targets = new Map<string, number>()

/**
 * E in the walkthrough flips the rocker in the aim, and the lights wired to
 * it go on or off, as the switch panel's toggles do.
 */
export default function LightSwitchSystem() {
  useEffect(
    () =>
      registerWalkthroughInteraction('light-switch', {
        resolve: (raycaster) => {
          const nodes = useScene.getState().nodes
          const found = nearestHit(
            raycaster,
            [...(sceneRegistry.byType['light-switch'] ?? [])].map(
              (id) => [id, sceneRegistry.nodes.get(id)] as const,
            ),
          )
          const hit = found && { id: found.key, distance: found.distance, gang: gangOf(found.part) }
          if (!hit) return null
          const node = nodes[hit.id as AnyNodeId]
          if (node?.type !== 'light-switch') return null
          const gang = Math.min(hit.gang, node.gangs - 1)
          targets.set(hit.id, gang)
          const which = node.gangs > 1 ? `${gang + 1}구 ` : ''
          return {
            id: hit.id,
            distance: hit.distance,
            label: `${which}불 ${node.on[gang] ? '끄기' : '켜기'}`,
          }
        },
        activate: (id) => {
          const node = useScene.getState().nodes[id as AnyNodeId]
          if (node?.type !== 'light-switch') return
          const gang = targets.get(id) ?? 0
          const on = Array.from({ length: node.gangs }, (_, g) => node.on[g] === true)
          on[gang] = !on[gang]
          useScene.getState().updateNode(node.id, { on })
        },
      }),
    [],
  )
  return null
}
