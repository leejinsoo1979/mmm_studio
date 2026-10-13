import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AvatarGender } from '../../avatar-catalog'
import { type BaseBody, readBaseBody } from '../base-body'
import { readFaceTargets } from '../head-model'

/** The app's base bodies, read from the repo's public folder (bun only: tests and the bench's tools). */
const PUBLIC = join(
  import.meta.dir,
  '../../../../../../../../apps/editor/public/characters/photoreal',
)

const read = (name: string) => readFileSync(join(PUBLIC, name))
const buffer = (name: string) => {
  const bytes = read(name)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const loaded = new Map<AvatarGender, Promise<BaseBody>>()

export function loadBaseForTests(gender: AvatarGender): Promise<BaseBody> {
  let found = loaded.get(gender)
  if (!found) {
    found = readBaseBody({
      glb: buffer(`mpfb-base-${gender}.glb`),
      basemesh: buffer(`mpfb-base-${gender}.basemesh.bin`),
      meta: JSON.parse(read(`mpfb-base-${gender}.json`).toString()),
      landmarks: JSON.parse(read(`mpfb-base-${gender}.landmarks.json`).toString()),
      targets: readFaceTargets(
        JSON.parse(read('mpfb-face-targets.json').toString()),
        buffer('mpfb-face-targets.bin'),
      ),
    })
    loaded.set(gender, found)
  }
  return found
}
