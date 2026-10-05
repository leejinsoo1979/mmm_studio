'use client'

import { type NavPoint, sceneRegistry } from '@pascal-app/core'
import {
  AvatarReach,
  armPole,
  type BodyAnchors,
  createBodyAnchors,
  type EmoteId,
  estimateBodyAnchors,
  getRemotePlayerPose,
  isEmoteId,
  measureBodyAnchors,
  setWalkthroughBodyOverlay,
  triggerSFX,
  useAudio,
  useAvatarEmote,
  useWalkthroughFacing,
  useWalkthroughView,
} from '@pascal-app/editor'
import { characterStatus } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useReducer, useRef } from 'react'
import { type Group, type Object3D, Quaternion, Vector3 } from 'three'
import { type NpcBodyOverlay, npcBodyOverlays } from '../body/npc-body'
import type { NpcEngagement, NpcSocialAct } from '../types'
import {
  CHASE_TOASTS,
  chaseHudText,
  chaseOutcome,
  chaseProgress,
  resetChaseMinds,
  startleHop,
} from './chase'
import { npcNow } from './clock'
import { effectiveEngagement, heldByOther } from './engagement'
import { useNpcPlayUi } from './play-ui'
import {
  PHOTO_SNAP_AT,
  playerSocialEmote,
  resetSocialMinds,
  SOCIAL_CONTACT,
  socialArmGoals,
  socialProgress,
  socialStance,
} from './social'
import { npcPoses, npcWorldFeet, useNpcRuntime } from './store'

/**
 * What the friendly gestures and the "왁!" chase look and sound like on this
 * client: the arms reaching (the NPC's from its engagement on every client,
 * the player's own on theirs), the player turned to face the NPC and playing
 * their part, the clap, the photo and its flash, the startled hop, and the
 * chase chip and notes. The menu starts them through the functions below.
 */

/** The walker's feet are this far below the controller's centre. */
const FEET_BELOW_CENTER = 1.15
/** Other players hear a clap within this distance (m). */
const HEAR_DISTANCE = 10
const HUD_INTERVAL_MS = 100
const PHOTO_TOAST_MS = 10_000
const SHOUT_MS = 1200

const SAY = {
  follow: '네, 따라갈게요!',
  stay: '그럼 여기 있을게요',
  shout: '왁!',
  photo: '사진을 찍었어요',
  photoFailed: '사진을 저장하지 못했어요',
}

// ─── Where things are ────────────────────────────────────────────────

const playerWorld = new Vector3()
const levelTurn = new Quaternion()
const levelForward = new Vector3()

/** The walker's feet in world space. */
function playerFeet(out = playerWorld): Vector3 {
  return out.copy(characterStatus.position).setY(characterStatus.position.y - FEET_BELOW_CENTER)
}

/** The walker's feet in `levelId`'s plan, or null when the level isn't there. */
export function playerOnLevel(levelId: string): NavPoint | null {
  const level = sceneRegistry.nodes.get(levelId)
  if (!level) return null
  const local = level.worldToLocal(playerFeet(new Vector3()))
  return [local.x, local.z]
}

/** How far a level's plan is turned in the world (rad about +Y). */
function levelYaw(levelId: string): number {
  const level = sceneRegistry.nodes.get(levelId)
  if (!level) return 0
  level.getWorldQuaternion(levelTurn)
  levelForward.set(0, 0, 1).applyQuaternion(levelTurn)
  return Math.atan2(levelForward.x, levelForward.z)
}

const facing = (from: Readonly<NavPoint>, to: Readonly<NavPoint>) =>
  Math.atan2(to[0] - from[0], to[1] - from[1])

// ─── Starting things (the menu) ──────────────────────────────────────

let stageCanvas: HTMLCanvasElement | null = null

/** Takes the mouse back for looking round in first person (after a menu click). */
export function resumeWalkthroughPointer() {
  if (useWalkthroughView.getState().view !== 'first' || !stageCanvas) return
  try {
    const request = stageCanvas.requestPointerLock?.() as unknown
    if (request instanceof Promise) request.catch(() => {})
  } catch {
    // The browser may refuse without a fresh gesture; a click on the scene takes it back.
  }
}

type Start = {
  me: string
  now: number
  levelId: string
  npcP: NavPoint
  npcYaw: number
  player: NavPoint
}

function startOf(npcId: string): Start | null {
  const { localPlayerId: me, engagements } = useNpcRuntime.getState()
  const now = npcNow()
  if (heldByOther(engagements[npcId], me, now)) return null
  const pose = npcPoses.get(npcId)
  if (!pose) return null
  const player = playerOnLevel(pose.levelId)
  if (!player) return null
  return { me, now, levelId: pose.levelId, npcP: [pose.p[0], pose.p[1]], npcYaw: pose.yaw, player }
}

/** The NPC walks up to the player and the two share `act`. */
export function startNpcSocialAct(npcId: string, act: NpcSocialAct): boolean {
  const start = startOf(npcId)
  if (!start) return false
  const toNpc = facing(start.player, start.npcP)
  useNpcRuntime.getState().setEngagement(npcId, {
    m: 'social',
    by: start.me,
    at: start.now,
    p: socialStance(act, start.player, toNpc),
    yaw: toNpc + Math.PI,
    act,
  })
  return true
}

/** "왁!": the player shouts, the NPC jumps and the game of tag begins. */
export function startNpcSurprise(npcId: string): boolean {
  const start = startOf(npcId)
  if (!start) return false
  useNpcRuntime.getState().setEngagement(npcId, {
    m: 'chase',
    by: start.me,
    at: start.now,
    p: start.npcP,
    ph: 'startle',
    pt: start.now,
  })
  useAvatarEmote.getState().play('hooray')
  useNpcPlayUi.getState().shout()
  return true
}

/** The NPC follows the player around, or stops where it is. */
export function setNpcFollowing(npcId: string, follow: boolean): boolean {
  const start = startOf(npcId)
  if (!start) return false
  const runtime = useNpcRuntime.getState()
  runtime.setEngagement(
    npcId,
    follow
      ? { m: 'follow', by: start.me, at: start.now, p: start.npcP }
      : { m: 'free', at: start.now, p: start.npcP },
  )
  runtime.say(npcId, follow ? SAY.follow : SAY.stay, 2500)
  return true
}

// ─── Sound ───────────────────────────────────────────────────────────

let audio: AudioContext | null = null

/** A hand clap (a few close cracks of filtered noise) or a soft knuckle tap, made on the spot. */
function playContact(kind: 'clap' | 'tap') {
  const { masterVolume, sfxVolume, muted } = useAudio.getState()
  const volume = muted ? 0 : (masterVolume / 100) * (sfxVolume / 100)
  if (volume <= 0 || typeof window === 'undefined' || !('AudioContext' in window)) return
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    const context = audio
    const rate = context.sampleRate
    const length = Math.floor(rate * 0.16)
    const buffer = context.createBuffer(1, length, rate)
    const data = buffer.getChannelData(0)
    const cracks = kind === 'clap' ? [0, 0.007, 0.016] : [0]
    const decay = kind === 'clap' ? 0.016 : 0.012
    for (const [index, start] of cracks.entries()) {
      const from = Math.floor(start * rate)
      const level = 1 / (1 + index * 0.8)
      for (let i = from; i < length; i++) {
        data[i]! += (Math.random() * 2 - 1) * level * Math.exp(-(i - from) / (decay * rate))
      }
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = kind === 'clap' ? 1500 : 420
    filter.Q.value = kind === 'clap' ? 0.8 : 1.2
    const gain = context.createGain()
    gain.gain.value = volume * (kind === 'clap' ? 1.4 : 1.8)
    source.connect(filter).connect(gain).connect(context.destination)
    source.start()
  } catch {
    // No sound is fine.
  }
}

// ─── The bodies ──────────────────────────────────────────────────────

/** Bodies measured this frame, for the other side of a gesture. */
const npcAnchors = new Map<string, BodyAnchors>()
let localAnchors: BodyAnchors | null = null
const estimated = createBodyAnchors()
const estimatedNpc = createBodyAnchors()
const remoteFeet = new Vector3()
const npcFeetAt = new Vector3()
const poleAt = new Vector3()

const reaches = new WeakMap<Object3D, AvatarReach>()
const reachOf = (model: Object3D) => {
  let reach = reaches.get(model)
  if (!reach) {
    reach = new AvatarReach(model)
    reaches.set(model, reach)
  }
  return reach
}

type Gesture = { npcId: string; engagement: Extract<NpcEngagement, { m: 'social' }> }

/** The gestures going on this frame, by NPC. */
const gestures = new Map<string, Gesture>()
/** The local player's own gesture, if any. */
let myGesture: Gesture | null = null

/** The engaging player's body: the walker's measured one, else guessed from their presence. */
function playerAnchorsFor(by: string): BodyAnchors | null {
  if (by === useNpcRuntime.getState().localPlayerId) {
    if (localAnchors) return localAnchors
    const forward = new Vector3(0, 0, 1).applyQuaternion(characterStatus.quaternion)
    return estimateBodyAnchors(playerFeet(), Math.atan2(forward.x, forward.z), 1.75, estimated)
  }
  const remote = getRemotePlayerPose(by)
  if (!remote) return null
  remoteFeet.set(remote.position[0], remote.position[1], remote.position[2])
  return estimateBodyAnchors(remoteFeet, remote.yaw, 1.75, estimated)
}

/** An NPC's body: measured by its overlay, else guessed from where it stands. */
function npcAnchorsFor(npcId: string): BodyAnchors | null {
  const measured = npcAnchors.get(npcId)
  if (measured) return measured
  const feet = npcWorldFeet.get(npcId)
  const pose = npcPoses.get(npcId)
  if (!(feet && pose)) return null
  npcFeetAt.set(feet[0], feet[1], feet[2])
  return estimateBodyAnchors(npcFeetAt, pose.yaw + levelYaw(pose.levelId), 1.7, estimatedNpc)
}

/** Seconds into the gesture's choreography, or null while the NPC still walks to its spot. */
function gestureTime(gesture: Gesture, now: number): number | null {
  const progress = socialProgress(gesture.npcId, now)
  if (
    !progress?.arrivedAt ||
    progress.key !== `${gesture.engagement.at}|${gesture.engagement.act}`
  ) {
    return null
  }
  return (now - progress.arrivedAt) / 1000
}

function poseArms(
  model: Object3D,
  who: 'npc' | 'player',
  self: BodyAnchors,
  other: BodyAnchors,
  gesture: Gesture,
) {
  const t = gestureTime(gesture, npcNow())
  if (t === null) return
  const reach = reachOf(model)
  for (const goal of socialArmGoals(
    gesture.engagement.act,
    t,
    who === 'npc' ? self : other,
    who === 'npc' ? other : self,
  )) {
    if (goal.who !== who) continue
    reach.reach(goal.side, goal.target, armPole(self, goal.side, poleAt), goal.weight)
    reach.fist(goal.side, goal.fist)
  }
}

/** The NPC's side of its gesture (on every client), and its startled hop. */
function overlayFor(npcId: string): NpcBodyOverlay {
  return {
    pose: (model) => {
      reachOf(model).begin()
      const self = measureBodyAnchors(model, npcAnchors.get(npcId) ?? createBodyAnchors())
      if (!self) return
      npcAnchors.set(npcId, self)
      const gesture = gestures.get(npcId)
      if (!gesture) return
      const other = playerAnchorsFor(gesture.engagement.by)
      if (other) poseArms(model, 'npc', self, other, gesture)
    },
  }
}

/** The walker's side of their gesture. */
const playerOverlay = (model: Object3D) => {
  reachOf(model).begin()
  const self = measureBodyAnchors(model, localAnchors ?? createBodyAnchors())
  if (!self) return
  localAnchors = self
  const gesture = myGesture
  if (!gesture) return
  const other = npcAnchorsFor(gesture.npcId)
  if (other) poseArms(model, 'player', self, other, gesture)
}

// ─── The stage ───────────────────────────────────────────────────────

/** What this client has done for a gesture or a chase step (keyed by the engagement). */
type Beat = {
  key: string
  emoted: boolean
  contact: boolean
  photo: boolean
}

type ChaseSeen = { key: string; ph: string }

/** The bubble over the walker after "왁!" (third person; first person shows it on screen). */
function ShoutBubble() {
  const shoutAt = useNpcPlayUi((state) => state.shoutAt)
  const third = useWalkthroughView((state) => state.view === 'third')
  const group = useRef<Group>(null)
  const [, expire] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    const left = shoutAt + SHOUT_MS - Date.now()
    if (left <= 0) return
    const timer = window.setTimeout(expire, left)
    return () => window.clearTimeout(timer)
  }, [shoutAt])
  useFrame(() => {
    group.current?.position.copy(characterStatus.position).setY(characterStatus.position.y + 0.95)
  })
  if (!third || Date.now() - shoutAt > SHOUT_MS) return null
  return (
    <group ref={group}>
      <Html center style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[20, 0]}>
        <div className="w-max rounded-2xl bg-white px-3 py-1.5 font-bold text-[18px] text-neutral-900 shadow-lg">
          {SAY.shout}
        </div>
      </Html>
    </group>
  )
}

/**
 * Plays the gestures and chases (mounted by the NPC system while the scene
 * is walked). Before the bodies each frame it sets their overlays, turns the
 * walker and plays their part; after the frame is drawn it takes the photo.
 */
export function NpcSocialStage() {
  const gl = useThree((state) => state.gl)
  const beats = useRef(new Map<string, Beat>())
  const chases = useRef(new Map<string, ChaseSeen>())
  const faced = useRef(false)
  const hudAt = useRef(0)
  const snap = useRef(false)

  useEffect(() => {
    stageCanvas = gl.domElement
    return () => {
      if (stageCanvas === gl.domElement) stageCanvas = null
    }
  }, [gl])

  useEffect(
    () => () => {
      // Leaving the walk lets go of what this player holds.
      const runtime = useNpcRuntime.getState()
      const now = npcNow()
      for (const [npcId, engagement] of Object.entries(runtime.engagements)) {
        if (
          (engagement.m === 'social' || engagement.m === 'chase') &&
          engagement.by === runtime.localPlayerId
        ) {
          const p = npcPoses.get(npcId)?.p ?? engagement.p
          runtime.setEngagement(npcId, { m: 'free', at: now, p: [p[0], p[1]] })
        }
      }
      for (const npcId of gestures.keys()) npcBodyOverlays.delete(npcId)
      for (const npcId of chases.current.keys()) npcBodyOverlays.delete(npcId)
      gestures.clear()
      npcAnchors.clear()
      myGesture = null
      localAnchors = null
      setWalkthroughBodyOverlay(null)
      if (faced.current) useWalkthroughFacing.getState().release()
      const ui = useNpcPlayUi.getState()
      ui.setHud(null)
      ui.closeMenu()
      resetSocialMinds()
      resetChaseMinds()
    },
    [],
  )

  useFrame(() => {
    const now = npcNow()
    const runtime = useNpcRuntime.getState()
    const me = runtime.localPlayerId
    const seen = new Set<string>()
    let mine: Gesture | null = null
    let hud: string | null = null

    for (const [npcId, stored] of Object.entries(runtime.engagements)) {
      const engagement = effectiveEngagement(stored, now)
      if (!engagement || (engagement.m !== 'social' && engagement.m !== 'chase')) continue
      seen.add(npcId)
      let overlay = npcBodyOverlays.get(npcId)
      if (!overlay) {
        overlay = overlayFor(npcId)
        npcBodyOverlays.set(npcId, overlay)
      }

      if (engagement.m === 'social') {
        const gesture: Gesture = { npcId, engagement }
        gestures.set(npcId, gesture)
        overlay.root = undefined
        const t = gestureTime(gesture, now)
        const key = `${engagement.at}|${engagement.act}`
        let beat = beats.current.get(npcId)
        if (beat?.key !== key) {
          beat = { key, emoted: false, contact: false, photo: false }
          beats.current.set(npcId, beat)
        }
        const owner = engagement.by === me
        if (owner) mine = gesture
        if (t === null) continue
        const contact = SOCIAL_CONTACT[engagement.act]
        if (contact && !beat.contact && t >= contact.at) {
          beat.contact = true
          const feet = npcWorldFeet.get(npcId)
          const near =
            feet &&
            playerFeet().distanceTo(npcFeetAt.set(feet[0], feet[1], feet[2])) < HEAR_DISTANCE
          if (owner || near) playContact(contact.sound)
        }
        if (!owner) continue
        if (!beat.emoted) {
          beat.emoted = true
          const progress = socialProgress(npcId, now)
          const id = playerSocialEmote(engagement.act, progress?.style)
          if (id && isEmoteId(id) && progress?.arrivedAt) {
            useAvatarEmote.setState({ emote: { id: id as EmoteId, at: progress.arrivedAt } })
          }
        }
        if (engagement.act === 'photo' && !beat.photo && t >= PHOTO_SNAP_AT) {
          beat.photo = true
          snap.current = true
        }
      } else {
        gestures.delete(npcId)
        const progress = chaseProgress(npcId, now)
        overlay.root =
          progress?.ph === 'startle' ? [0, startleHop((now - progress.pt) / 1000), 0] : undefined
        if (engagement.by !== me) continue
        const key = `${engagement.ph}|${engagement.pt}`
        const before = chases.current.get(npcId)
        if (before?.key !== key) {
          chases.current.set(npcId, { key, ph: engagement.ph })
          const ui = useNpcPlayUi.getState()
          if (before?.ph === 'npc' && engagement.ph === 'player') ui.showToast(CHASE_TOASTS.caught)
          if (engagement.ph === 'end') {
            const outcome = chaseOutcome(
              before ? (before.ph as typeof engagement.ph) : null,
              engagement.won,
            )
            if (outcome !== 'gone') ui.showToast(CHASE_TOASTS[outcome])
          }
        }
        const feet = npcWorldFeet.get(npcId)
        const walker = playerFeet()
        const distance = feet ? Math.hypot(walker.x - feet[0], walker.z - feet[2]) : null
        hud = chaseHudText(engagement.ph, distance, now - engagement.pt)
      }
    }

    for (const npcId of [...gestures.keys()]) if (!seen.has(npcId)) gestures.delete(npcId)
    for (const npcId of [...npcBodyOverlays.keys()]) {
      if (seen.has(npcId)) continue
      npcBodyOverlays.delete(npcId)
      npcAnchors.delete(npcId)
      beats.current.delete(npcId)
      chases.current.delete(npcId)
    }

    // The walker's side: face the NPC, stay put (a step lets the NPC go), reach.
    const facingStore = useWalkthroughFacing.getState()
    const previous = myGesture
    myGesture = mine
    if (mine) {
      const engagement = mine.engagement
      const moved =
        characterStatus.inputDir.lengthSq() > 0 || (faced.current && facingStore.yaw === null)
      if (moved) {
        const p = npcPoses.get(mine.npcId)?.p ?? engagement.p
        runtime.setEngagement(mine.npcId, { m: 'free', at: now, p: [p[0], p[1]] })
      } else {
        const levelId = npcPoses.get(mine.npcId)?.levelId
        const yaw = engagement.yaw + Math.PI + (levelId ? levelYaw(levelId) : 0)
        if (facingStore.yaw === null || Math.abs(Math.sin((facingStore.yaw - yaw) / 2)) > 0.005) {
          facingStore.face(yaw)
        }
        faced.current = true
      }
      setWalkthroughBodyOverlay(playerOverlay)
    } else if (previous) {
      setWalkthroughBodyOverlay(null)
      localAnchors = null
      if (faced.current && facingStore.yaw !== null) facingStore.release()
      faced.current = false
      // A shared dance stops with the gesture.
      const emote = useAvatarEmote.getState().emote
      const danced = emote && (emote.id === 'danceGroove' || emote.id === 'danceSilly')
      if (danced && previous.engagement.act === 'dance') useAvatarEmote.getState().stop()
    }

    if (now - hudAt.current >= HUD_INTERVAL_MS || hud === null) {
      hudAt.current = now
      useNpcPlayUi.getState().setHud(hud)
    }
  }, -0.4)

  // After the frame is drawn (the viewer draws at priority 1): the photo.
  useFrame(({ gl: renderer }) => {
    if (!snap.current) return
    snap.current = false
    triggerSFX('sfx:snapshot-capture')
    const ui = useNpcPlayUi.getState()
    ui.flash()
    try {
      const photo = renderer.domElement.toDataURL('image/png')
      ui.showToast(SAY.photo, PHOTO_TOAST_MS, photo)
    } catch {
      ui.showToast(SAY.photoFailed)
    }
  }, 2)

  return <ShoutBubble />
}
