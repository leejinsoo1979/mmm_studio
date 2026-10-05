import { collectSceneFacts } from '@pascal-app/nodes/npc/knowledge'
import { NpcNode } from '@pascal-app/nodes/npc/schema'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { readNpcTtsConfig } from '@/lib/npc-ai/config'
import { npcNameResolvers, type SceneMaterialNames } from '@/lib/npc-ai/prompt'
import { createNpcRateLimiter, npcClientIp } from '@/lib/npc-ai/rate-limit'
import { verifyReply } from '@/lib/npc-ai/reply-token'
import {
  createLru,
  isNpcSpeech,
  NPC_SPEECH_MAX,
  type NpcSpeechCandidates,
  npcSpeechCandidates,
  npcTtsVoice,
  npcVoiceDailyLimit,
  readBodyCapped,
  ttsRequest,
} from '@/lib/npc-ai/tts'
import { guardSceneApiRequest, sceneApiJson, withSceneApiHeaders } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'
import { canAccessOwnedResource, getVerifiedRequestStudioUserId } from '@/lib/studio-request-auth'

/**
 * NPC voice: `POST` answers one line as mp3 from the configured
 * OpenAI-compatible speech API. Only what the stored NPC says by itself
 * (scripted lines, barks, greetings, room descriptions) or an AI reply
 * carrying the chat route's token is voiced, with the chat route's access
 * rules and rate limits. No text is logged.
 */

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const UPSTREAM_TIMEOUT_MS = 30_000
const DEFAULT_RETRY_AFTER_S = 30
/** A 300-character line read slowly is well under 1 MB of mp3. */
const MAX_AUDIO_BYTES = 2 * 1024 * 1024
/** Lines the scene's visitors share are synthesized once per server instance. */
const AUDIO_CACHE_ENTRIES = 128
const AUDIO_CACHE_BYTES = 24 * 1024 * 1024
const CANDIDATE_CACHE_ENTRIES = 64

const VoiceRequest = z
  .object({
    npcId: z.string().min(1).max(64),
    text: z.string().trim().min(1).max(NPC_SPEECH_MAX),
    /** The chat route's signature of an AI reply. */
    token: z.string().max(128).optional(),
  })
  .strict()

const limiter = createNpcRateLimiter()
const candidatesCache = createLru<NpcSpeechCandidates>(CANDIDATE_CACHE_ENTRIES)
const audioCache = createLru<Uint8Array<ArrayBuffer>>(
  AUDIO_CACHE_ENTRIES,
  AUDIO_CACHE_BYTES,
  (bytes) => bytes.byteLength,
)

export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const input = VoiceRequest.safeParse(await request.json().catch(() => null))
  if (!input.success) return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  const tts = readNpcTtsConfig()
  if (!tts) return sceneApiJson(request, { error: 'voice_unavailable' }, { status: 503 })

  const { id } = await params
  const { npcId, text, token } = input.data
  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  if (
    scene.published !== true &&
    !canAccessOwnedResource(scene.ownerId, await getVerifiedRequestStudioUserId(request))
  ) {
    return sceneApiJson(request, { error: 'forbidden' }, { status: 403 })
  }
  const parsed = NpcNode.safeParse((scene.graph.nodes as Record<string, unknown>)[npcId])
  if (!parsed.success) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  const npc = parsed.data
  if (!npc.voice.enabled) return sceneApiJson(request, { error: 'voice_disabled' }, { status: 403 })

  const signed = token !== undefined && verifyReply(token, { sceneId: id, npcId, text })
  if (!signed) {
    // Draft saves can keep the version, so the graph hash names the revision when there is one.
    const revision = scene.graphHash ?? `${scene.version}@${scene.updatedAt}`
    const key = `${id}:${revision}:${npcId}`
    let candidates = candidatesCache.get(key)
    if (!candidates) {
      const materials = (scene.graph as { materials?: SceneMaterialNames }).materials
      const facts = collectSceneFacts(scene.graph.nodes, npcNameResolvers(materials))
      candidates = npcSpeechCandidates(npc, facts)
      candidatesCache.set(key, candidates)
    }
    if (!isNpcSpeech(candidates, text)) {
      return sceneApiJson(request, { error: 'not_speakable' }, { status: 403 })
    }
  }

  const voice = npcTtsVoice(tts, npc)
  const speed = npc.voice.rate
  const audioKey = JSON.stringify([voice, speed, text])
  const cached = audioCache.get(audioKey)
  if (cached) return audioResponse(request, cached)

  // Counted per visitor and scene as chat is; the "conversation" is the reply or the line, so one
  // line is re-synthesized at most as often as a conversation may ask.
  const limit = limiter.take({
    ip: npcClientIp(request),
    sceneId: id,
    conversationId: signed ? `reply:${token}` : `line:${npcId}:${text}`,
    dailyLimit: npcVoiceDailyLimit(),
  })
  if (!limit.ok) return rateLimited(request, limit.retryAfter)

  const { url, init } = ttsRequest(tts, { text, voice, speed })
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })
  } catch {
    return sceneApiJson(request, { error: 'upstream' }, { status: 502 })
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    console.warn('[npc-voice] speech API refused', { sceneId: id, status: response.status })
    if (response.status === 429) {
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
      return rateLimited(request, retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_S)
    }
    return sceneApiJson(request, { error: 'upstream' }, { status: 502 })
  }
  const audio = await readBodyCapped(response.body, MAX_AUDIO_BYTES).catch(() => null)
  if (!audio || audio.byteLength === 0) {
    return sceneApiJson(request, { error: 'upstream' }, { status: 502 })
  }
  audioCache.set(audioKey, audio)
  return audioResponse(request, audio)
}

function audioResponse(request: NextRequest, audio: Uint8Array<ArrayBuffer>) {
  return withSceneApiHeaders(
    request,
    new Response(audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        'Cache-Control': 'no-store',
      },
    }),
  )
}

function rateLimited(request: NextRequest, retryAfter: number) {
  const response = sceneApiJson(request, { error: 'rate_limited', retryAfter }, { status: 429 })
  response.headers.set('Retry-After', String(retryAfter))
  return response
}
