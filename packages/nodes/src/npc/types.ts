import type { NpcAi, NpcNode } from './schema'

/**
 * Runtime contracts shared by the NPC modules: the pose the system writes and
 * the body plays, the engagements players share through the world doc, the
 * stores other packages read, and the app-injected chat / voice transport.
 * Types only, so server code may import them.
 */

// ─── Pose ────────────────────────────────────────────────────────────

/** What the NPC is doing, for the body's animation. */
export type NpcPoseState =
  | 'idle'
  | 'walk'
  | 'talk'
  | 'follow'
  | 'guide'
  | 'social'
  | 'startled'
  | 'chase'
  | 'flee'

/** An emote the body plays from `at` (shared ms clock), so every client starts it together.
 *  Unknown ids are ignored (`isEmoteId`). */
export type NpcEmoteCue = { id: string; at: number }

/** An NPC this frame, written to `npcPoses` by the system before the bodies run. */
export type NpcPose = {
  levelId: string
  /** Level-local XZ of the feet. */
  p: [number, number]
  /** Level-local floor height under the feet (the nav cell's). */
  y: number
  /** Body facing, rad about +Y, 0 = +Z (as presence). */
  yaw: number
  /** Ground speed (m/s); drives the gait blend. */
  speed: number
  state: NpcPoseState
  emote: NpcEmoteCue | null
  /** World point the head turns to (a local overlay), or none. */
  lookAt: [number, number, number] | null
  /** False when culled (LOD) or not on a shown level. */
  visible: boolean
}

// ─── Engagements (shared as world entries `npc:<id>`) ────────────────

/** The friendly gestures a player can share with an NPC. The list is closed. */
export type NpcSocialAct =
  | 'highFive'
  | 'handshake'
  | 'fistBump'
  | 'shoulderPat'
  | 'hug'
  | 'dance'
  | 'photo'

/** The "왁!" game of tag: the NPC is startled, chases (`npc` is it), flees (`player` is it), ends. */
export type NpcChasePhase = 'startle' | 'npc' | 'player' | 'end'

/**
 * Who holds an NPC and how. `by` is the engaging player's id, `at` the shared
 * ms time it was written (refreshed while active; 120 s stale reads as
 * `free`), `p` the NPC's level-local XZ at that time. `free` releases the NPC:
 * its schedule walks it back from `p`. For `chase`, `pt` is when the current
 * phase started.
 */
export type NpcEngagement =
  | { m: 'talk'; by: string; at: number; p: [number, number]; yaw: number; line?: string }
  | { m: 'follow'; by: string; at: number; p: [number, number] }
  | { m: 'guide'; by: string; at: number; p: [number, number]; room: string; line?: string }
  | { m: 'social'; by: string; at: number; p: [number, number]; yaw: number; act: NpcSocialAct }
  | {
      m: 'chase'
      by: string
      at: number
      p: [number, number]
      ph: NpcChasePhase
      pt: number
      won?: 'npc' | 'player' | 'none'
    }
  | { m: 'free'; at: number; p: [number, number] }

export type NpcEngagementMode = NpcEngagement['m']

/** The engaging player's feet (level-local XZ and floor height) and facing. */
export type NpcPlayerPose = { p: [number, number]; y: number; yaw: number }

export type NpcEngagementContext<M extends NpcEngagementMode> = {
  npc: NpcNode
  engagement: Extract<NpcEngagement, { m: M }>
  /** The NPC's pose last frame (its schedule pose on the first). */
  pose: NpcPose
  /** The engaging player on the NPC's level, or null (gone, elsewhere, or a `free` anchor). */
  player: NpcPlayerPose | null
  /** The local player holds the engagement, so this client writes its transitions. */
  owner: boolean
  /** Shared clock (ms). */
  now: number
  /** Seconds since the last frame. */
  dt: number
}

/** What an engagement changes on the NPC's pose; the local overlays (look-at, greet,
 *  avoidance) apply after it. */
export type NpcPoseOverride = Partial<Omit<NpcPose, 'levelId' | 'visible'>>

/** One engagement kind's behaviour. The brain dispatches on `m`, so a new kind only adds
 *  its handler (runtime/social.ts, runtime/chase.ts). */
export type NpcEngagementHandler<M extends NpcEngagementMode> = (
  ctx: NpcEngagementContext<M>,
) => NpcPoseOverride

// ─── Runtime store (runtime/store.ts) ────────────────────────────────

/** A line over an NPC's head until `until` (local `Date.now()` ms). */
export type NpcBubble = { text: string; until: number }

/**
 * `useNpcRuntime`. Shared: the epoch and the engagements (the app mirrors them
 * into the world doc with `readNpcWorldEntries` / `applyNpcWorldEntry`).
 * Local: the bubbles.
 */
export type NpcRuntimeState = {
  /** Shared schedule origin (ms): the first player's join time; null until known. */
  epoch: number | null
  /** This player's id in engagements: the Firebase uid, or 'local' when signed out. */
  localPlayerId: string
  engagements: Record<string, NpcEngagement>
  bubbles: Record<string, NpcBubble>
  setEpoch(ms: number): void
  setLocalPlayerId(id: string): void
  setEngagement(npcId: string, engagement: NpcEngagement | null): void
  say(npcId: string, text: string, ms?: number): void
}

// ─── Dialogue store (dialogue/store.ts) ──────────────────────────────

/** `polite`: a goodbye choice, Esc or ✕ (the NPC waves). `walkedAway`: out of range (no wave).
 *  `preempted`: another player took the NPC. */
export type NpcDialogueCloseReason = 'polite' | 'walkedAway' | 'preempted'

/** The part of `useNpcDialogue` other modules use; the dialogue store adds the rest. */
export type NpcDialogueSurface = {
  /** The NPC the local player is talking to. */
  npcId: string | null
  /** The NPC's line on screen (streaming in AI chat), for its speech bubble. */
  line: string | null
  open(npcId: string): void
  close(reason?: NpcDialogueCloseReason): void
}

// ─── Chat and voice transport (dialogue/chat-transport.ts) ───────────

export type NpcChatTurn = { role: 'user' | 'assistant'; text: string }

export type NpcChatRequest = {
  npcId: string
  conversationId: string
  messages: NpcChatTurn[]
  context: { roomId?: string; levelId?: string }
  playerName?: string
  signal: AbortSignal
}

export type NpcChatErrorCode = 'unavailable' | 'rate_limited' | 'refusal' | 'upstream' | 'network'

/** `token` signs the finished reply so the server voice will speak it. */
export type NpcChatResult = { ok: true; token?: string } | { ok: false; code: NpcChatErrorCode }

/** How NPC lines are voiced: the browser's speech synthesis, or the server's TTS. */
export type NpcVoiceEngine = 'browser' | 'server'

export type NpcChatStatus = { available: boolean; reason?: string; voice: NpcVoiceEngine }

export type NpcVoiceRequest = { npcId: string; text: string; token?: string; signal: AbortSignal }

/** The app's bridge to its NPC routes (packages never know app URLs). */
export type NpcChatTransport = {
  status(): Promise<NpcChatStatus>
  send(req: NpcChatRequest, onDelta: (text: string) => void): Promise<NpcChatResult>
  /** Server TTS audio (mp3) for one line, or null when the server won't voice it. */
  speak(req: NpcVoiceRequest): Promise<ArrayBuffer | null>
}

// ─── Voice (voice/engine.ts) ─────────────────────────────────────────

/** A line to say aloud: `line` scripted, `bark` a greeting, `ai` an AI reply (with its token). */
export type NpcSpeechRequest = {
  npcId: string
  text: string
  kind: 'line' | 'bark' | 'ai'
  token?: string
}

/** Mouth opening (0..1) of a speaking NPC, written by the voice engine every frame. */
export type NpcSpeaking = { level: number }

// ─── Scene knowledge (knowledge/) ────────────────────────────────────

export type RoomFact = {
  id: string
  name: string
  levelId: string
  /** Floor area (m²), holes excluded. */
  area: number
  /** Level-local XZ. */
  centroid: [number, number]
  polygon: [number, number][]
  ceilingHeight?: number
  floorMaterial?: string
  wallMaterial?: string
  windows: number
  /** Rooms reached through a door. */
  doorsTo: string[]
  furniture: { name: string; count: number }[]
  cabinets: { family: string; variant: string; widthMm: number; finish: string }[]
  lights: number
}

export type LevelFact = { id: string; name: string; index: number; rooms: RoomFact[] }

export type SceneFacts = {
  buildings: number
  levels: LevelFact[]
  rooms: RoomFact[]
  /** Floor area of every room (m²). */
  totalArea: number
}

export type SceneFactsScope = NpcAi['sceneScope']

/** Korean names for catalog items and materials; the app injects its tables. */
export type NpcNameResolvers = {
  item(asset: { id: string; name: string }): string
  material(ref: string): string
}
