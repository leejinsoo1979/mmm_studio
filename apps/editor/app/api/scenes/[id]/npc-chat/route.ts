import { collectSceneFacts, formatSceneFactsKo } from '@pascal-app/nodes/npc/knowledge'
import { NpcNode } from '@pascal-app/nodes/npc/schema'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { type NpcAiProvider, npcChatStatus, readNpcAiConfig } from '@/lib/npc-ai/config'
import {
  buildNpcMessages,
  buildNpcSystemPrompt,
  cachedNpcPrompt,
  npcNameResolvers,
  type SceneMaterialNames,
} from '@/lib/npc-ai/prompt'
import { createNpcRateLimiter, npcClientIp } from '@/lib/npc-ai/rate-limit'
import { signReply } from '@/lib/npc-ai/reply-token'
import {
  encodeSse,
  type NpcStopReason,
  type NpcUsage,
  providerRequest,
  readProviderStream,
} from '@/lib/npc-ai/sse'
import { guardSceneApiRequest, sceneApiJson, withSceneApiHeaders } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'
import { canAccessOwnedResource, getVerifiedRequestStudioUserId } from '@/lib/studio-request-auth'

/**
 * NPC AI chat. `GET` says whether it is available (from the environment
 * only) and which engine voices NPCs. `POST` streams one reply as
 * `text/event-stream`: `meta`, `delta`…, then `done` (with a reply token for
 * the voice route) or `error`. The server loads the stored scene and NPC and
 * builds the prompt itself; no conversation text is stored or logged.
 */

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/** Room for a short spoken reply plus whatever thinking the model does first. */
const MAX_TOKENS = 2048
const UPSTREAM_TIMEOUT_MS = 60_000
const DEFAULT_RETRY_AFTER_S = 30

const ChatTurn = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), text: z.string().trim().min(1).max(500) }).strict(),
  // The NPC's own earlier replies, sent back as history.
  z.object({ role: z.literal('assistant'), text: z.string().trim().min(1).max(2000) }).strict(),
])

const ChatRequest = z
  .object({
    npcId: z.string().min(1).max(64),
    conversationId: z.uuid(),
    messages: z
      .array(ChatTurn)
      .min(1)
      .max(24)
      .refine(
        (turns) =>
          turns.at(-1)?.role === 'user' &&
          turns.every((turn, i) => i === 0 || turn.role !== turns[i - 1]?.role),
        'turns alternate and end with the visitor',
      ),
    context: z
      .object({ roomId: z.string().max(64).optional(), levelId: z.string().max(64).optional() })
      .strict()
      .optional(),
    playerName: z.string().trim().max(24).optional(),
  })
  .strict()

const limiter = createNpcRateLimiter()

export function GET(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  return sceneApiJson(request, npcChatStatus())
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  const input = ChatRequest.safeParse(await request.json().catch(() => null))
  if (!input.success) return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  const ai = readNpcAiConfig()
  if (!ai.ok) return sceneApiJson(request, { error: 'ai_unavailable' }, { status: 503 })

  const { id } = await params
  const { npcId, conversationId, messages, context, playerName } = input.data
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
  if (!npc.ai.enabled || !npc.interaction.talkable) {
    return sceneApiJson(request, { error: 'ai_disabled' }, { status: 403 })
  }

  const limit = limiter.take({
    ip: npcClientIp(request),
    sceneId: id,
    conversationId,
    dailyLimit: ai.config.dailyLimit,
  })
  if (!limit.ok) return rateLimited(request, limit.retryAfter)

  // Draft saves can keep the version, so the graph hash names the revision when there is one.
  const revision = scene.graphHash ?? `${scene.version}@${scene.updatedAt}`
  const prompt = cachedNpcPrompt(`${id}:${revision}:${npcId}`, () => {
    const materials = (scene.graph as { materials?: SceneMaterialNames }).materials
    const facts = collectSceneFacts(scene.graph.nodes, npcNameResolvers(materials))
    return {
      facts,
      system: buildNpcSystemPrompt(npc, formatSceneFactsKo(facts, npc.ai.sceneScope)),
    }
  })
  const turns = buildNpcMessages(messages, prompt.facts, context, playerName)
  const { url, init } = providerRequest(ai.config, prompt.system, turns, MAX_TOKENS)

  const upstream = new AbortController()
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.any([
        request.signal,
        upstream.signal,
        AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      ]),
    })
  } catch {
    return sceneApiJson(request, { error: 'upstream' }, { status: 502 })
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    console.warn('[npc-chat] provider refused', {
      sceneId: id,
      provider: ai.config.provider,
      status: response.status,
    })
    if (response.status === 429) {
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
      return rateLimited(request, retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_S)
    }
    return sceneApiJson(request, { error: 'upstream' }, { status: 502 })
  }

  const stream = replyStream(response.body, {
    provider: ai.config.provider,
    sceneId: id,
    npc,
    abort: () => upstream.abort(),
  })
  return withSceneApiHeaders(
    request,
    new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    }),
  )
}

function rateLimited(request: NextRequest, retryAfter: number) {
  const response = sceneApiJson(request, { error: 'rate_limited', retryAfter }, { status: 429 })
  response.headers.set('Retry-After', String(retryAfter))
  return response
}

/** The provider's reply as our events; a finished reply is signed so the NPC's voice may speak it. */
function replyStream(
  body: ReadableStream<Uint8Array>,
  options: { provider: NpcAiProvider; sceneId: string; npc: NpcNode; abort: () => void },
): ReadableStream<Uint8Array> {
  const { provider, sceneId, npc, abort } = options
  const encoder = new TextEncoder()
  let open = true
  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (open) controller.enqueue(encoder.encode(encodeSse(event, data)))
      }
      send('meta', { npc: npc.name })
      let reply = ''
      let stop: NpcStopReason = 'end_turn'
      let failed = false
      const usage: NpcUsage = {}
      try {
        for await (const event of readProviderStream(body, provider)) {
          if (event.kind === 'text') {
            reply += event.text
            send('delta', { text: event.text })
          } else if (event.kind === 'stop') {
            stop = event.reason
          } else if (event.kind === 'usage') {
            for (const [key, value] of Object.entries(event.usage)) {
              if (value !== undefined) usage[key as keyof NpcUsage] = value
            }
          } else {
            failed = true
          }
        }
      } catch {
        // Aborted (the visitor left, or the timeout) or the connection dropped.
        failed = true
      }

      const text = reply.trim()
      if (stop === 'refusal') send('error', { code: 'refusal' })
      else if (failed || !text) send('error', { code: 'upstream' })
      else send('done', { stop, token: signReply({ sceneId, npcId: npc.id, text }) })
      console.info('[npc-chat] usage', {
        sceneId,
        provider,
        stop: failed ? 'error' : stop,
        ...usage,
      })
      if (open) controller.close()
    },
    cancel() {
      open = false
      abort()
    },
  })
}
