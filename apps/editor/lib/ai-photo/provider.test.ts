import { describe, expect, test } from 'bun:test'
import type { AiPhotoConfig } from './config'
import {
  AI_PHOTO_MAX_OUTPUT_BYTES,
  aiPhotoRequest,
  parseGeminiImage,
  parseOpenAiImage,
  readAiPhotoResponse,
} from './provider'
import { base64Of, jpeg, png, webp } from './test-images'

const config = (overrides: Partial<AiPhotoConfig> = {}): AiPhotoConfig => ({
  provider: 'openai',
  baseUrl: 'https://images.example.com/v1',
  apiKey: 'key',
  model: 'test-image-model',
  extraParams: {},
  dailyLimit: 200,
  userDailyLimit: 10,
  allowAnonymous: false,
  faceEnabled: false,
  filteredProvider: true,
  moderation: null,
  ...overrides,
})

const render = { bytes: jpeg(1024, 1536), type: 'image/jpeg' as const }
const face = { bytes: webp(512, 512), type: 'image/webp' as const }
const input = { prompt: 'PROMPT', render, face, framing: 'full' as const, user: 'tag' }

describe('aiPhotoRequest: openai', () => {
  test('multipart edit with the render first, then the face', async () => {
    const { url, init } = aiPhotoRequest(
      config({ extraParams: { quality: 'medium', output_compression: 90 } }),
      input,
    )
    expect(url).toBe('https://images.example.com/v1/images/edits')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ accept: 'application/json', authorization: 'Bearer key' })
    const form = init.body as FormData
    expect([...form.keys()]).toEqual([
      'model',
      'prompt',
      'image[]',
      'image[]',
      'n',
      'size',
      'user',
      'quality',
      'output_compression',
    ])
    expect(form.get('model')).toBe('test-image-model')
    expect(form.get('prompt')).toBe('PROMPT')
    expect(form.get('n')).toBe('1')
    expect(form.get('size')).toBe('1024x1536')
    expect(form.get('user')).toBe('tag')
    expect(form.get('output_compression')).toBe('90')
    const [first, second] = form.getAll('image[]') as File[]
    expect([first?.name, first?.type, second?.name, second?.type]).toEqual([
      'render.jpg',
      'image/jpeg',
      'face.webp',
      'image/webp',
    ])
    expect(new Uint8Array(await first!.arrayBuffer())).toEqual(render.bytes)
    // Never a response_format or moderation knob of our own.
    expect(form.has('response_format')).toBe(false)
    expect(form.has('moderation')).toBe(false)
  })

  test('square for the face; no face, user tag or key when absent', () => {
    const { init } = aiPhotoRequest(config({ apiKey: null }), {
      ...input,
      face: null,
      framing: 'face',
      user: null,
    })
    const form = init.body as FormData
    expect(form.get('size')).toBe('1024x1024')
    expect(form.getAll('image[]')).toHaveLength(1)
    expect(form.has('user')).toBe(false)
    expect(init.headers).toEqual({ accept: 'application/json' })
  })
})

describe('aiPhotoRequest: gemini', () => {
  test('generateContent with labelled inline images and strict safety settings', () => {
    const { url, init } = aiPhotoRequest(
      config({
        provider: 'gemini',
        baseUrl: 'https://gemini.example.com/v1beta',
        model: 'test/image model',
        extraParams: { imageSize: '1K' },
      }),
      input,
    )
    expect(url).toBe(
      'https://gemini.example.com/v1beta/models/test%2Fimage%20model:generateContent',
    )
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-goog-api-key': 'key' })
    const body = JSON.parse(init.body as string)
    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Image 1:' },
          { inlineData: { mimeType: 'image/jpeg', data: base64Of(render.bytes) } },
          { text: 'Image 2:' },
          { inlineData: { mimeType: 'image/webp', data: base64Of(face.bytes) } },
          { text: 'PROMPT' },
        ],
      },
    ])
    expect(body.generationConfig).toEqual({
      responseModalities: ['TEXT', 'IMAGE'],
      candidateCount: 1,
      imageConfig: { imageSize: '1K', aspectRatio: '2:3' },
    })
    expect(body.safetySettings).toHaveLength(4)
    for (const setting of body.safetySettings) {
      expect(setting.threshold).toBe('BLOCK_LOW_AND_ABOVE')
    }
    expect(body.safetySettings.map((s: { category: string }) => s.category)).toContain(
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    )
    // No user id goes to Gemini.
    expect(init.body as string).not.toContain('tag')
  })

  test('square face shot without image 2', () => {
    const { init } = aiPhotoRequest(config({ provider: 'gemini' }), {
      ...input,
      face: null,
      framing: 'face',
    })
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts).toHaveLength(3)
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: '1:1' })
  })
})

describe('parseOpenAiImage', () => {
  test('the first b64_json image', () => {
    const image = jpeg(1024, 1024)
    const result = parseOpenAiImage(200, { data: [{ b64_json: base64Of(image) }] })
    expect(result).toEqual({ ok: true, bytes: image, type: 'image/jpeg' })
  })

  test('a URL-only answer, no data or non-image bytes are upstream failures, never refundable', () => {
    const answers = [
      parseOpenAiImage(200, { data: [{ url: 'https://cdn.example.com/x.png' }] }),
      parseOpenAiImage(200, {}),
      parseOpenAiImage(200, { data: [] }),
      parseOpenAiImage(200, null),
      parseOpenAiImage(200, { data: [{ b64_json: base64Of(new TextEncoder().encode('<html>')) }] }),
    ]
    for (const answer of answers) {
      expect(answer).toMatchObject({ ok: false, code: 'upstream' })
      expect(answer).not.toHaveProperty('refundable')
    }
    expect(answers[4]).toMatchObject({ detail: 'not_an_image' })
  })

  test('only errors the request cannot cause are refundable', () => {
    for (const status of [500, 502, 503, 401, 403, 404]) {
      expect(parseOpenAiImage(status, null)).toEqual({
        ok: false,
        code: 'upstream',
        detail: `http_${status}`,
        refundable: true,
      })
    }
    for (const status of [400, 408, 413, 415, 422]) {
      expect(parseOpenAiImage(status, null)).not.toHaveProperty('refundable')
    }
    const userError = {
      error: { code: 'invalid_request_error', type: 'image_generation_user_error' },
    }
    expect(parseOpenAiImage(400, userError)).toEqual({
      ok: false,
      code: 'upstream',
      detail: 'invalid_request_error/image_generation_user_error',
    })
  })

  test('safety refusals are blocked; other errors are upstream', () => {
    const error = (code: string, type = 'invalid_request_error') => ({ error: { code, type } })
    expect(parseOpenAiImage(400, error('moderation_blocked'))).toEqual({
      ok: false,
      code: 'blocked',
      detail: 'moderation_blocked/invalid_request_error',
    })
    expect(parseOpenAiImage(400, error('content_policy_violation'))).toMatchObject({
      code: 'blocked',
    })
    expect(parseOpenAiImage(400, error('content_filter'))).toMatchObject({ code: 'blocked' })
    expect(
      parseOpenAiImage(400, { error: { type: 'image_generation_user_error', code: null } }),
    ).toMatchObject({
      code: 'upstream',
    })
    expect(parseOpenAiImage(400, error('invalid_value'))).toMatchObject({ code: 'upstream' })
    const wrapped = {
      error: { message: 'litellm.ContentPolicyViolationError: rejected', code: '400' },
    }
    expect(parseOpenAiImage(400, wrapped)).toEqual({ ok: false, code: 'blocked', detail: '400' })
    expect(parseOpenAiImage(500, error('moderation_blocked'))).toMatchObject({ code: 'upstream' })
  })
})

describe('parseGeminiImage', () => {
  const answer = (parts: unknown[], finishReason = 'STOP') => ({
    candidates: [{ content: { role: 'model', parts }, finishReason }],
  })

  test('the last image that is not a thought', () => {
    const draft = png(64, 64)
    const final = png(1024, 1536)
    const result = parseGeminiImage(
      200,
      answer([
        { text: 'thinking', thought: true },
        { inlineData: { mimeType: 'image/png', data: base64Of(draft) }, thought: true },
        { inlineData: { mimeType: 'image/png', data: base64Of(final) }, thoughtSignature: 'x' },
        { text: 'Here is the photo' },
      ]),
    )
    expect(result).toEqual({ ok: true, bytes: final, type: 'image/png' })
  })

  test('snake_case inline data is read too', () => {
    const image = jpeg(1024, 1024)
    const result = parseGeminiImage(
      200,
      answer([{ inline_data: { mime_type: 'image/jpeg', data: base64Of(image) } }]),
    )
    expect(result).toEqual({ ok: true, bytes: image, type: 'image/jpeg' })
  })

  test('a blocked prompt or a safety finish is blocked', () => {
    expect(parseGeminiImage(200, { promptFeedback: { blockReason: 'SAFETY' } })).toEqual({
      ok: false,
      code: 'blocked',
      detail: 'SAFETY',
    })
    for (const reason of [
      'IMAGE_SAFETY',
      'IMAGE_PROHIBITED_CONTENT',
      'PROHIBITED_CONTENT',
      'SPII',
    ]) {
      expect(parseGeminiImage(200, answer([], reason))).toMatchObject({ code: 'blocked' })
    }
    // Even with an image part, a safety finish wins.
    const image = { inlineData: { mimeType: 'image/png', data: base64Of(png(8, 8)) } }
    expect(parseGeminiImage(200, answer([image], 'IMAGE_SAFETY'))).toMatchObject({
      code: 'blocked',
    })
  })

  test('no final image is how Gemini declines: blocked', () => {
    expect(parseGeminiImage(200, answer([{ text: 'I cannot do that' }]))).toEqual({
      ok: false,
      code: 'blocked',
      detail: 'STOP',
    })
    for (const reason of ['NO_IMAGE', 'IMAGE_OTHER', 'IMAGE_RECITATION', 'OTHER', 'MAX_TOKENS']) {
      expect(parseGeminiImage(200, answer([], reason))).toEqual({
        ok: false,
        code: 'blocked',
        detail: reason,
      })
    }
    expect(
      parseGeminiImage(
        200,
        answer([
          { inlineData: { mimeType: 'image/png', data: base64Of(png(8, 8)) }, thought: true },
        ]),
      ),
    ).toMatchObject({ code: 'blocked' })
    expect(parseGeminiImage(200, { candidates: [] })).toEqual({
      ok: false,
      code: 'blocked',
      detail: 'no_image',
    })
  })

  test('an HTTP error is an upstream failure, refundable only when the request cannot cause it', () => {
    expect(parseGeminiImage(400, { error: { code: 400, status: 'INVALID_ARGUMENT' } })).toEqual({
      ok: false,
      code: 'upstream',
      detail: 'INVALID_ARGUMENT',
    })
    expect(parseGeminiImage(503, { error: { code: 503, status: 'UNAVAILABLE' } })).toEqual({
      ok: false,
      code: 'upstream',
      detail: 'UNAVAILABLE',
      refundable: true,
    })
    expect(parseGeminiImage(403, null)).toMatchObject({ refundable: true })
  })
})

describe('readAiPhotoResponse', () => {
  test('reads the body and parses it by protocol', async () => {
    const image = jpeg(1024, 1024)
    const openai = await readAiPhotoResponse(
      'openai',
      Response.json({ data: [{ b64_json: base64Of(image) }] }),
    )
    expect(openai).toEqual({ ok: true, bytes: image, type: 'image/jpeg' })
    const gemini = await readAiPhotoResponse(
      'gemini',
      Response.json({
        candidates: [{ content: { parts: [{ inlineData: { data: base64Of(image) } }] } }],
      }),
    )
    expect(gemini.ok).toBe(true)
  })

  test('429 keeps the provider’s retry-after', async () => {
    const limited = new Response('{}', { status: 429, headers: { 'retry-after': '12' } })
    expect(await readAiPhotoResponse('openai', limited)).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfter: 12,
      detail: 'http_429',
      refundable: true,
    })
    expect(await readAiPhotoResponse('gemini', new Response('', { status: 429 }))).toMatchObject({
      retryAfter: 30,
    })
  })

  test('unreadable or oversized answers are upstream failures, kept counted', async () => {
    expect(await readAiPhotoResponse('openai', new Response('not json'))).toEqual({
      ok: false,
      code: 'upstream',
      detail: 'unreadable',
    })
    const huge = base64Of(jpeg(8, 8, { pad: AI_PHOTO_MAX_OUTPUT_BYTES }))
    expect(
      await readAiPhotoResponse('openai', Response.json({ data: [{ b64_json: huge }] })),
    ).toEqual({
      ok: false,
      code: 'upstream',
      detail: 'too_large',
    })
    expect(await readAiPhotoResponse('openai', new Response('oops', { status: 502 }))).toEqual({
      ok: false,
      code: 'upstream',
      detail: 'http_502',
      refundable: true,
    })
  })
})
