// Ephemeral store for the wall / fence tools' click-chaining start points.
// Fence: the 3D tool (`@pascal-app/nodes` fence/tool.tsx) owns node creation
// for both views and publishes each chained commit's resolved end here so the
// 2D floor-plan draft chains from the same point.
// Wall: the view that received the input commits it — the 2D floor plan
// publishes its open draft start (and each committed end) for the 3D wall
// tool to mirror, and the 3D tool publishes its own chained commits for the
// floor plan to follow. Cleared on cancel, chain end, and unmount — never
// persisted, never in undo history.

import { create } from 'zustand'
import type { WallPlanPoint } from '../components/tools/wall/wall-snap-geometry'

type SegmentKind = 'wall' | 'fence'

type SegmentDraftChainState = {
  wall: WallPlanPoint | null
  fence: WallPlanPoint | null
  setChainStart(kind: SegmentKind, point: WallPlanPoint | null): void
  clear(kind: SegmentKind): void
}

const useSegmentDraftChain = create<SegmentDraftChainState>((set) => ({
  wall: null,
  fence: null,
  setChainStart: (kind, point) => set({ [kind]: point }),
  clear: (kind) => set({ [kind]: null }),
}))

export default useSegmentDraftChain
