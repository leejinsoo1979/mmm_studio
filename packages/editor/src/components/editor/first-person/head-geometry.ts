import { type BufferGeometry, Matrix3, Matrix4, type Mesh, type SkinnedMesh, Vector3 } from 'three'
import type { HeadTriangle } from './look-pixels'

/**
 * A Rocketbox head's triangles on its texture and on a square front view
 * framing the skull (from the top of the head to just under the chin), in
 * the bind pose. `skin` is the face's skin — the largest connected piece
 * facing the front — and `eyes` the two eyeballs (the image's left first):
 * pieces of their own, whose texture sits elsewhere.
 */
export type HeadGeometry = {
  all: HeadTriangle[]
  skin: HeadTriangle[]
  eyes: HeadTriangle[][]
}

const triangleArea = (tri: HeadTriangle) =>
  Math.abs(
    (tri.x[1]! - tri.x[0]!) * (tri.y[2]! - tri.y[0]!) -
      (tri.x[2]! - tri.x[0]!) * (tri.y[1]! - tri.y[0]!),
  )

const triangleCentre = (tri: HeadTriangle) =>
  [(tri.x[0]! + tri.x[1]! + tri.x[2]!) / 3, (tri.y[0]! + tri.y[1]! + tri.y[2]!) / 3] as const

/**
 * Where the head sits in its front view: a point (x, y in the bind pose)
 * is at ((x − left) / size, (top − y) / size) in it. `neck` is the head
 * bone's place (the top of the neck), `front` how far forward the face
 * reaches.
 */
export type HeadFrame = { left: number; top: number; size: number; neck: Vector3; front: number }

/**
 * The geometry a head had as loaded: a face shape (avatar-shape.ts) swaps
 * in a reshaped copy, but looks are made from the original, which their
 * landmarks were found on.
 */
export function originalGeometry(mesh: Mesh): BufferGeometry {
  return (mesh.userData.shapeOriginal as BufferGeometry | undefined) ?? mesh.geometry
}

/**
 * The geometry a head had as loaded, its hair and all: a head made bald
 * (see avatar-hair.ts) shows only some of its triangles, and is reshaped
 * so, but its frame and looks go by the whole.
 */
export function loadedGeometry(mesh: Mesh): BufferGeometry {
  return (mesh.userData.hairOriginal as BufferGeometry | undefined) ?? originalGeometry(mesh)
}

/** A head's points in the bind pose. */
function bindPoints(head: Mesh): Vector3[] {
  const position = loadedGeometry(head).getAttribute('position')
  const skinned = head as SkinnedMesh
  const bind = skinned.isSkinnedMesh ? skinned.bindMatrix : new Matrix4()
  const points: Vector3[] = []
  for (let i = 0; i < (position?.count ?? 0); i++) {
    points.push(new Vector3().fromBufferAttribute(position!, i).applyMatrix4(bind))
  }
  return points
}

function frameOf(head: Mesh, points: readonly Vector3[]): HeadFrame {
  // The skull: from the top of the head down to the head bone (the top of
  // the neck), plus the chin under it.
  let top = Number.NEGATIVE_INFINITY
  const neck = new Vector3(0, Number.NEGATIVE_INFINITY, 0)
  const skinned = head as SkinnedMesh
  if (skinned.isSkinnedMesh) {
    const bones = skinned.skeleton.bones
    const index = bones.findIndex((bone) => /Head$/.test(bone.name))
    if (index >= 0) {
      neck.setFromMatrixPosition(new Matrix4().copy(skinned.skeleton.boneInverses[index]!).invert())
    }
  }
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let front = Number.NEGATIVE_INFINITY
  for (const point of points) top = Math.max(top, point.y)
  if (!Number.isFinite(neck.y)) neck.set(0, top - 0.2, 0)
  for (const point of points) {
    if (point.y > neck.y) {
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      front = Math.max(front, point.z)
    }
  }
  const size = (top - neck.y) * 1.45
  return { left: (minX + maxX) / 2 - size / 2, top: top + size * 0.03, size, neck, front }
}

/** Where a head sits in its front view (see HeadFrame). */
export function headFrame(head: Mesh): HeadFrame {
  return frameOf(head, bindPoints(head))
}

export function headGeometry(head: Mesh): HeadGeometry {
  const geometry = loadedGeometry(head)
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  if (!(position && normal && uv)) return { all: [], skin: [], eyes: [] }
  const skinned = head as SkinnedMesh
  const bind = skinned.isSkinnedMesh ? skinned.bindMatrix : new Matrix4()
  const normalMatrix = new Matrix3().getNormalMatrix(bind)
  const points = bindPoints(head)
  const normals: number[] = []
  const v = new Vector3()
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize()
    normals.push(v.z)
  }
  const { left, top: frameTop, size } = frameOf(head, points)

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
  const pieceOf = corners.map((tri) => find(vertexPiece[tri[0]!]!))

  // The skin: the piece with the most front-facing area across the face.
  const frontArea = new Map<number, number>()
  all.forEach((tri, i) => {
    const [x, y] = triangleCentre(tri)
    if (Math.abs(x - 0.5) > 0.3 || y < 0.2 || y > 0.9) return
    const piece = pieceOf[i]!
    frontArea.set(piece, (frontArea.get(piece) ?? 0) + triangleArea(tri))
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
    eyes: findEyes(all, pieceOf, skinPiece),
  }
}

/**
 * The eyeballs: the two front pieces (besides the skin) a mirror image of
 * each other, the image's left first.
 */
function findEyes(triangles: HeadTriangle[], pieceOf: number[], skinPiece: number) {
  const pieces = new Map<
    number,
    { x: number; y: number; area: number; triangles: HeadTriangle[] }
  >()
  triangles.forEach((tri, i) => {
    const piece = pieceOf[i]!
    if (piece === skinPiece) return
    const entry = pieces.get(piece) ?? { x: 0, y: 0, area: 0, triangles: [] }
    entry.triangles.push(tri)
    if (tri.n[0]! + tri.n[1]! + tri.n[2]! > 0) {
      const area = triangleArea(tri) + 1e-9
      const [x, y] = triangleCentre(tri)
      entry.x += x * area
      entry.y += y * area
      entry.area += area
    }
    pieces.set(piece, entry)
  })
  const centres = [...pieces.values()]
    .filter((piece) => piece.area > 0)
    .map((piece) => ({ ...piece, x: piece.x / piece.area, y: piece.y / piece.area }))
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
  return eyes ? eyes.map((eye) => eye.triangles) : []
}
