// The hair library's styles on the base bodies at rest (no photo): each one's avatar file, for
// the bench's hair probes (`--hair-styles`): its class as the bench reads it, and holes from every
// side in every pose. Each is dressed as a photo avatar is: the style's pictures (in the brown
// they are built in) and the scalp tinted under its hairline.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import type { AvatarGender } from '../../../packages/editor/src/components/editor/first-person/avatar-catalog'
import { loadBaseForTests } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/base-for-tests'
import { buildAvatarGlb } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/base-body'
import { dressHair } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/hair-glb'
import {
  HAIR_STYLES,
  type HairStyleName,
  readHairStyle,
} from '../../../packages/editor/src/components/editor/first-person/photo-avatar/hair-library'
import {
  type Rgb,
  scalpDensity,
  tintScalp,
} from '../../../packages/editor/src/components/editor/first-person/photo-avatar/hair-paint'

const HAIR = resolve(import.meta.dir, '../../../apps/editor/public/characters/photoreal/hair')

/** The brown every style's pictures are built in (build-photo-hair.py's NEUTRAL), linear. */
const NEUTRAL: Rgb = [0.09, 0.06, 0.042]

export const STYLE_NAMES = Object.keys(HAIR_STYLES) as HairStyleName[]

const buffer = (file: string) => {
  const bytes = readFileSync(join(HAIR, file))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** A base body at rest wearing `name`; null: bald. */
export async function styleGlb(name: HairStyleName | null, gender: AvatarGender): Promise<Uint8Array> {
  const base = await loadBaseForTests(gender)
  const moves = new Float64Array(base.basemesh.length)
  if (!name) {
    const glb = buildAvatarGlb(base, moves, new Map(), { dropBrows: false })
    return dressHair(glb, base, { style: null, gender, basemesh: base.basemesh, pictures: new Map(), colour: NEUTRAL })
  }
  const style = readHairStyle(buffer(`${name}.bin`))
  const { json, bin } = base.glb
  const image = json.images.find((one: { name?: string }) => one.name === 'head_color')
  const view = json.bufferViews[image.bufferView]
  const raw = await sharp(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const head = new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength)
  tintScalp(head, scalpDensity(style, gender, base.headSkin.mesh, base.headSkin.weld, raw.info.width), NEUTRAL)
  const tinted = await sharp(Buffer.from(head.buffer, head.byteOffset, head.byteLength), {
    raw: { width: raw.info.width, height: raw.info.height, channels: 4 },
  })
    .webp({ quality: 92 })
    .toBuffer()
  const glb = buildAvatarGlb(
    base,
    moves,
    new Map([['head_color', { bytes: new Uint8Array(tinted), mimeType: 'image/webp' }]]),
    { dropBrows: false },
  )
  const pictures = new Map(
    [...new Set(style.parts.map((p) => p.texture))].map((file) => [
      file,
      { bytes: new Uint8Array(buffer(file)), mimeType: 'image/webp' },
    ]),
  )
  return dressHair(glb, base, { style, gender, basemesh: base.basemesh, pictures, colour: NEUTRAL })
}
