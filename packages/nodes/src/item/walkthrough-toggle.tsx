'use client'

import {
  type AnyNodeId,
  type ItemNode,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { registerWalkthroughInteraction } from '@pascal-app/editor'
import { useEffect } from 'react'

/** The item's on/off control (a lamp, a fan), if it has one. */
function toggleIndex(node: ItemNode) {
  return node.asset.interactive?.controls.findIndex((control) => control.kind === 'toggle') ?? -1
}

/**
 * E in the walkthrough switches the item in the aim on or off — lamps,
 * ceiling fans, anything whose asset has a toggle control.
 */
export function ItemWalkthroughToggle() {
  useEffect(
    () =>
      registerWalkthroughInteraction('item-toggle', {
        resolve: (raycaster) => {
          const nodes = useScene.getState().nodes
          let hit: { node: ItemNode; distance: number; index: number } | null = null
          for (const id of sceneRegistry.byType.item ?? []) {
            const node = nodes[id as AnyNodeId]
            if (node?.type !== 'item') continue
            const index = toggleIndex(node)
            if (index < 0) continue
            const object = sceneRegistry.nodes.get(id)
            const first = object ? raycaster.intersectObject(object, true)[0] : undefined
            if (first && (!hit || first.distance < hit.distance)) {
              hit = { node, distance: first.distance, index }
            }
          }
          if (!hit) return null
          const on = useInteractive.getState().items[hit.node.id]?.controlValues[hit.index] === true
          const light = hit.node.asset.interactive?.effects.some(
            (effect) => effect.kind === 'light',
          )
          return {
            id: hit.node.id,
            distance: hit.distance,
            label: `${light ? '조명' : '전원'} ${on ? '끄기' : '켜기'}`,
          }
        },
        activate: (id) => {
          const node = useScene.getState().nodes[id as AnyNodeId]
          if (node?.type !== 'item') return
          const index = toggleIndex(node)
          if (index < 0) return
          const interactive = useInteractive.getState()
          // The model registers its controls once it loads; E can come first.
          if (!interactive.items[node.id] && node.asset.interactive) {
            interactive.initItem(node.id, node.asset.interactive)
          }
          const on = useInteractive.getState().items[node.id]?.controlValues[index] === true
          useInteractive.getState().setControlValue(node.id, index, !on)
        },
      }),
    [],
  )
  return null
}
