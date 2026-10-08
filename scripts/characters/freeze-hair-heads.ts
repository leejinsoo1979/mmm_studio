// Freezes the heads the generated-hair tests stand on (see
// packages/editor/src/components/editor/first-person/hair-fixtures.ts):
// for each, what the hair worker is sent (the head, the body cut to the
// neck and shoulders, the bones, the lashes and ears, the own hair cards)
// and the head as hair-base.ts flattens it now.
//
//   bun scripts/characters/freeze-hair-heads.ts
//
// Run it again when the flatten changes on purpose, and look at what moved.
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { avatarGender } from '../../packages/editor/src/components/editor/first-person/avatar-catalog'
import { flattenHead } from '../../packages/editor/src/components/editor/first-person/hair-base'
import {
  HAIR_HEADS,
  pack,
  type StoredHairHead,
} from '../../packages/editor/src/components/editor/first-person/hair-fixtures'
import { hairBaseInput } from '../../packages/editor/src/components/editor/first-person/hair-input'
import { loadHairLibrary } from '../../packages/editor/src/components/editor/first-person/hair-styles'
import {
  hairHeadFile,
  loadCharacterScene,
} from '../../packages/editor/src/components/editor/first-person/hair-test-utils'

const root = resolve(import.meta.dir, '../..')
const charactersDir = join(root, 'apps/editor/public/characters/rocketbox')

/** As the GLB quantised it: 16-bit fractions for positions and UVs, 8-bit for normals and weights. */
const POINT = 1 / 32767
const UV = 1 / 65535
const NORMAL = 1 / 127
const WEIGHT = 1 / 255

const realFetch = globalThis.fetch
globalThis.fetch = (async () =>
  new Response(Bun.file(join(charactersDir, 'hair-styles.json')))) as unknown as typeof fetch
const library = await loadHairLibrary()
globalThis.fetch = realFetch

for (const id of HAIR_HEADS) {
  const input = hairBaseInput(await loadCharacterScene(id), id)
  if (!input) throw new Error(`${id}: no head or body to grow hair on`)
  const { points, index, normals, uvs, skinIndex, skinWeight } = input.head
  const { points: trimmedPoints, uvs: trimmedUvs, index: keptCorners } = input.body
  const metresPerUnit = input.metresPerUnit
  const started = performance.now()
  const base = flattenHead(input, library)
  const ms = performance.now() - started
  const moved: number[] = []
  const movedPoints: number[] = []
  for (let i = 0; i < points.length / 3; i++) {
    const p = base.head.points.subarray(i * 3, i * 3 + 3)
    if (p.some((v, axis) => v !== points[i * 3 + axis])) {
      moved.push(i)
      movedPoints.push(...p)
    }
  }
  const keptTriangles = new Set<string>()
  for (let t = 0; t < base.head.index.length; t += 3) {
    keptTriangles.add(`${base.head.index[t]},${base.head.index[t + 1]},${base.head.index[t + 2]}`)
  }
  const loaded = new Set<string>()
  for (let t = 0; t < index.length; t += 3) loaded.add(`${index[t]},${index[t + 1]},${index[t + 2]}`)
  const added: number[] = []
  for (let t = 0; t < base.head.index.length; t += 3) {
    const corners = [base.head.index[t]!, base.head.index[t + 1]!, base.head.index[t + 2]!]
    if (!loaded.has(corners.join())) added.push(...corners)
  }
  const dropped: number[] = []
  for (let t = 0; t < index.length / 3; t++) {
    if (!keptTriangles.has(`${index[t * 3]},${index[t * 3 + 1]},${index[t * 3 + 2]}`)) dropped.push(t)
  }
  const stored: StoredHairHead = {
    version: 1,
    avatar: id,
    material: input.material,
    metresPerUnit,
    who: { sex: avatarGender(id) === 'female' ? 'female' : 'male', child: id.includes('Child') },
    head: {
      points: pack(points, 'i16', POINT),
      normals: pack(normals, 'i8', NORMAL),
      uvs: pack(uvs, 'u16', UV),
      index: pack(index, 'u16'),
      skinIndex: pack(skinIndex, 'u8'),
      skinWeight: pack(skinWeight, 'u8', WEIGHT),
    },
    body: {
      points: pack(trimmedPoints, 'i16', POINT),
      uvs: pack(trimmedUvs, 'u16', UV),
      index: pack(keptCorners, 'u16'),
    },
    cards: input.cards && pack(input.cards, 'i16', POINT),
    lashes: input.lashes,
    faceBones: input.faceBones,
    bones: input.bones,
    boneIndex: input.boneIndex,
    marks: input.marks,
    ears: input.ears && pack(input.ears, 'u8'),
    flat: {
      moved: pack(moved, 'u16'),
      points: pack(movedPoints, 'i16', POINT),
      dropped: pack(dropped, 'u16'),
      added: pack(added, 'u16'),
    },
  }
  writeFileSync(hairHeadFile(id), `${JSON.stringify(stored, null, 2)}\n`)
  console.log(
    `${id}: ${points.length / 3} points, ${index.length / 3} triangles; flattened ${moved.length} points, dropped ${dropped.length} triangles, closed holes with ${added.length / 3} in ${ms.toFixed(0)} ms; body ${trimmedPoints.length / 3} points`,
  )
}
