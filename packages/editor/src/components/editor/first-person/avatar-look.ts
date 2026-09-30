'use client'

import { useEffect, useRef } from 'react'
import {
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Source,
  type Texture,
} from 'three'
import { type AvatarLook, hasLook } from '../../../store/use-avatar-profile'
import { type FaceJob, runFaceJob } from './face-job'
import { loadFaceTargets } from './face-targets'
import { forEachTexel } from './front-render'
import { type HeadGeometry, headGeometry } from './head-geometry'
import {
  colorDistance,
  dye,
  type HeadTriangle,
  hairMask,
  hexToRgb,
  luminance,
  maskedLuminance,
  meanColor,
  type Pixels,
  type Rgb,
  similarityMask,
} from './look-pixels'

/**
 * A Rocketbox body's materials: `<code>_head`, `<code>_body` and, on about
 * half of them, `<code>_opacity` (hair cards and lashes); the rest have
 * their hair, if any, painted on the head.
 */
type Part = 'head' | 'body' | 'opacity'

type PartMesh = { mesh: Mesh; material: MeshStandardMaterial }

function partOf(material: Material): Part | null {
  const match = /_(head|body|opacity)$/.exec(material.name)
  return match ? (match[1] as Part) : null
}

function partMeshes(model: Object3D) {
  const parts: Record<Part, PartMesh[]> = { head: [], body: [], opacity: [] }
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const material = (mesh.userData.lookOriginal ?? mesh.material) as MeshStandardMaterial
    const part = partOf(material)
    if (part && material.map) parts[part].push({ mesh, material })
  })
  return parts
}

function readPixels(texture: Texture): Pixels {
  const image = texture.image as CanvasImageSource & { width: number; height: number }
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

const copyPixels = (pixels: Pixels): Pixels => ({
  data: new Uint8ClampedArray(pixels.data),
  width: pixels.width,
  height: pixels.height,
})

/** Everything about a body's textures a look needs, worked out once per body. */
type Analysis = {
  head: Pixels
  body: Pixels
  opacity: Pixels | null
  geometry: HeadGeometry
  hairMask: Float32Array
  headSkinMask: Float32Array
  bodySkinMask: Float32Array
  hairLum: number
  headHairLum: number
  skinLum: number
  bodySkinLum: number
}

const analyses = new WeakMap<Texture, Analysis>()

/**
 * The median colour (by lightness, so brows and nostrils don't pull it off)
 * of the head's texture under the triangles centred in part of its front
 * view.
 */
function colorWhere(
  head: Pixels,
  triangles: readonly HeadTriangle[],
  within: (x: number, y: number, n: number) => boolean,
  fallback: Rgb,
): Rgb {
  const samples: Rgb[] = []
  for (const tri of triangles) {
    const x = (tri.x[0]! + tri.x[1]! + tri.x[2]!) / 3
    const y = (tri.y[0]! + tri.y[1]! + tri.y[2]!) / 3
    const n = (tri.n[0]! + tri.n[1]! + tri.n[2]!) / 3
    if (!within(x, y, n)) continue
    const u = (tri.u[0]! + tri.u[1]! + tri.u[2]!) / 3
    const v = (tri.v[0]! + tri.v[1]! + tri.v[2]!) / 3
    const p =
      (Math.min(head.height - 1, Math.floor(v * head.height)) * head.width +
        Math.min(head.width - 1, Math.floor(u * head.width))) *
      4
    samples.push([head.data[p]!, head.data[p + 1]!, head.data[p + 2]!])
  }
  if (samples.length === 0) return fallback
  samples.sort((a, b) => luminance(...a) - luminance(...b))
  return samples[Math.floor(samples.length / 2)]!
}

/** The skin's colour: the cheeks and nose, facing the front. */
const skinColor = (head: Pixels, geometry: HeadGeometry) =>
  colorWhere(
    head,
    geometry.skin,
    (x, y, n) => n >= 0.6 && Math.abs(x - 0.5) <= 0.14 && y >= 0.55 && y <= 0.72,
    [200, 160, 140],
  )

/** The crown's colour: a head without hair cards has its hair, if any, painted there. */
const crownColor = (head: Pixels, geometry: HeadGeometry) =>
  colorWhere(
    head,
    geometry.all,
    (x, y) => Math.abs(x - 0.5) <= 0.12 && y >= 0.03 && y <= 0.12,
    [60, 45, 35],
  )

/**
 * A crown nearer the skin's colour than this is bare (a bald or shaved head)
 * or cut off under a covering: the head has no painted hair to find.
 */
const BARE_CROWN = 0.2

/**
 * Clears a head's hair mask where no hair is: the eyeballs, whatever their
 * colour, and — when the mask comes from a guess at painted hair's colour —
 * the face and jaw below the eyes (the lowest brows sit above 0.45 of the
 * front view on every character), where a shadowed cheek or a dark skin can
 * match that colour. The back of the head keeps its hair.
 */
function clearHairlessTexels(
  mask: Float32Array,
  head: Pixels,
  geometry: HeadGeometry,
  painted: boolean,
) {
  const clear = (texel: number) => {
    mask[texel] = 0
  }
  forEachTexel(head, geometry.eyes.flat(), () => true, clear)
  if (!painted) return
  forEachTexel(
    head,
    geometry.skin,
    (tri) => {
      const x = (tri.x[0]! + tri.x[1]! + tri.x[2]!) / 3
      const y = (tri.y[0]! + tri.y[1]! + tri.y[2]!) / 3
      return Math.abs(x - 0.5) < 0.28 && y > 0.45 && tri.n[0]! + tri.n[1]! + tri.n[2]! > -0.6
    },
    clear,
  )
}

function analyse(parts: Record<Part, PartMesh[]>): Analysis | null {
  const headMap = parts.head[0]?.material.map
  const bodyMap = parts.body[0]?.material.map
  const opacityMap = parts.opacity[0]?.material.map
  if (!(headMap && bodyMap)) return null
  const cached = analyses.get(headMap)
  if (cached) return cached
  const head = readPixels(headMap)
  const body = readPixels(bodyMap)
  const opacity = opacityMap ? readPixels(opacityMap) : null
  const geometry = headGeometry(parts.head[0]!.mesh)
  const skin = skinColor(head, geometry)
  const skinLum = luminance(...skin)
  const crown = opacity ? null : crownColor(head, geometry)
  const painted = crown && colorDistance(...crown, skin, skinLum) > BARE_CROWN ? crown : null
  const hairColour = opacity ? meanColor(opacity) : painted
  const hairOnHead = hairColour
    ? hairMask(head, hairColour, skin)
    : new Float32Array(head.width * head.height)
  if (hairColour) clearHairlessTexels(hairOnHead, head, geometry, !opacity)
  const headSkinMask = similarityMask(head, skin)
  for (let i = 0; i < headSkinMask.length; i++) headSkinMask[i]! *= 1 - hairOnHead[i]!
  const bodySkinMask = similarityMask(body, skin, 0.08, 0.2)
  const analysis: Analysis = {
    head,
    body,
    opacity,
    geometry,
    hairMask: hairOnHead,
    headSkinMask,
    bodySkinMask,
    hairLum: opacity ? luminance(...meanColor(opacity)) : 0,
    headHairLum: maskedLuminance(head, hairOnHead),
    skinLum,
    bodySkinLum: maskedLuminance(body, bodySkinMask),
  }
  analyses.set(headMap, analysis)
  return analysis
}

const photos = new Map<string, Promise<Pixels>>()

/** Larger than this a side, a face photo is none the studio made: it isn't read. */
const PHOTO_MAX = 2048

/** A face photo's pixels (a few recent ones kept). */
function photoPixels(photo: string): Promise<Pixels> {
  let found = photos.get(photo)
  if (!found) {
    found = new Promise<Pixels>((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        try {
          const { naturalWidth: width, naturalHeight: height } = image
          if (!(width > 0 && height > 0 && width <= PHOTO_MAX && height <= PHOTO_MAX)) {
            throw new Error(`face photo ${width}×${height}`)
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d', { willReadFrequently: true })!
          context.drawImage(image, 0, 0)
          resolve(context.getImageData(0, 0, width, height))
        } catch (error) {
          reject(error)
        }
      }
      image.onerror = () => reject(new Error('얼굴 사진을 읽지 못했습니다'))
      image.src = photo
    })
    // A photo that didn't load can be tried again.
    found.catch(() => photos.delete(photo))
    photos.set(photo, found)
    if (photos.size > 4) photos.delete(photos.keys().next().value!)
  }
  return found
}

function textureFrom(pixels: Pixels, original: Texture): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0)
  const texture = original.clone()
  // A clone shares its source: give this one its own picture.
  texture.source = new Source(canvas)
  texture.needsUpdate = true
  return texture
}

/** A face swap waiting or running: settles with the head, or null when a newer one for the same body replaced it. */
type Task = {
  job: FaceJob
  signal: AbortSignal
  resolve: (head: Pixels | null) => void
  reject: (error: unknown) => void
}

let worker: Worker | null | undefined
/** The task the worker is on (it runs one at a time). */
let running: Task | null = null
/** The next task for each body: a newer look replaces the one still waiting (a colour drag makes many). */
const waiting = new Map<object, Task>()

/** Runs a task here, settling it. */
function runHere(task: Task) {
  try {
    task.resolve(runFaceJob(task.job))
  } catch (error) {
    task.reject(error)
  }
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
    // Copied, not transferred: the job must still be runnable here if the worker fails.
    worker.postMessage({ job: task.job })
    return
  }
}

/** The face swap worker, started on first use; null where there are no workers, or it failed to start. */
function faceWorker(): Worker | null {
  if (worker !== undefined) return worker
  worker = null
  if (typeof Worker === 'undefined') return null
  try {
    const started = new Worker(new URL('./face-worker.ts', import.meta.url), { type: 'module' })
    started.onmessage = (event: MessageEvent<{ head?: Pixels; error?: string }>) => {
      const task = running
      running = null
      const { head, error } = event.data
      if (head) task?.resolve(head)
      else task?.reject(new Error(error))
      next()
    }
    // It didn't load: the tasks for it, and all later ones, run here.
    started.onerror = (event) => {
      event.preventDefault()
      started.terminate()
      worker = null
      const left = [...(running ? [running] : []), ...waiting.values()]
      running = null
      waiting.clear()
      for (const task of left) runHere(task)
    }
    worker = started
  } catch {
    worker = null
  }
  return worker
}

/**
 * Swaps a face onto a head (see face-job.ts) in the worker, so the game
 * doesn't stall for the second or more it takes; here if there is no worker.
 * Only the latest swap for each body waits its turn: settles with null for
 * one a newer swap for that body replaced, or `signal` aborted, before it
 * started.
 */
function swapFaceAside(body: object, job: FaceJob, signal: AbortSignal): Promise<Pixels | null> {
  return new Promise((resolve, reject) => {
    const task = { job, signal, resolve, reject }
    if (!faceWorker()) {
      runHere(task)
      return
    }
    waiting.get(body)?.resolve(null)
    waiting.set(body, task)
    next()
  })
}

/**
 * Dresses a body in a look: its own copies of the textures the look changes
 * (the swapped face, hair dye, skin tone) on its own copies of the materials.
 * Returns what undoes it (the original materials back, the copies freed),
 * or null when `signal` aborted it first; `retry` when the face couldn't be
 * loaded (the look went on without it) and may load later.
 */
async function applyLook(
  model: Object3D,
  look: AvatarLook,
  avatarId: string,
  signal: AbortSignal,
): Promise<{ undo: () => void; retry: boolean } | null> {
  const parts = partMeshes(model)
  const analysis = analyse(parts)
  if (!analysis) return { undo: () => {}, retry: false }
  const face = look.face
  let retry = false
  const [photo, target] = face
    ? await Promise.all([
        photoPixels(face.photo).catch(() => {
          retry = true
          return null
        }),
        loadFaceTargets().then(
          (targets) => targets[avatarId] ?? null,
          () => {
            retry = true
            return null
          },
        ),
      ])
    : [null, null]
  if (signal.aborted) return null

  const changed: Partial<Record<Part, Pixels>> = {}
  if ((face && photo && target) || look.hair || look.skin) {
    const dyed = copyPixels(analysis.head)
    if (look.hair) dye(dyed, hexToRgb(look.hair), analysis.headHairLum, analysis.hairMask)
    if (look.skin) dye(dyed, hexToRgb(look.skin), analysis.skinLum, analysis.headSkinMask)
    let head = dyed
    // The face goes on last: the dyes' masks are the character's own face,
    // not the photo's, and the face's colours meet the skin as dyed.
    if (face && photo && target) {
      try {
        const swapped = await swapFaceAside(
          model,
          {
            head: dyed,
            avatar: avatarId,
            front: `${avatarId}|${look.hair}|${look.skin}`,
            geometry: analysis.geometry,
            hair: analysis.hairMask,
            photo,
            photoKey: face.photo,
            points: face.points,
            target,
            blend: face.blend,
            light: face.light,
            eyes: face.eyes,
          },
          signal,
        )
        if (!swapped) return null
        head = swapped
      } catch (error) {
        // The dyes still go on; the face is left out.
        console.warn('[look] face swap failed', error)
      }
      if (signal.aborted) return null
    }
    changed.head = head
  }
  if (look.hair && analysis.opacity) {
    const opacity = copyPixels(analysis.opacity)
    dye(opacity, hexToRgb(look.hair), analysis.hairLum)
    changed.opacity = opacity
  }
  if (look.skin) {
    const body = copyPixels(analysis.body)
    dye(body, hexToRgb(look.skin), analysis.bodySkinLum, analysis.bodySkinMask)
    changed.body = body
  }

  const undo: (() => void)[] = []
  for (const part of Object.keys(changed) as Part[]) {
    const pixels = changed[part]!
    for (const { mesh, material } of parts[part]) {
      const texture = textureFrom(pixels, material.map!)
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
        texture.dispose()
      })
    }
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
 * Keeps a body dressed in a look. A new look replaces the old one only once
 * it's ready (a face takes a moment), so the body never shows undressed in
 * between; no look, another body, or unmounting undresses it at once.
 */
export function useAvatarLook(
  model: Object3D,
  look: AvatarLook | null | undefined,
  avatarId: string,
) {
  const dressing = useRef<{ model: Object3D; undo: () => void } | null>(null)

  useEffect(() => {
    if (dressing.current && (dressing.current.model !== model || !hasLook(look))) {
      dressing.current.undo()
      dressing.current = null
    }
    if (!hasLook(look)) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const dress = (attempt: number) => {
      applyLook(model, look, avatarId, controller.signal)
        .then((applied) => {
          if (!applied) return
          if (controller.signal.aborted) {
            applied.undo()
            return
          }
          dressing.current?.undo()
          dressing.current = { model, undo: applied.undo }
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
  }, [model, look, avatarId])

  useEffect(
    () => () => {
      dressing.current?.undo()
      dressing.current = null
    },
    [],
  )
}
