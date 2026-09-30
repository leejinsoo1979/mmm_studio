import { type FaceWarp, FRONT, maskImage, photoFace, swapFace, warpFace } from './face-swap'
import { type FrontImage, renderFront, tintIris } from './front-render'
import type { HeadGeometry } from './head-geometry'
import { hexToRgb, type Pixels } from './look-pixels'

/**
 * Everything a face swap onto one head needs, as plain data (it crosses to
 * a worker). The keys name what cached results depend on: `avatar` the
 * character (its head, geometry and hair), `front` the character as dyed.
 */
export type FaceJob = {
  /** The head texture, dyed: the face goes onto it (and it comes back). */
  head: Pixels
  avatar: string
  front: string
  geometry: HeadGeometry
  /** Where the head texture shows hair (0–1 per texel). */
  hair: Float32Array
  photo: Pixels
  photoKey: string
  /** The photo's face points and the character's (packed fractions). */
  points: number[]
  target: number[]
  blend: number
  light: number
  eyes: string | null
}

/** A few recent results kept, keyed by what they depend on (a slider drag repeats the rest). */
function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let value = cache.get(key)
  if (value === undefined) {
    value = make()
    cache.set(key, value)
    if (cache.size > 3) cache.delete(cache.keys().next().value!)
  }
  return value
}

const fronts = new Map<string, FrontImage>()
const hairFronts = new Map<string, Float32Array>()
const warps = new Map<string, FaceWarp>()
const photoFaces = new Map<string, Pixels>()

/** Where the character's hair covers its front view (0–1 per pixel). */
function hairFront(job: FaceJob): Float32Array {
  return remember(hairFronts, job.avatar, () => {
    const drawn = renderFront(
      maskImage(job.hair, job.head.width, job.head.height),
      job.geometry.all,
      FRONT,
    ).image.data
    const hair = new Float32Array(FRONT * FRONT)
    for (let i = 0; i < hair.length; i++) hair[i] = drawn[i * 4]! / 255
    return hair
  })
}

/** Swaps the photo's face onto the job's head texture (in place, and returned). */
export function runFaceJob(job: FaceJob): Pixels {
  const { head, geometry } = job
  const front = remember(fronts, job.front, () => renderFront(head, geometry.all, FRONT))
  const warpKey = `${job.avatar}|${job.points.join(',')}|${job.photoKey}`
  const warp = remember(warps, warpKey, () => warpFace(job.photo, job.points, job.target))
  const photo = remember(photoFaces, `${warpKey}|${job.light}`, () => photoFace(warp, job.light))
  swapFace(head, geometry.skin, front, hairFront(job), warp, photo, job.blend)
  if (job.eyes) for (const eye of geometry.eyes) tintIris(head, eye, hexToRgb(job.eyes))
  return head
}
