'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { NpcEditOverlay } from './body/edit-overlay'
import { NpcBody } from './body/npc-body'
import { NPC_ROLE_COLORS } from './presets'
import type { NpcNode } from './schema'

/** Bodies start this far apart (ms): a scene full of NPCs mounting at once stalls a frame. */
const MOUNT_STAGGER = 100
let nextMountAt = 0

function useStaggeredMount() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const now = performance.now()
    const at = Math.max(now, nextMountAt)
    nextMountAt = at + MOUNT_STAGGER
    const timer = window.setTimeout(() => setReady(true), at - now)
    return () => window.clearTimeout(timer)
  }, [])
  return ready
}

/** Stands in for the avatar while it loads. */
function MarkerSilhouette({ color }: { color: string }) {
  return (
    <mesh position={[0, 0.85, 0]}>
      <capsuleGeometry args={[0.2, 1.2, 4, 12]} />
      <meshStandardMaterial color={color} opacity={0.5} transparent />
    </mesh>
  )
}

/**
 * In build mode, a registered marker (placed by JSX like spawn, lifted onto
 * slabs by FloorElevationSystem): a hidden selection proxy, the avatar
 * standing in its look, and when selected where it wanders or patrols. While
 * the scene is walked the marker hides and an unregistered live body plays the
 * NPC in level-local space, so the marker's transform and floor lift never
 * fight the runtime pose.
 */
export default function NpcRenderer({ node }: { node: NpcNode }) {
  const markerRef = useRef<Group>(null!)
  const handlers = useNodeEvents(node as never, 'npc' as never)
  const liveOverride = useLiveNodeOverrides((state) => state.overrides.get(node.id))
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  const walkthroughMode = useViewer((state) => state.walkthroughMode)
  const selected = useViewer((state) => state.selection.selectedIds.includes(node.id as AnyNodeId))
  const ready = useStaggeredMount()
  useRegistry(node.id, 'npc', markerRef)

  // A marker mounts at its stored base Y; the mark has FloorElevationSystem
  // lift it onto its slab (a fresh viewer, such as the preview, remounts it).
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id as AnyNodeId)
  }, [node.id])

  const position =
    liveTransform?.position ??
    (liveOverride?.position as [number, number, number] | undefined) ??
    node.position
  const rotation =
    liveTransform?.rotation ?? (liveOverride?.rotation as number | undefined) ?? node.rotation
  const shown = node.visible !== false
  const silhouette = <MarkerSilhouette color={NPC_ROLE_COLORS[node.role]} />

  return (
    <>
      <group
        position={position}
        ref={markerRef}
        rotation={[0, rotation, 0]}
        visible={!walkthroughMode && shown}
      >
        {!walkthroughMode && (
          <mesh position={[0, 0.9, 0]} visible={false} {...handlers}>
            <cylinderGeometry args={[0.3, 0.3, 1.8, 12]} />
          </mesh>
        )}
        {ready ? (
          <Suspense fallback={silhouette}>
            <NpcBody mode="static" node={node} />
          </Suspense>
        ) : (
          silhouette
        )}
        {selected && !walkthroughMode && (
          <NpcEditOverlay node={node} position={position} rotation={rotation} />
        )}
      </group>
      {walkthroughMode && shown && ready && (
        <Suspense fallback={null}>
          <NpcBody mode="live" node={node} />
        </Suspense>
      )}
    </>
  )
}
