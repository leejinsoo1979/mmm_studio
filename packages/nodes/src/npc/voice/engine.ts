import { type AnyNodeId, useScene } from '@pascal-app/core'
import { characterStatus, useViewer } from '@pascal-app/viewer'
import { Quaternion, Vector3 } from 'three'
import { create } from 'zustand'
import { getNpcChatTransport } from '../dialogue/chat-transport'
import { npcWorldFeet } from '../runtime/store'
import type { NpcNode } from '../schema'
import type { NpcChatTransport, NpcSpeaking, NpcSpeechRequest } from '../types'
import { followMouth, rmsMouthLevel, speechMouthLevel } from './lip'
import { speaksNow, speechTimeoutMs } from './queue'
import { npcVoicePitch, pickNpcVoice, speechChunks } from './voices'

/**
 * NPC voices. A line is said with the browser's speech synthesis (free, no
 * key) or, when the server voices NPCs, with its audio played through WebAudio
 * from the NPC's head; a line the server won't voice goes to the browser. One
 * NPC speaks at a time (queue.ts), and its mouth level goes into `npcSpeaking`
 * every frame for the body's jaw.
 */

/** Mouth level of every speaking NPC, written each frame while it speaks; the body's jaw reads it. */
export const npcSpeaking = new Map<string, NpcSpeaking>()

/** The walker's controller reports its capsule centre, this far above its feet (m). */
const WALKER_CENTER_HEIGHT = 1.15
/** Within this distance (m) the server voice plays at full volume. */
const FULL_VOLUME_DISTANCE = 2
/** Server lines kept decoded, for barks and lines said again. */
const CLIP_CACHE_SIZE = 24
const ANALYSER_SIZE = 1024
/** How long the transport's answer on which engine voices NPCs is trusted (ms). */
const STATUS_MS = 60_000
/** Lines the server wouldn't voice, remembered (up to this many) so they go straight to the browser. */
const REFUSED_SIZE = 64
const MUTED_KEY = 'mmm-npc-voice-muted'

type Speech = {
  npcId: string
  kind: NpcSpeechRequest['kind']
  mouth: NpcSpeaking
  /** Cancels the server voice's request. */
  abort: AbortController
  /** When the voice was first heard (performance.now ms); null while it is prepared. */
  startedAt: number | null
  /** The browser voice's last word boundary. */
  wordAt: number | null
  /** The browser voice's utterances, held until they end: Chrome drops a collected one's events. */
  utterances: SpeechSynthesisUtterance[]
  /** The server voice, playing. */
  audio: { source: AudioBufferSourceNode; analyser: AnalyserNode; panner: PannerNode } | null
  timeout: ReturnType<typeof setTimeout>
}

let current: Speech | null = null
let audio: AudioContext | null = null
let gestured = false
const clips = new Map<string, AudioBuffer>()
const refused = new Set<string>()
let serverVoice: { transport: NpcChatTransport; at: number; on: Promise<boolean> } | null = null
/** The last status said the server voices NPCs. */
let serverVoiceOn = false

// Storage can throw (private mode, blocked site data): the voices are then on, and unremembered.
function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

function writeMuted(muted: boolean) {
  try {
    globalThis.localStorage?.setItem(MUTED_KEY, muted ? '1' : '0')
  } catch {
    // Kept for this page only.
  }
}

const useVoiceMuted = create<{ muted: boolean }>()(() => ({ muted: readMuted() }))

/**
 * Browsers keep a page silent until its first gesture (E counts). iOS also
 * wants the first utterance, and each resume of the audio context, inside one:
 * hence the silent utterance, and the resume on every gesture.
 */
function onGesture() {
  if (!gestured) {
    gestured = true
    if ('speechSynthesis' in window) {
      // Chrome lists its voices only once asked.
      window.speechSynthesis.getVoices()
      const silent = new SpeechSynthesisUtterance(' ')
      silent.volume = 0
      window.speechSynthesis.speak(silent)
    }
  }
  const context = serverVoiceOn ? audioContext() : audio
  if (context?.state === 'suspended') context.resume().catch(() => {})
}

if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown', 'touchend']) {
    window.addEventListener(type, onGesture, { capture: true, passive: true })
  }
}

const activated = () => gestured || navigator.userActivation?.hasBeenActive === true

/**
 * Says a line aloud, unless the voices are muted, the NPC's voice is off or the
 * page has had no gesture yet. Callers voice only what this player hears: its
 * own conversation and its local barks (other players' talks stay bubbles).
 */
export function speakNpc(req: NpcSpeechRequest): void {
  if (typeof window === 'undefined' || useVoiceMuted.getState().muted || !activated()) return
  const text = req.text.trim()
  const node = readNpc(req.npcId)
  if (!text || !node?.voice.enabled) return
  const distance = req.kind === 'bark' ? (offsetFromWalker(req.npcId)?.length() ?? null) : null
  if (!speaksNow(current, req, distance)) return

  stopNpcSpeech()
  const speech: Speech = {
    npcId: req.npcId,
    kind: req.kind,
    mouth: { level: 0 },
    abort: new AbortController(),
    startedAt: null,
    wordAt: null,
    utterances: [],
    audio: null,
    timeout: setTimeout(
      () => {
        if (current === speech) stopNpcSpeech()
      },
      speechTimeoutMs(text, node.voice.rate),
    ),
  }
  current = speech
  // Present while the line is still being fetched, so the conversation waits for its voice.
  npcSpeaking.set(speech.npcId, speech.mouth)
  requestFrame()
  void voice(speech, node, text, req.token)
}

/** Stops one NPC's speech, or whoever is speaking. */
export function stopNpcSpeech(npcId?: string): void {
  const speech = current
  if (!speech || (npcId !== undefined && speech.npcId !== npcId)) return
  current = null
  if (speech.utterances.length > 0) window.speechSynthesis.cancel()
  release(speech)
}

/** Mutes every NPC, silencing the one speaking; remembered on this device. */
export function setNpcVoiceMuted(muted: boolean): void {
  useVoiceMuted.setState({ muted })
  writeMuted(muted)
  if (muted) stopNpcSpeech()
}

export function useNpcVoiceMuted(): boolean {
  return useVoiceMuted((state) => state.muted)
}

function readNpc(id: string): NpcNode | null {
  const node = useScene.getState().nodes[id as AnyNodeId] as unknown as NpcNode | undefined
  return node?.type === 'npc' ? node : null
}

async function voice(speech: Speech, node: NpcNode, text: string, token?: string) {
  const transport = getNpcChatTransport()
  if (transport && (await serverVoices(transport)) && current === speech) {
    if (await playServer(speech, node, text, token, transport)) return
  }
  if (current === speech) speakBrowser(speech, node, text)
}

/** Whether the server voices NPCs, asked once a minute rather than per line. */
function serverVoices(transport: NpcChatTransport): Promise<boolean> {
  const now = performance.now()
  if (!serverVoice || serverVoice.transport !== transport || now - serverVoice.at > STATUS_MS) {
    const on = transport.status().then(
      (status) => status.voice === 'server',
      () => false,
    )
    serverVoice = { transport, at: now, on }
    void on.then((value) => {
      serverVoiceOn = value
    })
  }
  return serverVoice.on
}

/** Plays the server's voice for the line; false when the browser should say it instead. */
async function playServer(
  speech: Speech,
  node: NpcNode,
  text: string,
  token: string | undefined,
  transport: NpcChatTransport,
): Promise<boolean> {
  const context = audioContext()
  if (!context) return false
  if (context.state !== 'running') {
    // It resumes on the next gesture; until then the browser voice speaks.
    context.resume().catch(() => {})
    return false
  }
  const key = [node.id, node.voice.voice, node.voice.rate, text].join('\n')
  if (refused.has(key)) return false
  let clip = clips.get(key)
  if (!clip) {
    const data = await transport
      .speak({ npcId: speech.npcId, text, token, signal: speech.abort.signal })
      .catch(() => undefined)
    if (current !== speech) return true
    // A failed request (undefined) may work next time; a refusal or bad audio won't.
    if (data === undefined) return false
    clip = data ? await context.decodeAudioData(data).catch(() => undefined) : undefined
    if (current !== speech) return true
    if (!clip) {
      if (refused.size >= REFUSED_SIZE) refused.clear()
      refused.add(key)
      return false
    }
  }
  clips.delete(key)
  clips.set(key, clip)
  if (clips.size > CLIP_CACHE_SIZE) clips.delete(clips.keys().next().value as string)

  const source = context.createBufferSource()
  source.buffer = clip
  const analyser = context.createAnalyser()
  analyser.fftSize = ANALYSER_SIZE
  const panner = context.createPanner()
  panner.panningModel = 'HRTF'
  panner.refDistance = FULL_VOLUME_DISTANCE
  place(panner, speech.npcId)
  source.connect(analyser)
  source.connect(panner).connect(context.destination)
  source.onended = () => finish(speech)
  speech.audio = { source, analyser, panner }
  speech.startedAt = performance.now()
  source.start()
  return true
}

function audioContext(): AudioContext | null {
  if (!audio && typeof AudioContext !== 'undefined') audio = new AudioContext()
  return audio
}

function speakBrowser(speech: Speech, node: NpcNode, text: string) {
  if (!('speechSynthesis' in window)) {
    finish(speech)
    return
  }
  const synth = window.speechSynthesis
  const voice = pickNpcVoice(synth.getVoices(), node.avatar, node.voice.voice)
  const pitch = npcVoicePitch(node.avatar, node.voice.pitch)
  const chunks = speechChunks(text)
  speech.utterances = chunks.map((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk)
    utterance.lang = 'ko-KR'
    utterance.voice = voice
    utterance.pitch = pitch
    utterance.rate = node.voice.rate
    utterance.onstart = () => {
      speech.startedAt ??= performance.now()
    }
    utterance.onboundary = (event) => {
      if (event.name !== 'sentence') speech.wordAt = performance.now()
    }
    utterance.onerror = () => finish(speech)
    if (i === chunks.length - 1) utterance.onend = () => finish(speech)
    return utterance
  })
  for (const utterance of speech.utterances) synth.speak(utterance)
}

/** The line ended by itself (or failed). */
function finish(speech: Speech) {
  if (current !== speech) return
  current = null
  release(speech)
}

function release(speech: Speech) {
  clearTimeout(speech.timeout)
  speech.abort.abort()
  npcSpeaking.delete(speech.npcId)
  if (speech.audio) {
    speech.audio.source.onended = null
    speech.audio.source.stop()
    speech.audio.source.disconnect()
    speech.audio.panner.disconnect()
  }
}

const offset = new Vector3()
const facing = new Quaternion()

/**
 * The NPC's feet from the walker's, in world axes, or null outside play. The
 * NPC's mouth and the walker's ears are both about 1.6 m above their feet, so
 * this is also where the voice comes from.
 */
function offsetFromWalker(npcId: string): Vector3 | null {
  const feet = npcWorldFeet.get(npcId)
  if (!feet || !useViewer.getState().walkthroughMode) return null
  const walker = characterStatus.position
  return offset.set(
    feet[0] - walker.x,
    feet[1] - walker.y + WALKER_CENTER_HEIGHT,
    feet[2] - walker.z,
  )
}

/** Puts the server voice at the NPC's head as the walker hears it; straight ahead outside play
 *  (an inspector preview). */
function place(panner: PannerNode, npcId: string) {
  const heard = offsetFromWalker(npcId)?.applyQuaternion(
    facing.copy(characterStatus.quaternion).invert(),
  )
  // The walker faces +Z with +X on its left; the WebAudio listener faces -Z with +X on its right.
  panner.positionX.value = heard ? -heard.x : 0
  panner.positionY.value = heard ? heard.y : 0
  panner.positionZ.value = heard ? -heard.z : -1
}

const samples = new Float32Array(ANALYSER_SIZE)
let frame = 0
let frameAt = 0

function requestFrame() {
  if (frame !== 0) return
  frameAt = performance.now()
  frame = requestAnimationFrame(tick)
}

function tick(now: number) {
  frame = 0
  const speech = current
  if (!speech) return
  const dt = Math.min(0.1, Math.max(0, now - frameAt) / 1000)
  frameAt = now
  speech.mouth.level = followMouth(speech.mouth.level, mouthTarget(speech, now), dt)
  if (speech.audio) place(speech.audio.panner, speech.npcId)
  frame = requestAnimationFrame(tick)
}

function mouthTarget(speech: Speech, now: number): number {
  if (speech.startedAt === null) return 0
  if (!speech.audio) {
    const sinceWord =
      speech.wordAt === null ? Number.POSITIVE_INFINITY : (now - speech.wordAt) / 1000
    return speechMouthLevel((now - speech.startedAt) / 1000, sinceWord)
  }
  speech.audio.analyser.getFloatTimeDomainData(samples)
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return rmsMouthLevel(Math.sqrt(sum / samples.length))
}
