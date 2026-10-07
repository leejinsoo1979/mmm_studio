'use client'

import { useEffect, useRef, useState } from 'react'
import {
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
  Source,
  type Texture,
} from 'three'
import { type AvatarLook, type AvatarPaint, hasLook } from '../../../store/use-avatar-profile'
import { applyBodyBones } from './avatar-body'
import {
  bindOf,
  donorFor,
  feetOn,
  isFeetCopy,
  type LoadedDonor,
  loadFeetDonor,
  takeOffFeet,
  wearFeet,
} from './avatar-feet'
import { useAvatarHair } from './avatar-hair'
import { headOf, useAvatarShape } from './avatar-shape'
import type { ScalpPaint } from './bald-head'
import { hasBodyShape } from './body-shape'
import { hasFacePaint, NO_PAINT } from './face-paint'
import { loadFaceTargets } from './face-targets'
import { SHOD } from './footwear'
import { headGeometry } from './head-geometry'
import {
  BODIES_KEPT,
  type LookBody,
  type LookJob,
  type LookMessage,
  type LookReply,
  type LookResult,
  type Part,
  runLookJob,
  sameLookJob,
} from './look-job'
import { packTriangles, type Rgb } from './look-pixels'

type PartMesh = { mesh: Mesh; material: MeshStandardMaterial }

function partOf(material: Material): Part | null {
  const match = /_(head|body|opacity|feet)$/.exec(material.name)
  return match ? (match[1] as Part) : null
}

function partMeshes(model: Object3D) {
  const parts: Record<Part, PartMesh[]> = { head: [], body: [], opacity: [], feet: [] }
  model.traverse((object) => {
    const mesh = object as Mesh
    // A mesh showing another's material is dressed with it (see avatar-hair.ts).
    if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.userData.follows) return
    const material = (mesh.userData.lookOriginal ?? mesh.material) as MeshStandardMaterial
    const part = partOf(material)
    if (part && material.map) parts[part].push({ mesh, material })
  })
  return parts
}

/** A texture's picture as a bitmap, which a worker can take (the loader's own, mostly). */
function bitmapOf(texture: Texture): Promise<ImageBitmap> {
  const image = texture.image as ImageBitmapSource
  return typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap
    ? Promise.resolve(image)
    : createImageBitmap(image)
}

const bodies = new WeakMap<Texture['source'], Promise<LookBody>>()

/**
 * A body's textures and head geometry for a look, gathered once per body
 * (its head texture's picture names it). `head` is its head mesh: a bald
 * head's surface shares its texture (see avatar-hair.ts). Named by the
 * picture rather than the texture, the copies of a texture showing it —
 * the character studio's own, sharpened — name the same body: the game's
 * body, dressed in a look the studio just made, has the worker keep what
 * it worked out of that body for the studio (see look-job.ts) instead of
 * spending seconds on it again.
 */
function lookBody(parts: Record<Part, PartMesh[]>, head: Mesh | null): Promise<LookBody> | null {
  const headMap = parts.head[0]?.material.map
  const bodyMap = parts.body[0]?.material.map
  const opacityMap = parts.opacity[0]?.material.map
  if (!(headMap && bodyMap && head)) return null
  const picture = headMap.source
  let found = bodies.get(picture)
  if (!found) {
    const geometry = headGeometry(head)
    found = Promise.all([
      bitmapOf(headMap),
      bitmapOf(bodyMap),
      opacityMap ? bitmapOf(opacityMap) : null,
    ]).then(([head, body, opacity]) => ({
      key: picture.uuid,
      head,
      body,
      opacity,
      geometry: {
        all: packTriangles(geometry.all),
        skin: packTriangles(geometry.skin),
        eyes: geometry.eyes.map(packTriangles),
      },
    }))
    found.catch(() => bodies.delete(picture))
    bodies.set(picture, found)
  }
  return found
}

function textureFrom(bitmap: ImageBitmap, original: Texture): Texture {
  const texture = original.clone()
  // A clone shares its source: give this one its own picture.
  texture.source = new Source(bitmap)
  texture.needsUpdate = true
  return texture
}

/** A look being put together: settles with its textures, or null when a newer look for the same body replaced it. */
type Task = {
  job: LookJob
  signal: AbortSignal
  resolve: (result: LookResult | null) => void
  reject: (error: unknown) => void
}

let worker: Worker | null | undefined
/** The task the worker is on (it runs one at a time). */
let running: Task | null = null
/** The next task for each body: a newer look replaces the one still waiting (a colour drag makes many). */
const waiting = new Map<object, Task>()
/**
 * The bodies the worker holds, by key, oldest first: as it keeps them (see
 * look-worker.ts). Copying a body over takes the page a tenth of a second,
 * so a job names one it has by its key.
 */
const sent = new Set<string>()

/** Hands the worker a task, its body by its key alone when the worker has it. */
function post(task: Task, worker: Worker) {
  const { body, ...job } = task.job
  const known = sent.delete(body.key)
  sent.add(body.key)
  if (sent.size > BODIES_KEPT) sent.delete(sent.values().next().value!)
  const message: LookMessage = { job, key: body.key, body: known ? null : body }
  worker.postMessage(message)
}

/** Runs a task here, settling it. */
function runHere(task: Task): Promise<void> {
  return runLookJob(task.job).then(task.resolve, task.reject)
}

/** Starts the next waiting task (skipping those no longer wanted), if the worker is free. */
function next() {
  if (running || !worker) return
  for (const [body, task] of waiting) {
    waiting.delete(body)
    if (task.signal.aborted) {
      task.resolve(null)
      continue
    }
    running = task
    post(task, worker)
    return
  }
}

/** The look worker, started on first use; null where there are no workers, or it failed to start. */
function lookWorker(): Worker | null {
  if (worker !== undefined) return worker
  worker = null
  if (typeof Worker === 'undefined') return null
  try {
    const started = new Worker(new URL('./look-worker.ts', import.meta.url), { type: 'module' })
    started.onmessage = (event: MessageEvent<LookReply>) => {
      const task = running
      const { result, error, missing } = event.data
      if (missing && task) {
        sent.delete(task.job.body.key)
        post(task, started)
        return
      }
      running = null
      if (result) task?.resolve(result)
      else task?.reject(new Error(error))
      next()
    }
    // It didn't load: the tasks still wanted, and all later ones, are made
    // here, one at a time so the page keeps breathing between them.
    started.onerror = (event) => {
      event.preventDefault()
      started.terminate()
      worker = null
      console.warn('[look] the look worker did not start; looks are made on the main thread')
      const left = [...(running ? [running] : []), ...waiting.values()]
      running = null
      waiting.clear()
      let chain = Promise.resolve()
      for (const task of left) {
        chain = chain
          .then(() => new Promise((resolve) => setTimeout(resolve)))
          .then(() => (task.signal.aborted ? task.resolve(null) : runHere(task)))
      }
    }
    worker = started
  } catch {
    worker = null
  }
  return worker
}

/**
 * Puts a look together (see look-job.ts) in the worker, so the game doesn't
 * stall for the second or more it takes; here if there is no worker. Only
 * the latest look for each body waits its turn: settles with null for one
 * a newer look for that body replaced, or `signal` aborted, before it
 * started.
 */
function makeLook(body: object, job: LookJob, signal: AbortSignal): Promise<LookResult | null> {
  return new Promise((resolve, reject) => {
    const task = { job, signal, resolve, reject }
    if (!lookWorker()) {
      void runHere(task)
      return
    }
    waiting.get(body)?.resolve(null)
    waiting.set(body, task)
    next()
  })
}

/**
 * The look made last, with its own handles on its textures (bitmaps share
 * their pixels): a body put in the same look again — the game's, as the
 * character studio closes on the look it just made — is dressed at once,
 * not seconds later, once the worker made it again, its new textures then
 * sent to the GPU as the player walks off.
 */
let lastMade: { job: LookJob; result: LookResult } | null = null

/** A look's result with its own handles on its textures, their colours as they are (see look-job.ts's `bitmapOf`). */
async function copyOf(result: LookResult): Promise<LookResult> {
  const parts: LookResult['parts'] = {}
  await Promise.all(
    (Object.entries(result.parts) as [Part, ImageBitmap][]).map(async ([part, bitmap]) => {
      parts[part] = await createImageBitmap(bitmap, { premultiplyAlpha: 'none' })
    }),
  )
  return { ...result, parts }
}

const closeAll = (result: LookResult) => {
  for (const bitmap of Object.values(result.parts)) bitmap.close()
}

/** A look as makeLook makes it, or a copy of the one made last when that is the same look. */
async function madeLook(
  body: object,
  job: LookJob,
  signal: AbortSignal,
): Promise<LookResult | null> {
  const last = lastMade
  if (last && sameLookJob(last.job, job)) {
    const copy = await copyOf(last.result).catch(() => null)
    if (copy) return copy
  }
  const result = await makeLook(body, job, signal)
  // A face that failed is tried again (see useAvatarLook): not kept.
  if (result && !result.faceFailed) {
    copyOf(result).then(
      (copy) => {
        const replaced = lastMade
        lastMade = { job, result: copy }
        if (replaced) closeAll(replaced.result)
      },
      () => {},
    )
  }
  return result
}

/** The body mesh with the shoes, which borrowed feet replace (not its copy without them). */
function shodBody(parts: Record<Part, PartMesh[]>): SkinnedMesh | null {
  const found = parts.body.find(
    ({ mesh }) => (mesh as SkinnedMesh).isSkinnedMesh && !isFeetCopy(mesh),
  )
  return (found?.mesh as SkinnedMesh | undefined) ?? null
}

/**
 * Dresses a body in a look: its own copies of the textures the look changes
 * (the dyes, a bald head's skin, the swapped face, the face paint, socks or
 * bare feet) on its own copies of the materials — of every mesh showing
 * them when it is ready — and borrowed feet in place of its shoes (see
 * avatar-feet.ts) or its shoes back. Returns what undoes the dressing (the
 * original materials back, the copies freed), or null when `signal`
 * aborted it first; `retry` when the face or the landmarks it and the paint
 * are placed by, or the feet, couldn't be loaded (the look went on without
 * them) and may load later. `scalp` is how a bald head's skin is painted
 * (see bald-head.ts), `stubble` the colour of the hair worn over it and
 * `wig` where that shows.
 */
async function applyLook(
  model: Object3D,
  look: AvatarPaint,
  scalp: ScalpPaint | null,
  stubble: Rgb | null,
  wig: Float32Array | null,
  avatarId: string,
  signal: AbortSignal,
): Promise<{ undo: () => void; retry: boolean } | null> {
  const parts = partMeshes(model)
  const gathering = lookBody(parts, headOf(model))
  if (!gathering) return { undo: () => {}, retry: false }
  let retry = false
  // The face and the paint go by the character's face landmarks.
  const placed = look.face || hasFacePaint(look.paint)
  const shod = look.feet.wear !== 'shoes' ? shodBody(parts) : null
  const [body, target, donor] = await Promise.all([
    gathering,
    placed
      ? loadFaceTargets().then(
          (targets) => targets[avatarId] ?? null,
          () => {
            retry = true
            return null
          },
        )
      : null,
    shod
      ? loadFeetDonor(donorFor(avatarId)).catch((error: unknown): LoadedDonor | null => {
          console.warn('[look] could not load bare feet', error)
          retry = true
          return null
        })
      : null,
  ])
  if (signal.aborted) return null
  const job: LookJob = {
    body,
    avatar: avatarId,
    hair: look.hair,
    skin: look.skin,
    face: target && look.face,
    paint: look.paint,
    scalp: look.bald ? scalp : null,
    stubble: look.bald ? stubble : null,
    wig: look.bald ? wig : null,
    feet: look.feet,
    feetBind: shod && donor ? bindOf(shod) : null,
    feetDonor: donor?.donor ?? null,
    target,
  }
  // Without landmarks only the irises of the paint go on (a retry puts the
  // rest on).
  const painted = target ? hasFacePaint(job.paint) : job.paint.eyes
  if (!(job.hair || job.skin || job.face || job.scalp || painted || job.feetDonor)) {
    takeOffFeet(model)
    return { undo: () => {}, retry }
  }
  const result = await madeLook(model, job, signal)
  if (!result || signal.aborted) {
    for (const bitmap of Object.values(result?.parts ?? {})) bitmap.close()
    return null
  }
  if (result.faceFailed) retry = true

  if (result.feet && shod && donor) {
    wearFeet(model, shod, result.feet, donor.normalMap, look.feet.wear)
  } else {
    takeOffFeet(model)
  }
  // The meshes showing the textures now: wearing the feet adds some, and a
  // hairstyle put on meanwhile may have changed them.
  const dressed = partMeshes(model)
  const undo: (() => void)[] = []
  for (const part of Object.keys(result.parts) as Part[]) {
    const bitmap = result.parts[part]!
    const meshes = dressed[part]
    if (meshes.length === 0) {
      bitmap.close()
      continue
    }
    const texture = textureFrom(bitmap, meshes[0]!.material.map!)
    for (const { mesh, material } of meshes) {
      const dressed = material.clone()
      dressed.map = texture
      mesh.userData.lookOriginal = material
      mesh.material = dressed
      undo.push(() => {
        // A later look may have dressed the mesh since: leave that be.
        if (mesh.material === dressed) {
          mesh.material = material
          delete mesh.userData.lookOriginal
        }
        dressed.dispose()
      })
    }
    undo.push(() => {
      texture.dispose()
      bitmap.close()
    })
  }
  return {
    undo: () => {
      for (const step of undo) step()
    },
    retry,
  }
}

/** How many times, and how long after (ms, doubling), a look whose face didn't load tries again. */
const RETRIES = 4
const RETRY_AFTER = 3000

/**
 * Keeps a body dressed in a look, and its face shaped by it. A new look
 * replaces the old one only once it's ready (a face takes a moment), so the
 * body never shows undressed in between; no look, another body, or
 * unmounting undresses it at once.
 */
export function useAvatarLook(
  model: Object3D,
  look: AvatarLook | null | undefined,
  avatarId: string,
) {
  const dressing = useRef<{ model: Object3D; undo: () => void } | null>(null)
  const hairStyle = look?.hairStyle ?? null
  const hair = look?.hair ?? null
  const worn = useAvatarHair(model, hairStyle, hair)
  const [feet, setFeet] = useState<ReturnType<typeof feetOn>>(null)
  useAvatarShape(model, look, avatarId, worn?.shaper ?? null, feet)

  const body = look?.body
  useEffect(
    () => (body && hasBodyShape(body) ? applyBodyBones(model, body) : undefined),
    [model, body],
  )

  // Only the painted part of a look is dressed here: a new shape alone
  // leaves the textures be. A hairstyle worn in place of the character's
  // own makes its head bald, its skin painted round where its hair was
  // taken out; the meshes a hairstyle adds show the head's and the cards'
  // materials as they are dressed, so a new one alone needs no new look.
  // One the library doesn't offer is never worn, so its painted hair stays
  // with its own hair.
  const skin = look?.skin ?? null
  const face = look?.face ?? null
  const paint = look?.paint ?? NO_PAINT
  const footwear = look?.feet ?? SHOD
  const scalp = worn?.paint ?? null
  const stubble = worn?.stubble ?? null
  const wig = worn?.hairline ?? null
  useEffect(() => {
    const look: AvatarPaint = { hair, skin, face, paint, feet: footwear, bald: scalp !== null }
    if (dressing.current && (dressing.current.model !== model || !hasLook(look))) {
      dressing.current.undo()
      takeOffFeet(dressing.current.model)
      dressing.current = null
      setFeet(null)
    }
    if (!hasLook(look)) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const dress = (attempt: number) => {
      applyLook(model, look, scalp, stubble, wig, avatarId, controller.signal)
        .then((applied) => {
          if (!applied) return
          if (controller.signal.aborted) {
            applied.undo()
            return
          }
          dressing.current?.undo()
          dressing.current = { model, undo: applied.undo }
          setFeet(feetOn(model))
          if (applied.retry && attempt < RETRIES) {
            timer = setTimeout(() => dress(attempt + 1), RETRY_AFTER * 2 ** attempt)
          }
        })
        .catch((error: unknown) => console.warn('[look] could not dress the character', error))
    }
    dress(0)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [model, hair, skin, face, paint, footwear, scalp, stubble, wig, avatarId])

  useEffect(
    () => () => {
      if (dressing.current) {
        dressing.current.undo()
        takeOffFeet(dressing.current.model)
      }
      dressing.current = null
    },
    [],
  )
}
