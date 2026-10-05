import {
  type AnyNode,
  buildNavGrid,
  collectNavInputForLevel,
  hashNavInput,
  type NavGrid,
} from '@pascal-app/core'
import { collectSceneFacts } from '../knowledge'
import type { NpcNameResolvers } from '../types'
import { buildRoomMap, type NpcRoomMap } from './rooms'

/**
 * Navigation for the levels NPCs live on: one grid per level, kept while the
 * level's navigation input (its hash) is unchanged, with the level's room map.
 * The system refreshes it when the scene changes (debounced).
 */

type Entry = { hash: string; grid: NavGrid; rooms: NpcRoomMap }

type SceneNodes = Readonly<Record<string, AnyNode>>

const entries = new Map<string, Entry>()

/** Room names don't matter here, only their shapes. */
const PLAIN_NAMES: NpcNameResolvers = { item: (asset) => asset.name, material: (ref) => ref }

/** The ground level also walks the site around the house (passers-by outside). */
function includeSiteGround(nodes: SceneNodes, levelId: string): boolean {
  const level = nodes[levelId]
  return level?.type === 'level' && level.level === 0
}

/**
 * Brings the grids of `levelIds` up to date with `nodes`, rebuilding only
 * those whose input changed, and drops the others. Returns true when any grid
 * or room map changed.
 */
export function refreshNavCache(nodes: SceneNodes, levelIds: Iterable<string>): boolean {
  const wanted = new Set(levelIds)
  let changed = false
  for (const levelId of [...entries.keys()]) {
    if (!wanted.has(levelId)) {
      entries.delete(levelId)
      changed = true
    }
  }
  let facts: ReturnType<typeof collectSceneFacts> | null = null
  for (const levelId of wanted) {
    if (nodes[levelId]?.type !== 'level') {
      if (entries.delete(levelId)) changed = true
      continue
    }
    const input = collectNavInputForLevel(nodes, levelId, {
      includeSiteGround: includeSiteGround(nodes, levelId),
    })
    facts ??= collectSceneFacts(nodes as Record<string, AnyNode>, PLAIN_NAMES)
    const levelRooms = facts.rooms.filter((room) => room.levelId === levelId)
    // Rooms (zones) can change without the walkable floor changing.
    const hash = `${hashNavInput(input)}:${roomsHash(levelRooms)}`
    if (entries.get(levelId)?.hash === hash) continue
    const grid = buildNavGrid(input)
    entries.set(levelId, { hash, grid, rooms: buildRoomMap(grid, levelRooms) })
    changed = true
  }
  return changed
}

function roomsHash(rooms: readonly { id: string; polygon: readonly [number, number][] }[]): string {
  return JSON.stringify(rooms.map((room) => [room.id, room.polygon]))
}

export function navGridFor(levelId: string | null | undefined): NavGrid | null {
  return levelId ? (entries.get(levelId)?.grid ?? null) : null
}

export function roomMapFor(levelId: string | null | undefined): NpcRoomMap | null {
  return levelId ? (entries.get(levelId)?.rooms ?? null) : null
}

export function clearNavCache() {
  entries.clear()
}
