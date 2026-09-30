import { FACE_PARTS, unpackPoints } from './face-points'
import {
  type FaceWarp,
  FRONT,
  maskImage,
  type PhotoFace,
  photoFace,
  swapFace,
  warpFace,
} from './face-swap'
import { type FrontImage, renderFront } from './front-render'
import type { HeadGeometry } from './head-geometry'
import type { Pixels } from './look-pixels'

/**
 * Everything a face swap onto one head needs, as plain data (it crosses to
 * a worker). The keys name what cached results depend on: `avatar` the
 * character (its head, geometry and hair: a shaved one is another), `front`
 * the character as dyed and shaved.
 */
export type FaceJob = {
  /** The head texture, dyed: the face goes onto it (and it comes back). */
  head: Pixels
  avatar: string
  front: string
  geometry: HeadGeometry
  /** Where the head texture shows hair (0–1 per texel); null for none (a shaved head). */
  hair: Float32Array | null
  photo: Pixels
  photoKey: string
  /** The photo's face points and the character's (packed fractions). */
  points: number[]
  target: number[]
  blend: number
  light: number
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
const photoFaces = new Map<string, PhotoFace>()

/** A front view no hair covers: one for every shaved head. */
let bareFront: Float32Array | null = null

/** Where the character's hair covers its front view (0–1 per pixel). */
function hairFront(job: FaceJob): Float32Array {
  const { hair } = job
  if (!hair) {
    bareFront ??= new Float32Array(FRONT * FRONT)
    return bareFront
  }
  return remember(hairFronts, job.avatar, () => {
    const drawn = renderFront(
      maskImage(hair, job.head.width, job.head.height),
      job.geometry.all,
      FRONT,
    ).image.data
    const covered = new Float32Array(FRONT * FRONT)
    for (let i = 0; i < covered.length; i++) covered[i] = drawn[i * 4]! / 255
    return covered
  })
}

/**
 * Irises closer than this (a fraction of the photo's longer side) are no
 * face: landmarks collapsed to a point (a double-clicked mark, a bad save)
 * would warp one pixel of the photo over the whole face.
 */
const MIN_EYE_SPACING = 0.02

function photoFaceIsOpen(job: FaceJob) {
  const points = unpackPoints(job.points)
  const [rx, ry] = points[FACE_PARTS.rightIris[0]!]!
  const [lx, ly] = points[FACE_PARTS.leftIris[0]!]!
  const { width, height } = job.photo
  return (
    Math.hypot((rx - lx) * width, (ry - ly) * height) >= MIN_EYE_SPACING * Math.max(width, height)
  )
}

/** Swaps the photo's face onto the job's head texture (in place, and returned; untouched for a face that isn't one). */
export function runFaceJob(job: FaceJob): Pixels {
  if (!photoFaceIsOpen(job)) return job.head
  const { head, geometry } = job
  const front = remember(fronts, job.front, () => renderFront(head, geometry.all, FRONT))
  const warpKey = `${job.avatar}|${job.points.join(',')}|${job.photoKey}`
  const warp = remember(warps, warpKey, () => warpFace(job.photo, job.points, job.target))
  const photo = remember(photoFaces, `${warpKey}|${job.light}`, () => photoFace(warp, job.light))
  swapFace(head, geometry.skin, front, hairFront(job), warp, photo, job.blend)
  return head
}
