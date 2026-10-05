'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { readAvatarLook } from '@pascal-app/editor'
import { type NpcNode, useNpcStudioRequest } from '@pascal-app/nodes'
import { useEffect } from 'react'
import { useCharacterStudio } from './character-studio/use-character-studio'

/** Opens the character studio on the NPC whose inspector asked to edit its look. */
export function NpcStudioBridge() {
  const nodeId = useNpcStudioRequest((state) => state.nodeId)

  useEffect(() => {
    if (!nodeId) return
    useNpcStudioRequest.getState().clear()
    const node = useScene.getState().nodes[nodeId as AnyNodeId] as unknown as NpcNode | undefined
    if (node?.type !== 'npc') return
    useCharacterStudio.getState().show({
      kind: 'npc',
      nodeId: node.id,
      name: node.name,
      avatar: node.avatar,
      look: node.look ? readAvatarLook(node.look) : null,
    })
  }, [nodeId])

  return null
}
