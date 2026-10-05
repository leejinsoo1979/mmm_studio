import { useNpcRuntime } from './store'

/**
 * The shared NPC clock: wall-clock ms, which every player's engagements and
 * the epoch are written in. Players' clocks differ by about a second at most,
 * which only shifts a walking NPC a little along its path.
 */
export function npcNow(): number {
  return Date.now()
}

/**
 * The schedule origin. The first player to start sets it to their start time;
 * the world doc then hands it to everyone who joins (`npcEpoch`), so all
 * players see the same schedule. Signed out or alone, it is this start.
 */
export function ensureNpcEpoch(now: number = npcNow()): number {
  const { epoch, setEpoch } = useNpcRuntime.getState()
  if (epoch !== null) return epoch
  setEpoch(now)
  return now
}
