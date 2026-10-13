import { describe, expect, test } from 'bun:test'
import { buildPhotoAvatar, type PhotoAvatarRequest } from './build-client'

/** A worker stand-in: what it was sent, whether it was stopped, and a way to answer. */
function standIn() {
  const sent: unknown[] = []
  const worker = {
    terminated: false,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: { message: string }) => void) | null,
    postMessage(message: unknown) {
      sent.push(message)
    },
    terminate() {
      this.terminated = true
    },
  }
  return { worker, sent, make: () => worker as unknown as Worker }
}

const request: PhotoAvatarRequest = {
  gender: 'female',
  views: [],
  colors: { skin: '#c08060', eyes: null, hair: null },
}

describe('photo avatar build client', () => {
  test('a build stopped before it starts makes no worker', async () => {
    const controller = new AbortController()
    controller.abort()
    let made = 0
    const build = buildPhotoAvatar(request, () => {}, controller.signal, () => {
      made++
      return standIn().make()
    })
    await expect(build).rejects.toThrow('aborted')
    expect(made).toBe(0)
  })

  test('stopping a build stops its worker, and a late answer changes nothing', async () => {
    const { worker, sent, make } = standIn()
    const controller = new AbortController()
    const progress: number[] = []
    const build = buildPhotoAvatar(request, ({ fraction }) => progress.push(fraction), controller.signal, make)
    expect(sent).toHaveLength(1)
    worker.onmessage!({ data: { progress: 0.3, stage: 'fit' } })
    controller.abort()
    await expect(build).rejects.toThrow('aborted')
    expect(worker.terminated).toBe(true)
    expect(progress).toEqual([0.3])
  })

  test('a finished build hands back the file', async () => {
    const { worker, make } = standIn()
    const build = buildPhotoAvatar(request, () => {}, undefined, make)
    const glb = new Uint8Array([1, 2, 3])
    worker.onmessage!({ data: { glb, report: {} } })
    expect((await build).glb).toBe(glb)
    expect(worker.terminated).toBe(true)
  })
})
