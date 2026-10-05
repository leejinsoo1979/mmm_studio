import { describe, expect, test } from 'bun:test'
import { parseExtraParams, readAiPhotoConfig } from './config'

const openai = {
  AI_PHOTO_PROVIDER: 'openai',
  AI_PHOTO_MODEL: 'test-image-model',
  AI_PHOTO_API_KEY: 'key',
}
const moderated = {
  AI_PHOTO_MODERATION_MODEL: 'test-moderation',
  AI_PHOTO_MODERATION_API_KEY: 'mod-key',
}

describe('readAiPhotoConfig', () => {
  test('provider, model and key make it available, with defaults', () => {
    expect(readAiPhotoConfig(openai)).toEqual({
      ok: true,
      config: {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'key',
        model: 'test-image-model',
        extraParams: {},
        dailyLimit: 200,
        userDailyLimit: 10,
        allowAnonymous: false,
        faceEnabled: false,
        filteredProvider: true,
        moderation: null,
      },
    })
    const gemini = readAiPhotoConfig({ ...openai, AI_PHOTO_PROVIDER: 'gemini' })
    expect(gemini.ok && gemini.config.baseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta',
    )
  })

  test('a custom base URL loses its trailing slash; limits and anonymous use are read', () => {
    const custom = readAiPhotoConfig({
      ...openai,
      ...moderated,
      AI_PHOTO_BASE_URL: 'https://gateway.example.com/v1/',
      AI_PHOTO_DAILY_LIMIT: '50',
      AI_PHOTO_USER_DAILY_LIMIT: '4',
      AI_PHOTO_ALLOW_ANONYMOUS: 'true',
    })
    expect(custom.ok && custom.config).toMatchObject({
      baseUrl: 'https://gateway.example.com/v1',
      filteredProvider: false,
      dailyLimit: 50,
      userDailyLimit: 4,
      allowAnonymous: true,
    })
    const junk = readAiPhotoConfig({
      ...openai,
      AI_PHOTO_DAILY_LIMIT: '-3',
      AI_PHOTO_USER_DAILY_LIMIT: 'x',
    })
    expect(junk.ok && [junk.config.dailyLimit, junk.config.userDailyLimit]).toEqual([200, 10])
  })

  test('a local server needs no key', () => {
    const local = readAiPhotoConfig({
      ...moderated,
      AI_PHOTO_PROVIDER: 'openai',
      AI_PHOTO_MODEL: 'test-image-model',
      AI_PHOTO_BASE_URL: 'http://localhost:4000/v1',
    })
    expect(local.ok && local.config.apiKey).toBeNull()
  })

  test('moderation is required for anything but a first-party filtered API', () => {
    const unfiltered = [
      'http://localhost:8091/v1',
      'https://litellm.example.com/v1',
      'http://api.openai.com/v1',
      'https://api.openai.com.evil.example/v1',
    ]
    for (const url of unfiltered) {
      const env = { ...openai, AI_PHOTO_BASE_URL: url, AI_PHOTO_ALLOW_ANONYMOUS: 'true' }
      expect(readAiPhotoConfig(env)).toEqual({ ok: false, reason: 'moderation_required' })
      const withModeration = readAiPhotoConfig({ ...env, ...moderated })
      expect(withModeration.ok && withModeration.config.filteredProvider).toBe(false)
    }
    const filtered = [
      'https://api.openai.com/v1',
      'https://my-resource.openai.azure.com/openai',
      'https://generativelanguage.googleapis.com/v1beta',
      'https://aiplatform.googleapis.com/v1/publishers/google',
      'https://us-central1-aiplatform.googleapis.com/v1/publishers/google',
    ]
    for (const url of filtered) {
      const config = readAiPhotoConfig({ ...openai, AI_PHOTO_BASE_URL: url })
      expect(config.ok && config.config).toMatchObject({ filteredProvider: true, moderation: null })
    }
  })

  test('face photos: off unless switched on, and never without moderation', () => {
    const on = { ...openai, AI_PHOTO_FACE_ENABLED: 'true' }
    expect(readAiPhotoConfig(on)).toEqual({ ok: false, reason: 'moderation_required' })
    const config = readAiPhotoConfig({ ...on, ...moderated })
    expect(config.ok && config.config.faceEnabled).toBe(true)
    const off = readAiPhotoConfig({ ...openai, AI_PHOTO_FACE_ENABLED: 'yes' })
    expect(off.ok && off.config.faceEnabled).toBe(false)
  })

  test('why it is unavailable', () => {
    expect(readAiPhotoConfig({})).toEqual({ ok: false, reason: 'not_configured' })
    expect(readAiPhotoConfig({ ...openai, AI_PHOTO_ENABLED: 'false' })).toEqual({
      ok: false,
      reason: 'disabled',
    })
    expect(readAiPhotoConfig({ ...openai, AI_PHOTO_ENABLED: 'true' }).ok).toBe(true)
    expect(readAiPhotoConfig({ ...openai, AI_PHOTO_MODEL: ' ' }).ok).toBe(false)
    expect(readAiPhotoConfig({ ...openai, AI_PHOTO_PROVIDER: 'fal' }).ok).toBe(false)
    expect(readAiPhotoConfig({ ...openai, AI_PHOTO_BASE_URL: 'not a url' })).toEqual({
      ok: false,
      reason: 'not_configured',
    })
    expect(readAiPhotoConfig({ ...openai, AI_PHOTO_BASE_URL: 'ftp://x.example' }).ok).toBe(false)
    expect(readAiPhotoConfig({ ...openai, AI_PHOTO_API_KEY: '' })).toEqual({
      ok: false,
      reason: 'no_api_key',
    })
    expect(readAiPhotoConfig({ ...openai, AI_PHOTO_EXTRA_PARAMS: '{oops' })).toEqual({
      ok: false,
      reason: 'not_configured',
    })
  })

  test('extra params are passed through', () => {
    const config = readAiPhotoConfig({
      ...openai,
      AI_PHOTO_EXTRA_PARAMS: '{"quality":"medium","output_compression":90,"flag":true}',
    })
    expect(config.ok && config.config.extraParams).toEqual({
      quality: 'medium',
      output_compression: 90,
      flag: true,
    })
  })

  test('moderation: off unless a model is named; the main key only goes to the main host', () => {
    const shared = readAiPhotoConfig({ ...openai, AI_PHOTO_MODERATION_MODEL: 'test-moderation' })
    expect(shared.ok && shared.config.moderation).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'key',
      model: 'test-moderation',
    })
    const gemini = { ...openai, AI_PHOTO_PROVIDER: 'gemini', AI_PHOTO_MODERATION_MODEL: 'm' }
    expect(readAiPhotoConfig(gemini)).toEqual({ ok: false, reason: 'no_api_key' })
    const own = readAiPhotoConfig({ ...gemini, AI_PHOTO_MODERATION_API_KEY: 'mod-key' })
    expect(own.ok && own.config.moderation?.apiKey).toBe('mod-key')
    expect(
      readAiPhotoConfig({
        ...openai,
        AI_PHOTO_MODERATION_MODEL: 'm',
        AI_PHOTO_MODERATION_BASE_URL: '::',
      }),
    ).toEqual({ ok: false, reason: 'not_configured' })
  })
})

describe('parseExtraParams', () => {
  test('empty is no params', () => {
    expect(parseExtraParams(undefined)).toEqual({})
  })

  test('only a flat object of plain values', () => {
    expect(parseExtraParams('[]')).toBeNull()
    expect(parseExtraParams('"x"')).toBeNull()
    expect(parseExtraParams('null')).toBeNull()
    expect(parseExtraParams('{"a":{"b":1}}')).toBeNull()
    expect(parseExtraParams('{"a":[1]}')).toBeNull()
    expect(parseExtraParams('{"a":null}')).toBeNull()
    expect(parseExtraParams('{"bad key":1}')).toBeNull()
    expect(parseExtraParams(`{"a":"${'x'.repeat(201)}"}`)).toBeNull()
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]))
    expect(parseExtraParams(JSON.stringify(many))).toBeNull()
  })

  test('the route’s own fields and safety settings cannot be set', () => {
    for (const key of [
      'model',
      'prompt',
      'image',
      'n',
      'size',
      'user',
      'moderation',
      'safetySettings',
      'safety_settings',
      'SafetySettings',
      'personGeneration',
      'person_generation',
      'aspectRatio',
      'responseModalities',
      'contents',
      'mask',
      'stream',
    ]) {
      expect(parseExtraParams(JSON.stringify({ [key]: 'x' }))).toBeNull()
    }
    expect(parseExtraParams('{"imageSize":"1K"}')).toEqual({ imageSize: '1K' })
  })
})
