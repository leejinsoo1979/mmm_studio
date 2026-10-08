import { join } from 'node:path'
import { type HAIR_HEADS, type HairHead, readHairHead, type StoredHairHead } from './hair-fixtures'

/** Where a frozen head is kept (see hair-fixtures.ts). Bun only: for the tests and the script that writes them. */
export const hairHeadFile = (id: string) => join(import.meta.dir, 'hair-fixtures', `${id}.json`)

export async function loadHairHead(id: (typeof HAIR_HEADS)[number]): Promise<HairHead> {
  return readHairHead((await Bun.file(hairHeadFile(id)).json()) as StoredHairHead)
}
