'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  type DataTexture,
  type Material,
  Matrix3,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
  type SkinnedMesh,
  type Texture,
  Vector3,
} from 'three'
import { type HairOn, hideHeadwear, hideOwnHair } from './avatar-hair'
import { headOf, onShaped, reshapeNow } from './avatar-shape'
import type { BaseInput, BaseResult } from './hair-base'
import {
  HairClient,
  type HairPart,
  type HairPort,
  hairMesh,
  ribbonGeometry,
  rootsGeometry,
  showShells,
} from './hair-client'
import { cutKey, type HairCut } from './hair-cut'
import { buildKey, type HairBuild } from './hair-grow'
import { bindArray, hairBaseInput } from './hair-input'
import {
  type HairValues,
  newHairValues,
  newStrandOffsets,
  setHairLook,
  setRootsStyle,
} from './hair-material'
import { type StripRanges, sortedIndex, stripRanges, turnedSince } from './hair-shading'
import {
  followRoots,
  type GrowAsk,
  GrowPlan,
  growCut,
  type HairDetail,
  pointsHash,
  shapedFlat,
  strandOffsets,
  wornLook,
} from './hair-wear'
import { headGeometry, loadedGeometry } from './head-geometry'
import { ownColours } from './look-job'
import type { Pixels, Rgb } from './look-pixels'

export type { HairDetail } from './hair-wear'

/**
 * Generated hair on a character: what the rest of the look needs of it
 * (see HairOn; null while none is worn), and `settled`, which resolves
 * once no grow is pending for it and its final tier is on, so a capture
 * never shows a preview, or the old hair, mid-build.
 */
export type GeneratedHair = { on: HairOn | null; settled: Promise<void> }

// --- The worker -------------------------------------------------------------

let client: HairClient | null = null

/** The hair worker the studio and the game's characters share (see hair-worker.ts), started on first use. */
function hairClient(): HairClient {
  client ??= new HairClient(
    () =>
      new Worker(new URL('./hair-worker.ts', import.meta.url), {
        type: 'module',
      }) as unknown as HairPort,
  )
  return client
}

// --- A head's base, on the page ----------------------------------------------

/** A head's base (see hair-base.ts) made ready to wear: shared by every character drawn from that head. */
type HairBase = {
  input: BaseInput
  result: BaseResult
  /** The loaded head, as the head showed it before generated hair went on. */
  loaded: BufferGeometry
  /** Its points in the bind pose (to carry a shape onto the flattened head: see shapedFlat). */
  loadedPoints: Float32Array
  /**
   * The flattened head: the loaded head's own uv and skinning, its points
   * laid flat. Never freed: it shares those with the loaded head, which
   * every character drawn from it shows.
   */
  flat: BufferGeometry
  /** The top of the flattened head (bind height): what reaches up to it is headwear. */
  top: number
  /** Bind units over which the roots' darker shade fades out (1.2 cm). */
  rootFade: number
  /** The avatar's own hair and skin colours, for a look without a dye or a skin tone. */
  own: { hair: string; skin: string }
}

const bases = new WeakMap<BufferGeometry, Promise<HairBase>>()

/** A head's base for generated hair, worked out by the hair worker once per loaded head. */
function hairBaseOf(model: Object3D, head: SkinnedMesh, avatar: string): Promise<HairBase> {
  const loaded = loadedGeometry(head)
  let found = bases.get(loaded)
  if (!found) {
    const input = hairBaseInput(model, avatar)
    if (!input) return Promise.reject(new Error(`${avatar} has no head of its own to grow hair on`))
    const own = ownTones(model, head)
    found = hairClient()
      .base(avatar, input)
      .then((result) => madeBase(head, loaded, input, result, own))
    found.catch(() => bases.delete(loaded))
    bases.set(loaded, found)
  }
  return found
}

function madeBase(
  head: SkinnedMesh,
  loaded: BufferGeometry,
  input: BaseInput,
  result: BaseResult,
  own: HairBase['own'],
): HairBase {
  const toLocal = head.bindMatrix.clone().invert()
  const normalToLocal = new Matrix3().getNormalMatrix(toLocal)
  const { points, normals, index } = result.head
  const position = new Float32Array(points.length)
  const normal = new Float32Array(normals.length)
  const v = new Vector3()
  let top = Number.NEGATIVE_INFINITY
  for (let i = 0; i < points.length / 3; i++) {
    top = Math.max(top, points[i * 3 + 1]!)
    v.fromArray(points, i * 3)
      .applyMatrix4(toLocal)
      .toArray(position, i * 3)
    v.fromArray(normals, i * 3)
      .applyMatrix3(normalToLocal)
      .normalize()
      .toArray(normal, i * 3)
  }
  const flat = new BufferGeometry()
  flat.name = `${loaded.name}:flat`
  for (const [name, attribute] of Object.entries(loaded.attributes)) {
    if (name !== 'position' && name !== 'normal') flat.setAttribute(name, attribute)
  }
  flat.setAttribute('position', new BufferAttribute(position, 3))
  flat.setAttribute('normal', new BufferAttribute(normal, 3))
  flat.setIndex(new BufferAttribute(index, 1))
  flat.morphAttributes = loaded.morphAttributes
  flat.morphTargetsRelative = loaded.morphTargetsRelative
  flat.computeBoundingSphere()
  return {
    input,
    result,
    loaded,
    loadedPoints: bindArray(head, loaded, 'position'),
    flat,
    top,
    rootFade: (1.2 * 0.01) / input.metresPerUnit,
    own,
  }
}

const OWN_DEFAULT = { hair: '#4f3426', skin: '#c8987a' }
/** The side (px) the textures are read at for the own colours: plenty for a median. */
const TONE_READ = 512

const hex = (rgb: Rgb) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

/** A texture's picture, read at `size` px square. */
function pixelsOf(texture: Texture | null | undefined, size: number): Pixels | null {
  const image = texture?.image as CanvasImageSource | undefined
  if (!image || typeof OffscreenCanvas === 'undefined') return null
  const canvas = new OffscreenCanvas(size, size)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, size, size)
  const { data } = context.getImageData(0, 0, size, size)
  return { data, width: size, height: size }
}

const mapOf = (mesh: Mesh) =>
  ((mesh.userData.lookOriginal ?? mesh.material) as MeshStandardMaterial).map

/**
 * The avatar's own hair and skin colours, read off its textures as the
 * look reads them (see look-job.ts's ownColours): the colour generated
 * hair takes until the look dyes it, and the roots' tint.
 */
function ownTones(model: Object3D, head: SkinnedMesh): HairBase['own'] {
  try {
    let cards: Mesh | null = null
    model.traverse((object) => {
      const mesh = object as Mesh
      const material = (mesh.userData.lookOriginal ?? mesh.material) as Material
      if (mesh.isMesh && !mesh.userData.follows && material?.name?.endsWith('_opacity')) {
        cards ??= mesh
      }
    })
    const headPixels = pixelsOf(mapOf(head), TONE_READ)
    if (!headPixels) return OWN_DEFAULT
    const cardPixels = cards ? pixelsOf(mapOf(cards), TONE_READ / 2) : null
    const found = ownColours(headPixels, cardPixels, headGeometry(head))
    return { hair: found.hair ? hex(found.hair) : OWN_DEFAULT.hair, skin: hex(found.skin) }
  } catch {
    return OWN_DEFAULT
  }
}

// --- Failures -----------------------------------------------------------------

const failedAvatars = new Set<string>()
const failureListeners = new Set<() => void>()

function noteFailure(avatar: string, message: string) {
  if (failedAvatars.has(avatar)) return
  failedAvatars.add(avatar)
  console.warn(`[hair] could not grow hair for ${avatar}; it keeps its own`, message)
  for (const listener of failureListeners) listener()
}

const subscribeFailures = (listener: () => void) => {
  failureListeners.add(listener)
  return () => {
    failureListeners.delete(listener)
  }
}

/** Whether generated hair failed for an avatar this session (it shows its own hair). */
export function useHairFailed(avatar: string): boolean {
  return useSyncExternalStore(
    subscribeFailures,
    () => failedAvatars.has(avatar),
    () => false,
  )
}

// --- One character's hair ----------------------------------------------------

/** How many times a character's grow may fail before it keeps its own hair. */
const TRIES = 2

/** How long (ms) a character stays on the studio's stage before its head's base is worked out ahead. */
const PREFETCH_MS = 2500

const PARTS: readonly Exclude<HairPart, 'roots'>[] = ['inner', 'outer', 'strays', 'soft']

/** A build's meshes on a character, and what its strands were grown against. */
type WornBuild = {
  meshes: SkinnedMesh[]
  geometries: BufferGeometry[]
  roots: HairBuild['roots']
  grownOn: Float32Array
}

/** What generated hair put on a character, and what takes it off. */
type Worn = {
  base: HairBase
  roots: SkinnedMesh
  rootsGeometry: BufferGeometry
  build: WornBuild | null
  /** The head's own hair and headwear shown again. */
  undo: (() => void)[]
}

const toBind = new Matrix4()
const camera = new Vector3()

/** Where a hair mesh's camera is in its bind space, through its head bone (see hair-material.ts's bindCamera). */
function cameraInBind(mesh: SkinnedMesh, view: Camera): Vector3 {
  const bone = mesh.userData.hairBone as number
  const { bones, boneInverses } = mesh.skeleton
  toBind
    .multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse)
    .multiply(bones[bone]!.matrixWorld)
    .multiply(boneInverses[bone]!)
    .multiply(mesh.bindMatrix)
    .invert()
  return camera.setFromMatrixPosition(view.matrixWorld).applyMatrix4(toBind)
}

/**
 * Keeps the studio's soft pass drawn back to front: its strips sorted
 * along the view again once the view has turned 8 degrees.
 */
function sortSoft(mesh: SkinnedMesh) {
  const geometry = mesh.geometry
  const index = geometry.index!
  const order = Uint32Array.from(index.array as Uint32Array)
  const ranges: StripRanges = stripRanges(
    order,
    geometry.getAttribute('position').array as Float32Array,
    geometry.getAttribute('hairData').array as Float32Array,
  )
  const centre = geometry.boundingSphere!.center
  let sortedFor: [number, number, number] | null = null
  mesh.onBeforeRender = (_renderer, _scene, view) => {
    // A pass looking from elsewhere (the studio's contact shadow, from below) would sort it for itself.
    if (!(view as PerspectiveCamera).isPerspectiveCamera) return
    const to = cameraInBind(mesh, view).sub(centre).normalize()
    const now: [number, number, number] = [to.x, to.y, to.z]
    if (!turnedSince(sortedFor, now)) return
    sortedIndex(order, ranges, now, index.array as Uint32Array)
    index.needsUpdate = true
    sortedFor = now
  }
}

const slots = new WeakMap<Object3D, HairSlot>()

/**
 * One character's generated hair: asks the hair worker for its cut (see
 * GrowPlan), puts each build on in place of the last (new meshes each
 * time, the old ones taken off before they are freed), keeps it on the
 * head as the head is shaped, and puts the character's own hair back.
 */
class HairSlot {
  readonly id: string
  private readonly head: SkinnedMesh | null
  private readonly plan: GrowPlan
  private readonly values: HairValues = newHairValues()
  private readonly offsets: DataTexture = newStrandOffsets()
  private cut: HairCut | null = null
  private colours: { hair: string | null; skin: string | null } = { hair: null, skin: null }
  private basing: Promise<HairBase> | null = null
  private base: HairBase | null = null
  private worn: Worn | null = null
  /** The grows sent, by their build's key, oldest first, with what each was grown against. */
  private readonly sent = new Map<string, { ask: GrowAsk; grownOn: Float32Array }>()
  private lastSent: GrowAsk | null = null
  /** The shape the hair was last asked for against (see pointsHash), and its version. */
  private shapeHash = 0
  private version = 0
  /** Whether a shape is waiting to be told apart (see shaped). */
  private checking = false
  private failures = 0
  private broken = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private prefetch: ReturnType<typeof setTimeout> | undefined
  private waiters: (() => void)[] = []
  private readonly stopShaped: () => void
  private disposed = false

  constructor(
    private readonly model: Object3D,
    private readonly avatar: string,
    private readonly detail: HairDetail,
    private readonly setOn: (on: HairOn | null) => void,
  ) {
    this.id = model.uuid
    const head = headOf(model) as SkinnedMesh | null
    this.head = head?.isSkinnedMesh ? head : null
    this.plan = new GrowPlan(detail, 0)
    this.values.offsets = this.offsets
    this.stopShaped = onShaped(model, () => this.shaped())
    // In the studio a style is likely to be picked: the head's base is worked out ahead, once
    // the character has stayed on the stage a moment, so the first pick waits on its grow alone.
    if (detail === 'studio') {
      this.prefetch = setTimeout(() => {
        if (!this.disposed) this.ready().catch(() => {})
      }, PREFETCH_MS)
    }
  }

  private readonly listener = {
    build: (key: string, build: HairBuild) => this.built(key, build),
    error: (message: string) => this.failed(message),
  }

  want(cut: HairCut | null, colours: { hair: string | null; skin: string | null }) {
    if (this.disposed) return
    this.cut = cut
    this.colours = colours
    this.writeLook()
    if (this.broken) return
    const ask = this.plan.want(cut && growCut(cut), performance.now())
    if (!cut) {
      this.sent.clear()
      hairClient().cancel(this.id)
      this.takeOff()
    }
    this.arm()
    if (ask) void this.send(ask)
    this.settle()
  }

  /** Resolves once nothing is left to grow (at once when nothing is). */
  settled(): Promise<void> {
    if (!this.plan.pending) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
    clearTimeout(this.prefetch)
    this.stopShaped()
    hairClient().cancel(this.id)
    this.takeOff()
    this.offsets.dispose()
    for (const resolve of this.waiters.splice(0)) resolve()
  }

  private ready(): Promise<HairBase> {
    if (!this.head) return Promise.reject(new Error(`${this.avatar} has no skinned head`))
    this.basing ??= hairBaseOf(this.model, this.head, this.avatar).then((base) => {
      this.base = base
      return base
    })
    return this.basing
  }

  private async send(ask: GrowAsk) {
    let base: HairBase
    try {
      base = await this.ready()
    } catch (error) {
      this.giveUp(error instanceof Error ? error.message : String(error))
      return
    }
    // A newer ask replaced it meanwhile: that one goes instead.
    if (this.disposed || this.broken || !this.plan.latest(ask)) return
    const grownOn = this.shapeNow(base)
    this.shapeHash = pointsHash(grownOn)
    const shape = { version: this.version, head: grownOn, body: null }
    this.sent.set(buildKey(this.avatar, ask.cut, ask.tier, shape), { ask, grownOn })
    this.lastSent = ask
    hairClient().grow(
      {
        slot: this.id,
        avatar: this.avatar,
        cut: ask.cut,
        tier: ask.tier,
        shape,
        priority: this.detail === 'studio' ? 0 : 1,
      },
      this.listener,
    )
  }

  private built(key: string, build: HairBuild) {
    const sent = this.sent.get(key)
    if (!sent || this.disposed) return
    // The grows sent before it are answered too: the worker answers a slot's in order.
    for (const known of [...this.sent.keys()]) {
      this.sent.delete(known)
      if (known === key) break
    }
    if (this.plan.built(sent.ask.key) && this.cut) {
      this.failures = 0
      this.wear(build, sent.grownOn)
    }
    this.settle()
  }

  private failed(message: string) {
    if (this.disposed || this.broken) return
    const ask = this.lastSent
    if (ask) this.plan.failed(ask.key)
    this.failures++
    if (this.failures >= TRIES) {
      this.giveUp(message)
      return
    }
    const again = this.plan.retry()
    if (again) void this.send(again)
  }

  /** The character keeps its own hair from now on. */
  private giveUp(message: string) {
    this.broken = true
    noteFailure(this.avatar, message)
    this.sent.clear()
    hairClient().cancel(this.id)
    this.takeOff()
    this.plan.want(null, performance.now())
    this.settle()
  }

  private writeLook() {
    const worn = this.worn
    if (!(worn && this.cut)) return
    setHairLook({ meshes: [worn.roots] }, wornLook(this.cut, this.colours, worn.base.own))
  }

  /** The flattened head's bind points as the head is shaped now. */
  private shapeNow(base: HairBase): Float32Array {
    const head = this.head!
    const shown = bindArray(head, head.geometry, 'position')
    return this.worn ? shown : shapedFlat(base.result.head.points, base.loadedPoints, shown)
  }

  /**
   * The head took a shape (or let one go): the hair follows at once, and
   * is grown again once the shape settles, if it is not the one the hair
   * was last asked for against. A shape put on again (taken off and put
   * back in one go, as a new look does) is told apart from a new one once
   * both are done.
   */
  private shaped() {
    if (this.disposed || !this.head) return
    this.follow()
    if (this.checking) return
    this.checking = true
    queueMicrotask(() => {
      this.checking = false
      const base = this.base
      if (this.disposed || !base) return
      const hash = pointsHash(this.shapeNow(base))
      if (hash === this.shapeHash) return
      this.shapeHash = hash
      this.version++
      this.plan.shaped(this.version, performance.now())
      this.arm()
    })
  }

  /** Strands and root layer onto the head as it is shaped now. */
  private follow() {
    const worn = this.worn
    const head = this.head
    if (!(worn && head)) return
    const points = bindArray(head, head.geometry, 'position')
    if (worn.build) {
      strandOffsets(
        worn.build.roots,
        worn.base.result.head.index,
        worn.build.grownOn,
        points,
        this.offsets.image.data as Float32Array,
      )
      this.offsets.needsUpdate = true
    }
    const { srcVertex, height } = worn.base.result.roots
    const position = worn.rootsGeometry.getAttribute('position') as BufferAttribute
    const normal = worn.rootsGeometry.getAttribute('normal') as BufferAttribute
    followRoots(
      srcVertex,
      height,
      points,
      bindArray(head, head.geometry, 'normal'),
      position.array as Float32Array,
      normal.array as Float32Array,
    )
    position.needsUpdate = true
    normal.needsUpdate = true
  }

  /** Lays the head's own hair flat, hides its cards and headwear, and puts the root layer on. */
  private wearBase(base: HairBase): Worn {
    const head = this.head!
    head.userData.hairOriginal = base.loaded
    if (head.userData.shapeOriginal) head.userData.shapeOriginal = base.flat
    else head.geometry = base.flat
    reshapeNow(head)
    const undo: (() => void)[] = []
    const headwear = hideHeadwear(this.model, base.top, base.input.marks.neck, undo)
    hideOwnHair(this.model, !headwear, undo)
    const { roots } = base.result
    const rootsGeo = rootsGeometry({
      ...roots,
      position: Float32Array.from(roots.position),
      normal: Float32Array.from(roots.normal),
    })
    const rootsMesh = hairMesh(
      'roots',
      rootsGeo,
      head.skeleton,
      head.bindMatrix,
      base.input.boneIndex.head,
      this.values,
      false,
    )!
    head.parent!.add(rootsMesh)
    this.values.rootFade = base.rootFade
    const worn: Worn = { base, roots: rootsMesh, rootsGeometry: rootsGeo, build: null, undo }
    this.worn = worn
    this.writeLook()
    this.setOn({
      shaper: () => null,
      paint: base.result.paint,
      stubble: null,
      hairline: null,
      mode: 'generated',
    })
    return worn
  }

  /** Puts a build on in place of the one on (the base first, the first time). */
  private wear(build: HairBuild, grownOn: Float32Array) {
    const head = this.head
    if (!head?.parent) return
    const worn = this.worn ?? (this.base && this.wearBase(this.base))
    if (!worn) return
    const studio = build.geometries.soft !== undefined
    const meshes: SkinnedMesh[] = []
    const geometries: BufferGeometry[] = []
    for (const part of PARTS) {
      const arrays = build.geometries[part]
      if (!arrays) continue
      const geometry = ribbonGeometry(arrays)
      const mesh = hairMesh(
        part,
        geometry,
        head.skeleton,
        head.bindMatrix,
        worn.base.input.boneIndex.head,
        this.values,
        studio,
      )
      if (!mesh) continue
      if (part === 'soft') sortSoft(mesh)
      head.parent.add(mesh)
      meshes.push(mesh)
      geometries.push(geometry)
    }
    const old = worn.build
    worn.build = { meshes, geometries, roots: build.roots, grownOn }
    setRootsStyle({ meshes: [worn.roots] }, build)
    showShells(worn.rootsGeometry, build.undercut !== null)
    this.values.ombre.set(build.ombre.earY, build.ombre.cutY)
    this.follow()
    // Off before they are freed, so no mesh still drawn has its buffers freed.
    if (old) {
      for (const mesh of old.meshes) mesh.removeFromParent()
      for (const geometry of old.geometries) geometry.dispose()
    }
  }

  /** Takes the hair off: its meshes, then the head as it was, its own hair and headwear back. */
  private takeOff() {
    const worn = this.worn
    const head = this.head
    if (!(worn && head)) return
    this.worn = null
    const meshes = [worn.roots, ...(worn.build?.meshes ?? [])]
    for (const mesh of meshes) mesh.removeFromParent()
    worn.rootsGeometry.dispose()
    for (const geometry of worn.build?.geometries ?? []) geometry.dispose()
    const { flat, loaded } = worn.base
    if (head.userData.shapeOriginal === flat) head.userData.shapeOriginal = loaded
    else if (head.geometry === flat) head.geometry = loaded
    if (head.userData.hairOriginal === loaded) delete head.userData.hairOriginal
    reshapeNow(head)
    for (const step of worn.undo.reverse()) step()
    this.offsets.image.data?.fill(0)
    this.offsets.needsUpdate = true
    this.setOn(null)
  }

  /** Asks for the final tier once a drag has settled. */
  private arm() {
    clearTimeout(this.timer)
    const at = this.plan.dueAt
    if (at === null || this.disposed) return
    this.timer = setTimeout(
      () => {
        const ask = this.plan.due(performance.now())
        if (ask) void this.send(ask)
        this.arm()
        this.settle()
      },
      Math.max(0, at - performance.now()),
    )
  }

  private settle() {
    if (this.plan.pending) return
    for (const resolve of this.waiters.splice(0)) resolve()
  }
}

/**
 * Resolves once a character's generated hair has nothing left to grow (at
 * once for a character without it): before a capture, so it never shows a
 * preview tier or the old hair mid-build.
 */
export function hairSettled(model: Object3D): Promise<void> {
  return slots.get(model)?.settled() ?? Promise.resolve()
}

/**
 * Keeps a character in a generated cut (null: its own hair), coloured
 * `colours.hair` (null: its own hair colour) with roots tinted toward
 * `colours.skin`. Hair is grown in the hair worker, at the detail asked
 * for (see GrowPlan); the character keeps its own hair until the first
 * build is in, and if it can't be grown.
 */
export function useGeneratedHair(
  model: Object3D,
  avatarId: string,
  cut: HairCut | null,
  colours: { hair: string | null; skin: string | null },
  detail: HairDetail,
): GeneratedHair {
  const [on, setOn] = useState<{ model: Object3D; on: HairOn } | null>(null)
  const slot = useRef<HairSlot | null>(null)
  useEffect(() => {
    const made = new HairSlot(model, avatarId, detail, (next) =>
      setOn(next ? { model, on: next } : null),
    )
    slot.current = made
    slots.set(model, made)
    return () => {
      made.dispose()
      if (slots.get(model) === made) slots.delete(model)
      if (slot.current === made) slot.current = null
    }
  }, [model, avatarId, detail])
  const { hair, skin } = colours
  const key = cut && `${cutKey(cut)}|${cut.tip}|${cut.shine}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: the cut is read by its key; a new slot wants it again
  useEffect(() => {
    slot.current?.want(cut, { hair, skin })
  }, [model, avatarId, detail, key, hair, skin])
  return {
    on: on?.model === model ? on.on : null,
    settled: slot.current?.settled() ?? Promise.resolve(),
  }
}
