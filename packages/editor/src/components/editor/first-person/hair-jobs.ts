import { avatarGender, findAvatar } from './avatar-catalog'
import { type BaseInput, type BaseResult, flattenHead } from './hair-base'
import { cutKey } from './hair-cut'
import { groomOf, type Who } from './hair-groom'
import {
  growHair,
  growSeed,
  type HairBuild,
  type HairReply,
  type HairRequest,
  type HeadData,
  headData,
} from './hair-grow'
import type { HairLibrary } from './hair-styles'

/**
 * What a hair worker does with the page's requests (see hair-worker.ts):
 * builds a head's base and keeps what grows on it, and grows hair for
 * each character (`slot`) in stages, a newer request for a slot replacing
 * one still waiting and stopping one under way at its next stage (a
 * re-sent request that differs only in priority stops nothing). A grow
 * waits for its head's base while that is being built; for a head the
 * worker no longer keeps it answers `missing`, and the page sends the base
 * again. Pure: the worker hands it a way to post, to yield and to load the
 * hair library.
 */

export type HairJobsHost = {
  library: () => Promise<HairLibrary>
  post: (reply: HairReply, transfer: Transferable[]) => void
  /** Gives way to the worker's messages (a newer request may arrive meanwhile). */
  tick: () => Promise<void>
}

/** Heads a worker keeps (their flattened head, frames and radius maps), the least recently used let go first. */
export const HEADS_KEPT = 12

type Grow = Extract<HairRequest, { kind: 'grow' }>

const whoOf = (avatar: string): Who => ({
  sex: avatarGender(avatar),
  child: findAvatar(avatar).group === 'Children',
})

export class HairJobs {
  private readonly heads = new Map<string, { head: HeadData; who: Who }>()
  /** Avatars whose base is being built: their grows wait for it instead of answering `missing`. */
  private readonly building = new Set<string>()
  /** Avatars whose base failed: their grows answer with the failure until a base is sent again. */
  private readonly failed = new Map<string, string>()
  private readonly waiting = new Map<string, { grow: Grow; order: number }>()
  /** Per slot, the request it wants now: a grow under way stops at its next stage once it is not. */
  private readonly latest = new Map<string, Grow>()
  private pumping = false
  private order = 0

  constructor(
    private readonly host: HairJobsHost,
    private readonly kept = HEADS_KEPT,
  ) {}

  handle(request: HairRequest) {
    if (request.kind === 'base') {
      this.building.add(request.avatar)
      this.failed.delete(request.avatar)
      void this.base(request.avatar, request.input)
      return
    }
    const { slot } = request
    if (request.kind === 'cancel') {
      this.waiting.delete(slot)
      this.latest.delete(slot)
      return
    }
    const now = this.latest.get(slot)
    const queued = this.waiting.get(slot)
    if (now && sameGrow(now, request)) {
      // Only its priority moved (the background worker re-sends it as the camera moves):
      // reorder a waiting grow, and never restart one under way.
      if (queued) {
        this.waiting.set(slot, { grow: request, order: queued.order })
        this.latest.set(slot, request)
      }
      return
    }
    this.latest.set(slot, request)
    this.waiting.set(slot, { grow: request, order: this.order++ })
    void this.pump()
  }

  private async base(avatar: string, input: BaseInput) {
    try {
      const library = await this.host.library()
      const base = flattenHead(input, library)
      await this.host.tick()
      const head = headData(input, base, library)
      this.heads.delete(avatar)
      this.heads.set(avatar, { head, who: whoOf(avatar) })
      while (this.heads.size > this.kept) this.heads.delete(this.heads.keys().next().value!)
      this.host.post({ kind: 'base', avatar, base }, baseBuffers(base))
    } catch (error) {
      const message = messageOf(error)
      this.failed.set(avatar, message)
      this.host.post({ kind: 'error', avatar, message }, [])
    } finally {
      this.building.delete(avatar)
      void this.pump()
    }
  }

  /** The next grow: the most urgent (lowest priority), the first to arrive among equals; none whose base is still being built. */
  private next(): Grow | null {
    let best: { grow: Grow; order: number } | null = null
    for (const entry of this.waiting.values()) {
      if (this.building.has(entry.grow.avatar)) continue
      if (
        !best ||
        entry.grow.priority < best.grow.priority ||
        (entry.grow.priority === best.grow.priority && entry.order < best.order)
      ) {
        best = entry
      }
    }
    return best?.grow ?? null
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      for (;;) {
        const grow = this.next()
        if (!grow) return
        this.waiting.delete(grow.slot)
        await this.grow(grow)
        if (this.latest.get(grow.slot) === grow) this.latest.delete(grow.slot)
      }
    } finally {
      this.pumping = false
    }
  }

  private async grow(request: Grow) {
    const { slot, avatar, cut, tier, shape } = request
    const failure = this.failed.get(avatar)
    if (failure !== undefined) {
      this.host.post({ kind: 'error', slot, avatar, message: failure }, [])
      return
    }
    const known = this.heads.get(avatar)
    if (!known) {
      this.host.post({ kind: 'missing', avatar }, [])
      return
    }
    // Used again: the last to be let go.
    this.heads.delete(avatar)
    this.heads.set(avatar, known)
    const superseded = () => this.latest.get(slot) !== request
    try {
      const groom = groomOf({ ...cut, tip: null, shine: 0 }, known.who)
      const build = await growHair(
        known.head,
        groom,
        tier,
        shape,
        growSeed(avatar, cut.style),
        async () => {
          await this.host.tick()
          return superseded()
        },
      )
      if (!build || superseded()) return
      this.host.post({ kind: 'grow', slot, key: build.key, build }, buildBuffers(build))
    } catch (error) {
      this.host.post({ kind: 'error', slot, avatar, message: messageOf(error) }, [])
    }
  }
}

/** Whether two grows for a slot would build the same hair (they may differ in priority). */
const sameGrow = (a: Grow, b: Grow) =>
  a.avatar === b.avatar &&
  a.tier === b.tier &&
  a.shape.version === b.shape.version &&
  cutKey(a.cut) === cutKey(b.cut)

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Every array buffer a value holds (each once), to transfer it. */
function buffersOf(value: unknown, out = new Set<ArrayBuffer>()): Set<ArrayBuffer> {
  if (ArrayBuffer.isView(value)) out.add(value.buffer as ArrayBuffer)
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) buffersOf(item, out)
  }
  return out
}

export const buildBuffers = (build: HairBuild): Transferable[] => [...buffersOf(build)]

export const baseBuffers = (base: BaseResult): Transferable[] => [...buffersOf(base)]
