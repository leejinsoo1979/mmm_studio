import type { AnyNodeId } from '@pascal-app/core'

/**
 * The dirty NPCs whose marker is mounted: their marks can go. An NPC's mark
 * has one reader, `FloorElevationSystem` (frame priority 1), which lifts a
 * mounted marker onto its slab and leaves the mark of a kind with a system
 * of its own to that system. Never cleared, the marks keep the scene from
 * ever reading as built (the viewer's readiness waits out its frame cap on
 * every load) and every dirty-driven system walks them each frame.
 */
export function liftedNpcIds(
  dirty: Iterable<AnyNodeId>,
  nodes: Readonly<Record<string, { type: string } | undefined>>,
  mounted: { has(id: string): boolean },
): AnyNodeId[] {
  const ids: AnyNodeId[] = []
  for (const id of dirty) {
    if (nodes[id]?.type === 'npc' && mounted.has(id)) ids.push(id)
  }
  return ids
}
