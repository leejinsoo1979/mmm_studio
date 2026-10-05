import { useScene } from '@pascal-app/core'
import {
  type NpcChatErrorCode,
  type NpcChatResult,
  type NpcChatStatus,
  type NpcChatTransport,
  type NpcNameResolvers,
  readNpcChatStream,
  setNpcChatTransport,
  setNpcNameResolvers,
  useNpcDialogue,
  useNpcRuntime,
} from '@pascal-app/nodes'
import { getStudioAuthHeaders } from './auth-client'
import { observeFirebaseUser } from './firebase-client'
import { npcNameResolvers, type SceneMaterialNames } from './npc-ai/prompt'

/** The chat route's status answers from the environment only: asked again after this long. */
export const NPC_STATUS_TTL_MS = 60_000

const OFFLINE: NpcChatStatus = { available: false, reason: 'network', voice: 'browser' }

export type NpcChatClientDeps = {
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  /** Request headers naming the signed-in visitor (the Firebase ID token), as other scene calls send. */
  headers?: () => Promise<Record<string, string>>
  now?: () => number
}

function readStatus(value: unknown): NpcChatStatus {
  const status = (value ?? {}) as Partial<NpcChatStatus>
  return {
    available: status.available === true,
    ...(typeof status.reason === 'string' ? { reason: status.reason } : {}),
    voice: status.voice === 'server' ? 'server' : 'browser',
  }
}

/** Our code for a refusal the route gave before streaming. */
function refusalCode(status: number): NpcChatErrorCode {
  if (status === 429) return 'rate_limited'
  if (status === 403 || status === 404 || status === 503) return 'unavailable'
  return 'upstream'
}

/**
 * The NPC transport of one scene: AI chat streamed from
 * `/api/scenes/<id>/npc-chat`, its status cached for a minute, and server
 * voice clips from `/api/scenes/<id>/npc-voice`.
 */
export function createNpcChatTransport(
  sceneId: string,
  deps: NpcChatClientDeps = {},
): NpcChatTransport {
  const send = deps.fetch ?? ((input, init) => fetch(input, init))
  const headers = deps.headers ?? getStudioAuthHeaders
  const now = deps.now ?? Date.now
  const base = `/api/scenes/${encodeURIComponent(sceneId)}`
  let status: { at: number; value: Promise<NpcChatStatus> } | null = null

  const post = async (path: string, body: unknown, signal: AbortSignal) =>
    send(`${base}/${path}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(await headers()) },
      body: JSON.stringify(body),
      signal,
    })

  return {
    status() {
      if (status && now() - status.at < NPC_STATUS_TTL_MS) return status.value
      const at = now()
      const value = (async () => {
        const response = await send(`${base}/npc-chat`, {
          cache: 'no-store',
          headers: await headers(),
        })
        if (!response.ok) throw new Error(`npc-chat status ${response.status}`)
        return readStatus(await response.json())
      })().catch(() => {
        // Not kept: the next asker tries again.
        if (status?.at === at) status = null
        return OFFLINE
      })
      status = { at, value }
      return value
    },

    async send(request, onDelta): Promise<NpcChatResult> {
      const { npcId, conversationId, messages, context, playerName, signal } = request
      let response: Response
      try {
        response = await post(
          'npc-chat',
          { npcId, conversationId, messages, context, playerName },
          signal,
        )
      } catch {
        return { ok: false, code: 'network' }
      }
      if (!(response.ok && response.body)) {
        await response.body?.cancel().catch(() => {})
        // The server says AI chat is off now: the next status asks again.
        if (response.status === 503) status = null
        return { ok: false, code: refusalCode(response.status) }
      }
      return readNpcChatStream(response.body, onDelta)
    },

    async speak({ npcId, text, token, signal }) {
      const response = await post('npc-voice', { npcId, text, token }, signal)
      if (response.ok) return response.arrayBuffer()
      await response.body?.cancel().catch(() => {})
      // Busy or a failed upstream may answer next time (a rejection); anything else won't.
      if (response.status === 429 || response.status === 502) {
        throw new Error(`npc-voice ${response.status}`)
      }
      return null
    },
  }
}

/** Korean item and material names for facts gathered here, the scene's own materials included. */
export const npcClientNameResolvers: NpcNameResolvers = {
  item: (asset) => npcNameResolvers().item(asset),
  material: (ref) =>
    npcNameResolvers(useScene.getState().materials as SceneMaterialNames).material(ref),
}

/**
 * Connects the NPCs of the scene on screen to the app: the chat and voice
 * routes, the Korean names, and this player's id in shared engagements (the
 * Firebase uid, or 'local') and name. Undone when the scene is left, NPC state too.
 */
export function installNpcSceneServices(sceneId: string): () => void {
  setNpcChatTransport(createNpcChatTransport(sceneId))
  setNpcNameResolvers(npcClientNameResolvers)
  const unobserve = observeFirebaseUser((user) => {
    useNpcRuntime.getState().setLocalPlayerId(user?.uid ?? 'local')
    // The name the other players see over this player is the one NPCs call them by.
    useNpcDialogue.getState().setPlayerName(user?.displayName?.trim() || null)
  })
  return () => {
    unobserve()
    useNpcDialogue.getState().setPlayerName(null)
    setNpcChatTransport(null)
    setNpcNameResolvers(null)
    useNpcRuntime.setState({ epoch: null, localPlayerId: 'local', engagements: {}, bubbles: {} })
  }
}
