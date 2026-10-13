'use client'

import { useEffect, useState } from 'react'
import {
  findPhotoreal,
  PHOTO_AVATAR_SCHEME,
  type PhotorealCharacter,
  photoPhotorealId,
  registerPhotoAvatars,
} from '../photoreal-catalog'
import {
  deletePhotoAvatar,
  listPhotoAvatars,
  readPhotoAvatar,
  type StoredPhotoAvatar,
  savePhotoAvatar,
} from './store'

/**
 * The photo avatars in this browser as 실사 characters: listed once for
 * every gallery on the page (and again when one is added or deleted), each
 * file and card served from an object URL made once.
 */

const objectUrls = new Map<string, { url: string; thumbnail: string }>()

function urlsOf(avatar: StoredPhotoAvatar) {
  let found = objectUrls.get(avatar.id)
  if (!found) {
    found = {
      url: URL.createObjectURL(avatar.glb),
      thumbnail: URL.createObjectURL(avatar.thumbnail),
    }
    objectUrls.set(avatar.id, found)
  }
  return found
}

let listing: Promise<PhotorealCharacter[]> | null = null
const readers = new Set<() => void>()

type Entry = { id: string; name: string; url: string; thumbnail: string; ai: boolean }
/** What the store held when last listed, and an avatar just made, shown before it is kept. */
let stored: Entry[] = []
let preview: StoredPhotoAvatar | null = null

const entryOf = (avatar: StoredPhotoAvatar): Entry => ({
  id: avatar.id,
  name: avatar.name,
  ai: avatar.source === 'ai',
  ...urlsOf(avatar),
})

function register() {
  registerPhotoAvatars(
    preview && !stored.some(({ id }) => id === preview?.id)
      ? [...stored, entryOf(preview)]
      : stored,
  )
}

function loadPhotoAvatars(): Promise<PhotorealCharacter[]> {
  listing ??= listPhotoAvatars()
    .then((avatars) => {
      stored = avatars.map(entryOf)
      register()
      return avatars.map((avatar) => findPhotoreal(photoPhotorealId(avatar.gender, avatar.id))!)
    })
    .catch(() => [])
  return listing
}

function reloadPhotoAvatars() {
  listing = null
  for (const read of readers) read()
}

/** This browser's photo avatars, null while they are first read. */
export function usePhotoAvatars(): PhotorealCharacter[] | null {
  const [avatars, setAvatars] = useState<PhotorealCharacter[] | null>(null)
  useEffect(() => {
    let current = true
    const read = () => {
      loadPhotoAvatars().then((found) => {
        if (current) setAvatars(found)
      })
    }
    read()
    readers.add(read)
    return () => {
      current = false
      readers.delete(read)
    }
  }, [])
  return avatars
}

/**
 * Shows a photo avatar just made, not yet kept: its character (for the
 * stage), from memory until `addPhotoAvatar` keeps it or
 * `discardPhotoAvatarPreview` lets it go. One at a time.
 */
export function previewPhotoAvatar(avatar: StoredPhotoAvatar): PhotorealCharacter {
  discardPhotoAvatarPreview()
  preview = avatar
  register()
  return findPhotoreal(photoPhotorealId(avatar.gender, avatar.id))!
}

/** Lets go of the avatar shown by `previewPhotoAvatar`, unless it was kept meanwhile. */
export function discardPhotoAvatarPreview() {
  const shown = preview
  if (!shown) return
  preview = null
  if (!stored.some(({ id }) => id === shown.id)) forgetUrls(shown.id)
  register()
}

/** Keeps a new photo avatar in this browser (the one previewed, or another); its character. */
export async function addPhotoAvatar(avatar: StoredPhotoAvatar): Promise<PhotorealCharacter> {
  await savePhotoAvatar(avatar)
  if (preview?.id === avatar.id) preview = null
  reloadPhotoAvatars()
  await loadPhotoAvatars()
  return findPhotoreal(photoPhotorealId(avatar.gender, avatar.id))!
}

function forgetUrls(id: string) {
  const urls = objectUrls.get(id)
  if (!urls) return
  URL.revokeObjectURL(urls.url)
  URL.revokeObjectURL(urls.thumbnail)
  objectUrls.delete(id)
}

/** Deletes a photo avatar from this browser; whether it went. */
export async function removePhotoAvatar(id: string): Promise<boolean> {
  try {
    await deletePhotoAvatar(id)
  } catch {
    return false
  }
  forgetUrls(id)
  resolved.delete(id)
  reloadPhotoAvatars()
  return true
}

/** Reads of a photo avatar's file for a body to draw, by stored id: pending, done or failed. */
const resolved = new Map<string, { promise: Promise<void>; url?: string; error?: unknown }>()

/**
 * The URL a 실사 character's file loads from. A photo avatar's comes from
 * this browser's store: until it has been read, this suspends (as a file
 * loading does); one no longer there throws, for the caller's fallback.
 */
export function usePhotorealUrl(character: PhotorealCharacter): string {
  if (!character.url.startsWith(PHOTO_AVATAR_SCHEME)) return character.url
  const id = character.url.slice(PHOTO_AVATAR_SCHEME.length)
  let entry = resolved.get(id)
  if (!entry) {
    const made: { promise: Promise<void>; url?: string; error?: unknown } = {
      promise: Promise.resolve(),
    }
    made.promise = readPhotoAvatar(id)
      .then((avatar) => {
        if (avatar) made.url = urlsOf(avatar).url
        else made.error = new Error('photo avatar not in this browser')
      })
      .catch((error: unknown) => {
        made.error = error
      })
    resolved.set(id, made)
    entry = made
  }
  if (entry.url) return entry.url
  if (entry.error) throw entry.error
  throw entry.promise
}
