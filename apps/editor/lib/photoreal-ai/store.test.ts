import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AvatarMeta, createFileAvatarStore } from './store'

const root = mkdtempSync(join(tmpdir(), 'photoreal-ai-store-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const meta = (id: string, createdAt: number): AvatarMeta => ({
  id,
  name: 'AI 인물 1',
  gender: 'female',
  age: '30s',
  createdAt,
  service: 'Avatar SDK MetaPerson',
  mock: false,
  bytes: 4,
  ai: true,
})

describe('createFileAvatarStore', () => {
  const store = createFileAvatarStore(root)
  const user = store.userKey('uid-1')

  test('a user key is a hash, never the uid', () => {
    expect(user).toMatch(/^[0-9a-f]{16}$/)
    expect(user).not.toContain('uid')
    expect(store.userKey('uid-1')).toBe(user)
    expect(store.userKey('uid-2')).not.toBe(user)
  })

  test('an avatar is listed only once its model and meta are saved', async () => {
    const id = store.newAvatarId(user)
    expect(store.ownerOf(id)).toBe(user)
    await store.savePortrait(id, new Uint8Array([1, 2]), 'image/png')
    expect(await store.listAvatars(user)).toEqual([])
    expect(await store.readModel(id)).toBeNull()
    expect(await store.readPortrait(id)).toEqual({
      bytes: new Uint8Array([1, 2]),
      type: 'image/png',
    })
    await store.saveAvatar(id, new Uint8Array([9, 9, 9, 9]), meta(id, 5))
    expect(await store.listAvatars(user)).toEqual([meta(id, 5)])
    expect((await store.readModel(id))?.bytes).toEqual(new Uint8Array([9, 9, 9, 9]))
    // No temporary files left behind.
    const folder = join(root, 'users', user, 'avatars', id.split('-')[1]!)
    expect(readdirSync(folder).sort()).toEqual(['meta.json', 'model.glb', 'portrait.png'])
    expect(await store.deleteAvatar(id)).toBe(true)
    expect(existsSync(folder)).toBe(false)
    expect(await store.deleteAvatar(id)).toBe(false)
  })

  test('ids that are not its own shape reach no file', async () => {
    for (const id of ['../../etc', `${user}-..`, `${user}/x`, '', 'a-b']) {
      expect(store.ownerOf(id)).toBeNull()
      expect(await store.readModel(id)).toBeNull()
      expect(await store.readPortrait(id)).toBeNull()
      expect(await store.deleteAvatar(id)).toBe(false)
    }
    expect(await store.listAvatars('../users')).toEqual([])
    expect(await store.loadJob(user, '../../x')).toBeNull()
    await expect(store.saveJob(user, 'nope', {})).rejects.toThrow()
  })

  test('jobs are kept per user and swept by age', async () => {
    const job = 'a'.repeat(24)
    await store.saveJob(user, job, { id: job, n: 1 })
    expect(await store.loadJob(user, job)).toEqual({ id: job, n: 1 })
    expect(await store.loadJob(store.userKey('uid-2'), job)).toBeNull()
    await store.sweepJobs(user, Date.now() - 60_000)
    expect(await store.loadJob(user, job)).not.toBeNull()
    await store.sweepJobs(user, Date.now() + 60_000)
    expect(await store.loadJob(user, job)).toBeNull()
  })

  test('the service player is kept per account', async () => {
    const one = store.players('https://api.avatarsdk.com|id-1')
    expect(await one.load()).toBeNull()
    await one.save('player-1')
    expect(await one.load()).toBe('player-1')
    expect(await store.players('https://api.avatarsdk.com|id-2').load()).toBeNull()
  })
})
