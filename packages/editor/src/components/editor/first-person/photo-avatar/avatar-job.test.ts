import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBaseForTests } from './__bench__/base-for-tests'
import { syntheticCapture } from './__bench__/synthetic-capture'
import { type CaptureSlot, type CaptureView, type PictureCodec, runAvatarJob } from './avatar-job'
import type { BaseBody } from './base-body'
import { loadBaseExpressions } from './base-files'
import { parseGlb, readPrimitives } from './glb'
import { loadHairStyle } from './hair-library'
import { shapePositions } from './head-model'

const PUBLIC = join(import.meta.dir, '../../../../../../../apps/editor/public/characters/photoreal')
/** The app's files from the repo's public folder, as fetch would serve them. */
const fromDisk = (async (url: string) => new Response(readFileSync(url))) as unknown as typeof fetch

let base: BaseBody

beforeAll(async () => {
  base = await loadBaseForTests('female')
})

/** The bytes of each of the base file's pictures, by name. */
function basePictures(): Map<string, Uint8Array> {
  const { json, bin } = base.glb
  const out = new Map<string, Uint8Array>()
  for (const image of json.images) {
    const view = json.bufferViews[image.bufferView]
    const at = view.byteOffset ?? 0
    out.set(image.name, bin.subarray(at, at + view.byteLength))
  }
  return out
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.byteLength === b.byteLength && a.every((value, i) => value === b[i])

/**
 * A codec that decodes every picture to 32 × 32 (the hair library's, every
 * one not the base file's own, with see-through pixels, as hair is cut out
 * by its alpha) and writes each one as a few marked bytes, keeping what it
 * was given.
 */
function standInCodec(pictures: Map<string, Uint8Array>) {
  const size = 32
  const hairAlpha = (i: number) => (i * 37) % 256
  const written: Uint8ClampedArray[] = []
  const own = [...pictures.values()]
  const codec: PictureCodec = {
    async decode(bytes) {
      const hair = !own.some((picture) => same(bytes, picture))
      const data = new Uint8ClampedArray(size * size * 4)
      for (let i = 0; i < size * size; i++) {
        data.set([180, 130, 110, hair ? hairAlpha(i) : 255], i * 4)
      }
      return { data, width: size, height: size }
    },
    async encode(data, width, height) {
      expect([width, height]).toEqual([size, size])
      written.push(Uint8ClampedArray.from(data))
      return {
        bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, written.length - 1),
        mimeType: 'image/png',
      }
    },
  }
  return { codec, written, hairAlpha }
}

describe('the avatar job, start to finish', () => {
  test('fits, lays the skin, replaces the pictures (the hair keeps its alpha) and writes a file that reads', async () => {
    const pictures = basePictures()
    const { codec, written, hairAlpha } = standInCodec(pictures)
    const rest = shapePositions(base.head, new Float64Array(base.head.targetNames.length))
    const slots: CaptureSlot[] = ['front', 'left45', 'right45']
    const capture = syntheticCapture(base.head, rest, rest, [{ yaw: 0 }, { yaw: 45 }, { yaw: -45 }])
    const views: CaptureView[] = capture.views.map((view, k) => {
      const rgba = new Uint8ClampedArray(view.width * view.height * 4)
      for (let i = 0; i < view.width * view.height; i++) rgba.set([200, 150, 130, 255], i * 4)
      return {
        ...view,
        slot: slots[k]!,
        rgba,
        mask: view.mask ?? null,
        skin: null,
        covered: null,
        classes: null,
        blendshapes: null,
      }
    })
    const stages: string[] = []
    const { glb, report } = await runAvatarJob({
      base,
      expressions: await loadBaseExpressions(PUBLIC, fromDisk),
      views,
      colors: { skin: '#c89682', eyes: '#5a3b20', hair: '#3a2a20' },
      codec,
      hair: (name) => loadHairStyle(name, PUBLIC, fromDisk),
      progress: (fraction, stage) => {
        expect(fraction).toBeGreaterThanOrEqual(0)
        expect(fraction).toBeLessThanOrEqual(1)
        if (stages.at(-1) !== stage) stages.push(stage)
      },
    })
    expect(stages).toEqual(['fit', 'texture', 'pack'])
    expect(report.cameras).toHaveLength(3)
    expect(report.photoShare).toBeGreaterThan(0)
    expect(report.photoShare).toBeLessThanOrEqual(1)

    const file = parseGlb(glb)
    const { json } = file
    const replaced = new Map<string, number>()
    for (const image of json.images) {
      const view = json.bufferViews[image.bufferView]
      const bytes = file.bin.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      )
      if (bytes.byteLength === 5 && bytes[0] === 0x89) {
        expect(image.mimeType).toBe('image/png')
        replaced.set(image.name, bytes[4]!)
      }
    }
    for (const name of ['head_color', 'body_color', 'eye_color', 'hair_color'])
      expect(replaced.has(name)).toBe(true)
    // The hair was toned to its colour but its cut-out (alpha) is the one it came with.
    const hair = written[replaced.get('hair_color')!]!
    for (let i = 0; i < hair.length / 4; i++) expect(hair[i * 4 + 3]).toBe(hairAlpha(i))
    for (const name of ['head_color', 'body_color'])
      expect(written[replaced.get(name)!]!.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true)

    // A valid file: every picture's texture names it plainly or through WebP as its type says,
    // and every mesh still reads.
    for (const texture of json.textures) {
      const source = texture.source ?? texture.extensions?.EXT_texture_webp?.source
      expect(source).toBeDefined()
      if (texture.extensions?.EXT_texture_webp)
        expect(json.images[texture.extensions.EXT_texture_webp.source].mimeType).toBe('image/webp')
    }
    const primitives = await readPrimitives(file)
    expect(primitives.some((p) => p.material === 'Head_Skin')).toBe(true)
    for (const p of primitives) expect(p.attributes.POSITION!.values.length).toBeGreaterThan(0)
  }, 120_000)
})
