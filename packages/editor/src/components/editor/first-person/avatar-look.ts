'use client'

import { useEffect } from 'react'
import {
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Source,
  type Texture,
} from 'three'
import { type AvatarLook, hasLook } from '../../../store/use-avatar-profile'
import { type FaceWarp, FRONT, maskImage, photoFace, swapFace, warpFace } from './face-swap'
import { loadFaceTargets } from './face-targets'
import { type FrontImage, renderFront, tintIris } from './front-render'
import { type HeadGeometry, headGeometry } from './head-geometry'
import {
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

/** A Rocketbox body's materials: `<code>_head`, `<code>_body`, `<code>_opacity` (hair cards and lashes; children have none). */
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

/** The hair's colour on the crown, for heads whose hair is all texture (no hair cards). */
const crownColor = (head: Pixels, geometry: HeadGeometry) =>
  colorWhere(
    head,
    geometry.all,
    (x, y) => Math.abs(x - 0.5) <= 0.12 && y >= 0.03 && y <= 0.12,
    [60, 45, 35],
  )

function analyse(parts: Record<Part, PartMesh[]>): Analysis | null {
  const headMap = parts.head[0]?.material.map
  const bodyMap = parts.body[0]?.material.map
  // Children have no hair cards: their hair is painted on the head.
  const opacityMap = parts.opacity[0]?.material.map
  if (!(headMap && bodyMap)) return null
  const cached = analyses.get(headMap)
  if (cached) return cached
  const head = readPixels(headMap)
  const body = readPixels(bodyMap)
  const opacity = opacityMap ? readPixels(opacityMap) : null
  const geometry = headGeometry(parts.head[0]!.mesh)
  const skin = skinColor(head, geometry)
  const hair = opacity ? meanColor(opacity) : crownColor(head, geometry)
  const hairOnHead = hairMask(head, hair, skin)
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
    hairLum: luminance(...hair),
    headHairLum: maskedLuminance(head, hairOnHead),
    skinLum: luminance(...skin),
    bodySkinLum: maskedLuminance(body, bodySkinMask),
  }
  analyses.set(headMap, analysis)
  return analysis
}

const photos = new Map<string, Promise<Pixels>>()

/** A face photo's pixels (a few recent ones kept). */
function photoPixels(photo: string): Promise<Pixels> {
  let found = photos.get(photo)
  if (!found) {
    found = new Promise<Pixels>((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        context.drawImage(image, 0, 0)
        resolve(context.getImageData(0, 0, canvas.width, canvas.height))
      }
      image.onerror = () => reject(new Error('얼굴 사진을 읽지 못했습니다'))
      image.src = photo
    })
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

const warps = new Map<string, FaceWarp>()
const photoFaces = new Map<string, Pixels>()
const fronts = new Map<string, FrontImage>()
const hairFronts = new WeakMap<Analysis, Float32Array>()

/** Where the character's hair covers its front view (0–1 per pixel). */
function hairFront(analysis: Analysis): Float32Array {
  let hair = hairFronts.get(analysis)
  if (!hair) {
    const { width, height } = analysis.head
    const drawn = renderFront(
      maskImage(analysis.hairMask, width, height),
      analysis.geometry.all,
      FRONT,
    ).image.data
    hair = new Float32Array(FRONT * FRONT)
    for (let i = 0; i < hair.length; i++) hair[i] = drawn[i * 4]! / 255
    hairFronts.set(analysis, hair)
  }
  return hair
}

/**
 * Dresses a body in a look: its own copies of the textures the look changes
 * (the swapped face, hair dye, skin tone) on its own copies of the materials.
 * Returns what undoes it (the original materials back, the copies freed).
 */
export async function applyLook(
  model: Object3D,
  look: AvatarLook,
  avatarId: string,
): Promise<() => void> {
  const parts = partMeshes(model)
  const analysis = analyse(parts)
  if (!analysis) return () => {}
  const face = look.face
  const [photo, target] = face
    ? await Promise.all([
        photoPixels(face.photo).catch(() => null),
        loadFaceTargets()
          .then((targets) => targets[avatarId] ?? null)
          .catch(() => null),
      ])
    : [null, null]

  const changed: Partial<Record<Part, Pixels>> = {}
  if ((face && photo && target) || look.hair || look.skin) {
    const head = copyPixels(analysis.head)
    if (look.hair) dye(head, hexToRgb(look.hair), analysis.headHairLum, analysis.hairMask)
    if (look.skin) dye(head, hexToRgb(look.skin), analysis.skinLum, analysis.headSkinMask)
    // The face goes on last: the dyes' masks are the character's own face,
    // not the photo's, and the face's colours meet the skin as dyed.
    if (face && photo && target) {
      const front = remember(fronts, `${avatarId}|${look.hair}|${look.skin}`, () =>
        renderFront(head, analysis.geometry.all, FRONT),
      )
      const warpKey = `${avatarId}|${face.points.join(',')}|${face.photo}`
      const warp = remember(warps, warpKey, () => warpFace(photo, face.points, target))
      const cleaned = remember(photoFaces, `${warpKey}|${face.light}`, () =>
        photoFace(warp, face.light),
      )
      swapFace(head, analysis.geometry.skin, front, hairFront(analysis), warp, cleaned, face.blend)
      if (face.eyes) {
        for (const eye of analysis.geometry.eyes) tintIris(head, eye, hexToRgb(face.eyes))
      }
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
  return () => {
    for (const step of undo) step()
  }
}

/** Keeps a body dressed in a look (undressed again when the look or body changes). */
export function useAvatarLook(
  model: Object3D,
  look: AvatarLook | null | undefined,
  avatarId: string,
) {
  useEffect(() => {
    if (!hasLook(look)) return
    let undo: (() => void) | null = null
    let cancelled = false
    void applyLook(model, look, avatarId).then((done) => {
      if (cancelled) done()
      else undo = done
    })
    return () => {
      cancelled = true
      undo?.()
    }
  }, [model, look, avatarId])
}
