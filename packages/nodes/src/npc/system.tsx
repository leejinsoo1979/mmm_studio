'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import {
  registerWalkthroughDynamicCollider,
  registerWalkthroughInteraction,
} from '@pascal-app/editor'
import { characterStatus, computeGeometryBoundsTree, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { CapsuleGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { useNpcDialogue } from './dialogue/store'
import { localPlayerOn, type NpcFrame, resetNpcBrains, stepNpc } from './runtime/brain'
import { ensureNpcEpoch, npcNow } from './runtime/clock'
import { effectiveEngagement, heldByOther } from './runtime/engagement'
import { type NpcTalkCandidate, nearestNpcHit, npcTalkLabel } from './runtime/interaction'
import { clearNavCache, refreshNavCache } from './runtime/nav-cache'
import { NpcSocialStage } from './runtime/social-stage'
import { npcPoses, npcWorldFeet, useNpcRuntime } from './runtime/store'
import type { NpcNode } from './schema'
import { openNpcMenu } from './ui/interaction-menu'

/** Scene edits settle this long (ms) before the nav grids are rebuilt. */
const NAV_REBUILD_DELAY = 500
/** The walker's feet are this far below the controller's centre. */
const FEET_BELOW_CENTER = 1.15
/** A talk ends when the player walks this much (m) beyond the NPC's talking range. */
const WALK_AWAY_MARGIN = 1.5
/** Frames longer than this (s) are stepped as this long. */
const MAX_STEP = 0.1
/** The capsule the walker bumps into: radius, straight length (m). */
const COLLIDER_RADIUS = 0.28
const COLLIDER_LENGTH = 1.1

type SceneNodes = Readonly<Record<string, AnyNode>>

let npcList: { nodes: SceneNodes; npcs: NpcNode[] } | null = null

function npcsOf(nodes: SceneNodes): NpcNode[] {
  if (npcList?.nodes !== nodes) {
    const npcs = Object.values(nodes).filter(
      (node) => (node as { type: string }).type === 'npc',
    ) as unknown as NpcNode[]
    npcList = { nodes, npcs }
  }
  return npcList.npcs
}

function levelsOf(npcs: readonly NpcNode[]): Set<string> {
  return new Set(npcs.map((npc) => npc.parentId).filter((id): id is string => !!id))
}

function refreshNavigation() {
  const nodes = useScene.getState().nodes
  refreshNavCache(nodes, levelsOf(npcsOf(nodes)))
}

/** E on an NPC in the aim (its standing capsule, within its range) opens its menu: talk, gestures. */
function registerTalk() {
  return registerWalkthroughInteraction('npc-talk', {
    resolve: (raycaster) => {
      const talkingTo = useNpcDialogue.getState().npcId
      const npcs = npcsOf(useScene.getState().nodes)
      const byId = new Map<string, NpcNode>()
      const candidates: NpcTalkCandidate[] = []
      for (const npc of npcs) {
        const feet = npcWorldFeet.get(npc.id)
        if (!feet || npc.id === talkingTo) continue
        byId.set(npc.id, npc)
        candidates.push({ id: npc.id, feet, range: npc.interaction.range })
      }
      const { origin, direction } = raycaster.ray
      const hit = nearestNpcHit(
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
        candidates,
      )
      const npc = hit && byId.get(hit.id)
      if (!(hit && npc)) return null
      const { engagements, localPlayerId } = useNpcRuntime.getState()
      const busy = heldByOther(engagements[npc.id], localPlayerId, npcNow())
      return {
        id: npc.id,
        distance: hit.distance,
        label: npcTalkLabel(npc.name, npc.interaction.prompt, busy, npc.interaction.talkable),
      }
    },
    // The menu shows a busy NPC's items disabled, with why.
    activate: (id) => openNpcMenu(id),
  })
}

const noRaycast = () => {}

/** An invisible capsule per shown NPC that the walker bumps into, following its body. */
function registerColliders() {
  const geometry = new CapsuleGeometry(COLLIDER_RADIUS, COLLIDER_LENGTH, 4, 8)
  computeGeometryBoundsTree(geometry)
  const material = new MeshBasicMaterial({ visible: false })
  const meshes = new Map<string, Mesh>()
  let list: Mesh[] = []
  const centre = COLLIDER_RADIUS + COLLIDER_LENGTH / 2

  const meshFor = (id: string) => {
    let mesh = meshes.get(id)
    if (!mesh) {
      mesh = new Mesh(geometry, material)
      mesh.matrixAutoUpdate = false
      mesh.raycast = noRaycast
      mesh.userData = { excludeFloatHit: true, excludeCollisionCheck: false, restitution: 0.03 }
      meshes.set(id, mesh)
    }
    return mesh
  }

  const unregister = registerWalkthroughDynamicCollider('npc', () => {
    const npcs = npcsOf(useScene.getState().nodes)
    const { engagements } = useNpcRuntime.getState()
    const now = npcNow()
    let changed = npcs.length !== list.length
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i]!
      const mesh = meshFor(npc.id)
      if (list[i] !== mesh) changed = true
      const feet = npcWorldFeet.get(npc.id)
      // A friendly gesture brings the NPC closer than the capsules allow.
      const gesturing = effectiveEngagement(engagements[npc.id], now)?.m === 'social'
      mesh.visible = !!feet && !gesturing
      if (feet) {
        mesh.matrix.makeTranslation(feet[0], feet[1] + centre, feet[2])
        mesh.matrixWorld.copy(mesh.matrix)
      }
    }
    if (changed) {
      list = npcs.map((npc) => meshFor(npc.id))
      const kept = new Set<string>(npcs.map((npc) => npc.id))
      for (const id of meshes.keys()) if (!kept.has(id)) meshes.delete(id)
    }
    return list
  })

  return () => {
    unregister()
    meshes.clear()
    geometry.dispose()
    material.dispose()
  }
}

const localFeet = new Vector3()
const localFacing = new Vector3()

/** The NPCs while the scene is walked: their poses each frame, E to talk, their colliders. */
function NpcRuntime() {
  useEffect(() => {
    ensureNpcEpoch()
    refreshNavigation()
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useScene.subscribe((state, previous) => {
      if (state.nodes === previous.nodes) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        refreshNavigation()
      }, NAV_REBUILD_DELAY)
    })
    const unregisterTalk = registerTalk()
    const unregisterColliders = registerColliders()
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
      unregisterTalk()
      unregisterColliders()
      npcPoses.clear()
      resetNpcBrains()
      clearNavCache()
    }
  }, [])

  useFrame((_, delta) => {
    const nodes = useScene.getState().nodes
    const npcs = npcsOf(nodes)
    const now = npcNow()
    const runtime = useNpcRuntime.getState()
    localFeet.copy(characterStatus.position)
    localFeet.y -= FEET_BELOW_CENTER
    localFacing.set(0, 0, 1).applyQuaternion(characterStatus.quaternion)
    const frame: NpcFrame = {
      now,
      dt: Math.min(Math.max(delta, 0), MAX_STEP),
      epoch: runtime.epoch ?? ensureNpcEpoch(now),
      me: runtime.localPlayerId,
      localFeet,
      localYaw: Math.atan2(localFacing.x, localFacing.z),
    }

    for (const npc of npcs) npcPoses.set(npc.id, stepNpc(npc, frame))
    if (npcPoses.size !== npcs.length) {
      const kept = new Set<string>(npcs.map((npc) => npc.id))
      for (const id of npcPoses.keys()) {
        if (kept.has(id)) continue
        npcPoses.delete(id)
        resetNpcBrains(id)
      }
    }

    // Walking off ends a talk (not while the NPC leads the way to a room).
    const talkingTo = useNpcDialogue.getState().npcId
    if (!talkingTo) return
    const npc = nodes[talkingTo as AnyNodeId] as unknown as NpcNode | undefined
    const pose = npcPoses.get(talkingTo)
    if (!(npc && pose)) return
    if (effectiveEngagement(runtime.engagements[talkingTo], now)?.m === 'guide') return
    const player = localPlayerOn(frame, pose.levelId)
    const away =
      !player?.onLevel ||
      Math.hypot(player.p[0] - pose.p[0], player.p[1] - pose.p[1]) >
        npc.interaction.range + WALK_AWAY_MARGIN
    if (away) useNpcDialogue.getState().close('walkedAway')
  }, -0.5)

  return <NpcSocialStage />
}

/**
 * The NPC kind's system. While the scene is walked it runs every NPC: the
 * shared schedule or the engagement holding it, then this player's own
 * touches (looking at them, greeting, stepping aside); E talks to the NPC in
 * the aim, and the walker bumps into NPCs instead of passing through.
 */
export default function NpcSystem() {
  const walkthrough = useViewer((state) => state.walkthroughMode)
  return walkthrough ? <NpcRuntime /> : null
}
