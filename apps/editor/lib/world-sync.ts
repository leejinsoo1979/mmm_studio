/**
 * A shared game world, as flat entries: `door:<id>` → its open target,
 * `clock` → the hour, `screen:<id>` → what a TV shows, … A missing entry and
 * `null` read the same (closed, off, untouched).
 */
export type WorldValue =
  | null
  | boolean
  | number
  | string
  | WorldValue[]
  | { [key: string]: WorldValue }
export type WorldEntries = Record<string, WorldValue>

/** A value's text with map keys sorted: the store may hand maps back in any key order. */
function canonical(value: WorldValue | undefined): string {
  if (value === undefined || value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const sameWorldValue = (a: WorldValue | undefined, b: WorldValue | undefined) =>
  canonical(a) === canonical(b)

/** The entries that differ between two readings of the world (gone ones as `null`). */
export function changedEntries(before: WorldEntries, after: WorldEntries): WorldEntries {
  const changed: WorldEntries = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!sameWorldValue(before[key], after[key])) changed[key] = after[key] ?? null
  }
  return changed
}

/**
 * Keeps this player's world and the shared one in step, whatever carries the
 * entries between players:
 *  - what this player changes (read on each `tick`) is returned to publish,
 *    unless the shared world already says the same;
 *  - what the others change (each shared reading, `receive`) is applied here —
 *    and an applied entry doesn't come back out as this player's change.
 * Only changes travel: an entry the shared world still holds from before is
 * not re-applied over something done here meanwhile. The first shared reading
 * (joining) is applied whole. Readings are expected to include this player's
 * own writes as soon as they are made (Firestore's pending writes do).
 */
export class WorldSync {
  private local: WorldEntries | null = null
  private shared: WorldEntries | null = null

  constructor(
    private readonly read: () => WorldEntries,
    private readonly apply: (key: string, value: WorldValue) => void,
  ) {}

  /** A reading of the shared world. */
  receive(entries: WorldEntries) {
    const changes = this.shared ? changedEntries(this.shared, entries) : entries
    this.shared = entries
    for (const [key, value] of Object.entries(changes)) this.apply(key, value)
    const now = this.read()
    const local = this.local ?? now
    for (const key of Object.keys(changes)) {
      if (now[key] === undefined) delete local[key]
      else local[key] = now[key]
    }
    this.local = local
  }

  /** This player's changes since the last tick, to publish (nothing before joining). */
  tick(): WorldEntries {
    if (!(this.local && this.shared)) return {}
    const now = this.read()
    const changes = changedEntries(this.local, now)
    this.local = now
    const publish: WorldEntries = {}
    for (const [key, value] of Object.entries(changes)) {
      if (!sameWorldValue(this.shared[key], value)) publish[key] = value
    }
    // The store's readings include this player's writes from now on.
    this.shared = { ...this.shared, ...publish }
    return publish
  }
}
