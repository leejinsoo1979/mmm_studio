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
 * one still waiting and stopping one under way at its next stage. A grow
 * for a head it no longer keeps answers `missing`, and the page sends the
 * base again. Pure: the worker hands it a way to post, to yield and to
 * load the hair library.
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

/** Whose head an avatar's is, by the catalogue. */
const whoOf = (avatar: string): Who => ({
  sex: avatarGender(avatar),
  child: findAvatar(avatar).group === 'Children',
})

export class HairJobs {
  private readonly heads = new Map<string, { head: HeadData; who: Who }>()
  private readonly waiting = new Map<string, Grow>()
  /** Per slot, how many requests it has had: a grow under way stops once its slot's has moved on. */
  private readonly asked = new Map<string, number>()
  private running = false
  private order = 0
  private readonly arrived = new Map<string, number>()

  constructor(
    private readonly host: HairJobsHost,
    private readonly kept = HEADS_KEPT,
  ) {}

  handle(request: HairRequest) {
    if (request.kind === 'base') {
      void this.base(request.avatar, request.input)
      return
    }
    this.asked.set(request.slot, (this.asked.get(request.slot) ?? 0) + 1)
    if (request.kind === 'cancel') {
      this.waiting.delete(request.slot)
      return
    }
    this.waiting.set(request.slot, request)
    this.arrived.set(request.slot, this.order++)
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
      void this.pump()
    } catch (error) {
      this.host.post({ kind: 'error', avatar, message: messageOf(error) }, [])
    }
  }

  /** The next grow: the most urgent (lowest priority), the first to arrive among equals. */
  private next(): Grow | null {
    let best: Grow | null = null
    for (const grow of this.waiting.values()) {
      if (
        !best ||
        grow.priority < best.priority ||
        (grow.priority === best.priority &&
          this.arrived.get(grow.slot)! < this.arrived.get(best.slot)!)
      ) {
        best = grow
      }
    }
    return best
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const grow = this.next()
        if (!grow) return
        this.waiting.delete(grow.slot)
        await this.grow(grow)
      }
    } finally {
      this.running = false
    }
  }

  private async grow(request: Grow) {
    const { slot, avatar, cut, tier, shape } = request
    const known = this.heads.get(avatar)
    if (!known) {
      this.host.post({ kind: 'missing', avatar }, [])
      return
    }
    // Used again: the last to be let go.
    this.heads.delete(avatar)
    this.heads.set(avatar, known)
    const asked = this.asked.get(slot)
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
          return this.asked.get(slot) !== asked
        },
      )
      if (!build || this.asked.get(slot) !== asked) return
      this.host.post(
        { kind: 'grow', slot, key: `${avatar}|${cutKey(cut)}|${tier}|${shape.version}`, build },
        buildBuffers(build),
      )
    } catch (error) {
      this.host.post({ kind: 'error', slot, avatar, message: messageOf(error) }, [])
    }
  }
}

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
