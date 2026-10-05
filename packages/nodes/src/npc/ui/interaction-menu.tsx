'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { avatarThumbnailUrl, triggerSFX, useWalkthroughView } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Download, X } from 'lucide-react'
import { useEffect, useReducer, useRef } from 'react'
import { useNpcDialogue } from '../dialogue/store'
import { NPC_ROLE_COLORS } from '../presets'
import { surpriseCooldownLeft } from '../runtime/chase'
import { npcNow } from '../runtime/clock'
import { effectiveEngagement, heldByOther } from '../runtime/engagement'
import { useNpcPlayUi } from '../runtime/play-ui'
import { type NpcMenuItem, npcMenuItems } from '../runtime/social'
import {
  playerOnLevel,
  resumeWalkthroughPointer,
  setNpcFollowing,
  startNpcSocialAct,
  startNpcSurprise,
} from '../runtime/social-stage'
import { npcPoses, useNpcRuntime } from '../runtime/store'
import { NPC_ROLE_LABELS, type NpcNode } from '../schema'
import { choiceKeyIndex, useNpcKeyCapture } from './choice-list'

/** The menu closes when the player walks this much (m) beyond the NPC's range. */
const WALK_AWAY_MARGIN = 1.5
/** How often (ms) the menu re-reads where everyone stands. */
const MENU_REFRESH_MS = 250
const FLASH_MS = 450
const SHOUT_MS = 1200

/** Opens the E menu of `npcId` and frees the mouse to click it. */
export function openNpcMenu(npcId: string) {
  useNpcPlayUi.getState().openMenu(npcId)
  if (document.pointerLockElement) document.exitPointerLock()
}

function useTicker(ms: number) {
  const [, tick] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    const timer = window.setInterval(tick, ms)
    return () => window.clearInterval(timer)
  }, [ms])
}

function choose(node: NpcNode, item: NpcMenuItem) {
  if (!item.enabled) return
  triggerSFX('sfx:menu-click')
  useNpcPlayUi.getState().closeMenu()
  switch (item.action) {
    case 'talk':
      useNpcDialogue.getState().open(node.id)
      return
    case 'follow':
    case 'stopFollow':
      setNpcFollowing(node.id, item.action === 'follow')
      return
    case 'surprise':
      startNpcSurprise(node.id)
      break
    default:
      startNpcSocialAct(node.id, item.action)
  }
  resumeWalkthroughPointer()
}

function Menu({ node }: { node: NpcNode }) {
  useTicker(MENU_REFRESH_MS)
  const playerAvatar = useWalkthroughView((state) => state.character)
  const stored = useNpcRuntime((state) => state.engagements[node.id])
  const me = useNpcRuntime((state) => state.localPlayerId)
  const now = npcNow()
  const pose = npcPoses.get(node.id)
  const player = pose ? playerOnLevel(pose.levelId) : null
  const engagement = effectiveEngagement(stored, now)
  const items = npcMenuItems({
    talkable: node.interaction.talkable,
    npcAvatar: node.avatar,
    playerAvatar,
    busy: heldByOther(stored, me, now),
    following: engagement?.m === 'follow' && engagement.by === me,
    npc: pose ? { p: pose.p, yaw: pose.yaw } : null,
    player,
    surpriseCooldownMs: surpriseCooldownLeft(node.id, now),
  })

  const away =
    !(pose && player) ||
    Math.hypot(player[0] - pose.p[0], player[1] - pose.p[1]) >
      node.interaction.range + WALK_AWAY_MARGIN
  useEffect(() => {
    if (away) useNpcPlayUi.getState().closeMenu()
  }, [away])

  const itemsRef = useRef(items)
  itemsRef.current = items
  useNpcKeyCapture(true, (event) => {
    if (event.code === 'Escape' || event.code === 'KeyE') {
      useNpcPlayUi.getState().closeMenu()
      return true
    }
    const index = choiceKeyIndex(event.code)
    if (index === null) return false
    const item = itemsRef.current[index]
    if (item && !event.repeat) choose(node, item)
    return true
  })

  return (
    <div
      aria-label={`${node.name}에게 할 일`}
      className="dark pointer-events-auto fixed inset-x-0 bottom-24 z-[60] mx-auto flex max-h-[calc(100vh-140px)] w-[calc(100vw-24px)] max-w-[360px] flex-col gap-2 overflow-y-auto rounded-2xl border border-white/10 bg-[#141414]/85 p-3 text-white shadow-xl backdrop-blur-xl"
      role="menu"
    >
      <div className="flex items-center gap-2.5">
        <img
          alt=""
          className="size-9 shrink-0 rounded-full bg-white/10 object-cover"
          src={avatarThumbnailUrl(node.avatar)}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{node.name}</span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px] text-white"
          style={{ backgroundColor: NPC_ROLE_COLORS[node.role] }}
        >
          {NPC_ROLE_LABELS[node.role]}
        </span>
        <button
          aria-label="닫기"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
          onClick={() => useNpcPlayUi.getState().closeMenu()}
          title="닫기 (Esc)"
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
      <ol className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={item.action}>
            <button
              aria-disabled={!item.enabled}
              className={`flex min-h-10 w-full items-center gap-3 rounded-xl border border-white/10 px-3 py-1.5 text-left text-sm transition ${
                item.enabled
                  ? 'bg-white/5 text-white/90 hover:bg-white/15 active:bg-white/20'
                  : 'cursor-not-allowed bg-transparent text-white/40'
              }`}
              onClick={(event) => {
                event.currentTarget.blur()
                choose(node, item)
              }}
              role="menuitem"
              type="button"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/10 font-medium text-white/70 text-xs tabular-nums">
                {index < 9 ? index + 1 : 0}
              </span>
              <span className="flex min-w-0 flex-col">
                <span>{item.label}</span>
                {item.reason && <span className="text-[11px] text-white/45">{item.reason}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-white/40">숫자 선택 · E 또는 Esc 닫기</p>
    </div>
  )
}

/** The chase chip at the top centre ("도망쳐! 9.4m", "잡아라! 14초"). */
function ChaseChip() {
  const hud = useNpcPlayUi((state) => state.hud)
  if (!hud) return null
  return (
    <div className="dark pointer-events-none fixed inset-x-0 top-5 z-[60] mx-auto w-fit rounded-full border border-white/10 bg-[#141414]/85 px-4 py-1.5 font-semibold text-sm text-white tabular-nums shadow-xl backdrop-blur-xl">
      {hud}
    </div>
  )
}

/** A note, or the photo just taken with its save button. */
function Toast() {
  const toast = useNpcPlayUi((state) => state.toast)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(
      () => {
        if (useNpcPlayUi.getState().toast === toast) useNpcPlayUi.getState().hideToast()
      },
      Math.max(0, toast.until - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [toast])
  if (!toast) return null
  return (
    <div
      className={`dark fixed inset-x-0 top-16 z-[60] mx-auto flex w-fit max-w-[calc(100vw-24px)] items-center gap-3 rounded-2xl border border-white/10 bg-[#141414]/85 px-3 py-2 text-sm text-white shadow-xl backdrop-blur-xl ${
        toast.photo ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      role="status"
    >
      {toast.photo && (
        <img alt="찍은 사진" className="h-14 w-auto rounded-lg object-cover" src={toast.photo} />
      )}
      <span>{toast.text}</span>
      {toast.photo && (
        <>
          <a
            className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1.5 font-medium text-xs transition hover:bg-white/25"
            download={`사진_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`}
            href={toast.photo}
            onClick={() => useNpcPlayUi.getState().hideToast()}
          >
            <Download className="size-3.5" />
            사진 저장
          </a>
          <button
            aria-label="닫기"
            className="flex size-7 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
            onClick={() => useNpcPlayUi.getState().hideToast()}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

/** The camera's white flash. */
function Flash() {
  const flashAt = useNpcPlayUi((state) => state.flashAt)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!(element && flashAt) || Date.now() - flashAt > FLASH_MS) return
    element.style.transition = 'none'
    element.style.opacity = '0.9'
    const frame = requestAnimationFrame(() => {
      element.style.transition = `opacity ${FLASH_MS}ms ease-out`
      element.style.opacity = '0'
    })
    return () => cancelAnimationFrame(frame)
  }, [flashAt])
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[70] bg-white"
      ref={ref}
      style={{ opacity: 0 }}
    />
  )
}

/** "왁!" on screen in first person (third person shows it over the body). */
function Shout() {
  const shoutAt = useNpcPlayUi((state) => state.shoutAt)
  const first = useWalkthroughView((state) => state.view === 'first')
  const [, expire] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    const left = shoutAt + SHOUT_MS - Date.now()
    if (left <= 0) return
    const timer = window.setTimeout(expire, left)
    return () => window.clearTimeout(timer)
  }, [shoutAt])
  if (!first || Date.now() - shoutAt > SHOUT_MS) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[30%] z-[60] mx-auto w-fit rounded-2xl bg-white px-4 py-2 font-bold text-2xl text-neutral-900 shadow-xl">
      왁!
    </div>
  )
}

/**
 * Play mode's NPC overlay beside the dialogue panel: the E menu (talk and
 * the friendly gestures, numbered 1–9 and 0, Esc closes; keys are taken on
 * the window while it is open), the chase chip, notes and the photo to save,
 * the camera flash. Mounted by the app where it mounts `NpcDialoguePanel`.
 */
export function NpcInteractionMenu() {
  const walkthrough = useViewer((state) => state.walkthroughMode)
  const npcId = useNpcPlayUi((state) => state.menuNpcId)
  const talking = useNpcDialogue((state) => state.npcId !== null)
  const node = useScene((state) =>
    npcId ? (state.nodes[npcId as AnyNodeId] as unknown as NpcNode | undefined) : undefined,
  )

  useEffect(() => {
    if (npcId && !(walkthrough && node?.type === 'npc' && !talking)) {
      useNpcPlayUi.getState().closeMenu()
    }
  }, [npcId, walkthrough, node, talking])

  useEffect(() => {
    if (walkthrough) return
    const ui = useNpcPlayUi.getState()
    ui.setHud(null)
    ui.hideToast()
  }, [walkthrough])

  if (!walkthrough) return null
  return (
    <>
      {node?.type === 'npc' && !talking && <Menu key={node.id} node={node} />}
      <ChaseChip />
      <Toast />
      <Flash />
      <Shout />
    </>
  )
}
