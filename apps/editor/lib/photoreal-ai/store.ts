import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AiPersonAge, AiPersonSex } from './shared'

/**
 * Where AI 인물 keeps its avatars, on the server's disk (by default
 * apps/editor/data/photoreal-ai, which git ignores): one folder per user,
 * named by a hash of the uid, holding each finished avatar (model.glb, the
 * portrait it came from, meta.json) and the records of running 3D jobs.
 * Files are written to a temporary name and renamed, so a reader never sees
 * half a file. A hosted deployment with no lasting disk needs another
 * implementation of this interface (cloud storage).
 *
 *   <root>/users/<user key>/avatars/<avatar>/{model.glb, portrait.jpg|png, meta.json}
 *   <root>/users/<user key>/jobs/<job>.json
 *   <root>/service/player-<account hash>.json
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

export type AvatarStore = {
  userKey(uid: string): string
  newAvatarId(userKey: string): string
  /** The avatar id's owner key, when it is a well-formed id. */
  ownerOf(id: string): string | null
  saveJob(userKey: string, jobId: string, job: unknown): Promise<void>
  loadJob(userKey: string, jobId: string): Promise<unknown | null>
  /** Removes job records last written before `before` (ms). */
  sweepJobs(userKey: string, before: number): Promise<void>
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
}

const AVATAR_ID = /^([0-9a-f]{16})-([0-9a-f]{24})$/
export const JOB_ID = /^[0-9a-f]{24}$/
const PORTRAIT_FILES: Record<string, PortraitType> = {
  'portrait.jpg': 'image/jpeg',
  'portrait.png': 'image/png',
}

async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, path)
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
    /^[0-9a-f]{16}$/.test(userKey) && JOB_ID.test(jobId)
      ? join(users, userKey, 'jobs', `${jobId}.json`)
      : null

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

    async loadJob(userKey, jobId) {
      const path = jobPath(userKey, jobId)
      const bytes = path ? await readOptional(path) : null
      if (!bytes) return null
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown
      } catch {
        return null
      }
    },

    async sweepJobs(userKey, before) {
      if (!/^[0-9a-f]{16}$/.test(userKey)) return
      const folder = join(users, userKey, 'jobs')
      const names = await readdir(folder).catch(() => [] as string[])
      for (const name of names) {
        const path = join(folder, name)
        const info = await stat(path).catch(() => null)
        if (info && info.mtimeMs < before) await rm(path, { force: true })
      }
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
      if (!/^[0-9a-f]{16}$/.test(userKey)) return []
      const folder = join(users, userKey, 'avatars')
      const names = await readdir(folder).catch(() => [] as string[])
      const metas: AvatarMeta[] = []
      for (const name of names) {
        const bytes = await readOptional(join(folder, name, 'meta.json'))
        if (!bytes) continue
        try {
          const meta = JSON.parse(new TextDecoder().decode(bytes)) as unknown
          if (isMeta(meta) && meta.id === `${userKey}-${name}`) metas.push(meta)
        } catch {}
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
      const folder = avatarDir(id)
      if (!folder) return null
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
          if (!bytes) return null
          try {
            const code = (JSON.parse(new TextDecoder().decode(bytes)) as { code?: unknown }).code
            return typeof code === 'string' && code ? code : null
          } catch {
            return null
          }
        },
        async save(code) {
          await writeAtomic(path, JSON.stringify({ code }))
        },
      }
    },
  }
}
