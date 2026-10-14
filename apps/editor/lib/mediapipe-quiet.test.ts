import { afterAll, describe, expect, test } from 'bun:test'
import { quietMediaPipe } from './mediapipe-quiet'

const realFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = realFetch
})

describe('quietMediaPipe', () => {
  test('refuses MediaPipe’s usage reports before they are sent, and lets everything else through', async () => {
    const sent: string[] = []
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
      sent.push(String(input instanceof Request ? input.url : input))
      return new Response('ok')
    }, realFetch)
    quietMediaPipe()
    quietMediaPipe()
    await expect(
      fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST', body: 'usage' }),
    ).rejects.toThrow(TypeError)
    await expect(fetch(new Request('https://odml.pa.googleapis.com/v1/log'))).rejects.toThrow()
    expect(await (await fetch('/mediapipe/face_landmarker.task')).text()).toBe('ok')
    expect(await (await fetch(new URL('https://example.com/a'))).text()).toBe('ok')
    expect(sent).toEqual(['/mediapipe/face_landmarker.task', 'https://example.com/a'])
  })
})
