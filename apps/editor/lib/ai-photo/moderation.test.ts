import { describe, expect, test } from 'bun:test'
import { moderateImages, moderationRequest, readModerationVerdict } from './moderation'
import { base64Of, jpeg, png } from './test-images'

const config = { baseUrl: 'https://mod.example.com/v1', apiKey: 'key', model: 'test-moderation' }
const image = { bytes: jpeg(64, 64), type: 'image/jpeg' as const }

describe('moderationRequest', () => {
  test('one image as a data URL', () => {
    const { url, init } = moderationRequest(config, image)
    expect(url).toBe('https://mod.example.com/v1/moderations')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer key',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'test-moderation',
      input: [
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${base64Of(image.bytes)}` },
        },
      ],
    })
    const local = moderationRequest({ ...config, apiKey: null }, image)
    expect(local.init.headers).toEqual({ 'content-type': 'application/json' })
  })
})

describe('readModerationVerdict', () => {
  test('flagged, minors or clear', () => {
    expect(readModerationVerdict({ results: [{ flagged: false, categories: {} }] })).toBe('clear')
    expect(
      readModerationVerdict({ results: [{ flagged: true, categories: { sexual: true } }] }),
    ).toBe('flagged')
    expect(
      readModerationVerdict({
        results: [{ flagged: false, categories: { 'sexual/minors': true } }],
      }),
    ).toBe('flagged')
  })

  test('anything unreadable fails closed', () => {
    expect(readModerationVerdict(null)).toBe('error')
    expect(readModerationVerdict({})).toBe('error')
    expect(readModerationVerdict({ results: [] })).toBe('error')
    expect(readModerationVerdict({ results: [{ categories: {} }] })).toBe('error')
  })
})

describe('moderateImages', () => {
  const signal = new AbortController().signal

  test('checks each image; flagged wins, then errors', async () => {
    const flaggedBytes = base64Of(png(8, 8))
    const calls: string[] = []
    const fetch = async (url: string, init: RequestInit) => {
      calls.push(url)
      const flagged = (init.body as string).includes(flaggedBytes)
      return Response.json({ results: [{ flagged, categories: {} }] })
    }
    expect(await moderateImages(config, [image], { fetch, signal })).toBe('clear')
    const both = [image, { bytes: png(8, 8), type: 'image/png' as const }]
    expect(await moderateImages(config, both, { fetch, signal })).toBe('flagged')
    expect(calls).toHaveLength(3)
  })

  test('network and HTTP failures are errors', async () => {
    const down = async () => {
      throw new TypeError('offline')
    }
    expect(await moderateImages(config, [image], { fetch: down, signal })).toBe('error')
    const refused = async () => new Response('nope', { status: 500 })
    expect(await moderateImages(config, [image], { fetch: refused, signal })).toBe('error')
    const garbled = async () => new Response('not json')
    expect(await moderateImages(config, [image], { fetch: garbled, signal })).toBe('error')
  })
})
