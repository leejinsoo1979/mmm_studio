import { create } from 'zustand'
import type { NpcPose, NpcRuntimeState } from '../types'
import {
  canonicalEngagement,
  decodeEngagement,
  encodeEngagement,
  NPC_EPOCH_KEY,
  npcEngagementKey,
  npcIdOfKey,
} from './engagement'

const BUBBLE_MS = 3500
/** Another player's NPC line stays up this long: a little per character, within bounds. */
const SHARED_LINE_MS_PER_CHAR = 70
const SHARED_LINE_MIN_MS = 3000
const SHARED_LINE_MAX_MS = 9000

export const useNpcRuntime = create<NpcRuntimeState>((set) => ({
  epoch: null,
  localPlayerId: 'local',
  engagements: {},
  bubbles: {},
  setEpoch: (epoch) => set({ epoch: Math.round(epoch) }),
  setLocalPlayerId: (localPlayerId) => set({ localPlayerId }),
  setEngagement: (npcId, engagement) =>
    set((state) => {
      const engagements = { ...state.engagements }
      // Canonical here too, so the writer computes from exactly what the others read.
      if (engagement) engagements[npcId] = canonicalEngagement(engagement)
      else delete engagements[npcId]
      return { engagements }
    }),
  say: (npcId, text, ms = BUBBLE_MS) =>
    set((state) => ({ bubbles: { ...state.bubbles, [npcId]: { text, until: Date.now() + ms } } })),
}))

/** Every NPC's pose this frame, written by the system before the bodies read it. */
export const npcPoses = new Map<string, NpcPose>()

/** World-space feet of every shown body, written by the bodies each frame. */
export const npcWorldFeet = new Map<string, [number, number, number]>()

/** The world-doc entries this player shares: `npcEpoch` and one `npc:<id>` per engagement. */
export function readNpcWorldEntries(): Record<string, unknown> {
  const { epoch, engagements } = useNpcRuntime.getState()
  const entries: Record<string, unknown> = {}
  if (epoch !== null) entries[NPC_EPOCH_KEY] = epoch
  for (const [npcId, engagement] of Object.entries(engagements)) {
    entries[npcEngagementKey(npcId)] = encodeEngagement(engagement)
  }
  return entries
}

/**
 * Applies another player's world-doc entry; false when `key` is not an NPC
 * entry. A line another player's conversation shares shows over the NPC.
 */
export function applyNpcWorldEntry(key: string, value: unknown): boolean {
  const runtime = useNpcRuntime.getState()
  if (key === NPC_EPOCH_KEY) {
    if (typeof value === 'number' && Number.isFinite(value)) runtime.setEpoch(value)
    else if (value === null || value === undefined) useNpcRuntime.setState({ epoch: null })
    return true
  }
  const npcId = npcIdOfKey(key)
  if (npcId === null) return false
  if (value === null || value === undefined) {
    runtime.setEngagement(npcId, null)
    return true
  }
  const engagement = decodeEngagement(value)
  if (!engagement) return true
  const before = runtime.engagements[npcId]
  runtime.setEngagement(npcId, engagement)
  const spoken = engagement.m === 'talk' || engagement.m === 'guide' ? engagement : null
  const line = spoken?.by !== runtime.localPlayerId ? spoken?.line : undefined
  const lineBefore = before?.m === 'talk' || before?.m === 'guide' ? before.line : undefined
  if (line && line !== lineBefore) {
    const ms = Math.min(
      SHARED_LINE_MAX_MS,
      Math.max(SHARED_LINE_MIN_MS, line.length * SHARED_LINE_MS_PER_CHAR),
    )
    runtime.say(npcId, line, ms)
  }
  return true
}
