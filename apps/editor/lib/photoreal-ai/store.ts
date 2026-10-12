import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AiPersonAge, AiPersonSex } from './shared'

/**
 * Where AI 인물 keeps its avatars, on the server's disk (by default
 * apps/editor/data/photoreal-ai, which git ignores): one folder per user,
 * named by a hash of the uid, holding each finished avatar (model.glb, the
 * portrait it came from, meta.json) and the records of 3D jobs; and the
 * ledger of builds sent to the service (day counts and used portraits, which
 * must outlive a restart). Files are written to a temporary name and
 * renamed, so a reader never sees half a file. A hosted deployment with no
 * lasting disk needs another implementation of this interface (cloud storage).
 *
 *   <root>/users/<user key>/avatars/<avatar>/{model.glb, portrait.jpg|png, meta.json}
 *   <root>/users/<user key>/jobs/<job>.json
 *   <root>/service/player-<account hash>.json
 *   <root>/service/ledger.json
 */

export type AvatarMeta = {
  /** `<user key>-<avatar>`: the public id. */
  id: string
  name: string
  gender: AiPersonSex
  age: AiPersonAge
  createdAt: number
  /** The service that built it, for the credit line. */
  service: string
  mock: boolean
  bytes: number
  ai: true
}

export type PortraitType = 'image/jpeg' | 'image/png'

export type StoredFile = { bytes: Uint8Array<ArrayBuffer>; type: string }

/** A job record and when it was last written (ms). */
export type StoredJob = { id: string; job: unknown; writtenAt: number }

/** An avatar folder: finished once its meta.json is written; else a build's portrait. */
export type AvatarFolder = { id: string; finished: boolean; writtenAt: number }

export type AvatarStore = {
  userKey(uid: string): string
  newAvatarId(userKey: string): string
  /** The avatar id's owner key, when it is a well-formed id. */
  ownerOf(id: string): string | null
  /** Every user key with a folder. */
  listUsers(): Promise<string[]>
  saveJob(userKey: string, jobId: string, job: unknown): Promise<void>
  loadJob(userKey: string, jobId: string): Promise<unknown | null>
  listJobs(userKey: string): Promise<StoredJob[]>
  deleteJob(userKey: string, jobId: string): Promise<void>
  listFolders(userKey: string): Promise<AvatarFolder[]>
  savePortrait(id: string, bytes: Uint8Array, type: PortraitType): Promise<void>
  saveAvatar(id: string, glb: Uint8Array, meta: AvatarMeta): Promise<void>
  listAvatars(userKey: string): Promise<AvatarMeta[]>
  readModel(id: string): Promise<StoredFile | null>
  readPortrait(id: string): Promise<StoredFile | null>
  deleteAvatar(id: string): Promise<boolean>
  /** The avatar service's registered player for one service account, kept across restarts. */
  players(account: string): {
    load: () => Promise<string | null>
    save: (code: string) => Promise<void>
  }
  /** The ledger's one record (see ledger.ts). */
  loadLedger(): Promise<unknown | null>
  saveLedger(value: unknown): Promise<void>
}

const AVATAR_ID = /^([0-9a-f]{16})-([0-9a-f]{24})$/
const USER_KEY = /^[0-9a-f]{16}$/
export const JOB_ID = /^[0-9a-f]{24}$/
const PORTRAIT_FILES: Record<string, PortraitType> = {
  'portrait.jpg': 'image/jpeg',
  'portrait.png': 'image/png',
}

async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(temporary, data)
    await rename(temporary, path)
  } catch (error) {
    // A full disk must not keep the half-written copy.
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

const parseJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return null
  }
}

async function readOptional(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return new Uint8Array(await readFile(path))
  } catch {
    return null
  }
}

function isMeta(value: unknown): value is AvatarMeta {
  const meta = value as AvatarMeta | null
  return (
    !!meta &&
    typeof meta.id === 'string' &&
    typeof meta.name === 'string' &&
    (meta.gender === 'female' || meta.gender === 'male') &&
    typeof meta.createdAt === 'number'
  )
}

export function createFileAvatarStore(root: string): AvatarStore {
  const users = join(root, 'users')
  const split = (id: string) => {
    const match = AVATAR_ID.exec(id)
    return match ? { user: match[1]!, avatar: match[2]! } : null
  }
  const avatarDir = (id: string) => {
    const parts = split(id)
    return parts ? join(users, parts.user, 'avatars', parts.avatar) : null
  }
  const jobPath = (userKey: string, jobId: string) =>
    USER_KEY.test(userKey) && JOB_ID.test(jobId)
      ? join(users, userKey, 'jobs', `${jobId}.json`)
      : null
  const ledgerPath = join(root, 'service', 'ledger.json')

  return {
    userKey: (uid) =>
      createHash('sha256').update(`photoreal-ai-user:${uid}`).digest('hex').slice(0, 16),
    newAvatarId: (userKey) => `${userKey}-${randomBytes(12).toString('hex')}`,
    ownerOf: (id) => split(id)?.user ?? null,

    async saveJob(userKey, jobId, job) {
      const path = jobPath(userKey, jobId)
      if (!path) throw new Error('bad job id')
      await writeAtomic(path, JSON.stringify(job))
    },

    async listUsers() {
      const names = await readdir(users).catch(() => [] as string[])
      return names.filter((name) => USER_KEY.test(name))
    },

    async loadJob(userKey, jobId) {
      const path = jobPath(userKey, jobId)
      const bytes = path ? await readOptional(path) : null
      return bytes ? parseJson(bytes) : null
    },

    async listJobs(userKey) {
      if (!USER_KEY.test(userKey)) return []
      const folder = join(users, userKey, 'jobs')
      const names = await readdir(folder).catch(() => [] as string[])
      const jobs: StoredJob[] = []
      for (const name of names) {
        const id = name.replace(/\.json$/, '')
        if (!JOB_ID.test(id) || name !== `${id}.json`) continue
        const path = join(folder, name)
        const [bytes, info] = await Promise.all([readOptional(path), stat(path).catch(() => null)])
        if (bytes && info) jobs.push({ id, job: parseJson(bytes), writtenAt: info.mtimeMs })
      }
      return jobs
    },

    async deleteJob(userKey, jobId) {
      const path = jobPath(userKey, jobId)
      if (path) await rm(path, { force: true })
    },

    async listFolders(userKey) {
      if (!USER_KEY.test(userKey)) return []
      const folder = join(users, userKey, 'avatars')
      const names = await readdir(folder).catch(() => [] as string[])
      const folders: AvatarFolder[] = []
      for (const name of names) {
        const id = `${userKey}-${name}`
        if (!AVATAR_ID.test(id)) continue
        const info = await stat(join(folder, name)).catch(() => null)
        if (!info?.isDirectory()) continue
        const finished = (await stat(join(folder, name, 'meta.json')).catch(() => null)) !== null
        folders.push({ id, finished, writtenAt: info.mtimeMs })
      }
      return folders
    },

    async savePortrait(id, bytes, type) {
      const folder = avatarDir(id)
      if (!folder) throw new Error('bad avatar id')
      await writeAtomic(join(folder, type === 'image/png' ? 'portrait.png' : 'portrait.jpg'), bytes)
    },

    async saveAvatar(id, glb, meta) {
      const folder = avatarDir(id)
      if (!folder) throw new Error('bad avatar id')
      await writeAtomic(join(folder, 'model.glb'), glb)
      // meta.json last: an avatar is listed only once its model is there.
      await writeAtomic(join(folder, 'meta.json'), JSON.stringify(meta))
    },

    async listAvatars(userKey) {
      if (!USER_KEY.test(userKey)) return []
      const folder = join(users, userKey, 'avatars')
      const names = await readdir(folder).catch(() => [] as string[])
      const metas: AvatarMeta[] = []
      for (const name of names) {
        const bytes = await readOptional(join(folder, name, 'meta.json'))
        const meta = bytes ? parseJson(bytes) : null
        if (isMeta(meta) && meta.id === `${userKey}-${name}`) metas.push(meta)
      }
      return metas.sort((a, b) => a.createdAt - b.createdAt)
    },

    async readModel(id) {
      const folder = avatarDir(id)
      if (!folder || !(await readOptional(join(folder, 'meta.json')))) return null
      const bytes = await readOptional(join(folder, 'model.glb'))
      return bytes ? { bytes, type: 'model/gltf-binary' } : null
    },

    async readPortrait(id) {
      // Only a finished avatar's: a build's portrait is not served.
      const folder = avatarDir(id)
      if (!folder || !(await readOptional(join(folder, 'meta.json')))) return null
      for (const [file, type] of Object.entries(PORTRAIT_FILES)) {
        const bytes = await readOptional(join(folder, file))
        if (bytes) return { bytes, type }
      }
      return null
    },

    async deleteAvatar(id) {
      const folder = avatarDir(id)
      if (!folder) return false
      const existed = (await stat(folder).catch(() => null)) !== null
      await rm(folder, { recursive: true, force: true })
      return existed
    },

    players(account) {
      const name = createHash('sha256').update(account).digest('hex').slice(0, 16)
      const path = join(root, 'service', `player-${name}.json`)
      return {
        async load() {
          const bytes = await readOptional(path)
          const code = bytes ? (parseJson(bytes) as { code?: unknown } | null)?.code : null
          return typeof code === 'string' && code ? code : null
        },
        async save(code) {
          await writeAtomic(path, JSON.stringify({ code }))
        },
      }
    },

    async loadLedger() {
      const bytes = await readOptional(ledgerPath)
      return bytes ? parseJson(bytes) : null
    },

    async saveLedger(value) {
      await writeAtomic(ledgerPath, JSON.stringify(value))
    },
  }
}
