'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  FrontSide,
  type Material,
  Matrix3,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  SkinnedMesh,
  Source,
  type Texture,
} from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { avatarUrl } from './avatar-catalog'
import { headOf, type Shaper } from './avatar-shape'
import {
  bentSkull,
  cleanCut,
  cutRings,
  hairShadow,
  hollowShade,
  keptTriangles,
  nearEar,
  neckFitted,
  necklineFan,
  type ScalpPaint,
  scalpPaint,
  scalpTriangles,
  scalpUvs,
  smoothNape,
  spreadWeights,
  TONE_RINGS,
  underKept,
  vertexNormals,
  withNeckPiece,
} from './bald-head'
import { BLEED_BELOW, bleedHair, pictureOf, texturePixels } from './hair-bleed'
import { dyeHair } from './hair-dye'
import { BALD, type HairLibrary, type HairStyle, loadHairLibrary } from './hair-styles'
import { loadedGeometry, originalGeometry } from './head-geometry'
import {
  type AxisFit,
  composeFits,
  craniumFit,
  faceFit,
  fitBald,
  fitSkull,
  invertFit,
  keepStandoff,
  PointGrid,
  pushOut,
  SKULL_CELL,
  type Surface,
  smoothstep,
  standingOver,
  type Triples,
  tuckUnder,
} from './head-skull'
import {
  byLightness,
  colorDistance,
  hairMask,
  luminance,
  maskedLuminance,
  meanColor,
  type Pixels,
  type Rgb,
} from './look-pixels'

/**
 * Borrowed hairstyles: one character's hair worn by another, over its head
 * made bald (see bald-head.ts) as a wig. A Rocketbox hairstyle is two
 * things — a shell of the head mesh itself, sculpted to the hair's volume
 * and painted with it (the "cap"), and alpha cards for its loose strands
 * (`_opacity`, with the lashes). Both are carried over through the bald
 * skull every head shares (see head-skull.ts): fitted to each character by
 * its face bones, it says where the donor's hair stood over its skull.
 *
 * Lengths are in the bind pose's own units (see head-skull.ts). The sizes
 * below are an adult's; on a child they are a fifth smaller in metres.
 *
 * The pure geometry comes first (tested in avatar-hair.test.ts), then the
 * meshes built from it, then loading and the hook.
 */

/** Kinds of an opacity mesh's pieces. */
export const LASH = 0
export const HAIR = 1
export const GEAR = 2
export type CardKind = typeof LASH | typeof HAIR | typeof GEAR

/**
 * Every point of a lash is this near (bind units) an eyeball's centre; no
 * hair comes within 0.06 of one.
 */
const LASH_REACH = 0.04

/**
 * A piece this far (bind units) in front of the eyes is gear worn over the
 * face — a visor, a mask, goggles (they reach 0.079 and more; the fullest
 * afro 0.071) — or, hanging from the shoulders, a scarf's fringe.
 */
const GEAR_FRONT = 0.075

/**
 * An earring is a card seen edge on from the front — no thicker across
 * than EARRING_THIN (bind units) — out at the side of the head
 * (EARRING_SIDE from the face's middle) and hanging below the eyes
 * (EARRING_BELOW under them); a lock of hair there lies the other way
 * round.
 */
const EARRING_THIN = 0.015
const EARRING_SIDE = 0.06
const EARRING_BELOW = 0.02

/** Points of a mesh this near (bind units) are at one spot (a texture seam splits them). */
const SPOT = 1e-4

/** Each point's spot (see SPOT), numbered in the order they are first met, and how many there are. */
function spotsOf(positions: Triples) {
  const count = positions.length / 3
  const numbers = new Map<string, number>()
  const spots = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    const key = [0, 1, 2].map((axis) => Math.round(positions[i * 3 + axis]! / SPOT)).join()
    let spot = numbers.get(key)
    if (spot === undefined) {
      spot = numbers.size
      numbers.set(key, spot)
    }
    spots[i] = spot
  }
  return { spots, count: numbers.size }
}

/**
 * What each triangle of an opacity mesh is, by the piece it is part of
 * (triangles joined at a corner, or at corners at one spot): lashes, all
 * round an eye; gear — worn over the face, far out in front of it, or an
 * earring; the rest hair. `eyes` are the eyeballs' centres (bind pose, x/y/z
 * each), the face looking along +z.
 */
export function cardKinds(positions: Triples, index: ArrayLike<number>, eyes: Triples): Uint8Array {
  const count = positions.length / 3
  const parent = Array.from({ length: count }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  const { spots } = spotsOf(positions)
  const first = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const other = first.get(spots[i]!)
    if (other === undefined) first.set(spots[i]!, i)
    else parent[find(i)] = find(other)
  }
  for (let t = 0; t < index.length; t += 3) {
    parent[find(index[t + 1]!)] = find(index[t]!)
    parent[find(index[t + 2]!)] = find(index[t]!)
  }
  const middle = (eyes[0]! + eyes[3]!) / 2
  const eyeLevel = (eyes[1]! + eyes[4]!) / 2
  const eyeFront = Math.max(eyes[2]!, eyes[5]!)
  const pieces = new Map<
    number,
    { nearEyes: boolean; front: number; left: number; right: number; top: number }
  >()
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!
    const y = positions[i * 3 + 1]!
    const z = positions[i * 3 + 2]!
    const toEye = Math.min(
      Math.hypot(x - eyes[0]!, y - eyes[1]!, z - eyes[2]!),
      Math.hypot(x - eyes[3]!, y - eyes[4]!, z - eyes[5]!),
    )
    const piece = pieces.get(find(i))
    if (piece) {
      piece.nearEyes &&= toEye <= LASH_REACH
      piece.front = Math.max(piece.front, z)
      piece.left = Math.min(piece.left, x)
      piece.right = Math.max(piece.right, x)
      piece.top = Math.max(piece.top, y)
    } else {
      pieces.set(find(i), { nearEyes: toEye <= LASH_REACH, front: z, left: x, right: x, top: y })
    }
  }
  const kindOf = new Map<number, CardKind>()
  for (const [root, piece] of pieces) {
    const earring =
      piece.right - piece.left <= EARRING_THIN &&
      Math.abs((piece.left + piece.right) / 2 - middle) >= EARRING_SIDE &&
      piece.top <= eyeLevel - EARRING_BELOW
    kindOf.set(
      root,
      piece.nearEyes ? LASH : earring || piece.front - eyeFront > GEAR_FRONT ? GEAR : HAIR,
    )
  }
  return Uint8Array.from({ length: index.length / 3 }, (_, t) => kindOf.get(find(index[t * 3]!))!)
}

/**
 * An opacity mesh's triangles (`index`) with its cards' twins folded into
 * one. Rocketbox models a card two-sided — each triangle again at its
 * corners' spots, wound the other way — and the material draws both sides
 * of both: at one depth, so either copy wins a pixel, and a back copy's
 * normals are often its front's, which, turned for the side it shows, face
 * away from the light: the hair goes black in patches. Of each such pair the
 * copy whose normals agree with its winding is kept (the first, when both
 * or neither do): drawn double-sided, it shows from behind with them
 * turned. Returns the corners kept, in order; a triangle with no twin
 * stays.
 */
export function foldTwins(
  positions: Triples,
  normals: Triples,
  index: ArrayLike<number>,
): number[] {
  const { spots } = spotsOf(positions)
  const at = (corner: number, axis: number) => positions[index[corner]! * 3 + axis]!
  // Each triangle's winding, as its corners turn (unnormalised), and
  // whether its normals agree with it.
  const winding = (t: number) => {
    const e = [0, 1, 2].map((axis) => at(t * 3 + 1, axis) - at(t * 3, axis))
    const f = [0, 1, 2].map((axis) => at(t * 3 + 2, axis) - at(t * 3, axis))
    return [
      e[1]! * f[2]! - e[2]! * f[1]!,
      e[2]! * f[0]! - e[0]! * f[2]!,
      e[0]! * f[1]! - e[1]! * f[0]!,
    ]
  }
  const agrees = (t: number, w: number[]) => {
    let along = 0
    for (let k = 0; k < 3; k++) {
      for (let axis = 0; axis < 3; axis++)
        along += normals[index[t * 3 + k]! * 3 + axis]! * w[axis]!
    }
    return along > 0
  }
  const coincident = new Map<string, number[]>()
  const count = index.length / 3
  for (let t = 0; t < count; t++) {
    const key = [0, 1, 2]
      .map((k) => spots[index[t * 3 + k]!]!)
      .sort((a, b) => a - b)
      .join()
    const found = coincident.get(key)
    if (found) found.push(t)
    else coincident.set(key, [t])
  }
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  const dropped = new Uint8Array(count)
  for (const triangles of coincident.values()) {
    if (triangles.length < 2) continue
    const windings = triangles.map(winding)
    // Copies wound the same way are no two-sided card: left be.
    if (!windings.some((w) => dot(w, windings[0]!) < 0)) continue
    const kept = triangles.find((t, i) => agrees(t, windings[i]!)) ?? triangles[0]!
    for (const t of triangles) if (t !== kept) dropped[t] = 1
  }
  const corners: number[] = []
  for (let t = 0; t < count; t++) {
    if (!dropped[t]) corners.push(index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!)
  }
  return corners
}

const foldedGeometries = new WeakSet<BufferGeometry>()

/**
 * Folds an opacity mesh's twin cards (see `foldTwins`) in its geometry
 * itself, once: every copy of the character shares it.
 */
export function foldCardTwins(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (foldedGeometries.has(geometry) || !(position && normal)) return
  foldedGeometries.add(geometry)
  // As stored (often quantised, interleaved): read a component at a time.
  const values = (attribute: typeof position) =>
    Float32Array.from({ length: attribute.count * 3 }, (_, j) =>
      attribute.getComponent(Math.floor(j / 3), j % 3),
    )
  const index = indexOf(geometry)
  const kept = foldTwins(values(position), values(normal), index)
  if (kept.length < index.length) geometry.setIndex(kept)
}

/**
 * Each of a donor's bone slots as one of the wearer's bones: by name, and
 * anything the wearer lacks on its head.
 */
export function remapBones(
  names: readonly string[],
  wearer: readonly string[],
  head: number,
): Uint16Array {
  const byName = new Map(wearer.map((name, index) => [name, index]))
  return Uint16Array.from(names, (name) => byName.get(name) ?? head)
}

/**
 * A donor's hair points carried onto the wearer, each by the bones that
 * carry it: a bone slot's anchor on the donor (`from`, xyz per slot) goes
 * to its anchor on the wearer (`to`), the point keeping its offset from it
 * scaled axis by axis. The head's anchors are the skull fit's (the origin
 * to its shift), so hair on the head keeps its place over the skull; hair
 * lying on the back and shoulders keeps its place over them.
 */
export function carryPoints(
  points: Triples,
  skinIndex: ArrayLike<number>,
  skinWeight: ArrayLike<number>,
  anchors: { from: Triples; to: Triples },
  scale: readonly number[],
): Float32Array {
  const count = points.length / 3
  const influences = skinIndex.length / count
  const carried = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    let total = 0
    for (let k = 0; k < influences; k++) {
      const weight = skinWeight[i * influences + k]!
      if (weight <= 0) continue
      const slot = skinIndex[i * influences + k]!
      total += weight
      for (let axis = 0; axis < 3; axis++) {
        carried[i * 3 + axis]! +=
          weight *
          (anchors.to[slot * 3 + axis]! +
            (points[i * 3 + axis]! - anchors.from[slot * 3 + axis]!) * scale[axis]!)
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      carried[i * 3 + axis] = total > 0 ? carried[i * 3 + axis]! / total : points[i * 3 + axis]!
    }
  }
  return carried
}

/** A triangle with less area (texels²) than this on its texture covers none of it. */
const FLAT = 1e-12

/**
 * Fills a triangle's texels on a `width` × `height` texture (corners in
 * 0–1 UVs), calling `visit` with each texel whose centre is inside and its
 * barycentric weights.
 */
function fillTexels(
  width: number,
  height: number,
  u: readonly number[],
  v: readonly number[],
  visit: (texel: number, w0: number, w1: number, w2: number) => void,
) {
  const ax = u[0]! * width
  const ay = v[0]! * height
  const bx = u[1]! * width
  const by = v[1]! * height
  const cx = u[2]! * width
  const cy = v[2]! * height
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  if (Math.abs(area) < FLAT) return
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const x = px + 0.5
      const y = py + 0.5
      const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area
      const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area
      const w2 = 1 - w0 - w1
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) visit(py * width + px, w0, w1, w2)
    }
  }
}

/**
 * In the donor's sculpted shell (see `CapTriangle`), a texel this unlike
 * its skin (see `colorDistance`) starts to be hair, and this unlike is
 * wholly: a highlight can come near the skin's colour, but not to it.
 */
const SKIN_NEAR = 0.1
const SKIN_FAR = 0.2

/**
 * The cap's hair, on a 1024 texture: closed over gaps CLOSE texels across
 * (a sideburn's or a hairline's sparse strands one patch, not specks);
 * without patches of fewer than SPECK texels (a pore, a mole, a blemish of
 * the donor's skin); its edge faded over EDGE texels.
 */
const CLOSE = 3
const SPECK = 120
const EDGE = 3

/** A triangle of the cap on its texture (corners in 0–1 UVs): `solid` on the hair's sculpted shell. */
export type CapTriangle = { u: number[]; v: number[]; solid: boolean }

/**
 * The cap's texture: the donor's head texture with everything but its hair
 * cut away (alpha 0), the donor's skin round it and on it never carried
 * over. Hair is what is nearer the hair's colour than the skin's — the hair
 * painted onto the scalp, the temples, the sideburns — and, on the sculpted
 * shell (`solid`), what isn't plainly skin; closed over its gaps, cleared
 * of specks and faded at its edge, never across a UV island's rim (see
 * CLOSE; the cap is drawn blended: see `hairAssetOf`).
 */
export function capPixels(
  head: Pixels,
  hair: Rgb,
  skin: Rgb,
  triangles: readonly CapTriangle[],
): Pixels {
  const { width, height, data } = head
  const mask = hairMask(head, hair, skin)
  const skinLum = luminance(...skin)
  const notSkin = (texel: number) =>
    smoothstep(
      SKIN_NEAR,
      SKIN_FAR,
      colorDistance(data[texel * 4]!, data[texel * 4 + 1]!, data[texel * 4 + 2]!, skin, skinLum),
    )
  const covered = new Uint8Array(mask.length)
  const hairy = new Uint8Array(mask.length)
  for (const tri of triangles) {
    fillTexels(width, height, tri.u, tri.v, (texel) => {
      covered[texel] = 1
      const share = tri.solid ? Math.max(mask[texel]!, notSkin(texel)) : mask[texel]!
      if (share >= 0.5) hairy[texel] = 1
    })
  }
  const scale = width / 1024
  const reach = Math.max(1, Math.round(CLOSE * scale))
  const closed = spread(
    spread(hairy, covered, width, height, reach, 1),
    covered,
    width,
    height,
    reach,
    0,
  )
  const kept = withoutSpecks(closed, width, height, Math.round(SPECK * scale * scale))
  const soft = softened(kept, covered, width, height, Math.max(1, Math.round(EDGE * scale)))
  const out: Pixels = { data: new Uint8ClampedArray(data), width, height }
  for (let i = 0; i < mask.length; i++) out.data[i * 4 + 3] = Math.round(255 * soft[i]!)
  return out
}

/**
 * A mask grown (`value` 1) or shrunk (`value` 0) by `reach` texels each way
 * over the texels `covered` holds; texels it doesn't hold neither grow nor
 * shrink it, so a UV island's rim stays where it is.
 */
function spread(
  mask: Uint8Array,
  covered: Uint8Array,
  width: number,
  height: number,
  reach: number,
  value: 0 | 1,
): Uint8Array {
  const pass = (from: Uint8Array, along: boolean) => {
    const out = new Uint8Array(from)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const texel = y * width + x
        if (!covered[texel] || from[texel] === value) continue
        for (let d = -reach; d <= reach; d++) {
          const nx = along ? x + d : x
          const ny = along ? y : y + d
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const other = ny * width + nx
          if (covered[other] && from[other] === value) {
            out[texel] = value
            break
          }
        }
      }
    }
    return out
  }
  return pass(pass(mask, true), false)
}

/** A mask without its patches (4-connected) of fewer than `fewest` texels. */
function withoutSpecks(mask: Uint8Array, width: number, height: number, fewest: number) {
  const out = new Uint8Array(mask)
  const seen = new Uint8Array(mask.length)
  const patch: number[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    patch.length = 0
    patch.push(start)
    seen[start] = 1
    for (let k = 0; k < patch.length; k++) {
      const texel = patch[k]!
      const x = texel % width
      const neighbours = [
        x > 0 ? texel - 1 : -1,
        x < width - 1 ? texel + 1 : -1,
        texel >= width ? texel - width : -1,
        texel < width * (height - 1) ? texel + width : -1,
      ]
      for (const other of neighbours) {
        if (other >= 0 && mask[other] && !seen[other]) {
          seen[other] = 1
          patch.push(other)
        }
      }
    }
    if (patch.length < fewest) for (const texel of patch) out[texel] = 0
  }
  return out
}

/** A mask averaged over each texel and those within `reach` round it that `covered` holds: only texels it holds change. */
function softened(
  mask: Uint8Array,
  covered: Uint8Array,
  width: number,
  height: number,
  reach: number,
): Float32Array {
  const out = Float32Array.from(mask)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!covered[y * width + x]) continue
      let sum = 0
      let n = 0
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !covered[ny * width + nx]) continue
          sum += mask[ny * width + nx]!
          n++
        }
      }
      out[y * width + x] = sum / n
    }
  }
  return out
}

/**
 * The colour of a donor's hair as its head is painted with it: the median
 * (by lightness) of the texels of its sculpted shell (`solid` triangles).
 * Short hair painted onto the scalp is nearer it than the cards' colour,
 * which strands lit through and edge on make lighter. Null for none.
 */
function paintedHair(head: Pixels, triangles: readonly CapTriangle[]): Rgb | null {
  const samples: Rgb[] = []
  for (const tri of triangles) {
    if (!tri.solid) continue
    fillTexels(head.width, head.height, tri.u, tri.v, (texel) => {
      if (texel % PAINTED_SAMPLE !== 0) return
      const p = texel * 4
      samples.push([head.data[p]!, head.data[p + 1]!, head.data[p + 2]!])
    })
  }
  if (samples.length === 0) return null
  return byLightness(samples, 0.5)
}

/** One texel in this many is read for a donor's painted hair colour: enough for a median. */
const PAINTED_SAMPLE = 7

/** How far (bind units) round a cheek bone the skin's colour is sampled. */
const CHEEK_REACH = 0.015

/**
 * The donor's skin colour, for telling its hair from its skin: the median
 * (by lightness, so a pore or a highlight doesn't pull it off) of its head
 * texture round its cheek bones. Null when it has none to sample.
 */
function skinTone(head: Pixels, uvs: Triples, points: Triples, cheeks: Triples[]): Rgb | null {
  const samples: Rgb[] = []
  const count = points.length / 3
  for (let i = 0; i < count; i++) {
    const near = cheeks.some(
      (cheek) =>
        Math.hypot(
          points[i * 3]! - cheek[0]!,
          points[i * 3 + 1]! - cheek[1]!,
          points[i * 3 + 2]! - cheek[2]!,
        ) <= CHEEK_REACH,
    )
    if (!near) continue
    const x = Math.min(head.width - 1, Math.max(0, Math.floor(uvs[i * 2]! * head.width)))
    const y = Math.min(head.height - 1, Math.max(0, Math.floor(uvs[i * 2 + 1]! * head.height)))
    const p = (y * head.width + x) * 4
    samples.push([head.data[p]!, head.data[p + 1]!, head.data[p + 2]!])
  }
  if (samples.length === 0) return null
  return byLightness(samples, 0.5)
}

/** A skinned mesh's bones' places in the bind pose (xyz per bone). */
function boneBindPositions(mesh: SkinnedMesh): Float32Array {
  const places = new Float32Array(mesh.skeleton.bones.length * 3)
  const inverse = new Matrix4()
  mesh.skeleton.boneInverses.forEach((boneInverse, i) => {
    inverse.copy(boneInverse).invert()
    places[i * 3] = inverse.elements[12]!
    places[i * 3 + 1] = inverse.elements[13]!
    places[i * 3 + 2] = inverse.elements[14]!
  })
  return places
}

function bonePlaces(mesh: SkinnedMesh): Map<string, number[]> {
  const places = boneBindPositions(mesh)
  return new Map(
    mesh.skeleton.bones.map((bone, i) => [
      bone.name,
      [places[i * 3]!, places[i * 3 + 1]!, places[i * 3 + 2]!],
    ]),
  )
}

const isHeadBone = (name: string) => /Head$/.test(name)

/**
 * A skeleton's bone names, the face's bones (the head's children: jaw,
 * lips, brows, lids) named as the head: hair a face bone carried would
 * otherwise flap with a smile or a blink on the wearer.
 */
function hairBoneNames(mesh: SkinnedMesh): string[] {
  const head = mesh.skeleton.bones.find((bone) => isHeadBone(bone.name))
  return mesh.skeleton.bones.map((bone) => {
    for (let up = bone.parent; up && head; up = up.parent) if (up === head) return head.name
    return bone.name
  })
}

/** A mesh's points (or normals) in the bind pose, flat. */
function bindPoints(mesh: Mesh, geometry: BufferGeometry, name: 'position' | 'normal') {
  const attribute = geometry.getAttribute(name)
  const skinned = mesh as SkinnedMesh
  const bind = skinned.isSkinnedMesh ? skinned.bindMatrix : new Matrix4()
  const normalMatrix = new Matrix3().getNormalMatrix(bind)
  const out = new Float32Array(attribute.count * 3)
  const e = bind.elements
  const n = normalMatrix.elements
  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i)
    const y = attribute.getY(i)
    const z = attribute.getZ(i)
    if (name === 'position') {
      out[i * 3] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!
      out[i * 3 + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!
      out[i * 3 + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!
    } else {
      const nx = n[0]! * x + n[3]! * y + n[6]! * z
      const ny = n[1]! * x + n[4]! * y + n[7]! * z
      const nz = n[2]! * x + n[5]! * y + n[8]! * z
      const length = Math.hypot(nx, ny, nz) || 1
      out[i * 3] = nx / length
      out[i * 3 + 1] = ny / length
      out[i * 3 + 2] = nz / length
    }
  }
  return out
}

/**
 * Meshes' surfaces as one (bind pose, as loaded), with `more` surfaces
 * joined on.
 */
function surfaceOf(meshes: readonly Mesh[], more: readonly Surface[] = []): Surface {
  const parts = [
    ...meshes.map((mesh) => {
      const geometry = originalGeometry(mesh)
      return {
        points: bindPoints(mesh, geometry, 'position'),
        normals: bindPoints(mesh, geometry, 'normal'),
      }
    }),
    ...more,
  ]
  const joined = (name: 'points' | 'normals') => {
    const out = new Float32Array(parts.reduce((sum, part) => sum + part[name].length, 0))
    let at = 0
    for (const part of parts) {
      out.set(part[name], at)
      at += part[name].length
    }
    return out
  }
  const points = joined('points')
  return { points, normals: joined('normals'), grid: new PointGrid(points, SKULL_CELL) }
}

const indexOf = (geometry: BufferGeometry) =>
  geometry.index
    ? Array.from(geometry.index.array as ArrayLike<number>)
    : Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i)

/** The material a look found on a mesh (the look swaps in its own dressed copies). */
const ownMaterial = (mesh: Mesh) => (mesh.userData.lookOriginal ?? mesh.material) as Material

/** The character's own meshes of one part (by their material's name ending). */
function ownMeshes(model: Object3D, part: 'body' | 'opacity'): SkinnedMesh[] {
  const found: SkinnedMesh[] = []
  model.traverse((object) => {
    const mesh = object as SkinnedMesh
    if (!mesh.isSkinnedMesh || Array.isArray(mesh.material) || mesh.userData.follows) return
    if (ownMaterial(mesh).name.endsWith(`_${part}`)) found.push(mesh)
  })
  return found
}

/** The eyeballs' centres (bind pose), from the eye bones. */
function eyesOf(mesh: SkinnedMesh): number[] | null {
  const places = bonePlaces(mesh)
  const left = [...places].find(([name]) => /LEye$/.test(name))?.[1]
  const right = [...places].find(([name]) => /REye$/.test(name))?.[1]
  return left && right ? [...left, ...right] : null
}

/**
 * How the shared skull fits a head's cranium (see head-skull.ts's
 * `craniumFit`), from its face bones' fit, its own points (bind pose) and
 * its eyes: null without them.
 */
function craniumOf(
  basis: HairBasis,
  fit: AxisFit | null,
  points: Triples,
  eyes: number[] | null,
): AxisFit | null {
  if (!(fit && eyes)) return null
  const middle = [
    (eyes[0]! + eyes[3]!) / 2,
    (eyes[1]! + eyes[4]!) / 2,
    Math.max(eyes[2]!, eyes[5]!),
  ]
  return craniumFit(basis.skull, fit, points, middle as [number, number, number])
}

const kindsCache = new WeakMap<BufferGeometry, Uint8Array>()

/** What each triangle of an opacity mesh is (see `cardKinds`), worked out once per geometry. */
function kindsOf(mesh: SkinnedMesh): Uint8Array {
  const geometry = originalGeometry(mesh)
  let kinds = kindsCache.get(geometry)
  if (!kinds) {
    const eyes = eyesOf(mesh)
    kinds = eyes
      ? cardKinds(bindPoints(mesh, geometry, 'position'), indexOf(geometry), eyes)
      : new Uint8Array(indexOf(geometry).length / 3).fill(HAIR)
    kindsCache.set(geometry, kinds)
  }
  return kinds
}

/**
 * What a hairstyle is carried over by: the shared skull; which points of
 * each card-haired head (by its material's name) are its hair's shell; and
 * which triangles of every head are its own hair (see bald-head.ts).
 */
export type HairBasis = Pick<HairLibrary, 'skull' | 'shells' | 'bald'>

/** Which points of a head are its hair's shell (1), or null for a head whose hair is only painted on. */
const shellOf = (head: Mesh, basis: HairBasis) => basis.shells.get(ownMaterial(head).name) ?? null

/**
 * Some of a geometry's triangles as a geometry of their own, holding only
 * the points they use and all they carry — positions and normals (into the
 * bind pose when `toBind`), texture coordinates, vertex colours (which the
 * material multiplies by, where there are any), the skin's bone slots and
 * weights — as plain numbers.
 */
function subset(
  mesh: SkinnedMesh,
  geometry: BufferGeometry,
  triangles: readonly number[],
  toBind: boolean,
): BufferGeometry {
  const index = indexOf(geometry)
  const remap = new Map<number, number>()
  const corners: number[] = []
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const old = index[t * 3 + k]!
      let fresh = remap.get(old)
      if (fresh === undefined) {
        fresh = remap.size
        remap.set(old, fresh)
      }
      corners.push(fresh)
    }
  }
  const olds = [...remap.keys()]
  const bound = toBind
    ? {
        position: bindPoints(mesh, geometry, 'position'),
        normal: bindPoints(mesh, geometry, 'normal'),
      }
    : null
  const out = new BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const size = attribute.itemSize
    const values =
      name === 'skinIndex'
        ? new Uint16Array(olds.length * size)
        : new Float32Array(olds.length * size)
    const from = bound?.[name as 'position' | 'normal']
    olds.forEach((old, i) => {
      for (let c = 0; c < size; c++) {
        values[i * size + c] = from ? from[old * size + c]! : attribute.getComponent(old, c)
      }
    })
    out.setAttribute(name, new BufferAttribute(values, size))
  }
  out.setIndex(corners)
  return out
}

/** One part of a borrowed hairstyle: the cap, or the cards. */
export type HairPart = {
  name: 'cap' | 'cards'
  /** In the donor's bind pose; its skin's bone slots are the donor's. */
  geometry: BufferGeometry
  /** Holds the part's texture where it was loaded in a browser. */
  material: Material
  /** Its texture's pixels (the cap's with the skin cut away), to dye; null where there are none. */
  pixels: Pixels | null
  /** Which of those pixels a dye takes (all that show, when null), and their usual lightness. */
  dyeMask: Float32Array | null
  lum: number
  /**
   * Its texels less opaque than this (0–255) are cut away: the rest's
   * colour is bled under them (see `bleedHair`).
   */
  bleedBelow: number
  /** How far (bind units) it is kept off the wearer's head and body. */
  clearance: number
  /** How far each of its points stood over the donor's bald cranium (bind units; see `keepStandoff`). */
  standoff: Float32Array
}

/**
 * A hairstyle ready to put on anyone (see `wearHair`): the donor's hair,
 * its bones' names (the face's named as the head) and bind places by skin
 * slot, and how the shared skull fits the donor's cranium.
 */
export type HairAsset = {
  id: string
  parts: HairPart[]
  bones: string[]
  anchors: Float32Array
  fit: AxisFit
  basis: HairBasis
}

/**
 * The skull's hair share a cap triangle's every corner has at least, when
 * on the skull: the face — its brows, a beard — stays the donor's.
 */
const CAP_ZONE = 0.02

/** Where the skull's zone is at least this at every corner, the donor's head is scalp: in the cap, for any hair painted there. */
const CAP_SCALP = 0.05

/** A cap triangle's corners off the skull's nearest point by more than this are hair whatever the zone. */
const CAP_OFF = 0.006

/** How far (bind units) the cap and the cards are kept off the wearer. */
const CAP_CLEARANCE = 0.0015
const CARD_CLEARANCE = 0.003

/** Deeper (bind units) into the wearer than this, a point is left be by `pushOut`. */
const PUSH_REACH = 0.03

/**
 * Hair carried onto a wearer stands as far over its bald head as it stood
 * over the donor's cranium (see head-skull.ts's `keepStandoff`): wholly
 * within STANDOFF_NEAR of it, not at all from STANDOFF_FAR, moved no more
 * than STANDOFF_REACH. The bald surface is the wearer's own head, not the
 * skull the hair is carried by: carried by that alone, a cap would stand
 * off a smaller head, or sink into a larger one.
 */
const STANDOFF_NEAR = 0.01
const STANDOFF_FAR = 0.03
const STANDOFF_REACH = 0.015

/** The cards' cut-out, as the characters' own (see avatar-rig.ts). */
const CARD_ALPHA_TEST = 0.4

/**
 * The cap is blended over the bald head, its faintest texels (below
 * CAP_ALPHA_TEST) not drawn. Every texel not wholly hair takes the colour
 * of the hair round it (see `bleedHair`): a hairline's strands over the
 * donor's skin, or short hair the skin shows through, are hair-coloured
 * and as opaque as there is hair, the wearer's own skin showing through
 * them instead of the donor's.
 */
const CAP_ALPHA_TEST = 0.05
const CAP_BLEED_BELOW = 255

/** A piece of a head's hair this small beside its largest, wholly below the neck, is worn there: a bead, a pendant. */
const JEWEL = 0.05

/**
 * Which of a head's own hair triangles (`own`) are jewellery its mesh
 * models with it (see JEWEL): pieces joined at corners, or at corners at
 * one spot; `neck` the top of the neck's height (bind pose).
 */
function jewellery(
  own: Uint8Array,
  index: ArrayLike<number>,
  points: Triples,
  spots: Int32Array,
  spotCount: number,
  neck: number,
): Uint8Array {
  const parent = Int32Array.from({ length: spotCount }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  const count = index.length / 3
  for (let t = 0; t < count; t++) {
    if (!own[t]) continue
    const a = find(spots[index[t * 3]!]!)
    parent[find(spots[index[t * 3 + 1]!]!)] = a
    parent[find(spots[index[t * 3 + 2]!]!)] = a
  }
  const pieces = new Map<number, { size: number; top: number }>()
  for (let t = 0; t < count; t++) {
    if (!own[t]) continue
    const root = find(spots[index[t * 3]!]!)
    const piece = pieces.get(root) ?? { size: 0, top: Number.NEGATIVE_INFINITY }
    piece.size++
    for (let k = 0; k < 3; k++) piece.top = Math.max(piece.top, points[index[t * 3 + k]! * 3 + 1]!)
    pieces.set(root, piece)
  }
  const largest = Math.max(0, ...[...pieces.values()].map((piece) => piece.size))
  return Uint8Array.from({ length: count }, (_, t) => {
    const piece = own[t] ? pieces.get(find(spots[index[t * 3]!]!)) : undefined
    return piece && piece.size < JEWEL * largest && piece.top < neck ? 1 : 0
  })
}

/**
 * Of a cap's triangles, those in pieces (joined at corners, or at corners
 * at one spot) that hold some of the hair (`onHair`, by spot): what else
 * the donor's head mesh models on the scalp's zone — a necklace's beads on
 * its chest — stays the donor's.
 */
function joinedToHair(
  triangles: readonly number[],
  index: ArrayLike<number>,
  spots: Int32Array,
  spotCount: number,
  onHair: Uint8Array,
): number[] {
  const parent = Int32Array.from({ length: spotCount }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  for (const t of triangles) {
    const a = find(spots[index[t * 3]!]!)
    parent[find(spots[index[t * 3 + 1]!]!)] = a
    parent[find(spots[index[t * 3 + 2]!]!)] = a
  }
  const hairy = new Uint8Array(spotCount)
  for (let spot = 0; spot < spotCount; spot++) if (onHair[spot]) hairy[find(spot)] = 1
  return triangles.filter((t) => hairy[find(spots[index[t * 3]!]!)])
}

/**
 * A hairstyle from a donor's loaded scene: the cap (its head's triangles
 * touching its hair's shell, clear of the face) and the hair cards (its
 * opacity mesh without the lashes and any gear). `pixels` are its head and
 * opacity textures', for the cap's cut-out and dyeing; without them
 * (offline) the parts have geometry only.
 */
export function hairAssetOf(
  id: string,
  scene: Object3D,
  basis: HairBasis,
  pixels: { head: Pixels; opacity: Pixels | null } | null,
): HairAsset {
  const head = headOf(scene) as SkinnedMesh | null
  if (!head?.isSkinnedMesh) throw new Error(`hair ${id}: no head`)
  const fit = faceFit(basis.skull, bonePlaces(head))
  if (!fit) throw new Error(`hair ${id}: no face bones`)
  const skull = fitSkull(basis.skull, fit)
  const geometry = originalGeometry(head)
  const points = bindPoints(head, geometry, 'position')
  const cranium = craniumOf(basis, fit, points, eyesOf(head)) ?? fit
  const bald = fitBald(basis.skull, cranium)
  const standoffOf = (part: BufferGeometry) =>
    standingOver(part.getAttribute('position').array as Float32Array, bald).height
  const count = points.length / 3
  const { zone, off } = standingOver(points, skull)
  const shell = shellOf(head, basis)
  const index = indexOf(geometry)
  const clearOfFace = (i: number) => zone[i]! >= CAP_ZONE || off[i]! > CAP_OFF
  // The cap: the donor's own hair as a bald head of it would lose it (see
  // bald-head.ts) — its sculpted shell, and its hair painted onto the
  // scalp — and the skin round it clear of the face, where a hairline, a
  // temple or a sideburn is painted.
  const own = basis.bald.get(ownMaterial(head).name)
  const { spots, count: spotCount } = spotsOf(points)
  const onHair = new Uint8Array(spotCount)
  const capTriangles: number[] = []
  const neck =
    boneBindPositions(head)[head.skeleton.bones.findIndex((b) => isHeadBone(b.name)) * 3 + 1]
  const worn =
    own && neck !== undefined ? jewellery(own, index, points, spots, spotCount, neck) : null
  for (let t = 0; (own || shell) && t < index.length / 3; t++) {
    const corners = [0, 1, 2].map((k) => index[t * 3 + k]!)
    // What a bald head of the donor loses is all its hair, to its hairline
    // (the face is never among it), but for what it wears below its neck.
    if (
      own
        ? own[t] === 1 && !worn?.[t]
        : corners.some((i) => shell![i]) && corners.every(clearOfFace)
    ) {
      capTriangles.push(t)
      for (const i of corners) onHair[spots[i]!] = 1
    }
  }
  for (let t = 0; shell && own && t < index.length / 3; t++) {
    const corners = [0, 1, 2].map((k) => index[t * 3 + k]!)
    if (own[t]) continue
    const round = corners.some((i) => onHair[spots[i]!]) && corners.every(clearOfFace)
    if (round || corners.every((i) => zone[i]! >= CAP_SCALP)) capTriangles.push(t)
  }
  const capped = joinedToHair(capTriangles, index, spots, spotCount, onHair)
  const opacity = ownMeshes(scene, 'opacity')[0]
  const parts: HairPart[] = []
  const opacityMaterial = opacity && ownMaterial(opacity)
  const hair = pixels?.opacity ? meanColor(pixels.opacity) : null
  if (capped.length > 0) {
    const material = ownMaterial(head).clone()
    material.name = `${id}:hair-cap`
    Object.assign(material, {
      transparent: true,
      depthWrite: true,
      alphaTest: CAP_ALPHA_TEST,
      side: FrontSide,
      // Where the cap lies on the wearer's own scalp, it is drawn over it.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    const capGeometry = subset(head, geometry, capped, true)
    const cap: HairPart = {
      name: 'cap',
      geometry: capGeometry,
      material,
      pixels: null,
      dyeMask: null,
      lum: 0,
      bleedBelow: CAP_BLEED_BELOW,
      clearance: CAP_CLEARANCE,
      standoff: standoffOf(capGeometry),
    }
    const uv = geometry.getAttribute('uv')
    const uvs = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = uv.getX(i)
      uvs[i * 2 + 1] = uv.getY(i)
    }
    const places = bonePlaces(head)
    const cheeks = [...places].filter(([name]) => /Cheek$/.test(name)).map(([, place]) => place)
    const skin = pixels && skinTone(pixels.head, uvs, points, cheeks)
    if (pixels && hair && skin) {
      const triangles = capped.map((t): CapTriangle => {
        const at = [0, 1, 2].map((k) => index[t * 3 + k]!)
        return {
          u: at.map((i) => uvs[i * 2]!),
          v: at.map((i) => uvs[i * 2 + 1]!),
          solid: !!shell && at.every((i) => shell[i]),
        }
      })
      cap.pixels = capPixels(
        pixels.head,
        paintedHair(pixels.head, triangles) ?? hair,
        skin,
        triangles,
      )
      cap.dyeMask = Float32Array.from(
        { length: cap.pixels.width * cap.pixels.height },
        (_, i) => cap.pixels!.data[i * 4 + 3]! / 255,
      )
      cap.lum = maskedLuminance(cap.pixels, cap.dyeMask)
    }
    parts.push(cap)
  }
  if (opacity && opacityMaterial) {
    const kinds = kindsOf(opacity)
    const hairTriangles = [...kinds.keys()].filter((t) => kinds[t] === HAIR)
    if (hairTriangles.length > 0) {
      const material = opacityMaterial.clone()
      material.name = `${id}:hair-cards`
      Object.assign(material, { transparent: false, alphaTest: CARD_ALPHA_TEST, depthWrite: true })
      const cardGeometry = subset(opacity, originalGeometry(opacity), hairTriangles, true)
      parts.push({
        name: 'cards',
        geometry: cardGeometry,
        material,
        pixels: pixels?.opacity ?? null,
        dyeMask: null,
        lum: hair ? luminance(...hair) : 0,
        bleedBelow: BLEED_BELOW,
        clearance: CARD_CLEARANCE,
        standoff: standoffOf(cardGeometry),
      })
    }
  }
  return {
    id,
    parts,
    bones: hairBoneNames(head),
    anchors: boneBindPositions(head),
    fit: cranium,
    basis,
  }
}

/**
 * A head made bald (see bald-head.ts): its kept triangles, and its normals
 * turned to the bald surface's near the cut; the bald
 * surface closing it, in the head mesh's own space, skinned as the head
 * round it and showing the texels the hair did; the notch the hair hid
 * in the body's neckline closed (see `collarOf`); the head and the bald
 * surface as one surface (bind pose) for another's hair to stay off; how
 * its skin is painted round the cut; and the heights of the top of its
 * skull and of its neck.
 */
type BaldHead = {
  index: BufferAttribute
  normal: BufferAttribute
  scalp: BufferGeometry | null
  collar: BufferGeometry | null
  surface: Surface
  paint: ScalpPaint
  top: number
  neck: number
  /** How the shared skull fits the head's cranium: another's hair is carried onto the bald head by it. */
  fit: AxisFit
}

/**
 * How far (bind units) from the nearest point of the head as loaded (see
 * SKIN_HEIGHT) the bald surface takes that point's skinning, and down the
 * neck from the nearest point of the body (its clothes, its neck); the rest
 * of it is skinned as what is round it (see `spreadWeights`).
 */
const SKINNED_AS_HEAD = 0.02
const SKINNED_AS_BODY = 0.015

/** This far (bind units) over the top of the neck and higher, the cranium moves with the head alone, as every head's own does. */
const CRANIUM_RIGID = 0.03

/**
 * Of the head as loaded over the top of its neck, only its points standing
 * less than this (bind units) over the skull lend their skinning: its
 * skin, and hair painted on, not long hair's volume, which its maker may
 * have bound to the neck and the back to swing with them. (Down the neck
 * the skull's man's neck says nothing of how far they stand.)
 */
const SKIN_HEIGHT = 0.01

/**
 * How far (bind units) under the kept skin and the clothes the bald surface
 * is tucked where it would stand out of them, within TUCK_REACH of them.
 */
const UNDER_KEPT = 0.0008
const UNDER_CLOTHES = 0.003
const TUCK_REACH = 0.015

/** Where on a hair card (its corners' weights) its shadow is cast from. */
const CARD_SAMPLES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.5, 0.5, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
  [1 / 3, 1 / 3, 1 / 3],
] as const

/** How far down the neck (bind units, from its top) the bald surface gives way to the body over it. */
const LOW_NECK = 0.04

/** Low down the neck, the bald surface this near the kept skin's points (bind units: they are far apart there), and this far from the cut, lies under it. */
const UNDER_SKIN = 0.02
const OFF_CUT = 0.015

/** How far (bind units) under the middle of the body's neckline the bald surface reaches. */
const UNDER_NECKLINE = 0.01

/**
 * Kept skin and the bald surface this near the cut (bind units) are lit
 * alike, turning back to their own normals by TURN_BACK: at the cut the
 * skin's own were smoothed with the hair taken out, and would shade the
 * two apart.
 */
const TURN_FULL = 0.003
const TURN_BACK = 0.015

/** Kept skin standing this far over the skull, or on an ear, keeps its own normals. */
const TURN_STANDING = 0.006

const baldHeads = new WeakMap<BufferGeometry, BaldHead | null>()

/**
 * A head made bald (see `BaldHead`), worked out once per head geometry as
 * loaded. Null for a head the library takes no hair off (one wearing a
 * garment over it), or the skull doesn't fit.
 */
function baldHeadOf(model: Object3D, head: SkinnedMesh, basis: HairBasis): BaldHead | null {
  const geometry = loadedGeometry(head)
  let bald = baldHeads.get(geometry)
  if (bald === undefined) {
    bald = makeBald(model, head, geometry, basis)
    baldHeads.set(geometry, bald)
  }
  return bald
}

/** A skinned mesh's bone slots and weights at a point, as pairs, its slots as `slots` maps them. */
function skinOf(geometry: BufferGeometry, i: number, slots: (slot: number) => number) {
  const index = geometry.getAttribute('skinIndex')
  const weight = geometry.getAttribute('skinWeight')
  const pairs: [number, number][] = []
  for (let k = 0; k < index.itemSize; k++) {
    const w = weight.getComponent(i, k)
    if (w > 0) pairs.push([slots(index.getComponent(i, k)), w])
  }
  return pairs
}

function makeBald(
  model: Object3D,
  head: SkinnedMesh,
  geometry: BufferGeometry,
  basis: HairBasis,
): BaldHead | null {
  const own = basis.bald.get(ownMaterial(head).name)
  const fit = faceFit(basis.skull, bonePlaces(head))
  const eyes = eyesOf(head)
  const headBone = head.skeleton.bones.findIndex((bone) => isHeadBone(bone.name))
  const index = indexOf(geometry)
  if (!(own?.includes(1) && fit && eyes && headBone >= 0) || own.length < index.length / 3) {
    return null
  }
  const points = bindPoints(head, geometry, 'position')
  const normals = bindPoints(head, geometry, 'normal')
  const count = points.length / 3
  const places = boneBindPositions(head)
  const neck = places[headBone * 3 + 1]!
  const marks = {
    eyes: [eyes.slice(0, 3), eyes.slice(3, 6)],
    neck,
    nape: places[headBone * 3 + 2]!,
  }
  const { spots, count: spotCount } = spotsOf(points)
  const { height } = standingOver(points, fitSkull(basis.skull, fit))
  const taken = cleanCut({ points, index, spots, spotCount, height }, own, marks)
  const cranium = craniumOf(basis, fit, points, eyes)!
  const fitted = fitBald(basis.skull, cranium)
  const kept = keptTriangles(index, taken)
  const keptPoint = new Uint8Array(count)
  for (const i of kept) keptPoint[i] = 1
  const keptIds = [...keptPoint.keys()].filter((i) => keptPoint[i])
  const anchors = new Float32Array(keptIds.length * 3)
  keptIds.forEach((i, k) => {
    anchors.set(points.subarray(i * 3, i * 3 + 3), k * 3)
  })
  // Hung before its neck is fitted and it is bent, so the neck skin kept to
  // either side shapes the piece too.
  const hung = withNeckPiece(fitted, basis.skull.triangles, neck)
  const necked = neckFitted(hung.points, anchors, neck)
  const skull = {
    ...hung,
    points: necked,
    normals: vertexNormals(necked, hung.triangles),
    grid: new PointGrid(necked, SKULL_CELL),
  }
  const bent = bentSkull(skull, hung.triangles, anchors, neck)
  smoothNape(bent.points, hung.triangles, bent.known, neck, marks.nape)
  const bald = { ...hung, points: bent.points, normals: vertexNormals(bent.points, hung.triangles) }
  const chosen = scalpTriangles(bald, { points, normals, index: kept }, marks)

  // The bald surface as a mesh beside the head: its points used.
  const remap = new Map<number, number>()
  const corners: number[] = []
  for (const t of chosen) {
    for (let k = 0; k < 3; k++) {
      const old = bald.triangles[t * 3 + k]!
      let fresh = remap.get(old)
      if (fresh === undefined) {
        fresh = remap.size
        remap.set(old, fresh)
      }
      corners.push(fresh)
    }
  }
  const olds = [...remap.keys()]
  const scalpPoints = new Float32Array(olds.length * 3)
  olds.forEach((old, i) => {
    scalpPoints.set(bald.points.subarray(old * 3, old * 3 + 3), i * 3)
  })
  // Nowhere standing out of the skin the head keeps, nor down the neck out
  // of the body's clothes: the skull's shape and the head's part by some
  // millimetres round the cut, more round a thin neck.
  const keptNormals = new Float32Array(anchors.length)
  keptIds.forEach((i, k) => {
    keptNormals.set(normals.subarray(i * 3, i * 3 + 3), k * 3)
  })
  const keptGrid = new PointGrid(anchors, SKULL_CELL)
  const found: number[] = []
  const distances: number[] = []
  tuckUnder(
    scalpPoints,
    { points: anchors, normals: keptNormals, grid: keptGrid },
    UNDER_KEPT,
    TUCK_REACH,
  )
  // The kept skin along the cut.
  const onCut = new Uint8Array(count)
  for (let t = 0; t < index.length / 3; t++) {
    if (taken[t]) for (let k = 0; k < 3; k++) onCut[index[t * 3 + k]!] = 1
  }
  const cutIds = keptIds.filter((i) => onCut[i])
  const cutGrid = new PointGrid(
    Float32Array.from(
      cutIds.flatMap((i) => [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]),
    ),
    SKULL_CELL,
  )
  const bodyMesh = ownMeshes(model, 'body')[0]
  const bodyGeometry = bodyMesh && originalGeometry(bodyMesh)
  const bodySurface = surfaceOf(ownMeshes(model, 'body'))
  const low = olds.map((_, i) => i).filter((i) => scalpPoints[i * 3 + 1]! < neck)
  const lowPoints = new Float32Array(low.length * 3)
  low.forEach((i, k) => {
    lowPoints.set(scalpPoints.subarray(i * 3, i * 3 + 3), k * 3)
  })
  tuckUnder(lowPoints, bodySurface, UNDER_CLOTHES, TUCK_REACH)
  low.forEach((i, k) => {
    scalpPoints.set(lowPoints.subarray(k * 3, k * 3 + 3), i * 3)
  })
  // The back of the body's neckline, which long hair may have hidden a
  // notch in, closed with what the body shows round it.
  const fan =
    bodyMesh && bodyGeometry
      ? necklineFan(
          bindPoints(bodyMesh, bodyGeometry, 'position'),
          indexOf(bodyGeometry),
          places.subarray(headBone * 3, headBone * 3 + 3),
        )
      : null
  // Nothing hangs into the clothes below that: seen down the neckline, it
  // would show inside them.
  if (fan && fan.points.length > 0) {
    const lowest = fan.points[1]! - UNDER_NECKLINE
    for (let i = 1; i < scalpPoints.length; i += 3) {
      scalpPoints[i] = Math.max(scalpPoints[i]!, lowest)
    }
  }
  // Low down the neck where the body's own skin or collar is over it — its
  // triangles, not only its points, far apart there — the body shows: what
  // of the bald surface reaches there would stand out of it, showing the
  // head's texture stretched over the body's neck. So does the head's own
  // neck skin away from the cut: tucked under the skin's points, the bald
  // surface would still poke through the skin's flat triangles between
  // them.
  {
    const underBody =
      bodyMesh && bodyGeometry
        ? underKept(scalpPoints, vertexNormals(scalpPoints, corners), {
            points: bindPoints(bodyMesh, bodyGeometry, 'position'),
            normals: bindPoints(bodyMesh, bodyGeometry, 'normal'),
            index: indexOf(bodyGeometry),
          }).triangle
        : null
    const near = (grid: PointGrid, i: number, within: number) =>
      grid.nearest(
        scalpPoints[i * 3]!,
        scalpPoints[i * 3 + 1]!,
        scalpPoints[i * 3 + 2]!,
        1,
        found,
        distances,
        within,
      ) > 0 && distances[0]! <= within ** 2
    const kept: number[] = []
    for (let t = 0; t < corners.length; t += 3) {
      const hidden = [0, 1, 2].every((k) => {
        const i = corners[t + k]!
        return (
          scalpPoints[i * 3 + 1]! < neck - LOW_NECK &&
          ((underBody !== null && underBody[i]! >= 0) ||
            (near(keptGrid, i, UNDER_SKIN) && !near(cutGrid, i, OFF_CUT)))
        )
      })
      if (!hidden) kept.push(corners[t]!, corners[t + 1]!, corners[t + 2]!)
    }
    corners.length = 0
    corners.push(...kept)
  }
  // What of it lies under the kept skin — the ring tucked under the cut's
  // edge, the piece hung down the neck — is tucked under its triangles, not
  // only its points, and shows as that skin does where it still shows
  // through: its texels, lit alike. Else it shows in patches of another
  // shade wherever the two cross.
  const keptUnder = keptTriangles(
    index,
    Uint8Array.from({ length: index.length / 3 }, (_, t) =>
      taken[t] ||
      [0, 1, 2].some((k) => {
        const i = index[t * 3 + k]!
        return (
          height[i]! > TURN_STANDING &&
          nearEar(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!, marks)
        )
      })
        ? 1
        : 0,
    ),
  )
  const under = underKept(scalpPoints, vertexNormals(scalpPoints, corners), {
    points,
    normals,
    index: keptUnder,
  })
  for (let j = 0; j < scalpPoints.length / 3; j++) {
    const lift = -UNDER_KEPT - under.height[j]!
    if (under.triangle[j]! < 0 || lift >= 0) continue
    for (let axis = 0; axis < 3; axis++) {
      scalpPoints[j * 3 + axis]! += under.normal[j * 3 + axis]! * lift
    }
  }
  /** A kept triangle's corners' values (`size` per point) at a point of the bald surface under it. */
  const underValue = (values: ArrayLike<number>, size: number, j: number, out: number[]) => {
    const t = under.triangle[j]!
    out.fill(0)
    for (let k = 0; k < 3; k++) {
      const i = keptUnder[t * 3 + k]!
      for (let c = 0; c < size; c++) out[c]! += under.weights[j * 3 + k]! * values[i * size + c]!
    }
  }
  const scalpNormals = vertexNormals(scalpPoints, corners)
  // The kept skin and the bald surface lit alike where they meet: each
  // turned halfway to the other at the cut, back to its own by TURN_BACK.
  const turned = new Float32Array(normals)
  const scalpLit = new Float32Array(scalpNormals)
  {
    const scalpGrid = new PointGrid(scalpPoints, SKULL_CELL)
    const turnOf = (x: number, y: number, z: number) =>
      cutGrid.nearest(x, y, z, 1, found, distances, TURN_BACK) === 0
        ? 0
        : (1 - smoothstep(TURN_FULL, TURN_BACK, Math.sqrt(distances[0]!))) / 2
    const turn = (
      out: Float32Array,
      own: Float32Array,
      i: number,
      other: Float32Array,
      j: number,
      share: number,
    ) => {
      let length = 0
      for (let axis = 0; axis < 3; axis++) {
        const value = own[i * 3 + axis]! + (other[j * 3 + axis]! - own[i * 3 + axis]!) * share
        out[i * 3 + axis] = value
        length += value * value
      }
      length = Math.sqrt(length) || 1
      for (let axis = 0; axis < 3; axis++) out[i * 3 + axis]! /= length
    }
    for (const i of keptIds) {
      const [x, y, z] = [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]
      if (height[i]! > TURN_STANDING || nearEar(x, y, z, marks)) continue
      const share = turnOf(x, y, z)
      if (share <= 0 || scalpGrid.nearest(x, y, z, 1, found, distances) === 0) continue
      turn(turned, normals, i, scalpNormals, found[0]!, share)
    }
    for (let j = 0; j < scalpPoints.length / 3; j++) {
      const [x, y, z] = [scalpPoints[j * 3]!, scalpPoints[j * 3 + 1]!, scalpPoints[j * 3 + 2]!]
      if (nearEar(x, y, z, marks)) continue
      const share = turnOf(x, y, z)
      if (share <= 0 || keptGrid.nearest(x, y, z, 1, found, distances) === 0) continue
      const i = keptIds[found[0]!]!
      if (height[i]! > TURN_STANDING) continue
      turn(scalpLit, scalpNormals, j, normals, i, share)
    }
  }
  {
    const lit = [0, 0, 0]
    for (let j = 0; j < scalpPoints.length / 3; j++) {
      if (under.triangle[j]! < 0) continue
      underValue(turned, 3, j, lit)
      const length = Math.hypot(lit[0]!, lit[1]!, lit[2]!) || 1
      for (let axis = 0; axis < 3; axis++) scalpLit[j * 3 + axis] = lit[axis]! / length
    }
  }
  const vertices = olds.length
  const aroundPoints = new Float32Array(anchors.length + scalpPoints.length)
  aroundPoints.set(anchors)
  aroundPoints.set(scalpPoints, anchors.length)
  const surfaceAround = { points: aroundPoints, grid: new PointGrid(aroundPoints, SKULL_CELL) }

  const uv = geometry.getAttribute('uv')
  const uvs = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    uvs[i * 2] = uv.getX(i)
    uvs[i * 2 + 1] = uv.getY(i)
  }
  const fixedUvs = new Float32Array(vertices * 2)
  {
    const at = [0, 0]
    for (let j = 0; j < vertices; j++) {
      if (under.triangle[j]! < 0) continue
      underValue(uvs, 2, j, at)
      fixedUvs[j * 2] = at[0]!
      fixedUvs[j * 2 + 1] = at[1]!
    }
  }
  const placed = scalpUvs(
    scalpPoints,
    corners,
    { points, uvs, index, triangles: [...taken.keys()].filter((t) => taken[t]) },
    { uvs: fixedUvs, has: Uint8Array.from(under.triangle, (t) => (t >= 0 ? 1 : 0)) },
  )

  // Skinned as the head was where its hair was: the cranium with the head
  // alone (see CRANIUM_RIGID), the nape with the head mesh's own weights,
  // running from the head down to the spine as its maker painted them (see
  // SKIN_HEIGHT), and as the body further down. Spread from the few places
  // the kept skin and the body meet it, the spine's weight reached up over
  // the occiput and the nape folded as the head turned. The face's bones
  // count as the head: a nape doesn't move with the jaw or a brow.
  const nearest = Array.from({ length: vertices }, (_, i) => {
    const n = keptGrid.nearest(
      scalpPoints[i * 3]!,
      scalpPoints[i * 3 + 1]!,
      scalpPoints[i * 3 + 2]!,
      1,
      found,
      distances,
    )
    return n > 0 ? { at: keptIds[found[0]!]! } : null
  })
  const onSkull = [...height.keys()].filter(
    (i) => height[i]! < SKIN_HEIGHT || points[i * 3 + 1]! < neck,
  )
  const headGrid = new PointGrid(
    Float32Array.from(
      onSkull.flatMap((i) => [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]),
    ),
    SKULL_CELL,
  )
  const headBoneOf = head.skeleton.bones.map((bone, slot) => {
    for (let up = bone.parent; up; up = up.parent) {
      if (up === head.skeleton.bones[headBone]) return headBone
    }
    return slot
  })
  const bodyBones =
    bodyMesh?.skeleton.bones.map((bone) => {
      const same = head.skeleton.bones.indexOf(bone)
      return same >= 0 ? same : head.skeleton.bones.findIndex((b) => b.name === bone.name)
    }) ?? []
  const known = Array.from({ length: vertices }, (_, i): [number, number][] | null => {
    if (scalpPoints[i * 3 + 1]! >= neck + CRANIUM_RIGID) return [[headBone, 1]]
    const onHead = headGrid.nearest(
      scalpPoints[i * 3]!,
      scalpPoints[i * 3 + 1]!,
      scalpPoints[i * 3 + 2]!,
      1,
      found,
      distances,
      SKINNED_AS_HEAD,
    )
    if (onHead > 0 && distances[0]! <= SKINNED_AS_HEAD ** 2) {
      return skinOf(geometry, onSkull[found[0]!]!, (slot) => headBoneOf[slot] ?? slot)
    }
    if (!(bodyGeometry && scalpPoints[i * 3 + 1]! < neck)) return null
    const n = bodySurface.grid.nearest(
      scalpPoints[i * 3]!,
      scalpPoints[i * 3 + 1]!,
      scalpPoints[i * 3 + 2]!,
      1,
      found,
      distances,
      SKINNED_AS_BODY,
    )
    if (n === 0) return null
    const pairs = skinOf(bodyGeometry, found[0]!, (slot) => bodyBones[slot] ?? -1)
    return pairs.every(([bone]) => bone >= 0) ? pairs : null
  })
  const skin = spreadWeights(
    vertices,
    corners,
    known,
    headBone,
    geometry.getAttribute('skinIndex').itemSize,
  )

  const rings = cutRings(index, taken, spots, spotCount, TONE_RINGS)
  const { zone } = standingOver(points, fitted)
  const scalpCorners = {
    uvs: new Float32Array(placed.triangles.length * 2),
    points: new Float32Array(placed.triangles.length * 3),
  }
  placed.triangles.forEach((f, k) => {
    scalpCorners.uvs.set(placed.uvs.subarray(f * 2, f * 2 + 2), k * 2)
    const i = placed.from[f]!
    scalpCorners.points.set(scalpPoints.subarray(i * 3, i * 3 + 3), k * 3)
  })
  // What shaded the body: what was taken out of the head, and the cards.
  const hairPoints: number[] = []
  for (let t = 0; t < index.length / 3; t++) {
    if (!taken[t]) continue
    for (let k = 0; k < 3; k++) {
      const i = index[t * 3 + k]!
      hairPoints.push(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!)
    }
  }
  for (const cards of ownMeshes(model, 'opacity')) {
    const kinds = kindsOf(cards)
    const cardGeometry = originalGeometry(cards)
    const cardPoints = bindPoints(cards, cardGeometry, 'position')
    const cardIndex = indexOf(cardGeometry)
    for (let t = 0; t < kinds.length; t++) {
      if (kinds[t] !== HAIR) continue
      // A card is a few points far apart: its middle and its edges' too.
      const [a, b, c] = [0, 1, 2].map((k) => cardIndex[t * 3 + k]! * 3)
      for (const [wa, wb, wc] of CARD_SAMPLES) {
        for (let axis = 0; axis < 3; axis++) {
          hairPoints.push(
            cardPoints[a! + axis]! * wa + cardPoints[b! + axis]! * wb + cardPoints[c! + axis]! * wc,
          )
        }
      }
    }
  }
  const bodyUv = bodyGeometry?.getAttribute('uv')
  const shadow =
    bodyMesh && bodyGeometry && bodyUv
      ? hairShadow(
          {
            points: bindPoints(bodyMesh, bodyGeometry, 'position'),
            uvs: Float32Array.from({ length: bodyUv.count * 2 }, (_, j) =>
              bodyUv.getComponent(j >> 1, j & 1),
            ),
            index: indexOf(bodyGeometry),
          },
          hairPoints,
          marks,
        )
      : new Float32Array()
  const paint: ScalpPaint = {
    ...scalpPaint({ points, normals, uvs, index }, taken, rings, spots, zone, marks, scalpCorners),
    shadow,
  }
  let scalp: BufferGeometry | null = null
  if (vertices > 0) {
    const shade = hollowShade(scalpPoints, scalpNormals, surfaceAround)
    for (let j = 0; j < vertices; j++) if (under.triangle[j]! >= 0) shade[j] = 1
    scalp = new BufferGeometry()
    const unbind = head.bindMatrix.clone().invert()
    const unbindNormal = new Matrix3().getNormalMatrix(unbind)
    const total = placed.from.length
    const spread = (values: Float32Array) =>
      Float32Array.from(
        { length: total * 3 },
        (_, j) => values[placed.from[Math.floor(j / 3)]! * 3 + (j % 3)]!,
      )
    const position = new BufferAttribute(spread(scalpPoints), 3)
    const normal = new BufferAttribute(spread(scalpLit), 3)
    position.applyMatrix4(unbind)
    normal.applyNormalMatrix(unbindNormal)
    scalp.setAttribute('position', position)
    scalp.setAttribute('normal', normal)
    scalp.setAttribute('uv', new BufferAttribute(placed.uvs, 2))
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (name === 'position' || name === 'normal' || name === 'uv') continue
      const size = attribute.itemSize
      const values =
        name === 'skinIndex' ? new Uint16Array(total * size) : new Float32Array(total * size)
      for (let f = 0; f < total; f++) {
        const i = placed.from[f]!
        const from = nearest[i]
        for (let c = 0; c < size; c++) {
          const at = f * size + c
          if (name === 'skinIndex') values[at] = skin.index[i * size + c]!
          else if (name === 'skinWeight') values[at] = skin.weight[i * size + c]!
          else if (name === 'color' && c < 3)
            values[at] = (from ? attribute.getComponent(from.at, c) : 1) * shade[i]!
          else values[at] = from ? attribute.getComponent(from.at, c) : 0
        }
      }
      scalp.setAttribute(name, new BufferAttribute(values, size))
    }
    scalp.setIndex(Array.from(placed.triangles))
  }

  const normal = new BufferAttribute(turned, 3)
  normal.applyNormalMatrix(new Matrix3().getNormalMatrix(head.bindMatrix.clone().invert()))

  const surfacePoints = new Float32Array((keptIds.length + olds.length) * 3)
  const surfaceNormals = new Float32Array(surfacePoints.length)
  keptIds.forEach((i, k) => {
    surfacePoints.set(points.subarray(i * 3, i * 3 + 3), k * 3)
    surfaceNormals.set(normals.subarray(i * 3, i * 3 + 3), k * 3)
  })
  surfacePoints.set(scalpPoints, keptIds.length * 3)
  surfaceNormals.set(scalpNormals, keptIds.length * 3)
  let top = Number.NEGATIVE_INFINITY
  for (let i = 1; i < bald.points.length; i += 3) top = Math.max(top, bald.points[i]!)
  return {
    index: new BufferAttribute(
      geometry.index?.array instanceof Uint16Array ? Uint16Array.from(kept) : kept,
      1,
    ),
    normal,
    scalp,
    collar: fan && bodyMesh && bodyGeometry ? collarOf(fan, bodyMesh, bodyGeometry) : null,
    surface: {
      points: surfacePoints,
      normals: surfaceNormals,
      grid: new PointGrid(surfacePoints, SKULL_CELL),
    },
    paint,
    top,
    neck,
    fit: cranium,
  }
}

/** How far past a neckline's rim (in texture coordinates) the notch closing it reads the body's texture. */
const PAST_RIM = 0.012

/**
 * The notch closing the back of a body's neckline (see `necklineFan`), in
 * the body mesh's own space and skinned, lit and textured as the body round
 * it: its middle as all of its rim, and its texture the body's just past
 * the rim — a collar, or skin.
 */

function collarOf(
  fan: ReturnType<typeof necklineFan>,
  body: SkinnedMesh,
  geometry: BufferGeometry,
): BufferGeometry | null {
  const count = fan.points.length / 3
  if (count === 0) return null
  let lowest = 1
  for (let k = 2; k < count; k++) {
    if (fan.points[k * 3 + 1]! < fan.points[lowest * 3 + 1]!) lowest = k
  }
  const collar = new BufferGeometry()
  const position = new BufferAttribute(fan.points.slice(), 3)
  position.applyMatrix4(body.bindMatrix.clone().invert())
  collar.setAttribute('position', position)
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (name === 'position') continue
    const size = attribute.itemSize
    const values =
      name === 'skinIndex' ? new Uint16Array(count * size) : new Float32Array(count * size)
    for (let k = 1; k < count; k++) {
      for (let c = 0; c < size; c++) values[k * size + c] = attribute.getComponent(fan.body[k]!, c)
    }
    if (name === 'skinIndex' || name === 'skinWeight') {
      // The middle hangs from the bones of the rim's lowest point.
      for (let c = 0; c < size; c++) values[c] = values[lowest * size + c]!
    } else if (name === 'uv') {
      // The texture inside a neckline's rim is the hole's (dark, or none):
      // all of it shows the body's just out past the rim's lowest point.
      const middle = [0, 0]
      for (let k = 1; k < count; k++) {
        middle[0]! += values[k * 2]! / (count - 1)
        middle[1]! += values[k * 2 + 1]! / (count - 1)
      }
      const du = values[lowest * 2]! - middle[0]!
      const dv = values[lowest * 2 + 1]! - middle[1]!
      const length = Math.hypot(du, dv) || 1
      const u = values[lowest * 2]! + (du / length) * PAST_RIM
      const v = values[lowest * 2 + 1]! + (dv / length) * PAST_RIM
      for (let k = 0; k < count; k++) values.set([u, v], k * 2)
    } else {
      for (let c = 0; c < size; c++) {
        let sum = 0
        for (let k = 1; k < count; k++) sum += values[k * size + c]!
        values[c] = sum / (count - 1)
      }
    }
    collar.setAttribute(name, new BufferAttribute(values, size))
  }
  collar.setIndex(fan.triangles)
  return collar
}

/** Each head geometry as loaded, by a copy of it showing only its kept triangles (see `BaldHead`). */
const baldGeometries = new WeakMap<BufferGeometry, BufferGeometry>()

/** A geometry as loaded showing a bald head's kept triangles alone, sharing all else with it. */
function baldGeometry(loaded: BufferGeometry, bald: BaldHead): BufferGeometry {
  let geometry = baldGeometries.get(loaded)
  if (!geometry) {
    geometry = new BufferGeometry()
    for (const [name, attribute] of Object.entries(loaded.attributes)) {
      geometry.setAttribute(name, name === 'normal' ? bald.normal : attribute)
    }
    geometry.setIndex(bald.index)
    baldGeometries.set(loaded, geometry)
  }
  return geometry
}

/**
 * Makes a character's head bald (steps to undo it into `undo`): it shows
 * only its kept triangles — as loaded, or as a shape already reshaped it
 * (which reshapes the bald one from then on: see avatar-shape.ts) — and the
 * bald surface closing it, a mesh just before it showing its material.
 */
function goBald(model: Object3D, head: SkinnedMesh, bald: BaldHead, undo: (() => void)[]) {
  const loaded = loadedGeometry(head)
  const shown = baldGeometry(loaded, bald)
  head.userData.hairOriginal = loaded
  // The kept triangles are numbered as the geometry's own points: a
  // reshaped copy of it shows them as well.
  if (head.userData.shapeOriginal) {
    head.userData.shapeOriginal = shown
    head.geometry.setIndex(bald.index)
  } else {
    head.geometry = shown
  }
  const scalp = bald.scalp && besides(head, bald.scalp, head.material as Material, 'hair:scalp')
  if (scalp) {
    // Coarser than the head, it would shade itself in facets.
    scalp.castShadow = false
    // Before the head, which `headOf` finds as the last.
    const siblings = scalp.parent!.children
    siblings.splice(siblings.indexOf(scalp), 1)
    siblings.splice(siblings.indexOf(head), 0, scalp)
    follow(scalp, head, unbumped)
  }
  const body = ownMeshes(model, 'body')[0]
  const collar =
    bald.collar && body && besides(body, bald.collar, body.material as Material, 'hair:collar')
  if (collar) follow(collar, body!)
  undo.push(() => {
    scalp?.removeFromParent()
    collar?.removeFromParent()
    if (head.userData.shapeOriginal === shown) {
      head.userData.shapeOriginal = loaded
      head.geometry.setIndex(loaded.index)
    } else if (head.geometry === shown) {
      head.geometry = loaded
    }
    delete head.userData.hairOriginal
  })
}

/** Worn on the head this near the skull's top (bind units) or higher, a mesh is headwear. */
const HEADWEAR = 0.02

/**
 * Hides what a character wears on its head as meshes of their own, for
 * another's hair to go on (steps to undo it into `undo`): headwear — a
 * helmet, a hat, what reaches up past the top of its skull (`top`, less
 * HEADWEAR) — and with it what else it wears above the top of its neck
 * (`neck`), a visor or a mask fixed to it. Glasses alone stay. Returns
 * whether it had headwear.
 */
function hideHeadwear(model: Object3D, top: number, neck: number, undo: (() => void)[]): boolean {
  const worn: { mesh: SkinnedMesh; high: number; middle: number }[] = []
  model.traverse((object) => {
    const mesh = object as SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.visible || mesh.userData.follows) return
    if (mesh.name.startsWith('hair:') || /_(head|body|opacity)$/.test(ownMaterial(mesh).name))
      return
    const points = bindPoints(mesh, originalGeometry(mesh), 'position')
    let high = Number.NEGATIVE_INFINITY
    let sum = 0
    for (let i = 1; i < points.length; i += 3) {
      high = Math.max(high, points[i]!)
      sum += points[i]!
    }
    worn.push({ mesh, high, middle: sum / (points.length / 3) })
  })
  if (!worn.some(({ high }) => high >= top - HEADWEAR)) return false
  for (const { mesh, high, middle } of worn) {
    if (high < top - HEADWEAR && middle < neck) continue
    mesh.visible = false
    undo.push(() => {
      mesh.visible = true
    })
  }
  return true
}

/**
 * Makes a mesh show another's material, whatever that is from one frame to
 * the next: a look dresses the character's own meshes (see avatar-look.ts)
 * and frees what it dressed them in when a newer look replaces it, which a
 * mesh that only copied it would go on showing.
 */
function follow(mesh: Mesh, source: Mesh, as: (material: Material) => Material = (m) => m) {
  mesh.userData.follows = source
  Object.defineProperty(mesh, 'material', {
    get: () => as(source.material as Material),
    set: () => {},
    configurable: true,
  })
}

const unbumpedCopies = new WeakMap<Material, { copy: Material; version: number }>()

/**
 * A head's material as the bald surface shows it: without its normal map.
 * The surface shows the texels the hair did (see `scalpUvs`), whose bumps
 * are the hair's strands.
 */
function unbumped(material: Material): Material {
  const standard = material as MeshStandardMaterial
  if (!standard.normalMap) return material
  let found = unbumpedCopies.get(material)
  // Kept in step with the head's: a viewer may retune it.
  if (!found || found.version !== standard.version) {
    found?.copy.dispose()
    const copy = standard.clone()
    copy.normalMap = null
    found = { copy, version: standard.version }
    unbumpedCopies.set(material, found)
  }
  return found.copy
}

/** Puts a new skinned mesh beside another, on its skeleton, bound as it is. */
function besides(beside: SkinnedMesh, geometry: BufferGeometry, material: Material, name: string) {
  const mesh = new SkinnedMesh(geometry, material)
  mesh.name = name
  mesh.position.copy(beside.position)
  mesh.quaternion.copy(beside.quaternion)
  mesh.scale.copy(beside.scale)
  mesh.bind(beside.skeleton, beside.bindMatrix)
  mesh.castShadow = beside.castShadow
  mesh.receiveShadow = beside.receiveShadow
  // Skinned bounds follow the bind pose, not the animated body.
  mesh.frustumCulled = false
  beside.parent?.add(mesh)
  return mesh
}

/**
 * Hides a character's own hair cards (steps to undo them into `undo`),
 * keeping what else its opacity mesh holds — its lashes, and (`keepGear`)
 * gear such as a visor — as a mesh of its own beside it: same skeleton, its geometry
 * reshaped with the rest, showing the hidden mesh's material as the look
 * dresses it.
 */
function hideOwnHair(model: Object3D, keepGear: boolean, undo: (() => void)[]) {
  for (const mesh of ownMeshes(model, 'opacity')) {
    const kinds = kindsOf(mesh)
    if (!(kinds.includes(HAIR) || (!keepGear && kinds.includes(GEAR)))) continue
    const wasVisible = mesh.visible
    mesh.visible = false
    const kept = [...kinds.keys()].filter(
      (t) => kinds[t] === LASH || (keepGear && kinds[t] === GEAR),
    )
    const keptMesh =
      kept.length > 0
        ? besides(
            mesh,
            subset(mesh, originalGeometry(mesh), kept, false),
            mesh.material as Material,
            `${mesh.name}:kept`,
          )
        : null
    if (keptMesh) follow(keptMesh, mesh)
    undo.push(() => {
      mesh.visible = wasVisible
      if (keptMesh) {
        keptMesh.removeFromParent()
        keptMesh.geometry.dispose()
      }
    })
  }
}

/** A copy of `template` (its sampling, colour space, flip) showing `pixels`. */
function textureFrom(pixels: Pixels, template: Texture): Texture {
  const texture = template.clone()
  texture.source = new Source(pictureOf(pixels))
  texture.needsUpdate = true
  return texture
}

/** Frees a texture no one needs again: its picture too. */
function freeTexture(texture: Texture) {
  texture.dispose()
  const image = texture.image as ImageBitmap | null
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
}

/** The textures a material shows. */
function texturesOf(material: Material): Set<Texture> {
  const found = new Set<Texture>()
  for (const value of Object.values(material)) {
    if ((value as Texture | null)?.isTexture) found.add(value as Texture)
  }
  return found
}

/**
 * Frees the GPU's copies of a material's textures. A wearer still showing
 * them has them uploaded again.
 */
function releaseTextures(material: Material) {
  for (const texture of texturesOf(material)) texture.dispose()
}

/** Each part's pixels as last dyed, and the dye: worn again in it, it shows at once. */
const lastDyed = new WeakMap<HairPart, { hex: string; pixels: Pixels }>()

/** A part's pixels dyed `hex` (see hair-dye.ts), kept as its last dye. */
function dyedPart(part: HairPart, pixels: Pixels, hex: string): Promise<Pixels> {
  const last = lastDyed.get(part)
  if (last?.hex === hex) return Promise.resolve(last.pixels)
  return dyeHair(pixels, part.lum, hex).then((dyed) => {
    lastDyed.set(part, { hex, pixels: dyed })
    return dyed
  })
}

/** Dyes a hairstyle's parts `hex` ahead of wearing it (see `useAvatarHair`). */
function dyeAhead(asset: HairAsset, hex: string): Promise<unknown> {
  return Promise.all(
    asset.parts.map((part) => (part.pixels ? dyedPart(part, part.pixels, hex) : null)),
  )
}

/**
 * Puts a hairstyle on a character (steps to undo it into `undo`): each part
 * carried from the donor's bind pose into the wearer's, on the wearer's
 * skeleton, from the donor's cranium to the wearer's bald head (`bald`),
 * kept off it and the body. Returns what dyes it (`null` for its own colour).
 */
function wearBorrowed(
  model: Object3D,
  head: SkinnedMesh,
  asset: HairAsset,
  bald: Pick<BaldHead, 'surface' | 'fit'>,
  undo: (() => void)[],
): (hex: string | null) => void {
  // From the donor's cranium to the wearer's: the hair sits on the bald head
  // as it sat on the donor's.
  const carry = composeFits(bald.fit, invertFit(asset.fit))
  const surface = surfaceOf([], [bald.surface, surfaceOf(ownMeshes(model, 'body'))])

  const names = head.skeleton.bones.map((bone) => bone.name)
  const headIndex = names.findIndex(isHeadBone)
  const slots = remapBones(asset.bones, names, headIndex)
  const places = boneBindPositions(head)
  const from = new Float32Array(asset.anchors.length)
  const to = new Float32Array(asset.anchors.length)
  slots.forEach((bone, slot) => {
    for (let axis = 0; axis < 3; axis++) {
      // Hair on the head keeps its place over the skull; on the body, over its bones.
      from[slot * 3 + axis] = bone === headIndex ? 0 : asset.anchors[slot * 3 + axis]!
      to[slot * 3 + axis] = bone === headIndex ? carry.shift[axis]! : places[bone * 3 + axis]!
    }
  })
  const unbind = head.bindMatrix.clone().invert()
  const unbindNormal = new Matrix3().getNormalMatrix(unbind)

  const dyes: ((hex: string | null) => void)[] = []
  for (const part of asset.parts) {
    const geometry = part.geometry.clone()
    const skinIndex = geometry.getAttribute('skinIndex')
    const carried = carryPoints(
      part.geometry.getAttribute('position').array as Float32Array,
      skinIndex.array as Uint16Array,
      geometry.getAttribute('skinWeight').array as Float32Array,
      { from, to },
      carry.scale,
    )
    keepStandoff(carried, part.standoff, bald.surface, STANDOFF_NEAR, STANDOFF_FAR, STANDOFF_REACH)
    pushOut(carried, surface, part.clearance, PUSH_REACH)
    const normal = geometry.getAttribute('normal')
    for (let i = 0; i < normal.count; i++) {
      // A normal turns by the inverse of a stretch.
      const nx = normal.getX(i) / carry.scale[0]
      const ny = normal.getY(i) / carry.scale[1]
      const nz = normal.getZ(i) / carry.scale[2]
      const length = Math.hypot(nx, ny, nz) || 1
      normal.setXYZ(i, nx / length, ny / length, nz / length)
    }
    geometry.setAttribute('position', new BufferAttribute(carried, 3))
    geometry.getAttribute('position').applyMatrix4(unbind)
    normal.applyNormalMatrix(unbindNormal)
    for (let i = 0; i < skinIndex.array.length; i++)
      skinIndex.array[i] = slots[skinIndex.array[i]!]!

    const material = part.material.clone() as MeshStandardMaterial
    const map = material.map
    const shared = texturesOf(part.material)
    let dyed: Texture | null = null
    const show = (pixels: Pixels | null) => {
      const next = pixels && map ? textureFrom(pixels, map) : null
      const old = material.map
      material.map = next ?? map
      // A copy someone made of the map in its place (a viewer sharpening
      // it) is freed with it.
      if (old && old !== material.map && old !== dyed && !shared.has(old)) old.dispose()
      if (dyed) freeTexture(dyed)
      dyed = next
    }
    // One dye at a time is made: the latest asked for once it is done.
    let wanted: string | null = null
    let dyeing = false
    let off = false
    const dyeTo = (hex: string | null) => {
      wanted = hex
      const pixels = part.pixels
      if (!(map && pixels) || dyeing) return
      const last = hex ? lastDyed.get(part) : null
      if (!hex || last?.hex === hex) {
        show(last?.pixels ?? null)
        return
      }
      dyeing = true
      dyedPart(part, pixels, hex)
        .then(
          (done) => {
            if (!off && wanted === hex) show(done)
          },
          (error: unknown) => console.warn('[look] could not dye the hair', error),
        )
        .finally(() => {
          dyeing = false
          if (!off && wanted !== hex) dyeTo(wanted)
        })
    }
    dyes.push(dyeTo)
    const mesh = besides(head, geometry, material, `hair:${part.name}`)
    // Reshaped with what it is worn over (see ear-shape.ts).
    mesh.userData.wornOn = head
    // The asset's textures aren't released: worn again, its pictures are
    // still on the GPU (see `loadHairAsset`, which releases them once the
    // asset is let go). Copies of them made for this wearing are.
    undo.push(() => {
      off = true
      mesh.removeFromParent()
      geometry.dispose()
      if (dyed) freeTexture(dyed)
      for (const texture of texturesOf(material)) {
        if (texture !== dyed && !shared.has(texture)) texture.dispose()
      }
      material.dispose()
    })
  }
  return (hex) => {
    for (const each of dyes) each(hex)
  }
}

/** A hairstyle being worn (see `wearHair`). */
export type WornHair = {
  /** How the bald head's skin is painted round the cut (see scalp-paint.ts); null with no bald head. */
  paint: ScalpPaint | null
  /** Dyes the borrowed hair (`null` for its own colour). */
  dye: (hex: string | null) => void
  /** Takes it all off again. */
  takeOff: () => void
}

/**
 * Puts a hairstyle on a character over its head made bald (see
 * bald-head.ts) — or, `asset` null, leaves it bald: its own hair cards come
 * off (its lashes and any gear among them stay, a mesh of their own), and
 * under another's hair what it wears on its head. A head the library takes
 * no hair off (a garment over it), or the skull doesn't fit, keeps its own
 * head, and wears no other hair over it.
 */
export function wearHair(model: Object3D, asset: HairAsset | null, basis: HairBasis): WornHair {
  const head = headOf(model) as SkinnedMesh | null
  const undo: (() => void)[] = []
  const takeOff = () => {
    for (const step of undo.reverse()) step()
  }
  if (!head?.isSkinnedMesh) return { paint: null, dye: () => {}, takeOff }
  const bald = baldHeadOf(model, head, basis)
  if (bald) goBald(model, head, bald, undo)
  const headwear = !!bald && !!asset && hideHeadwear(model, bald.top, bald.neck, undo)
  hideOwnHair(model, !headwear, undo)
  const dye = asset && bald ? wearBorrowed(model, head, asset, bald, undo) : () => {}
  return { paint: bald?.paint ?? null, dye, takeOff }
}

/**
 * Whether a character's own hair can come off for another's (see
 * `wearHair`): not on a head the library takes no hair off, a garment over
 * it, where no hairstyle changes anything.
 */
export function canChangeHair(model: Object3D, basis: HairBasis): boolean {
  const head = headOf(model)
  return !!head && !!basis.bald.get(ownMaterial(head).name)?.includes(1)
}

/** The side (px) the cap's texture is read at: the head's 2048 is more than hair needs. */
const CAP_TEXTURE = 1024

/** The donor's materials a hairstyle needs (its head's and its cards'); the rest load bare. */
const HAIR_MATERIAL = /_(head|opacity)$/

/** Loads a donor without its body's textures, which a hairstyle never shows. */
function loadDonor(id: string) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  loader.register((parser) => ({
    name: 'hair-materials-only',
    loadMaterial: (index: number) =>
      HAIR_MATERIAL.test(parser.json.materials[index].name ?? '')
        ? null
        : Promise.resolve(new MeshBasicMaterial()),
  }))
  return loader.loadAsync(avatarUrl(id))
}

/** How many donors' hairstyles are kept loaded (each holds a few MB of pictures). */
const ASSETS_KEPT = 4

const assets = new Map<string, Promise<HairAsset>>()

/**
 * A donor's hairstyle, loaded once (a few are kept; a failed load may be
 * tried again): its cap's texture cut out and its parts' pixels read, so
 * wearing it, dyed or not, is quick.
 */
export function loadHairAsset(donorId: string): Promise<HairAsset> {
  let found = assets.get(donorId)
  if (found) {
    assets.delete(donorId)
  } else {
    found = Promise.all([loadHairLibrary(), loadDonor(donorId)]).then(([library, gltf]) => {
      for (const mesh of ownMeshes(gltf.scene, 'opacity')) foldCardTwins(mesh.geometry)
      const head = headOf(gltf.scene)
      const headMap = head && (ownMaterial(head) as MeshStandardMaterial).map
      if (!headMap) throw new Error(`hair ${donorId}: no head texture`)
      const opacityMap = ownMeshes(gltf.scene, 'opacity')
        .map((mesh) => (ownMaterial(mesh) as MeshStandardMaterial).map)
        .find((map) => map)
      const asset = hairAssetOf(donorId, gltf.scene, library, {
        head: texturePixels(headMap, CAP_TEXTURE),
        opacity: opacityMap ? texturePixels(opacityMap) : null,
      })
      // Each part shows its own pixels — the cap's cut out, both bled
      // (after the cap and the dyes have read the colours as painted).
      for (const part of asset.parts) {
        const material = part.material as MeshStandardMaterial
        if (part.pixels && material.map) {
          bleedHair(part.pixels, part.bleedBelow)
          const original = material.map
          material.map = textureFrom(part.pixels, original)
          freeTexture(original)
        }
      }
      return asset
    })
    found.catch(() => assets.delete(donorId))
  }
  assets.set(donorId, found)
  if (assets.size > ASSETS_KEPT) {
    const [oldest, letGo] = assets.entries().next().value!
    assets.delete(oldest)
    letGo.then(
      (asset) => {
        for (const part of asset.parts) releaseTextures(part.material)
      },
      () => {},
    )
  }
  return found
}

/** Donors whose hairstyle failed to load, warned of once each. */
const warned = new Set<string>()

/** What a hairstyle worn needs of the rest of the look (see `useAvatarHair`). */
export type HairOn = {
  /** The reshaping its new meshes need with the body's (it moves nothing itself). */
  shaper: Shaper
  /** How the bald head's skin is painted (see scalp-paint.ts), or null. */
  paint: ScalpPaint | null
}

/**
 * Keeps a character in a hairstyle: none (null) leaves its own; BALD makes
 * it bald (see bald-head.ts); a donor's id in the library puts that
 * donor's hair on over the bald head, dyed `dyeHex` when given — any other
 * id (an old or a foreign save) is the character's own hair. A new style
 * replaces the old one only once it has loaded, so the character never
 * shows bald in between; a new dye only dyes it again.
 *
 * Returns, while any hair but its own is on, a new reshaping each time hair
 * goes on — so the body's reshaping, given it, runs again over the new
 * meshes too — and how the look paints the bald head's skin.
 */
export function useAvatarHair(
  model: Object3D,
  style: HairStyle,
  dyeHex: string | null,
): HairOn | null {
  const worn = useRef<{ model: Object3D; hair: WornHair } | null>(null)
  const [on, setOn] = useState<{ model: Object3D; on: HairOn } | null>(null)
  const dyeRef = useRef(dyeHex)
  dyeRef.current = dyeHex
  useEffect(() => {
    const takeOff = () => {
      worn.current?.hair.takeOff()
      worn.current = null
      setOn(null)
    }
    if (worn.current && (worn.current.model !== model || style === null)) takeOff()
    if (style === null) return
    let current = true
    loadHairLibrary()
      .then(async (library) => {
        const offered = style === BALD || library.styles.some((entry) => entry.id === style)
        const asset = offered && style !== BALD ? await loadHairAsset(style) : null
        // Dyed before it goes on, so it never shows undyed first.
        if (asset && dyeRef.current) await dyeAhead(asset, dyeRef.current).catch(() => {})
        if (!current) return
        if (!offered) {
          takeOff()
          return
        }
        worn.current?.hair.takeOff()
        const hair = wearHair(model, asset, library)
        hair.dye(dyeRef.current)
        worn.current = { model, hair }
        setOn({ model, on: { shaper: () => null, paint: hair.paint } })
      })
      .catch((error: unknown) => {
        if (warned.has(style)) return
        warned.add(style)
        console.warn(`[look] could not put on hairstyle ${style}`, error)
      })
    return () => {
      current = false
    }
  }, [model, style])

  useEffect(() => {
    worn.current?.hair.dye(dyeHex)
  }, [dyeHex])

  useEffect(
    () => () => {
      worn.current?.hair.takeOff()
      worn.current = null
    },
    [],
  )
  return on?.model === model ? on.on : null
}
