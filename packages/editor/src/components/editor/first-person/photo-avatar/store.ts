import type { AvatarGender } from '../avatar-catalog'

/**
 * The photo avatars made in this browser, kept in this browser (IndexedDB):
 * the avatar's GLB and a small picture for its card (a render of the
 * avatar, never the photo). Nothing is sent anywhere; another browser, or
 * another player, never sees them.
 */

export type StoredPhotoAvatar = {
  /** A random UUID. */
  id: string
  name: string
  gender: AvatarGender
  /** How it was made: a 3D capture, one photo, or an AI-made fictional portrait. */
  source: 'capture' | 'photo' | 'ai'
  /** Made with no side or ¾ view (one photo): its profile is the base head's guess (옆모습 추정). */
  profileEstimated?: boolean
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
    request.onsuccess = () => {
      const db = request.result
      // Another tab upgrading the database, or the browser closing it (storage cleared): the
      // next call opens it again.
      const forget = () => {
        if (opened === opening) opened = null
      }
      db.onversionchange = () => {
        forget()
        db.close()
      }
      db.onclose = forget
      resolve(db)
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
  opening.catch(() => {
    if (opened === opening) opened = null
  })
  opened = opening
  return opening
}

function attempt<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = work(transaction.objectStore(STORE))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'))
  })
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database()
  try {
    return await attempt(db, mode, work)
  } catch (error) {
    // A connection closed under us (a transaction can't even start on it): once more on a new one.
    if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error
    if (opened && (await opened.catch(() => null)) === db) opened = null
    return attempt(await database(), mode, work)
  }
}

let persisting: Promise<unknown> | null = null

/**
 * Asks the browser once to keep this site's storage (else it may clear it
 * when space runs short, avatars and all); saving goes ahead whatever it says.
 */
function persist(): Promise<unknown> {
  persisting ??= Promise.resolve()
    .then(() => (typeof navigator !== 'undefined' ? navigator.storage?.persist?.() : undefined))
    .catch(() => undefined)
  return persisting
}

export async function savePhotoAvatar(avatar: StoredPhotoAvatar): Promise<void> {
  await persist()
  await run('readwrite', (store) => store.put(avatar))
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
