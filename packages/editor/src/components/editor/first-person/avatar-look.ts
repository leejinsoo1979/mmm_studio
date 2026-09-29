'use client'

import { useEffect } from 'react'
import {
  type Material,
  Matrix3,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
  Source,
  type Texture,
  Vector3,
} from 'three'
import { type AvatarLook, hasLook } from '../../../store/use-avatar-profile'
import {
  bakeFace,
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

/** A Rocketbox body's three materials: `<code>_head`, `<code>_body`, `<code>_opacity` (hair, lashes). */
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

/**
 * The head's triangles on its texture and on a square front view framing the
 * skull (from the top of the head to just under the chin), in the bind pose;
 * and which of them are the face's skin — the largest connected piece facing
 * the front. The eyeballs and the inside of the mouth are pieces of their
 * own (their texture sits elsewhere): a face photo must not paint them.
 */
/** Where the eyes and the mouth are on the head's front view (fractions of it, y down). */
export type FaceLandmarks = {
  leftEye: [number, number]
  rightEye: [number, number]
  mouth: [number, number]
}

type HeadGeometry = { all: HeadTriangle[]; skin: HeadTriangle[]; landmarks: FaceLandmarks | null }

function headTriangles(head: Mesh): HeadGeometry {
  const geometry = head.geometry
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  if (!(position && normal && uv)) return { all: [], skin: [], landmarks: null }
  const skinned = head as SkinnedMesh
  const bind = skinned.isSkinnedMesh ? skinned.bindMatrix : new Matrix4()
  const normalMatrix = new Matrix3().getNormalMatrix(bind)
  const points: Vector3[] = []
  const normals: number[] = []
  const v = new Vector3()
  for (let i = 0; i < position.count; i++) {
    points.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(bind))
    v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize()
    normals.push(v.z)
  }

  // The skull: from the top of the head down to the head bone (the top of
  // the neck), plus the chin under it.
  let top = Number.NEGATIVE_INFINITY
  let headBoneY = Number.NEGATIVE_INFINITY
  if (skinned.isSkinnedMesh) {
    const bones = skinned.skeleton.bones
    const index = bones.findIndex((bone) => /Head$/.test(bone.name))
    if (index >= 0) {
      headBoneY = new Vector3().setFromMatrixPosition(
        new Matrix4().copy(skinned.skeleton.boneInverses[index]!).invert(),
      ).y
    }
  }
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  for (const point of points) {
    top = Math.max(top, point.y)
    if (point.y > headBoneY) {
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
    }
  }
  if (!Number.isFinite(headBoneY)) headBoneY = top - 0.2
  const size = (top - headBoneY) * 1.45
  const left = (minX + maxX) / 2 - size / 2
  const frameTop = top + size * 0.03

  // Pieces: corners at one spot are one (texture seams split vertices that
  // the surface still joins).
  const spot = new Map<string, number>()
  const parent: number[] = []
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  const vertexPiece = points.map((point) => {
    const key = `${Math.round(point.x * 1e4)},${Math.round(point.y * 1e4)},${Math.round(point.z * 1e4)}`
    let piece = spot.get(key)
    if (piece === undefined) {
      piece = parent.length
      parent.push(piece)
      spot.set(key, piece)
    }
    return piece
  })

  const index = geometry.index
  const count = index ? index.count : position.count
  const all: HeadTriangle[] = []
  const corners: number[][] = []
  for (let i = 0; i < count; i += 3) {
    const tri = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k))
    corners.push(tri)
    const [a, b, c] = tri.map((corner) => find(vertexPiece[corner]!)) as [number, number, number]
    parent[b] = a
    parent[find(c)] = find(a)
    all.push({
      u: tri.map((c) => uv.getX(c)),
      v: tri.map((c) => uv.getY(c)),
      x: tri.map((c) => (points[c]!.x - left) / size),
      y: tri.map((c) => (frameTop - points[c]!.y) / size),
      n: tri.map((c) => normals[c]!),
      z: tri.map((c) => points[c]!.z),
    })
  }
  // The skin: the piece with the most front-facing area across the face.
  const frontArea = new Map<number, number>()
  const pieceOf = corners.map((tri) => find(vertexPiece[tri[0]!]!))
  all.forEach((tri, i) => {
    const x = (tri.x[0]! + tri.x[1]! + tri.x[2]!) / 3
    const y = (tri.y[0]! + tri.y[1]! + tri.y[2]!) / 3
    if (Math.abs(x - 0.5) > 0.3 || y < 0.2 || y > 0.9) return
    const area = Math.abs(
      (tri.x[1]! - tri.x[0]!) * (tri.y[2]! - tri.y[0]!) -
        (tri.x[2]! - tri.x[0]!) * (tri.y[1]! - tri.y[0]!),
    )
    const piece = pieceOf[i]!
    frontArea.set(piece, (frontArea.get(piece) ?? 0) + area)
  })
  let skinPiece = -1
  let most = 0
  for (const [piece, area] of frontArea) {
    if (area > most) {
      most = area
      skinPiece = piece
    }
  }
  return {
    all,
    skin: all.filter((_, i) => pieceOf[i] === skinPiece),
    landmarks: findLandmarks(all, pieceOf, skinPiece),
  }
}

/**
 * The eyes are the two front pieces (besides the skin) a mirror image of
 * each other; the mouth, the piece between and below them (the teeth and
 * tongue) — or where a face usually has it, a little more than the eyes'
 * spacing below them.
 */
function findLandmarks(
  triangles: HeadTriangle[],
  pieceOf: number[],
  skinPiece: number,
): FaceLandmarks | null {
  const pieces = new Map<number, { x: number; y: number; area: number }>()
  triangles.forEach((tri, i) => {
    const piece = pieceOf[i]!
    if (piece === skinPiece || tri.n[0]! + tri.n[1]! + tri.n[2]! < 0) return
    const area =
      Math.abs(
        (tri.x[1]! - tri.x[0]!) * (tri.y[2]! - tri.y[0]!) -
          (tri.x[2]! - tri.x[0]!) * (tri.y[1]! - tri.y[0]!),
      ) + 1e-9
    const entry = pieces.get(piece) ?? { x: 0, y: 0, area: 0 }
    entry.x += ((tri.x[0]! + tri.x[1]! + tri.x[2]!) / 3) * area
    entry.y += ((tri.y[0]! + tri.y[1]! + tri.y[2]!) / 3) * area
    entry.area += area
    pieces.set(piece, entry)
  })
  const centres = [...pieces.values()].map(({ x, y, area }) => ({ x: x / area, y: y / area, area }))
  let eyes: [(typeof centres)[number], (typeof centres)[number]] | null = null
  let best = Number.POSITIVE_INFINITY
  for (const a of centres) {
    for (const b of centres) {
      if (a.x >= 0.5 || b.x <= 0.5) continue
      const mismatch =
        Math.abs(a.x - 0.5 - (0.5 - b.x)) + Math.abs(a.y - b.y) + Math.abs(a.area - b.area) * 20
      if (Math.abs(a.x - b.x) > 0.08 && mismatch < best) {
        best = mismatch
        eyes = [a, b]
      }
    }
  }
  if (!eyes) return null
  const [left, right] = eyes
  const eyeY = (left.y + right.y) / 2
  const spacing = right.x - left.x
  const mouthPiece = centres.find(
    (c) => Math.abs(c.x - 0.5) < 0.05 && c.y > eyeY + spacing * 0.7 && c.y < eyeY + spacing * 1.6,
  )
  return {
    leftEye: [left.x, left.y],
    rightEye: [right.x, right.y],
    mouth: mouthPiece ? [mouthPiece.x, mouthPiece.y] : [0.5, eyeY + spacing * 1.1],
  }
}

/** Everything about a body's textures a look needs, worked out once per body. */
type Analysis = {
  head: Pixels
  body: Pixels
  opacity: Pixels
  triangles: HeadTriangle[]
  /** The face's skin only (what a photo may paint). */
  skinTriangles: HeadTriangle[]
  landmarks: FaceLandmarks | null
  hairMask: Float32Array
  headSkinMask: Float32Array
  bodySkinMask: Float32Array
  hairLum: number
  headHairLum: number
  skinLum: number
  bodySkinLum: number
}

const analyses = new WeakMap<Texture, Analysis>()

/** The skin's colour: the cheeks and nose, facing the front. */
function skinColor(head: Pixels, triangles: readonly HeadTriangle[]): Rgb {
  const samples: Rgb[] = []
  for (const tri of triangles) {
    const x = (tri.x[0]! + tri.x[1]! + tri.x[2]!) / 3
    const y = (tri.y[0]! + tri.y[1]! + tri.y[2]!) / 3
    const n = (tri.n[0]! + tri.n[1]! + tri.n[2]!) / 3
    if (n < 0.6 || Math.abs(x - 0.5) > 0.14 || y < 0.55 || y > 0.72) continue
    const u = (tri.u[0]! + tri.u[1]! + tri.u[2]!) / 3
    const v = (tri.v[0]! + tri.v[1]! + tri.v[2]!) / 3
    const p =
      (Math.min(head.height - 1, Math.floor(v * head.height)) * head.width +
        Math.min(head.width - 1, Math.floor(u * head.width))) *
      4
    samples.push([head.data[p]!, head.data[p + 1]!, head.data[p + 2]!])
  }
  if (samples.length === 0) return [200, 160, 140]
  // The median by lightness: brows and nostrils don't pull it off.
  samples.sort((a, b) => luminance(...a) - luminance(...b))
  return samples[Math.floor(samples.length / 2)]!
}

function analyse(parts: Record<Part, PartMesh[]>): Analysis | null {
  const headMap = parts.head[0]?.material.map
  const bodyMap = parts.body[0]?.material.map
  const opacityMap = parts.opacity[0]?.material.map
  if (!(headMap && bodyMap && opacityMap)) return null
  const cached = analyses.get(headMap)
  if (cached) return cached
  const head = readPixels(headMap)
  const body = readPixels(bodyMap)
  const opacity = readPixels(opacityMap)
  const { all: triangles, skin: skinTriangles, landmarks } = headTriangles(parts.head[0]!.mesh)
  const skin = skinColor(head, skinTriangles)
  const hair = meanColor(opacity)
  const hairOnHead = hairMask(head, hair, skin)
  const headSkinMask = similarityMask(head, skin)
  for (let i = 0; i < headSkinMask.length; i++) headSkinMask[i]! *= 1 - hairOnHead[i]!
  const bodySkinMask = similarityMask(body, skin, 0.08, 0.2)
  const analysis: Analysis = {
    head,
    body,
    opacity,
    triangles,
    skinTriangles,
    landmarks,
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

/**
 * Dresses a body in a look: its own copies of the textures the look changes
 * (the face photo, hair dye, skin tone) on its own copies of the materials.
 * Returns what undoes it (the original materials back, the copies freed).
 */
export async function applyLook(model: Object3D, look: AvatarLook): Promise<() => void> {
  const parts = partMeshes(model)
  const analysis = analyse(parts)
  if (!analysis) return () => {}
  const photo = look.face ? await photoPixels(look.face.photo).catch(() => null) : null

  const changed: Partial<Record<Part, Pixels>> = {}
  if (photo || look.hair || look.skin) {
    const head = copyPixels(analysis.head)
    if (look.hair) dye(head, hexToRgb(look.hair), analysis.headHairLum, analysis.hairMask)
    if (look.skin) dye(head, hexToRgb(look.skin), analysis.skinLum, analysis.headSkinMask)
    // The photo goes on last: the dyes' masks are the body's own face, not
    // the photo's, and its colours match the skin as dyed.
    if (photo && look.face) bakeFace(head, analysis.skinTriangles, photo, look.face, look.face.tone)
    changed.head = head
  }
  if (look.hair) {
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
export function useAvatarLook(model: Object3D, look: AvatarLook | null | undefined) {
  useEffect(() => {
    if (!hasLook(look)) return
    let undo: (() => void) | null = null
    let cancelled = false
    void applyLook(model, look).then((done) => {
      if (cancelled) done()
      else undo = done
    })
    return () => {
      cancelled = true
      undo?.()
    }
  }, [model, look])
}

/** The head's eyes and mouth on its front view (see renderHeadFront). */
export function headLandmarks(model: Object3D): FaceLandmarks | null {
  return analyse(partMeshes(model))?.landmarks ?? null
}

/**
 * The head seen from the front, as the face photo is placed on it: its
 * texture drawn over its front-facing triangles, back to front, into a
 * square canvas `size` pixels across.
 */
export function renderHeadFront(model: Object3D, size = 512): HTMLCanvasElement | null {
  const parts = partMeshes(model)
  const analysis = analyse(parts)
  if (!analysis) return null
  const source = document.createElement('canvas')
  source.width = analysis.head.width
  source.height = analysis.head.height
  source
    .getContext('2d')!
    .putImageData(
      new ImageData(analysis.head.data, analysis.head.width, analysis.head.height),
      0,
      0,
    )
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  const front = analysis.triangles
    .filter((tri) => tri.n[0]! + tri.n[1]! + tri.n[2]! > 0)
    .sort((a, b) => a.z[0]! + a.z[1]! + a.z[2]! - (b.z[0]! + b.z[1]! + b.z[2]!))
  const { width: tw, height: th } = analysis.head
  for (const tri of front) {
    const [x0, x1, x2] = tri.x.map((x) => x * size) as [number, number, number]
    const [y0, y1, y2] = tri.y.map((y) => y * size) as [number, number, number]
    const [u0, u1, u2] = tri.u.map((u) => u * tw) as [number, number, number]
    const [v0, v1, v2] = tri.v.map((v) => v * th) as [number, number, number]
    // The affine map from the texture triangle onto the view triangle.
    const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)
    if (Math.abs(det) < 1e-6) continue
    const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det
    const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det
    const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det
    const d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det
    const e = x0 - a * u0 - c * v0
    const f = y0 - b * u0 - d * v0
    // Grown by half a pixel so neighbouring triangles close their seams.
    const cx = (x0 + x1 + x2) / 3
    const cy = (y0 + y1 + y2) / 3
    const grow = (px: number, py: number) => {
      const dx = px - cx
      const dy = py - cy
      const length = Math.hypot(dx, dy) || 1
      return [px + (dx / length) * 0.6, py + (dy / length) * 0.6] as const
    }
    context.save()
    context.beginPath()
    context.moveTo(...grow(x0, y0))
    context.lineTo(...grow(x1, y1))
    context.lineTo(...grow(x2, y2))
    context.closePath()
    context.clip()
    context.setTransform(a, b, c, d, e, f)
    context.drawImage(source, 0, 0)
    context.restore()
  }
  return canvas
}
