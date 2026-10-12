import {
  BufferAttribute,
  BufferGeometry,
  type Material,
  type Matrix4,
  type Skeleton,
  SkinnedMesh,
} from 'three'
import type { BaseInput, BaseResult } from './hair-base'
import type { HairBuild, HairReply, HairRequest, RibbonArrays } from './hair-grow'
import { CORE_COVERAGE, type HairValues, hairMaterials, holdHairValues } from './hair-material'

/**
 * A build's strips as geometry, in the one layout every strip geometry
 * shares, so they all share one pipeline. `uv2` is the very attribute `uv`
 * is: the viewer adds a second uv only where one is missing, so it copies
 * nothing.
 */
export function ribbonGeometry(arrays: RibbonArrays): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(arrays.position, 3))
  geometry.setAttribute('normal', new BufferAttribute(arrays.normal, 3))
  geometry.setAttribute('tangent', new BufferAttribute(arrays.tangent, 4))
  const uv = new BufferAttribute(arrays.uv, 2)
  geometry.setAttribute('uv', uv)
  geometry.setAttribute('uv2', uv)
  geometry.setAttribute('hairData', new BufferAttribute(arrays.hairData, 4))
  geometry.setAttribute('hairShape', new BufferAttribute(arrays.hairShape, 4))
  geometry.setAttribute('skinIndex', new BufferAttribute(arrays.skinIndex, 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(arrays.skinWeight, 4))
  geometry.setIndex(new BufferAttribute(arrays.index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

/** The root layer, then the undercut shells after `shellStart` indices (see `showShells`). */
export function rootsGeometry(roots: BaseResult['roots']): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(roots.position, 3))
  geometry.setAttribute('normal', new BufferAttribute(roots.normal, 3))
  geometry.setAttribute('scalpDir', new BufferAttribute(roots.scalpDir, 4))
  geometry.setAttribute('comb', new BufferAttribute(roots.comb, 3))
  geometry.setAttribute('grows', new BufferAttribute(roots.grows, 1))
  geometry.setAttribute('skinIndex', new BufferAttribute(roots.skinIndex, 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(roots.skinWeight, 4))
  geometry.setIndex(new BufferAttribute(roots.index, 1))
  geometry.userData.shellStart = roots.shellStart
  geometry.computeBoundingSphere()
  showShells(geometry, false)
  return geometry
}

export function showShells(geometry: BufferGeometry, shown: boolean) {
  geometry.setDrawRange(
    0,
    shown ? Number.POSITIVE_INFINITY : (geometry.userData.shellStart as number),
  )
}

/** Which of a character's hair meshes this is (its name is `hair:<part>`). */
export type HairPart = 'inner' | 'outer' | 'strays' | 'soft' | 'roots'

const PARTS: Record<
  HairPart,
  { order: number; casts: boolean; core: (studio: boolean) => number | undefined }
> = {
  roots: { order: 1, casts: false, core: () => undefined },
  inner: { order: 2, casts: true, core: () => undefined },
  outer: { order: 2, casts: true, core: (studio) => (studio ? CORE_COVERAGE : undefined) },
  strays: { order: 2, casts: false, core: (studio) => (studio ? CORE_COVERAGE : undefined) },
  soft: { order: 3, casts: false, core: () => undefined },
}

const materialOf = (part: HairPart): Material =>
  part === 'roots'
    ? hairMaterials.roots
    : part === 'soft'
      ? hairMaterials.soft
      : hairMaterials.strands

/**
 * A hair mesh on a character's skeleton, carrying the character's values,
 * or null for a geometry with nothing to draw. `headBone` is the Head's
 * index in the skeleton: camera-facing strips turn in its frame, whatever
 * bone a strip's first vertex leans on. In the studio the outer strips
 * draw their solid cores here and their soft edges in the soft pass.
 */
export function hairMesh(
  part: HairPart,
  geometry: BufferGeometry,
  skeleton: Skeleton,
  bindMatrix: Matrix4,
  headBone: number,
  values: HairValues,
  studio: boolean,
): SkinnedMesh | null {
  if (!geometry.index?.count) return null
  const { order, casts, core } = PARTS[part]
  const mesh = new SkinnedMesh(geometry, materialOf(part))
  mesh.name = `hair:${part}`
  mesh.bind(skeleton, bindMatrix)
  mesh.renderOrder = order
  mesh.castShadow = casts
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  mesh.raycast = () => {}
  mesh.userData.hairBone = headBone
  holdHairValues(mesh, values, core(studio))
  return mesh
}

/** A hair worker as the page talks to it: a Worker running hair-worker.ts, or a stand-in. */
export type HairPort = {
  postMessage(message: HairRequest): void
  onmessage: ((event: MessageEvent<HairReply>) => void) | null
  onerror: ((event: Event) => void) | null
  terminate(): void
}

type Grow = Extract<HairRequest, { kind: 'grow' }>

/** Where a slot's builds (by their key: see hair-grow.ts's HairBuild) and failures go. */
export type GrowListener = {
  build: (key: string, build: HairBuild) => void
  error: (message: string) => void
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  // A base nobody waits on any more may still fail.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

/**
 * The page's side of a hair worker (see hair-jobs.ts): sends each head's
 * base once and hands its answer on, sends each character's (`slot`'s)
 * grows and routes its builds back, and when the worker no longer has a
 * head (`missing`) sends its base again and asks again for what each of
 * its slots wants. Started on first use; if the worker fails, every base
 * and grow fails from then on and the characters keep their own hair.
 */
export class HairClient {
  private port: HairPort | null | undefined
  private readonly inputs = new Map<string, BaseInput>()
  private readonly bases = new Map<string, Deferred<BaseResult>>()
  private readonly slots = new Map<string, { grow: Grow; listener: GrowListener }>()
  private dead: string | null = null

  constructor(private readonly start: () => HairPort) {}

  /** A head's base (see hair-base.ts), its input sent to the worker once. */
  base(avatar: string, input: BaseInput): Promise<BaseResult> {
    let found = this.bases.get(avatar)
    if (found) return found.promise
    found = deferred<BaseResult>()
    this.bases.set(avatar, found)
    this.inputs.set(avatar, input)
    if (this.dead !== null) found.reject(new Error(this.dead))
    else this.send({ kind: 'base', avatar, input })
    return found.promise
  }

  /** Asks for a slot's hair (a newer ask replaces one the worker hasn't started). */
  grow(request: Omit<Grow, 'kind'>, listener: GrowListener) {
    const grow: Grow = { kind: 'grow', ...request }
    this.slots.set(request.slot, { grow, listener })
    if (this.dead !== null) {
      const message = this.dead
      queueMicrotask(() => listener.error(message))
      return
    }
    this.send(grow)
  }

  /** Lets go of a slot: nothing it asked for comes back. */
  cancel(slot: string) {
    if (!this.slots.delete(slot)) return
    if (this.dead === null) this.send({ kind: 'cancel', slot })
  }

  private send(message: HairRequest) {
    this.portOf()?.postMessage(message)
  }

  private portOf(): HairPort | null {
    if (this.port !== undefined) return this.port
    try {
      const port = this.start()
      port.onmessage = (event) => this.receive(event.data)
      port.onerror = (event) => {
        event.preventDefault()
        this.fail('the hair worker stopped')
      }
      this.port = port
    } catch (error) {
      this.port = null
      this.fail(error instanceof Error ? error.message : String(error))
    }
    return this.port
  }

  private fail(message: string) {
    this.dead = message
    this.port?.terminate()
    this.port = null
    for (const base of this.bases.values()) base.reject(new Error(message))
    for (const { listener } of this.slots.values()) listener.error(message)
  }

  private receive(reply: HairReply) {
    switch (reply.kind) {
      case 'base':
        this.bases.get(reply.avatar)?.resolve(reply.base)
        return
      case 'grow':
        this.slots.get(reply.slot)?.listener.build(reply.key, reply.build)
        return
      case 'missing': {
        const input = this.inputs.get(reply.avatar)
        if (!input) return
        this.send({ kind: 'base', avatar: reply.avatar, input })
        for (const { grow } of this.slots.values()) {
          if (grow.avatar === reply.avatar) this.send(grow)
        }
        return
      }
      case 'error':
        if (reply.slot !== undefined) {
          this.slots.get(reply.slot)?.listener.error(reply.message)
        } else if (reply.avatar !== undefined) {
          // A base that failed is built again when it is next asked for.
          this.bases.get(reply.avatar)?.reject(new Error(reply.message))
          this.bases.delete(reply.avatar)
          this.inputs.delete(reply.avatar)
        }
    }
  }
}
