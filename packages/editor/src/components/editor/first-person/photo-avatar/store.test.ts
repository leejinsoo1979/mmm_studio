import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { findPhotoreal, PHOTO_AVATAR_SCHEME, photoPhotorealId } from '../photoreal-catalog'
import {
  deletePhotoAvatar,
  listPhotoAvatars,
  readPhotoAvatar,
  type StoredPhotoAvatar,
  savePhotoAvatar,
} from './store'
import { addPhotoAvatar, removePhotoAvatar } from './use-photo-avatars'

/**
 * A stand-in for the browser's IndexedDB, as much as the store uses: one
 * object store by key path, transactions that complete a turn later, a
 * connection the test can close (as a browser does when storage is
 * cleared), and `getAll` answers the test can hold back.
 */
class FakeIndexedDb {
  readonly rows = new Map<string, unknown>()
  connections: FakeDb[] = []
  opens = 0
  /** While set, `getAll` answers wait for it. */
  hold: Promise<void> | null = null
  pendingLists = 0

  open() {
    this.opens++
    const request: Record<string, any> = {}
    setTimeout(() => {
      const db = new FakeDb(this)
      this.connections.push(db)
      request.result = db
      if (!this.created) {
        this.created = true
        request.onupgradeneeded?.()
      }
      request.onsuccess?.()
    })
    return request
  }

  private created = false
}

class FakeDb {
  closed = false
  onclose: (() => void) | null = null
  onversionchange: (() => void) | null = null
  objectStoreNames = { contains: () => false }

  constructor(private readonly idb: FakeIndexedDb) {}

  createObjectStore() {}

  close() {
    this.closed = true
  }

  /** The browser closing the connection under the page. */
  lose() {
    this.closed = true
    this.onclose?.()
  }

  transaction() {
    if (this.closed) throw new DOMException('closed', 'InvalidStateError')
    const idb = this.idb
    const transaction: Record<string, any> = {}
    let pending: Promise<void> = Promise.resolve()
    const done = (request: Record<string, any>, value: () => unknown, wait?: Promise<void>) => {
      pending = (wait ?? Promise.resolve()).then(() => {
        request.result = value()
      })
      pending.then(() => setTimeout(() => transaction.oncomplete?.()))
      return request
    }
    transaction.objectStore = () => ({
      put: (row: { id: string }) => done({}, () => idb.rows.set(row.id, row) && row.id),
      get: (id: string) => done({}, () => idb.rows.get(id)),
      delete: (id: string) => done({}, () => idb.rows.delete(id) && undefined),
      getAll: () => {
        const wait = idb.hold
        if (wait) idb.pendingLists++
        // As it was when asked (a held answer comes late, but from then).
        const snapshot = [...idb.rows.values()]
        return done({}, () => snapshot, wait ?? undefined)
      },
    })
    return transaction
  }
}

const fake = new FakeIndexedDb()
const persisted: number[] = []
const created: Blob[] = []
const revoked: string[] = []
const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).indexedDB = fake
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
      persist: async () => {
        persisted.push(fake.rows.size)
        return true
      },
    },
  })
  URL.createObjectURL = (blob: Blob) => {
    created.push(blob)
    return realCreate(blob)
  }
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url)
    realRevoke(url)
  }
})

afterAll(() => {
  delete (globalThis as Record<string, unknown>).indexedDB
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
})

let made = 0
function avatar(): StoredPhotoAvatar {
  made++
  const hex = made.toString(16).padStart(12, '0')
  return {
    id: `00000000-0000-4000-8000-${hex}`,
    name: `사진 ${made}`,
    gender: 'female',
    source: 'capture',
    createdAt: made,
    glb: new Blob([new Uint8Array([made])], { type: 'model/gltf-binary' }),
    thumbnail: new Blob([new Uint8Array([made, made])], { type: 'image/png' }),
  }
}

const idOf = (one: StoredPhotoAvatar) => photoPhotorealId(one.gender, one.id)
const until = async (ready: () => boolean) => {
  for (let i = 0; i < 200 && !ready(); i++) await new Promise((r) => setTimeout(r, 5))
  expect(ready()).toBe(true)
}

describe('photo avatar store', () => {
  test('keeps, lists, reads and deletes, asking once to keep the storage before the first save', async () => {
    const a = avatar()
    const b = avatar()
    await savePhotoAvatar(b)
    await savePhotoAvatar(a)
    // Asked before anything was written, and only once.
    expect(persisted).toEqual([0])
    expect((await listPhotoAvatars()).map((one) => one.id)).toEqual([a.id, b.id])
    expect((await readPhotoAvatar(a.id))?.name).toBe(a.name)
    await deletePhotoAvatar(a.id)
    expect(await readPhotoAvatar(a.id)).toBeNull()
    await deletePhotoAvatar(b.id)
  })

  test('a connection the browser closed is opened again, and the save goes through', async () => {
    const one = avatar()
    const opens = fake.opens
    fake.connections.at(-1)!.lose()
    await savePhotoAvatar(one)
    expect(fake.opens).toBe(opens + 1)
    expect((await readPhotoAvatar(one.id))?.id).toBe(one.id)
    await deletePhotoAvatar(one.id)
  })

  test('a connection that closed unannounced is opened again too', async () => {
    const one = avatar()
    const opens = fake.opens
    fake.connections.at(-1)!.close()
    await savePhotoAvatar(one)
    expect(fake.opens).toBe(opens + 1)
    await deletePhotoAvatar(one.id)
  })
})

describe('photo avatar listing', () => {
  test('a listing begun before a delete does not bring the deleted avatar back', async () => {
    const gone = avatar()
    const stays = avatar()
    await addPhotoAvatar(gone)
    await addPhotoAvatar(stays)
    expect(findPhotoreal(idOf(gone))!.url.startsWith('blob:')).toBe(true)

    // A save whose listing is held back, and a delete meanwhile.
    const late = avatar()
    let release = () => {}
    fake.hold = new Promise((resolve) => {
      release = resolve
    })
    fake.pendingLists = 0
    const adding = addPhotoAvatar(late)
    await until(() => fake.pendingLists === 1)
    fake.hold = null
    expect(await removePhotoAvatar(gone.id)).toBe(true)
    const goneUrls = created.filter((blob) => blob === gone.glb).length
    release()
    const character = await adding

    expect(character.id).toBe(idOf(late))
    expect(findPhotoreal(idOf(late))!.url.startsWith('blob:')).toBe(true)
    expect(findPhotoreal(idOf(stays))!.url.startsWith('blob:')).toBe(true)
    // Unknown again, and no new object URL was made for its file.
    expect(findPhotoreal(idOf(gone))!.url).toBe(`${PHOTO_AVATAR_SCHEME}${gone.id}`)
    expect(created.filter((blob) => blob === gone.glb).length).toBe(goneUrls)
  })

  test('a deleted avatar’s file and card URLs are let go of', async () => {
    const one = avatar()
    await addPhotoAvatar(one)
    const known = findPhotoreal(idOf(one))!
    expect(await removePhotoAvatar(one.id)).toBe(true)
    // Nothing drew it, so its file goes at once.
    expect(revoked).toContain(known.url)
    expect(revoked).toContain(known.thumbnail!)
  })
})
