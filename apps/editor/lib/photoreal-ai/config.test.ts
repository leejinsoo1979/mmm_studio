import { describe, expect, test } from 'bun:test'
import { readJobService, readPhotorealAiConfig } from './config'

const IMAGE = {
  AI_PHOTO_PROVIDER: 'openai',
  AI_PHOTO_MODEL: 'test-image-model',
  AI_PHOTO_API_KEY: 'image-key',
}
const SERVICE = { AI_AVATAR_CLIENT_ID: 'id', AI_AVATAR_CLIENT_SECRET: 'secret' }
const CWD = '/srv/app'

describe('readPhotorealAiConfig', () => {
  test('reuses the AI 실사 사진 image API and adds the service, with defaults', () => {
    const result = readPhotorealAiConfig({ ...IMAGE, ...SERVICE }, CWD)
    if (!result.ok) throw new Error(result.reason)
    const { config } = result
    expect(config.mock).toBe(false)
    expect(config.image).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'test-image-model',
    })
    expect(config.service).toEqual({
      kind: 'metaperson',
      baseUrl: 'https://api.avatarsdk.com',
      clientId: 'id',
      clientSecret: 'secret',
      playerUid: null,
      requireAgeCheck: false,
    })
    expect(config.portraitLimits).toEqual({ userDaily: 8, globalDaily: 100 })
    expect(config.avatarLimits).toEqual({ userDaily: 2, globalDaily: 10 })
    expect(config.storeDir).toBe('/srv/app/data/photoreal-ai')
    expect(config.mockGlbPath).toBeNull()
  })

  test('its own caps, store, player and service address', () => {
    const result = readPhotorealAiConfig(
      {
        ...IMAGE,
        ...SERVICE,
        AI_AVATAR_PORTRAIT_USER_DAILY_LIMIT: '3',
        AI_AVATAR_PORTRAIT_DAILY_LIMIT: '30',
        AI_AVATAR_USER_DAILY_LIMIT: '1',
        AI_AVATAR_DAILY_LIMIT: '5',
        AI_AVATAR_STORE_DIR: '/data/avatars',
        AI_AVATAR_PLAYER_UID: 'player-1',
        AI_AVATAR_BASE_URL: 'https://api.avatarsdk.com/',
        AI_AVATAR_REQUIRE_AGE_CHECK: 'true',
        AI_PHOTO_DAILY_LIMIT: '999',
      },
      CWD,
    )
    expect(result).toMatchObject({
      ok: true,
      config: {
        portraitLimits: { userDaily: 3, globalDaily: 30 },
        avatarLimits: { userDaily: 1, globalDaily: 5 },
        storeDir: '/data/avatars',
        service: {
          playerUid: 'player-1',
          baseUrl: 'https://api.avatarsdk.com',
          requireAgeCheck: true,
        },
      },
    })
  })

  test('off, unconfigured or misconfigured: says which part', () => {
    expect(readPhotorealAiConfig({ ...IMAGE, ...SERVICE, AI_AVATAR_ENABLED: 'false' })).toEqual({
      ok: false,
      reason: 'disabled',
      part: 'portrait',
    })
    expect(readPhotorealAiConfig({ ...IMAGE, ...SERVICE, AI_PHOTO_ENABLED: 'false' })).toEqual({
      ok: false,
      reason: 'disabled',
      part: 'portrait',
    })
    expect(readPhotorealAiConfig({ ...SERVICE })).toMatchObject({
      ok: false,
      reason: 'not_configured',
    })
    // No keys: no paid service, and this browser makes the avatar; one key alone is broken.
    expect(readPhotorealAiConfig({ ...IMAGE })).toMatchObject({
      ok: true,
      config: { service: null },
    })
    expect(readPhotorealAiConfig({ ...IMAGE, AI_AVATAR_CLIENT_ID: 'id' })).toEqual({
      ok: false,
      reason: 'service_not_configured',
      part: 'avatar',
    })
    for (const bad of [
      { AI_AVATAR_SERVICE: 'other' },
      { AI_AVATAR_BASE_URL: 'http://api.avatarsdk.com' },
      { AI_AVATAR_BASE_URL: 'not a url' },
    ]) {
      expect(readPhotorealAiConfig({ ...IMAGE, ...SERVICE, ...bad })).toMatchObject({
        ok: false,
        part: 'avatar',
      })
    }
    expect(
      readPhotorealAiConfig({ ...IMAGE, ...SERVICE, AI_AVATAR_BASE_URL: 'http://localhost:9000' })
        .ok,
    ).toBe(true)
  })

  test('the portrait extra params: same rules as AI 실사 사진, and never WebP', () => {
    const extra = (raw: string) =>
      readPhotorealAiConfig({ ...IMAGE, ...SERVICE, AI_AVATAR_PORTRAIT_EXTRA_PARAMS: raw })
    expect(extra('{"quality":"high","output_format":"jpeg"}')).toMatchObject({
      ok: true,
      config: { portraitExtraParams: { quality: 'high', output_format: 'jpeg' } },
    })
    expect(extra('{"output_format":"webp"}')).toMatchObject({ ok: false, reason: 'not_configured' })
    expect(extra('{"moderation":"low"}')).toMatchObject({ ok: false, reason: 'not_configured' })
    expect(extra('not json')).toMatchObject({ ok: false, reason: 'not_configured' })
    // AI 실사 사진's edit options are not used here.
    expect(
      readPhotorealAiConfig({
        ...IMAGE,
        ...SERVICE,
        AI_PHOTO_EXTRA_PARAMS: '{"input_fidelity":"high"}',
      }),
    ).toMatchObject({ ok: true, config: { portraitExtraParams: {} } })
  })

  test('the AI 실사 사진 face switch does not turn AI 인물 off', () => {
    // With face photos on, AI 실사 사진 needs a moderation model; AI 인물 never takes a face photo.
    expect(readPhotorealAiConfig({ ...IMAGE, ...SERVICE, AI_PHOTO_FACE_ENABLED: 'true' }).ok).toBe(
      true,
    )
    expect(
      readPhotorealAiConfig({
        ...IMAGE,
        ...SERVICE,
        AI_PHOTO_BASE_URL: 'https://gateway.example.com/v1',
      }),
    ).toMatchObject({ ok: false, reason: 'moderation_required' })
  })

  test('the 목업 needs no keys, and only outside production', () => {
    const mock = readPhotorealAiConfig({ AI_AVATAR_MOCK: 'true', NODE_ENV: 'development' }, CWD)
    expect(mock).toMatchObject({
      ok: true,
      config: {
        mock: true,
        image: null,
        mockPortraitPath: null,
        mockGlbPath: '/srv/app/public/characters/photoreal/makehuman-female-01.glb',
      },
    })
    expect(
      readPhotorealAiConfig(
        {
          AI_AVATAR_MOCK: 'true',
          AI_AVATAR_MOCK_GLB: '/tmp/a.glb',
          AI_AVATAR_MOCK_PORTRAIT: '/tmp/p.jpg',
        },
        CWD,
      ),
    ).toMatchObject({ config: { mockGlbPath: '/tmp/a.glb', mockPortraitPath: '/tmp/p.jpg' } })
    expect(readPhotorealAiConfig({ AI_AVATAR_MOCK: 'true', NODE_ENV: 'production' })).toMatchObject(
      {
        ok: false,
      },
    )
    // The 목업's file settings mean nothing outside it.
    const real = readPhotorealAiConfig({ ...IMAGE, ...SERVICE, AI_AVATAR_MOCK_GLB: '/tmp/a.glb' })
    expect(real).toMatchObject({ ok: true, config: { mock: false, mockGlbPath: null } })
  })
})

describe('readJobService', () => {
  test('a started build is carried on whatever the feature switches say now', () => {
    for (const env of [
      { ...SERVICE, AI_AVATAR_ENABLED: 'false' },
      { ...SERVICE },
      { ...IMAGE, ...SERVICE, AI_PHOTO_ENABLED: 'false' },
    ]) {
      expect(readJobService(env, CWD, false)).toMatchObject({
        mock: false,
        service: { clientId: 'id', clientSecret: 'secret' },
      })
    }
    expect(readJobService({ ...IMAGE }, CWD, false)).toBeNull()
  })

  test('a 목업 build on the 목업 service, never in production', () => {
    expect(readJobService({ ...IMAGE, ...SERVICE }, CWD, true)).toMatchObject({
      mock: true,
      service: { clientId: 'mock-client' },
      mockGlbPath: '/srv/app/public/characters/photoreal/makehuman-female-01.glb',
    })
    expect(readJobService({ NODE_ENV: 'production' }, CWD, true)).toBeNull()
  })
})
