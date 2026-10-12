'use client'

import { useEffect, useState } from 'react'
import type { AvatarGender } from './avatar-catalog'

/**
 * The 실사 (photoreal) set: rigged people from outside the Rocketbox
 * library, drawn with the human shading and moved by the shared clips
 * carried onto their rigs (humanoid-rig.ts). Those whose licence lets them
 * be shipped are listed here; the rest — a MetaHuman, Character Creator or
 * selfie-avatar export, whose terms keep them off a public site — the owner
 * puts in a local folder the repository ignores, and the app lists what it
 * finds there.
 */

export type PhotorealCharacter = {
  /** `local:<gender>:<file>` for one from the local folder. */
  id: string
  /** Korean label: "실사 여 1", or a local file's name. */
  label: string
  gender: AvatarGender
  url: string
  /** A full-body card (128 × 208), or null where there is none (local files). */
  thumbnail: string | null
  /** Who made it and its licence, shown with it. */
  credit: string
  local: boolean
}

const BASE = '/characters/photoreal'

/** Where the owner's own characters go, as the app serves it, and in the repository. */
export const PHOTOREAL_LOCAL_URL = '/characters/photoreal-local'
export const PHOTOREAL_LOCAL_FOLDER = 'apps/editor/public/characters/photoreal-local'
/** The app's listing of that folder (apps/editor/app/api/photoreal-local). */
const LOCAL_LISTING = '/api/photoreal-local'

export const PHOTOREAL_CHARACTERS: readonly PhotorealCharacter[] = [
  {
    id: 'makehuman-female-01',
    label: '실사 여 1',
    gender: 'female',
    url: `${BASE}/makehuman-female-01.glb`,
    thumbnail: `${BASE}/thumbs/makehuman-female-01.webp`,
    credit: 'MakeHuman · CC0',
    local: false,
  },
]

const shipped = new Map(PHOTOREAL_CHARACTERS.map((character) => [character.id, character]))

const LOCAL_ID = /^local:(male|female):([^/\\:]+\.glb)$/i

export const localPhotorealId = (gender: AvatarGender, file: string) => `local:${gender}:${file}`

/** A local file's name without its extension, for its label. */
const stem = (file: string) => file.replace(/\.glb$/i, '')

/** The gender a local file's name suggests (female, woman, girl, 여…), male otherwise. */
export function guessGender(file: string): AvatarGender {
  return /(female|woman|women|girl|lady|^f[_-]|[_-]f[_-]|여)/i.test(file) ? 'female' : 'male'
}

/** The character an id names: shipped, or a file in the local folder (null for anything else). */
export function findPhotoreal(id: string | null | undefined): PhotorealCharacter | null {
  if (!id) return null
  const known = shipped.get(id)
  if (known) return known
  const local = LOCAL_ID.exec(id)
  if (!local) return null
  const file = local[2]!
  return {
    id,
    label: stem(file),
    gender: local[1]!.toLowerCase() as AvatarGender,
    url: `${PHOTOREAL_LOCAL_URL}/${encodeURIComponent(file)}`,
    thumbnail: null,
    credit: '내 PC의 파일',
    local: true,
  }
}

/** A 실사 id as saved, or null when it isn't one (an older or broken save). */
export function readPhotorealId(value: unknown): string | null {
  return typeof value === 'string' && findPhotoreal(value) ? value : null
}

/** One entry of the local folder's listing: the file, and the name and gender characters.json gives it. */
export type LocalPhotorealEntry = { file: string; name?: string; gender?: AvatarGender }

/** The local folder's characters, in the listing's order. */
export function localCharacters(entries: readonly LocalPhotorealEntry[]): PhotorealCharacter[] {
  const characters: PhotorealCharacter[] = []
  for (const entry of entries) {
    if (!/\.glb$/i.test(entry.file) || /[/\\:]/.test(entry.file)) continue
    const gender =
      entry.gender === 'male' || entry.gender === 'female' ? entry.gender : guessGender(entry.file)
    const character = findPhotoreal(localPhotorealId(gender, entry.file))!
    characters.push({ ...character, label: entry.name?.trim() || character.label })
  }
  return characters
}

let localListing: Promise<PhotorealCharacter[]> | null = null

/** The local folder's characters (fetched once; none where the app has no listing, as on a public deployment). */
export function loadLocalPhotoreal(): Promise<PhotorealCharacter[]> {
  localListing ??= fetch(LOCAL_LISTING)
    .then((response) => (response.ok ? response.json() : { characters: [] }))
    .then((body: { characters?: LocalPhotorealEntry[] }) =>
      localCharacters(Array.isArray(body.characters) ? body.characters : []),
    )
    .catch(() => [])
  return localListing
}

/** The local folder's characters, null while the listing loads. */
export function useLocalPhotoreal(): PhotorealCharacter[] | null {
  const [characters, setCharacters] = useState<PhotorealCharacter[] | null>(null)
  useEffect(() => {
    let current = true
    loadLocalPhotoreal().then((found) => {
      if (current) setCharacters(found)
    })
    return () => {
      current = false
    }
  }, [])
  return characters
}

/** The two character sets the pickers switch between. */
export type CharacterEdition = 'basic' | 'real'

export const CHARACTER_EDITIONS: readonly { id: CharacterEdition; label: string }[] = [
  { id: 'basic', label: '기본' },
  { id: 'real', label: '실사' },
]

/** What a 실사 character can't take from the look tabs: their tools fit the Rocketbox bodies alone. */
export const PHOTOREAL_LOOK_NOTE =
  '실사 캐릭터는 얼굴·몸 슬라이더, 메이크업, 얼굴 사진, 맨발, 머리색 바꾸기를 아직 지원하지 않아요. 기본 캐릭터에서 쓸 수 있어요.'
