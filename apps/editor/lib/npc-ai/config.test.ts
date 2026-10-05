import { describe, expect, test } from 'bun:test'
import { isLocalBaseUrl, npcChatStatus, readNpcAiConfig, readNpcTtsConfig } from './config'

const openai = { NPC_AI_PROVIDER: 'openai', NPC_AI_MODEL: 'some-model', NPC_AI_API_KEY: 'key' }

describe('readNpcAiConfig', () => {
  test('provider, model and key make it available, with default base URLs', () => {
    expect(readNpcAiConfig(openai)).toEqual({
      ok: true,
      config: {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'key',
        model: 'some-model',
        dailyLimit: 1000,
      },
    })
    const anthropic = readNpcAiConfig({ ...openai, NPC_AI_PROVIDER: 'anthropic' })
    expect(anthropic.ok && anthropic.config.baseUrl).toBe('https://api.anthropic.com')
  })

  test('a custom base URL loses its trailing slash; the daily limit is read', () => {
    const custom = readNpcAiConfig({
      ...openai,
      NPC_AI_BASE_URL: 'https://gateway.example.com/v1/',
      NPC_AI_DAILY_LIMIT: '250',
    })
    expect(custom.ok && [custom.config.baseUrl, custom.config.dailyLimit]).toEqual([
      'https://gateway.example.com/v1',
      250,
    ])
  })

  test('a local server needs no key', () => {
    const local = readNpcAiConfig({
      NPC_AI_PROVIDER: 'openai',
      NPC_AI_MODEL: 'some-model',
      NPC_AI_BASE_URL: 'http://localhost:11434/v1',
    })
    expect(local.ok && local.config.apiKey).toBeNull()
    expect(
      readNpcAiConfig({
        ...openai,
        NPC_AI_API_KEY: '',
        NPC_AI_BASE_URL: 'http://127.0.0.1:1234/v1',
      }).ok,
    ).toBe(true)
  })

  test('why it is unavailable', () => {
    expect(readNpcAiConfig({})).toEqual({ ok: false, reason: 'not_configured' })
    expect(readNpcAiConfig({ ...openai, NPC_AI_ENABLED: 'false' })).toEqual({
      ok: false,
      reason: 'disabled',
    })
    expect(readNpcAiConfig({ ...openai, NPC_AI_MODEL: ' ' }).ok).toBe(false)
    expect(readNpcAiConfig({ ...openai, NPC_AI_PROVIDER: 'gemini' }).ok).toBe(false)
    expect(readNpcAiConfig({ ...openai, NPC_AI_BASE_URL: 'not a url' })).toEqual({
      ok: false,
      reason: 'not_configured',
    })
    expect(readNpcAiConfig({ ...openai, NPC_AI_API_KEY: '' })).toEqual({
      ok: false,
      reason: 'no_api_key',
    })
    expect(
      readNpcAiConfig({
        ...openai,
        NPC_AI_API_KEY: '',
        NPC_AI_BASE_URL: 'https://localhost.example.com',
      }).ok,
    ).toBe(false)
  })
})

describe('readNpcTtsConfig', () => {
  test('a model and a key (or a local server) turn the server voice on', () => {
    expect(readNpcTtsConfig({ NPC_TTS_MODEL: 'tts', NPC_TTS_API_KEY: 'key' })).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'key',
      model: 'tts',
      voice: null,
    })
    expect(
      readNpcTtsConfig({ NPC_TTS_MODEL: 'tts', NPC_TTS_BASE_URL: 'http://localhost:8880/v1' }),
    ).toEqual({ baseUrl: 'http://localhost:8880/v1', apiKey: null, model: 'tts', voice: null })
    expect(readNpcTtsConfig({ NPC_TTS_API_KEY: 'key' })).toBeNull()
    expect(readNpcTtsConfig({ NPC_TTS_MODEL: 'tts' })).toBeNull()
  })
})

describe('npcChatStatus', () => {
  test('availability and the voice engine are independent', () => {
    expect(npcChatStatus(openai)).toEqual({ available: true, voice: 'browser' })
    expect(npcChatStatus({ NPC_TTS_MODEL: 'tts', NPC_TTS_API_KEY: 'key' })).toEqual({
      available: false,
      reason: 'not_configured',
      voice: 'server',
    })
  })
})

test('isLocalBaseUrl', () => {
  expect(isLocalBaseUrl('http://localhost:11434/v1')).toBe(true)
  expect(isLocalBaseUrl('http://127.0.0.1:1234')).toBe(true)
  expect(isLocalBaseUrl('http://[::1]:8080')).toBe(true)
  expect(isLocalBaseUrl('https://api.example.com')).toBe(false)
  expect(isLocalBaseUrl('nope')).toBe(false)
})
