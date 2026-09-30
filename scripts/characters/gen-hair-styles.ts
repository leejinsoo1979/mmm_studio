// Builds the hairstyle library the character studio offers — and what a
// hairstyle is carried from one character to another by — and writes the
// file the editor fetches:
//
//   bun scripts/characters/gen-hair-styles.ts
//
// A Rocketbox hairstyle is a shell of the head mesh (sculpted to the hair's
// volume, painted with it) and hair cards on the `_opacity` mesh. For every
// head with hair cards it finds which of its points are that shell: those
// the look system's mask of the cards' hair (look-job.ts's cardHairMask)
// finds hair on, its texture decoded by sharp (installed with Next.js). The
// skull is a bald head's (SKULL_AVATAR), kept with its face bones — every
// head is one template per sex, so the skull fits any of them by those —
// and, for each of its points, the share of the card-haired heads whose
// shell stands out of it there. The styles are the characters with hair
// cards, once each (several professions reuse a character's hair), told
// apart by sex and by how far the hair falls. Hair gear modelled in a head
// (a scrunchie, a tie, a pin) is shell too. Lengths are in the bind pose's
// own units (about 0.9 m on an adult: see avatar-hair.ts).
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { type Material, type Mesh, type Object3D, type SkinnedMesh, Vector3 } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { avatarGender } from '../../packages/editor/src/components/editor/first-person/avatar-catalog'
import {
  faceFit,
  fitSkull,
  type HairAsset,
  type HairBasis,
  hairAssetOf,
  invertFit,
  PointGrid,
  standingOver,
} from '../../packages/editor/src/components/editor/first-person/avatar-hair'
import {
  type HairStyleEntry,
  NORMAL_UNIT,
  POINT_UNIT,
  packFlags,
  type SkullData,
  type StoredHairLibrary,
  ZONE_UNIT,
} from '../../packages/editor/src/components/editor/first-person/hair-styles'
import { headGeometry } from '../../packages/editor/src/components/editor/first-person/head-geometry'
import { cardHairMask } from '../../packages/editor/src/components/editor/first-person/look-job'
import type { Pixels } from '../../packages/editor/src/components/editor/first-person/look-pixels'
import { ROCKETBOX_AVATARS } from '../../packages/editor/src/components/editor/first-person/rocketbox-catalog'

const root = resolve(import.meta.dir, '../..')
const charactersDir = join(root, 'apps/editor/public/characters/rocketbox')
const out = join(charactersDir, 'hair-styles.json')

/**
 * Characters whose hair is only painted on, but whose head mesh carries a
 * bun or a ponytail — the others with something standing off their skull
 * have a hat, a cap or a hood modelled there, which the hair mask can't
 * tell from hair. Their knot — what stands more than KNOT_OFF off the
 * skull behind the head bone, a scrunchie too, in patches reaching up past
 * it (not the collar a head mesh may reach down to) — is shell to take in;
 * their painted cranium is not (a child's skull is larger than the shared
 * one).
 */
const KNOTTED = [
  'Female_Child_01',
  'Military_Female_01',
  'Pilot_Female_01',
  'Pilot_Female_02',
  'Security_Female_01',
  'Sports_Female_01',
]
const KNOT_OFF = 0.03

/** A bald man (shaved; Construction_Male_02 shares his head) whose skull is the smallest of the bald ones. */
const SKULL_AVATAR = 'Business_Male_07'

/** A shell standing this far out of the skull carries hair volume there. */
const SHELL = 0.005

/**
 * The hair mask finds "shell" on the face and down the neck where a pale
 * skin passes for blond hair, and on a painted goatee. Shell is kept where
 * at least FACE_ZONE of the heads carry hair volume, beside the face —
 * further out than FACE_MIDDLE from its middle — where it stands more than
 * FACE_OFF off the skull, and more than NAPE under the head bone only
 * where it stands more than NECK_OFF off it: long hair, not a neck a
 * little fuller than the skull's.
 */
const FACE_ZONE = 0.05
const FACE_MIDDLE = 0.04
const FACE_OFF = 0.006
const NAPE = 0.02
const NECK_OFF = 0.02

/** Points at one spot within this are one (texture seams split them). */
const WELD = 1e-4

/** The texels round a point's own (each way) its hair mask is averaged over. */
const MASK_SPREAD = 1

/** A point is the shell's where its hair mask averages at least this. */
const SHELL_MASK = 0.5

/**
 * The shell's holes are filled, and its specks cleared, by taking this many
 * times the side most of each point's neighbours are on — where at least
 * FILL_SHARE of them are.
 */
const FILL_ROUNDS = 2
const FILL_SHARE = 0.6

/**
 * A patch of shell apart from the rest keeps its place only this big (as a
 * share of the biggest): hair is one piece, but a hair-coloured collar or
 * lip is a patch of its own.
 */
const PATCH_SHARE = 0.1

/**
 * Hair reaching no further down than this under the head bone (the top of
 * the neck) is short — above the nape — and no further than MEDIUM, to
 * the shoulders at most; the rest is long.
 */
const SHORT = 0.03
const MEDIUM = 0.13

/**
 * Two styles are one when their cards have as many points and, brought
 * together by the skull's fits to their heads, half of one's lie this near
 * a point of the other's: the files order a mesh's points as they please,
 * and a profession's copy of a character's hair may have a strand or two
 * nudged. Different styles' cards lie ten times that apart and more.
 */
const SAME_STYLE = 0.001

/**
 * Hair gear modelled in the head mesh — a scrunchie round a bun, a
 * ponytail's tie, a hair pin — is neither hair to the mask nor skin, and
 * would float where the hair was taken in: it is shell too. It is what
 * stands more than GEAR_OFF off the skull, above the head bone and behind
 * it, in patches touching the shell or in pieces of their own; and,
 * GEAR_RINGS rings of neighbours round those, what stands more than
 * GEAR_NEAR off (the part of a tie lying against the hair).
 */
const GEAR_OFF = 0.02
const GEAR_NEAR = 0.01
const GEAR_RINGS = 2

/**
 * A shell point this far over the skull is surely hair, not skin painted
 * with a hairline.
 */
const SURELY_HAIR = 0.006

type Character = { id: string; scene: Object3D; textures: Map<string, Pixels> }

/** Decodes a GLB's colour texture (WebP) for each material named `…_head` or `…_opacity`. */
async function colourTextures(json: GltfJson, bin: Uint8Array) {
  const textures = new Map<string, Pixels>()
  for (const material of json.materials ?? []) {
    const texture = material.pbrMetallicRoughness?.baseColorTexture?.index
    if (texture === undefined || !/_(head|opacity)$/.test(material.name)) continue
    const source = json.textures![texture]!.extensions?.EXT_texture_webp?.source
    const view = json.bufferViews[json.images![source!]!.bufferView]!
    const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    textures.set(material.name, {
      data: Uint8ClampedArray.from(data),
      width: info.width,
      height: info.height,
    })
  }
  return textures
}

type GltfJson = {
  materials?: {
    name: string
    pbrMetallicRoughness?: Record<string, unknown> & { baseColorTexture?: { index: number } }
    extensions?: unknown
    [key: string]: unknown
  }[]
  textures?: { extensions?: { EXT_texture_webp?: { source: number } } }[]
  images?: { bufferView: number }[]
  bufferViews: { byteOffset?: number; byteLength: number }[]
  samplers?: unknown
  extensionsUsed?: string[]
  extensionsRequired?: string[]
}

/**
 * A character's scene, its textures left out (GLTFLoader would need a
 * browser to decode them), and — when `withTextures` — its colour textures
 * decoded apart.
 */
async function loadCharacter(id: string, withTextures: boolean): Promise<Character> {
  const file = new Uint8Array(await Bun.file(join(charactersDir, `${id}.glb`)).arrayBuffer())
  const view = new DataView(file.buffer)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + jsonLength))) as GltfJson
  const textures = withTextures
    ? await colourTextures(json, file.subarray(20 + jsonLength + 8))
    : new Map<string, Pixels>()
  delete json.textures
  delete json.images
  delete json.samplers
  const bare = (list: string[] | undefined) => list?.filter((name) => name !== 'EXT_texture_webp')
  json.extensionsUsed = bare(json.extensionsUsed)
  json.extensionsRequired = bare(json.extensionsRequired)
  for (const material of json.materials ?? []) {
    for (const key of Object.keys(material)) if (key.endsWith('Texture')) delete material[key]
    delete material.pbrMetallicRoughness?.baseColorTexture
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture
    delete material.extensions
  }
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const jsonBytes = new TextEncoder().encode(text)
  const rest = file.subarray(20 + jsonLength)
  const glb = new Uint8Array(20 + jsonBytes.length + rest.length)
  const header = new DataView(glb.buffer)
  header.setUint32(0, 0x46546c67, true)
  header.setUint32(4, 2, true)
  header.setUint32(8, glb.length, true)
  header.setUint32(12, jsonBytes.length, true)
  header.setUint32(16, 0x4e4f534a, true)
  glb.set(jsonBytes, 20)
  glb.set(rest, 20 + jsonBytes.length)
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer, '')
  gltf.scene.updateMatrixWorld(true)
  return { id, scene: gltf.scene, textures }
}

function meshOf(scene: Object3D, part: string): SkinnedMesh | null {
  let found: SkinnedMesh | null = null
  scene.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh && (mesh.material as Material).name.endsWith(`_${part}`))
      found = mesh as SkinnedMesh
  })
  return found
}

const bindPlace = (mesh: SkinnedMesh, bone: number) =>
  new Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[bone]!.clone().invert())

const bonePlaces = (mesh: SkinnedMesh) =>
  new Map(mesh.skeleton.bones.map((bone, i) => [bone.name, bindPlace(mesh, i).toArray()]))

/** A mesh's bind-pose points, those at one spot welded: each point's weld, and each weld's neighbours. */
function welded(mesh: SkinnedMesh) {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.index!
  const spot = new Map<string, number>()
  const weldOf: number[] = []
  const points: number[] = []
  const p = new Vector3()
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix)
    const key = [p.x, p.y, p.z].map((value) => Math.round(value / WELD)).join(',')
    let weld = spot.get(key)
    if (weld === undefined) {
      weld = points.length / 3
      spot.set(key, weld)
      points.push(p.x, p.y, p.z)
    }
    weldOf.push(weld)
  }
  const neighbours = Array.from({ length: points.length / 3 }, () => new Set<number>())
  for (let t = 0; t < index.count; t += 3) {
    const corners = [0, 1, 2].map((k) => weldOf[index.getX(t + k)]!)
    for (const a of corners) for (const b of corners) if (a !== b) neighbours[a]!.add(b)
  }
  return { points, weldOf, neighbours: neighbours.map((set) => [...set]) }
}

/**
 * Which points of a card-haired head the look system's mask of its cards'
 * hair finds hair on, averaged round each point's texel: 1 or 0 per welded
 * point, with the welds.
 */
function hairOf(character: Character, head: SkinnedMesh) {
  const texture = (mesh: Mesh) => character.textures.get((mesh.material as Material).name)!
  const headTexture = texture(head)
  const mask = cardHairMask(
    headTexture,
    texture(meshOf(character.scene, 'opacity')!),
    headGeometry(head),
  )
  const { width, height } = headTexture
  const uv = head.geometry.getAttribute('uv')
  const welds = welded(head)
  const { weldOf } = welds
  const flags = new Uint8Array(welds.neighbours.length)
  const sums = new Float32Array(flags.length)
  const counts = new Float32Array(flags.length)
  for (let i = 0; i < uv.count; i++) {
    const x = Math.floor(uv.getX(i) * width)
    const y = Math.floor(uv.getY(i) * height)
    for (let dy = -MASK_SPREAD; dy <= MASK_SPREAD; dy++) {
      for (let dx = -MASK_SPREAD; dx <= MASK_SPREAD; dx++) {
        const tx = Math.min(width - 1, Math.max(0, x + dx))
        const ty = Math.min(height - 1, Math.max(0, y + dy))
        sums[weldOf[i]!]! += mask[ty * width + tx]!
        counts[weldOf[i]!]!++
      }
    }
  }
  for (let w = 0; w < flags.length; w++) flags[w] = sums[w]! / counts[w]! >= SHELL_MASK ? 1 : 0
  return { flags, ...welds }
}

/**
 * Which points of a card-haired head are its hair's shell: where the hair
 * mask finds hair, its holes filled, specks and stray patches cleared over
 * the mesh.
 */
function shellOf(character: Character, head: SkinnedMesh): Uint8Array {
  const found = hairOf(character, head)
  const { weldOf, neighbours } = found
  let flags = found.flags
  for (let round = 0; round < FILL_ROUNDS; round++) {
    flags = flags.map((flag, w) => {
      const around = neighbours[w]!
      if (around.length === 0) return flag
      const share = around.reduce((sum, n) => sum + flags[n]!, 0) / around.length
      return share >= FILL_SHARE ? 1 : share <= 1 - FILL_SHARE ? 0 : flag
    })
  }
  return withoutPatches(
    head,
    Uint8Array.from(weldOf, (w) => flags[w]!),
  )
}

/** A head's shell in patches apart from each other: each welded point's patch (-1 off the shell) and their sizes. */
function patchesOf(head: SkinnedMesh, shell: Uint8Array) {
  const { weldOf, neighbours } = welded(head)
  const flags = new Uint8Array(neighbours.length)
  weldOf.forEach((w, i) => {
    flags[w] ||= shell[i]!
  })
  const patchOf = new Int32Array(flags.length).fill(-1)
  const sizes: number[] = []
  for (let w = 0; w < flags.length; w++) {
    if (!flags[w] || patchOf[w]! >= 0) continue
    const patch = sizes.length
    const stack = [w]
    patchOf[w] = patch
    let size = 0
    while (stack.length > 0) {
      const at = stack.pop()!
      size++
      for (const n of neighbours[at]!) {
        if (flags[n] && patchOf[n]! < 0) {
          patchOf[n] = patch
          stack.push(n)
        }
      }
    }
    sizes.push(size)
  }
  return { weldOf, patchOf, sizes }
}

/** A head's shell without the patches of it apart from the rest and much smaller (see PATCH_SHARE). */
function withoutPatches(head: SkinnedMesh, shell: Uint8Array): Uint8Array {
  const { weldOf, patchOf, sizes } = patchesOf(head, shell)
  const biggest = Math.max(0, ...sizes)
  return Uint8Array.from(weldOf, (w) =>
    patchOf[w]! >= 0 && sizes[patchOf[w]!]! >= PATCH_SHARE * biggest ? 1 : 0,
  )
}

/**
 * The skull: the bald head's main piece (not its eyeballs), its points at
 * one spot welded into one with their normals averaged, their neighbours
 * along its triangles, and its face bones (the head's children).
 */
function skullOf(head: SkinnedMesh) {
  const { points, weldOf, neighbours } = welded(head)
  const normal = head.geometry.getAttribute('normal')
  const normals = new Float32Array(points.length)
  for (let i = 0; i < normal.count; i++) {
    for (let axis = 0; axis < 3; axis++)
      normals[weldOf[i]! * 3 + axis]! += normal.getComponent(i, axis)
  }
  const count = points.length / 3
  const parent = Array.from({ length: count }, (_, i) => i)
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a]!)))
  neighbours.forEach((around, w) => {
    for (const n of around) parent[find(n)] = find(w)
  })
  const sizes = new Map<number, number>()
  for (let w = 0; w < count; w++) sizes.set(find(w), (sizes.get(find(w)) ?? 0) + 1)
  const main = [...sizes].reduce((best, each) => (each[1] > best[1] ? each : best))[0]
  const kept = [...Array(count).keys()].filter((w) => find(w) === main)
  const keptAt = new Map(kept.map((old, i) => [old, i]))
  const bones: SkullData['bones'] = {}
  const headBone = head.skeleton.bones.find((bone) => /Head$/.test(bone.name))!
  head.skeleton.bones.forEach((bone, i) => {
    let up = bone.parent
    while (up && up !== headBone) up = up.parent
    if (up)
      bones[bone.name] = bindPlace(head, i)
        .toArray()
        .map((value) => Number(value.toFixed(4))) as [number, number, number]
  })
  return {
    bones,
    points: Float32Array.from(kept.flatMap((w) => points.slice(w * 3, w * 3 + 3))),
    normals: Float32Array.from(
      kept.flatMap((w) =>
        new Vector3()
          .fromArray(normals, w * 3)
          .normalize()
          .toArray(),
      ),
    ),
    neighbours: kept.map((old) =>
      neighbours[old]!.filter((n) => keptAt.has(n)).map((n) => keptAt.get(n)!),
    ),
  }
}

// The characters, adults first and professions after (so a style several
// share goes by the first), in the catalogue's order within each.
const ids = ROCKETBOX_AVATARS.map((avatar) => avatar.id).sort((a, b) => {
  const rank = (id: string) => (/^(Female|Male)_/.test(id) ? 0 : /^Business_/.test(id) ? 1 : 2)
  return rank(a) - rank(b)
})
const skullHead = meshOf((await loadCharacter(SKULL_AVATAR, false)).scene, 'head')!
const skull = skullOf(skullHead)
const noZone: SkullData = { ...skull, zone: new Float32Array(skull.points.length / 3) }
const bare: HairBasis = { skull: noZone, shells: new Map() }

// The card-haired heads' shells, and every head with a shell, by its
// material's name.
const shells = new Map<string, Uint8Array>()
const heads = new Map<string, SkinnedMesh>()
const characters: Character[] = []
for (const id of ids) {
  const scene = (await loadCharacter(id, false)).scene
  const cards = meshOf(scene, 'opacity')
  if (!cards || !hairAssetOf(id, scene, bare, null).parts.some((part) => part.name === 'cards')) {
    continue
  }
  const character = await loadCharacter(id, true)
  characters.push(character)
  const head = meshOf(character.scene, 'head')!
  const name = (head.material as Material).name
  if (!shells.has(name)) shells.set(name, shellOf(character, head))
  heads.set(name, head)
}

/**
 * The zone: over each skull point, the share of the card-haired heads
 * whose shell stands out of the skull there by more than SHELL, smoothed
 * once over each point's neighbours so it has no speckle.
 */
function zoneOf(shells: ReadonlyMap<string, Uint8Array>) {
  const hits = new Float32Array(noZone.zone.length)
  for (const character of characters) {
    const head = meshOf(character.scene, 'head')!
    const fitted = fitSkull(noZone, faceFit(noZone, bonePlaces(head))!)
    const shell = shells.get((head.material as Material).name)!
    const position = head.geometry.getAttribute('position')
    const most = new Float32Array(hits.length).fill(Number.NEGATIVE_INFINITY)
    const p = new Vector3()
    for (let i = 0; i < position.count; i++) {
      if (!shell[i]) continue
      p.fromBufferAttribute(position, i).applyMatrix4(head.bindMatrix)
      if (fitted.grid.nearest(p.x, p.y, p.z, 1, found, distances) === 0) continue
      const j = found[0]!
      const height = p
        .sub(new Vector3().fromArray(fitted.points, j * 3))
        .dot(new Vector3().fromArray(fitted.normals, j * 3))
      most[j] = Math.max(most[j]!, height)
    }
    for (let j = 0; j < hits.length; j++) if (most[j]! > SHELL) hits[j]!++
  }
  return Float32Array.from(hits, (hit, j) => {
    const around = skull.neighbours[j]!
    const mean = around.reduce((sum, k) => sum + hits[k]!, 0) / Math.max(1, around.length)
    return (hit + mean) / 2 / characters.length
  })
}

const found: number[] = []
const distances: number[] = []
// Shell the zone says is face, or that runs down the neck, is skin.
const rough = { ...noZone, zone: zoneOf(shells) }
for (const character of characters) {
  const head = meshOf(character.scene, 'head')!
  const name = (head.material as Material).name
  const shell = shells.get(name)!
  const nape =
    bindPlace(
      head,
      head.skeleton.bones.findIndex((bone) => /Head$/.test(bone.name)),
    ).y - NAPE
  const position = head.geometry.getAttribute('position')
  const points = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    new Vector3()
      .fromBufferAttribute(position, i)
      .applyMatrix4(head.bindMatrix)
      .toArray(points, i * 3)
  }
  const { zone, off } = standingOver(points, fitSkull(rough, faceFit(rough, bonePlaces(head))!))
  const cleaned = shell.map((flag, i) => {
    if (points[i * 3 + 1]! < nape) return flag && off[i]! > NECK_OFF ? 1 : 0
    const beside = Math.abs(points[i * 3]!) > FACE_MIDDLE && off[i]! > FACE_OFF
    return flag && (zone[i]! >= FACE_ZONE || beside) ? 1 : 0
  })
  shells.set(name, withoutPatches(head, cleaned))
}
const zone = zoneOf(shells)

// The painted-hair knots.
const zoned: SkullData = { ...noZone, zone }
for (const id of KNOTTED) {
  const head = meshOf((await loadCharacter(id, false)).scene, 'head')!
  const top = bindPlace(
    head,
    head.skeleton.bones.findIndex((bone) => /Head$/.test(bone.name)),
  )
  const position = head.geometry.getAttribute('position')
  const points = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    new Vector3()
      .fromBufferAttribute(position, i)
      .applyMatrix4(head.bindMatrix)
      .toArray(points, i * 3)
  }
  const { off } = standingOver(points, fitSkull(zoned, faceFit(zoned, bonePlaces(head))!))
  const behind = Uint8Array.from(off, (away, i) =>
    away > KNOT_OFF && points[i * 3 + 2]! < top.z ? 1 : 0,
  )
  const { weldOf, patchOf, sizes } = patchesOf(head, behind)
  const reaching = new Set<number>()
  weldOf.forEach((w, i) => {
    if (patchOf[w]! >= 0 && points[i * 3 + 1]! > top.y) reaching.add(patchOf[w]!)
  })
  shells.set(
    (head.material as Material).name,
    Uint8Array.from(weldOf, (w) => (reaching.has(patchOf[w]!) ? 1 : 0)),
  )
  heads.set((head.material as Material).name, head)
  console.log(
    `${id}: knot of ${sizes.filter((_, patch) => reaching.has(patch)).reduce((a, b) => a + b, 0)} points`,
  )
}

/** A head's shell with its hair gear (see GEAR_OFF) added. */
function withGear(head: SkinnedMesh, shell: Uint8Array): Uint8Array {
  const { points, weldOf, neighbours } = welded(head)
  const top = bindPlace(
    head,
    head.skeleton.bones.findIndex((bone) => /Head$/.test(bone.name)),
  )
  const { height } = standingOver(points, fitSkull(zoned, faceFit(zoned, bonePlaces(head))!))
  const onShell = new Uint8Array(neighbours.length)
  weldOf.forEach((w, i) => {
    onShell[w] ||= shell[i]!
  })
  const standing = (w: number, off: number) =>
    !onShell[w] && height[w]! > off && points[w * 3 + 1]! > top.y && points[w * 3 + 2]! < top.z
  const gear = new Uint8Array(neighbours.length)
  const seen = new Uint8Array(neighbours.length)
  for (let w = 0; w < neighbours.length; w++) {
    if (seen[w] || !standing(w, GEAR_OFF)) continue
    const patch = [w]
    seen[w] = 1
    let touches = false
    let alone = true
    for (let k = 0; k < patch.length; k++) {
      for (const n of neighbours[patch[k]!]!) {
        if (onShell[n]) touches = true
        else if (!standing(n, GEAR_OFF)) alone = false
        else if (!seen[n]) {
          seen[n] = 1
          patch.push(n)
        }
      }
    }
    if (touches || alone) for (const each of patch) gear[each] = 1
  }
  let ring = [...gear.keys()].filter((w) => gear[w])
  for (let round = 0; round < GEAR_RINGS; round++) {
    const next: number[] = []
    for (const w of ring) {
      for (const n of neighbours[w]!) {
        if (gear[n] || !standing(n, GEAR_NEAR)) continue
        gear[n] = 1
        next.push(n)
      }
    }
    ring = next
  }
  return Uint8Array.from(weldOf, (w, i) => (shell[i] || gear[w] ? 1 : 0))
}

// The hair gear on every head with a shell.
for (const [name, head] of heads) {
  const shell = shells.get(name)!
  const geared = withGear(head, shell)
  const added = geared.reduce((sum, flag, i) => sum + flag - shell[i]!, 0)
  if (added > 0) console.log(`${name}: ${added} points of hair gear`)
  shells.set(name, geared)
}
const basis: HairBasis = { skull: { ...noZone, zone }, shells }
console.log(`skull: ${zone.length} points; shells of ${shells.size} heads`)

/**
 * How far under the head bone a hairstyle reaches: its cards, and its cap
 * where it is surely hair.
 */
function reach(scene: Object3D, asset: HairAsset) {
  const head = meshOf(scene, 'head')!
  const top = bindPlace(
    head,
    head.skeleton.bones.findIndex((bone) => /Head$/.test(bone.name)),
  ).y
  const fitted = fitSkull(basis.skull, faceFit(basis.skull, bonePlaces(head))!)
  let lowest = Number.POSITIVE_INFINITY
  for (const part of asset.parts) {
    const points = part.geometry.getAttribute('position').array as Float32Array
    const height = part.name === 'cap' ? standingOver(points, fitted).height : null
    for (let i = 0; i < points.length / 3; i++) {
      if (height && height[i]! < SURELY_HAIR) continue
      lowest = Math.min(lowest, points[i * 3 + 1]!)
    }
  }
  return top - lowest
}

/**
 * A style's cards' points in the shared skull's frame (its head's fit
 * undone), to tell one character's hair from another's.
 */
function cardPoints(asset: HairAsset) {
  const points = asset.parts.find((part) => part.name === 'cards')!.geometry.getAttribute('position')
  const back = invertFit(asset.fit)
  return Float32Array.from(
    points.array as Float32Array,
    (value, i) => value * back.scale[i % 3]! + back.shift[i % 3]!,
  )
}

/** Whether two styles' cards (see `cardPoints`) are one's (see SAME_STYLE). */
function sameCards(a: Float32Array, b: Float32Array) {
  if (a.length !== b.length) return false
  const grid = new PointGrid(b, SAME_STYLE * 4)
  const apart: number[] = []
  for (let i = 0; i < a.length; i += 3) {
    grid.nearest(a[i]!, a[i + 1]!, a[i + 2]!, 1, found, distances)
    apart.push(distances[0]!)
  }
  apart.sort((x, y) => x - y)
  return apart[apart.length >> 1]! <= SAME_STYLE ** 2
}

const styles: (HairStyleEntry & { reach: number })[] = []
const kept: { id: string; cards: Float32Array }[] = []
for (const { id, scene } of characters) {
  const asset = hairAssetOf(id, scene, basis, null)
  const cards = cardPoints(asset)
  const twin = kept.find((style) => sameCards(style.cards, cards))
  if (twin) {
    console.log(`${id}: the same hair as ${twin.id}`)
    continue
  }
  kept.push({ id, cards })
  const falls = reach(scene, asset)
  const length = falls <= SHORT ? 'short' : falls <= MEDIUM ? 'medium' : 'long'
  styles.push({ id, gender: avatarGender(id), length, reach: falls })
  console.log(`${id}: ${length} (${falls.toFixed(3)} under the head bone)`)
}

// Women's, then men's; each short to long, and within a length by how far
// it falls, so a picker's neighbours look alike.
const LENGTHS = ['short', 'medium', 'long']
styles.sort(
  (a, b) =>
    Number(a.gender === 'male') - Number(b.gender === 'male') ||
    LENGTHS.indexOf(a.length) - LENGTHS.indexOf(b.length) ||
    a.reach - b.reach,
)
const library: StoredHairLibrary = {
  styles: styles.map(({ id, gender, length }) => ({ id, gender, length })),
  skull: {
    bones: skull.bones,
    points: Array.from(skull.points, (value) => Math.round(value / POINT_UNIT)),
    normals: Array.from(skull.normals, (value) => Math.round(value / NORMAL_UNIT)),
    zone: Array.from(zone, (value) => Math.round(value / ZONE_UNIT)),
  },
  shells: Object.fromEntries([...shells].map(([head, flags]) => [head, packFlags(flags)])),
}
writeFileSync(out, `${JSON.stringify(library)}\n`)
console.log(`${styles.length} styles → ${out}`)
