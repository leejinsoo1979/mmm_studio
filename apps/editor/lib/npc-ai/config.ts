import type { NpcChatStatus } from '@pascal-app/nodes'

/**
 * NPC AI chat and voice settings, from the server's environment only (never
 * `NEXT_PUBLIC_`): the owner picks the provider and model there, and nothing
 * in the repo names one. Empty values count as unset (.env.example lists
 * every variable empty).
 */

/** `openai`: any OpenAI-compatible Chat Completions API. `anthropic`: the Messages API. */
export type NpcAiProvider = 'openai' | 'anthropic'

export type NpcAiConfig = {
  provider: NpcAiProvider
  /** No trailing slash. */
  baseUrl: string
  /** Null for a local server (Ollama, LM Studio) that needs none. */
  apiKey: string | null
  model: string
  /** Replies per scene per day. */
  dailyLimit: number
}

export type NpcAiUnavailableReason = 'disabled' | 'not_configured' | 'no_api_key'

export type NpcTtsConfig = {
  baseUrl: string
  apiKey: string | null
  model: string
  /** Default voice id; an NPC's own `voice.voice` wins when it isn't 'auto'. */
  voice: string | null
}

type Env = Record<string, string | undefined>

const DEFAULT_BASE_URL: Record<NpcAiProvider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
}
const DEFAULT_TTS_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_DAILY_LIMIT = 1000
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const value = (env: Env, key: string) => env[key]?.trim() || undefined

/** A local model server, which may run without a key. */
export function isLocalBaseUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

function baseUrl(raw: string | undefined, fallback: string): string | null {
  const url = (raw ?? fallback).replace(/\/+$/, '')
  try {
    return new URL(url).protocol.startsWith('http') ? url : null
  } catch {
    return null
  }
}

export function readNpcAiConfig(
  env: Env = process.env,
): { ok: true; config: NpcAiConfig } | { ok: false; reason: NpcAiUnavailableReason } {
  if (value(env, 'NPC_AI_ENABLED') === 'false') return { ok: false, reason: 'disabled' }
  const provider = value(env, 'NPC_AI_PROVIDER')
  const model = value(env, 'NPC_AI_MODEL')
  if ((provider !== 'openai' && provider !== 'anthropic') || !model) {
    return { ok: false, reason: 'not_configured' }
  }
  const url = baseUrl(value(env, 'NPC_AI_BASE_URL'), DEFAULT_BASE_URL[provider])
  if (!url) return { ok: false, reason: 'not_configured' }
  const apiKey = value(env, 'NPC_AI_API_KEY') ?? null
  if (!apiKey && !isLocalBaseUrl(url)) return { ok: false, reason: 'no_api_key' }
  const limit = Number.parseInt(value(env, 'NPC_AI_DAILY_LIMIT') ?? '', 10)
  return {
    ok: true,
    config: {
      provider,
      baseUrl: url,
      apiKey,
      model,
      dailyLimit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_DAILY_LIMIT,
    },
  }
}

/** The server voice (an OpenAI-compatible `/audio/speech`), or null to use the browser's. */
export function readNpcTtsConfig(env: Env = process.env): NpcTtsConfig | null {
  const model = value(env, 'NPC_TTS_MODEL')
  const url = baseUrl(value(env, 'NPC_TTS_BASE_URL'), DEFAULT_TTS_BASE_URL)
  const apiKey = value(env, 'NPC_TTS_API_KEY') ?? null
  if (!model || !url || (!apiKey && !isLocalBaseUrl(url))) return null
  return { baseUrl: url, apiKey, model, voice: value(env, 'NPC_TTS_VOICE') ?? null }
}

/** What `GET …/npc-chat` answers: whether AI chat works and which engine voices NPCs. */
export function npcChatStatus(env: Env = process.env): NpcChatStatus {
  const ai = readNpcAiConfig(env)
  const voice = readNpcTtsConfig(env) ? 'server' : 'browser'
  return ai.ok ? { available: true, voice } : { available: false, reason: ai.reason, voice }
}
