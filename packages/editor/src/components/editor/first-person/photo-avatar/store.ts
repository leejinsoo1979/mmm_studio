import type { AvatarGender } from '../avatar-catalog'

/**
 * The photo avatars made in this browser, kept in this browser (IndexedDB):
 * the avatar's GLB and a small picture for its card. Nothing is sent
 * anywhere; another browser, or another player, never sees them.
 */

export type StoredPhotoAvatar = {
  /** A random UUID. */
  id: string
  name: string
  gender: AvatarGender
  /** How it was made: a 3D capture, one photo, or an AI-made fictional portrait. */
  source: 'capture' | 'photo' | 'ai'
  createdAt: number
  glb: Blob
  thumbnail: Blob
}

export type PhotoAvatarSummary = Omit<StoredPhotoAvatar, 'glb' | 'thumbnail'>

const DATABASE = 'mmm-photo-avatars'
const STORE = 'avatars'

let opened: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  if (opened) return opened
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
  opening.catch(() => {
    if (opened === opening) opened = null
  })
  opened = opening
  return opening
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return database().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = work(transaction.objectStore(STORE))
        transaction.oncomplete = () => resolve(request.result)
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed'))
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'))
      }),
  )
}

export function savePhotoAvatar(avatar: StoredPhotoAvatar): Promise<void> {
  return run('readwrite', (store) => store.put(avatar)).then(() => undefined)
}

export function readPhotoAvatar(id: string): Promise<StoredPhotoAvatar | null> {
  return run<StoredPhotoAvatar | undefined>('readonly', (store) => store.get(id)).then(
    (found) => found ?? null,
  )
}

/** Every stored avatar, oldest first. */
export function listPhotoAvatars(): Promise<StoredPhotoAvatar[]> {
  return run<StoredPhotoAvatar[]>('readonly', (store) => store.getAll()).then((all) =>
    all.sort((a, b) => a.createdAt - b.createdAt),
  )
}

export function deletePhotoAvatar(id: string): Promise<void> {
  return run('readwrite', (store) => store.delete(id)).then(() => undefined)
}
