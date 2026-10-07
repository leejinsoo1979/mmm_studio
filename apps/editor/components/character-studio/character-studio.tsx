'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import {
  ALL_AVATARS,
  type AvatarLook,
  type AvatarTab,
  applyFaceDrag,
  avatarLabel,
  avatarTab,
  avatarThumbnailUrl,
  canBindKey,
  DEFAULT_EMOTE_KEYS,
  EMOTE_CATEGORIES,
  EMOTE_IDS,
  EMOTES,
  type EmoteCategory,
  type EmoteCue,
  type EmoteId,
  FACE_HANDLE,
  type FaceHandleId,
  type FaceRegion,
  type FaceShape,
  keyLabel,
  loadHairStyles,
  MAX_CHARACTER_NAME,
  NO_LOOK,
  useAvatarProfile,
  useFaceTarget,
  useWalkthroughView,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Check, Eye, EyeOff, Keyboard, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiPhotoFraming } from '@/lib/ai-photo/client'
import { cn } from '@/lib/utils'
import { AiPhotoDialog } from './ai-photo-dialog'
import { download, stampedName } from './ai-photo-label'
import { lookOn } from './avatar-counterpart'
import { BasicInfoPanel } from './basic-info-panel'
import { BodyBody, BodyFooter } from './body-panel'
import { CategoryRail } from './category-rail'
import { FaceEditor } from './face-editor'
import { FaceRegionBody, FaceRegionFooter, regionHasChanges, resetRegion } from './face-shape-panel'
import { HairColorBody, HairStyleBody } from './hair-panel'
import { MakeupBody, MakeupFooter } from './makeup-panel'
import { randomLook } from './random-look'
import {
  COACH_WIDTH,
  DEFAULT_SCULPT,
  SculptBar,
  SculptCoach,
  type SculptOptions,
  stepRadius,
} from './sculpt-bar'
import { SlidePanel } from './slide-panel'
import {
  type SculptEvent,
  type SculptSettings,
  STUDIO_FILTERS,
  type StageView,
  type StudioFilterId,
  type StudioStageApi,
} from './stage-contract'
import { StageControls } from './stage-controls'
import { Chips, ColorPanel, FOCUS_RING, PanelSection } from './studio-controls'
import { EMOTE_ICONS, SKIN_SWATCHES } from './studio-data'
import {
  type BodyCategory,
  cardBeside,
  categoriesOf,
  categoryChanged,
  FACE_REGION_LABELS,
  FRONT_TABS,
  firstCategory,
  focusOf,
  freeRect,
  lookChips,
  type MakeupCategory,
  panelPushes,
  regionOfCategory,
  SHORT,
  STILL_TABS,
  type StudioTab,
  stageInsets,
  stagePose,
  studioTabs,
  TAB_FOCUS,
  type Viewport,
  WIDE,
} from './studio-layout'
import { StudioStage } from './studio-stage'
import { StudioTabs } from './studio-tabs'
import { StudioToolbar } from './studio-toolbar'
import { type StudioTarget, useCharacterStudio } from './use-character-studio'

type Draft = { avatar: string; look: AvatarLook; keys: Record<string, EmoteId> }

/** The longest NPC name (its node's schema). */
const MAX_NPC_NAME = 24

const PANEL_ID = 'studio-panel'
const FILTER_KEY = 'mmm-studio-filter'
const SCULPT_KEY = 'mmm-studio-sculpt'
const COACH_KEY = 'mmm-studio-sculpt-coach'
/** How long (ms) the coach mark waits for the camera to come in on the face. */
const COACH_DELAY = 1200

/** Browser storage that may be missing or refuse (private windows, blocked site data). */
const stored = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value)
    } catch {}
  },
}

function storedFilter(): StudioFilterId {
  const saved = stored.get(FILTER_KEY)
  return STUDIO_FILTERS.find(({ id }) => id === saved)?.id ?? 'realistic'
}

function storedSculpt(): SculptOptions {
  try {
    const saved = JSON.parse(stored.get(SCULPT_KEY) ?? 'null') as Partial<SculptOptions> | null
    if (!saved) return DEFAULT_SCULPT
    return {
      symmetric: typeof saved.symmetric === 'boolean' ? saved.symmetric : DEFAULT_SCULPT.symmetric,
      depth: typeof saved.depth === 'boolean' ? saved.depth : DEFAULT_SCULPT.depth,
      radiusScale:
        typeof saved.radiusScale === 'number'
          ? stepRadius(saved.radiusScale, 0)
          : DEFAULT_SCULPT.radiusScale,
    }
  } catch {
    return DEFAULT_SCULPT
  }
}

/** Digits first (in order), then the numpad, letters, the rest. */
function keyOrder(code: string) {
  if (code.startsWith('Digit')) return `0${code.slice(5) === '0' ? '9z' : code.slice(5)}`
  if (code.startsWith('Numpad')) return `1${code}`
  if (code.startsWith('Key')) return `2${code}`
  return `3${code}`
}

/** A value that follows `value` at most every `ms` (the last change always lands). */
function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    const wait = last.current + ms - performance.now()
    if (wait <= 0) {
      last.current = performance.now()
      setShown(value)
      return
    }
    const timer = window.setTimeout(() => {
      last.current = performance.now()
      setShown(value)
    }, wait)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return shown
}

function useViewport(): Viewport {
  const [size, setSize] = useState<Viewport>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  useEffect(() => {
    const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  return size
}

/** The base characters of one group, as tall full-body cards. */
function AvatarGallery({
  group,
  avatar,
  onPick,
}: {
  group: AvatarTab
  avatar: string
  onPick: (id: string) => void
}) {
  const avatars = useMemo(() => ALL_AVATARS.filter((entry) => avatarTab(entry) === group), [group])
  return (
    <div className="grid grid-cols-3 gap-x-2.5 gap-y-3">
      {avatars.map((entry) => {
        const selected = entry.id === avatar
        return (
          <button
            aria-pressed={selected}
            className={cn(
              'group flex min-w-0 flex-col items-center gap-1.5 rounded-2xl',
              FOCUS_RING,
            )}
            key={entry.id}
            onClick={() => onPick(entry.id)}
            title={avatarLabel(entry.id)}
            type="button"
          >
            <span
              className={cn(
                'relative w-full overflow-hidden rounded-2xl bg-gradient-to-b from-white/[0.09] to-white/[0.02] transition duration-200 ease-out motion-reduce:transition-none',
                selected
                  ? 'shadow-[0_0_0_4px_rgba(56,189,248,0.15)] ring-2 ring-sky-400'
                  : 'ring-1 ring-white/10 group-hover:ring-white/40',
              )}
            >
              <img
                alt=""
                className="aspect-[128/208] h-auto w-full object-contain transition duration-200 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
                loading="lazy"
                src={avatarThumbnailUrl(entry.id)}
              />
            </span>
            <span
              className={cn(
                'w-full truncate text-center text-[11px]',
                selected ? 'font-semibold text-white' : 'text-white/70',
              )}
            >
              {avatarLabel(entry.id)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

type Listening = { mode: 'rebind'; code: string } | { mode: 'new' } | null

/** The emotes to preview (and, with a key slot picked, to put on it). */
function EmoteGrid({
  keys,
  slot,
  preview,
  onPreview,
  onKeys,
}: {
  keys: Record<string, EmoteId>
  slot: string | null
  preview: EmoteId | null
  onPreview: (emote: EmoteId) => void
  onKeys: (keys: Record<string, EmoteId>) => void
}) {
  const [category, setCategory] = useState<EmoteCategory | 'all'>('all')
  const keyOf = useMemo(() => {
    const found: Partial<Record<EmoteId, string>> = {}
    for (const code of Object.keys(keys).sort((a, b) => keyOrder(a).localeCompare(keyOrder(b)))) {
      found[keys[code]!] ??= code
    }
    return found
  }, [keys])
  const emotes = EMOTE_IDS.filter((id) => category === 'all' || EMOTES[id].category === category)
  return (
    <div className="flex flex-col gap-4">
      <Chips
        label="동작 종류"
        onPick={setCategory}
        options={[{ id: 'all' as const, label: '전체' }, ...EMOTE_CATEGORIES]}
        value={category}
      />
      {slot && (
        <p className="rounded-xl bg-sky-400/10 px-3 py-2 text-[11px] text-sky-200">
          동작을 누르면 {keyLabel(slot)} 키에 들어가요
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {emotes.map((id) => {
          const emote = EMOTES[id]
          const Icon = EMOTE_ICONS[id]
          const bound = keyOf[id]
          const playing = preview === id
          return (
            <button
              aria-pressed={playing}
              className={cn(
                'relative flex flex-col items-center gap-1.5 rounded-2xl px-1 pt-3 pb-2 transition duration-200 ease-out motion-reduce:transition-none',
                FOCUS_RING,
                playing
                  ? 'bg-sky-400 text-neutral-950 shadow-[0_6px_16px_rgba(56,189,248,0.3)]'
                  : 'bg-white/[0.05] text-white/80 ring-1 ring-white/10 hover:bg-white/10',
              )}
              key={id}
              onClick={() => {
                onPreview(id)
                if (slot) onKeys({ ...keys, [slot]: id })
              }}
              type="button"
            >
              <span
                className={cn(
                  'grid size-9 place-items-center rounded-full',
                  playing ? 'bg-neutral-950/15' : 'bg-white/10 text-sky-300',
                )}
              >
                <Icon className="size-[18px]" />
              </span>
              <span className="w-full truncate text-center font-medium text-[11px]">
                {emote.label}
              </span>
              {emote.loop && (
                <span
                  className={cn(
                    'absolute top-1.5 left-1.5 rounded-full px-1 text-[9px]',
                    playing ? 'bg-neutral-950/15' : 'bg-white/10 text-white/55',
                  )}
                >
                  반복
                </span>
              )}
              {bound && (
                <span
                  className={cn(
                    'absolute top-1.5 right-1.5 rounded border px-1 font-mono text-[9px]',
                    playing ? 'border-neutral-950/30' : 'border-white/20 text-white/55',
                  )}
                >
                  {keyLabel(bound)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The game's emote keys: pick a slot to change its emote, its key to rebind it. */
function KeySlots({
  keys,
  slot,
  onSlot,
  onKeys,
  preview,
  onPreview,
  listening,
  setListening,
  keyMessage,
}: {
  keys: Record<string, EmoteId>
  slot: string | null
  onSlot: (code: string | null) => void
  preview: EmoteId | null
  onPreview: (emote: EmoteId) => void
  onKeys: (keys: Record<string, EmoteId>) => void
  listening: Listening
  setListening: (listening: Listening) => void
  keyMessage: string | null
}) {
  const slots = useMemo(
    () => Object.keys(keys).sort((a, b) => keyOrder(a).localeCompare(keyOrder(b))),
    [keys],
  )
  return (
    <PanelSection
      action={
        <button
          className={cn(
            'flex items-center gap-1 rounded-full bg-sky-400/15 px-2.5 py-1 font-medium text-[11px] text-sky-200 transition hover:bg-sky-400/25',
            FOCUS_RING,
          )}
          onClick={() => setListening({ mode: 'new' })}
          type="button"
        >
          <Plus className="size-3" /> 키 추가
        </button>
      }
      title="게임 단축키"
    >
      {listening && (
        <div className="flex items-center gap-2 rounded-xl bg-sky-400 px-3 py-2 text-[12px] text-neutral-950">
          <Keyboard className="size-4 shrink-0" />
          <span className="flex-1">
            {listening.mode === 'new'
              ? '새로 쓸 키를 눌러 주세요'
              : `${keyLabel(listening.code)} 대신 쓸 키를 눌러 주세요`}
          </span>
          <button
            className="rounded-full bg-neutral-950/15 px-2 py-0.5 text-[11px] hover:bg-neutral-950/25"
            onClick={() => setListening(null)}
            type="button"
          >
            취소
          </button>
        </div>
      )}
      {keyMessage && <p className="text-[11px] text-rose-400">{keyMessage}</p>}
      <div className="grid grid-cols-3 gap-1.5">
        {slots.map((code) => {
          const emote = EMOTES[keys[code]!]
          const Icon = EMOTE_ICONS[emote.id]
          const selected = slot === code
          return (
            <div
              className={cn(
                'group relative flex flex-col items-center gap-1 rounded-xl px-1 pt-2 pb-1.5 transition',
                selected
                  ? 'bg-sky-400/15 ring-2 ring-sky-400'
                  : 'bg-white/[0.05] ring-1 ring-white/10 hover:bg-white/10',
              )}
              key={code}
            >
              <button
                aria-label={`${keyLabel(code)} 키: ${emote.label}`}
                aria-pressed={selected}
                className={cn('absolute inset-0 rounded-xl', FOCUS_RING)}
                onClick={() => onSlot(selected ? null : code)}
                type="button"
              />
              <button
                className="relative z-10 min-w-7 rounded-md border border-white/25 border-b-2 bg-white/10 px-1.5 font-mono font-semibold text-[11px] text-white transition hover:border-sky-400 hover:text-sky-200"
                onClick={() => setListening({ mode: 'rebind', code })}
                title="키 바꾸기"
                type="button"
              >
                {keyLabel(code)}
              </button>
              <Icon className="pointer-events-none size-4 text-white/70" />
              <span className="pointer-events-none w-full truncate text-center text-[10px] text-white/65">
                {emote.label}
              </span>
              <button
                aria-label={`${keyLabel(code)} 키 비우기`}
                className="absolute top-1 right-1 z-10 hidden size-4 place-items-center rounded-full bg-white/15 text-white/70 hover:bg-rose-500/30 hover:text-rose-200 group-hover:grid"
                onClick={() => {
                  const next = { ...keys }
                  delete next[code]
                  if (slot === code) onSlot(null)
                  onKeys(next)
                }}
                type="button"
              >
                <X className="size-2.5" />
              </button>
            </div>
          )
        })}
      </div>
      {!slot && (
        <ul className="space-y-0.5 text-[11px] text-white/45 leading-4">
          <li>칸을 고른 뒤 동작을 누르면 그 키에 들어가요</li>
          <li>키 모양을 누르면 키를 바꿔요</li>
        </ul>
      )}
      {slot && (
        <EmoteGrid
          keys={keys}
          onKeys={onKeys}
          onPreview={onPreview}
          preview={preview}
          slot={slot}
        />
      )}
    </PanelSection>
  )
}

/** What may be typed into (or a slider moved) without the studio's keys taking over. */
const TYPING = 'input, textarea, select, [role="slider"], [contenteditable="true"]'

/** Keys the studio's own widgets need (roving tabs, radio rows): passed on to them. */
const WIDGET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

/** Keys the stage (turntable, zoom, the face handles) needs on top. */
const STAGE_KEYS = new Set([...WIDGET_KEYS, 'PageUp', 'PageDown', 'Enter', ' ', '+', '-', '=', '_'])

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The character studio, inZOI-style: the character full-bleed on a dark
 * stage, a toolbar and photo looks on top, who the character is on the
 * left, the tab's categories down the right with their options sliding in
 * beside them, the big tabs along the bottom, and 완료 to keep the result
 * (body, look, emote keys and name) for the game. In 얼굴 the face is
 * sculpted by its handles. For an NPC it edits that NPC's body, look and
 * name (no face photo, no keys), kept on its node as one undoable change.
 */
export function CharacterStudio() {
  const open = useCharacterStudio((state) => state.open)
  const target = useCharacterStudio((state) => state.target)
  if (!open) return null
  return <Studio key={target.kind === 'npc' ? target.nodeId : 'player'} target={target} />
}

function Studio({ target: studioTarget }: { target: StudioTarget }) {
  const npc = studioTarget.kind === 'npc' ? studioTarget : null
  const isNpc = npc !== null
  // A look saved before the studio kept a character's own hairstyle as its
  // own hair (null) may still name it: it opens as its own hair.
  const initial = useMemo<Draft>(() => {
    if (studioTarget.kind === 'npc') {
      const look = { ...(studioTarget.look ?? NO_LOOK), face: null }
      return { avatar: studioTarget.avatar, look: lookOn(look, studioTarget.avatar), keys: {} }
    }
    const avatar = useWalkthroughView.getState().character
    const { look, keys } = useAvatarProfile.getState()
    return { avatar, look: lookOn(look, avatar), keys }
  }, [studioTarget])
  const initialName = useMemo(
    () => (studioTarget.kind === 'npc' ? studioTarget.name : useAvatarProfile.getState().name),
    [studioTarget],
  )
  const tabs = studioTabs(isNpc)
  const viewport = useViewport()
  const wide = cardBeside(viewport)
  const pushes = panelPushes(viewport)
  const short = viewport.height < SHORT

  const [draft, setDraft] = useState<Draft>(initial)
  const [preview, setPreview] = useState<Draft | null>(null)
  const [past, setPast] = useState<Draft[]>([])
  const [future, setFuture] = useState<Draft[]>([])
  const [name, setName] = useState(initialName)
  const [tab, setTab] = useState<StudioTab>('preset')
  const [category, setCategory] = useState(() => firstCategory('preset', isNpc, initial.avatar))
  const [subs, setSubs] = useState<Record<string, string>>({})
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= WIDE)
  const [hovered, setHovered] = useState<string | null>(null)
  const [handleHover, setHandleHover] = useState<FaceHandleId | null>(null)
  const [live, setLive] = useState(false)
  const [filter, setFilter] = useState<StudioFilterId>(storedFilter)
  const [sculptOptions, setSculptOptions] = useState<SculptOptions>(storedSculpt)
  const [showHandles, setShowHandles] = useState(true)
  const [uiHidden, setUiHidden] = useState(false)
  const [view, setView] = useState<StageView>('front')
  const [cue, setCue] = useState<EmoteCue | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [listening, setListening] = useState<Listening>(null)
  const [keyMessage, setKeyMessage] = useState<string | null>(null)
  const [randomizing, setRandomizing] = useState(false)
  const [snapshotting, setSnapshotting] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [coach, setCoach] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const stageRef = useRef<StudioStageApi>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const shown = preview ?? draft
  const stageLook = useThrottled(shown.look, 90)
  const faceTarget = useFaceTarget(shown.avatar)
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial) || name.trim() !== initialName.trim()

  // The draft as it is now, for changes made after a wait (a photo being
  // read) that must build on whatever was done meanwhile.
  const draftRef = useRef(draft)
  draftRef.current = draft
  const commit = useCallback((next: Draft) => {
    const current = draftRef.current
    draftRef.current = next
    setPast((list) => [...list.slice(-49), current])
    setFuture([])
    setDraft(next)
    setPreview(null)
  }, [])
  const undo = () => {
    const previous = past[past.length - 1]
    if (!previous) return
    setPast(past.slice(0, -1))
    setFuture([draft, ...future])
    setDraft(previous)
    setPreview(null)
  }
  const redo = () => {
    const next = future[0]
    if (!next) return
    setFuture(future.slice(1))
    setPast([...past, draft])
    setDraft(next)
    setPreview(null)
  }

  const announce = useCallback((text: string) => setAnnouncement(text), [])
  const toastTimer = useRef(0)
  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current)
    setToast(text)
    setAnnouncement(text)
    toastTimer.current = window.setTimeout(() => setToast(null), 2500)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  useEffect(() => {
    if (confirming)
      rootRef.current?.querySelector<HTMLElement>('[role="alertdialog"] [data-autofocus]')?.focus()
  }, [confirming])

  const close = () => useCharacterStudio.getState().hide()
  const save = () => {
    const trimmed = name.trim()
    if (npc) {
      const { nodes, updateNode } = useScene.getState()
      const id = npc.nodeId as AnyNodeId
      // The node may have been deleted meanwhile (by another editor).
      if (nodes[id]) {
        updateNode(id, {
          avatar: draft.avatar,
          look: { ...draft.look, face: null },
          name: trimmed || npc.name,
        } as never)
      }
    } else {
      useWalkthroughView.getState().setCharacter(draft.avatar)
      useAvatarProfile.getState().setLook(draft.look)
      useAvatarProfile.getState().setKeys(draft.keys)
      useAvatarProfile.getState().setName(trimmed)
    }
    close()
  }
  const cancel = () => (dirty ? setConfirming(true) : close())

  // The hairstyle library is fetched as the studio opens, so 무작위 (and the
  // 헤어 tab) needn't wait for it; a failed fetch is tried again there.
  useEffect(() => {
    loadHairStyles().catch(() => {})
  }, [])

  // The game underneath rests while the studio is open.
  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock()
    useViewer.getState().setRenderPaused(true)
    return () => useViewer.getState().setRenderPaused(false)
  }, [])

  // Focus starts on the bottom tab and goes back to whatever opened the studio.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    rootRef.current?.querySelector<HTMLElement>('[data-tab][aria-selected="true"]')?.focus()
    return () => opener?.focus()
  }, [])

  const lookPatch = (patch: Partial<AvatarLook>, commitIt: boolean) => {
    const current = draftRef.current
    const next = { ...current, look: { ...current.look, ...patch } }
    if (commitIt) commit(next)
    else setPreview(next)
  }
  const pickAvatar = (avatar: string) => {
    const current = draftRef.current
    if (avatar !== current.avatar)
      commit({ ...current, avatar, look: lookOn(current.look, avatar) })
  }
  // The hairstyle library may still be loading (or fail to): the random
  // look is made once it answers, on the draft as it is by then, and the
  // button waits with it so a second click doesn't queue another.
  const randomize = async () => {
    setRandomizing(true)
    try {
      const styles = await loadHairStyles().catch(() => null)
      const current = draftRef.current
      commit({ ...current, look: randomLook(current.look, current.avatar, styles) })
    } finally {
      setRandomizing(false)
    }
  }
  const resetAll = () =>
    commit({ ...draftRef.current, look: NO_LOOK, keys: npc ? draft.keys : DEFAULT_EMOTE_KEYS })

  const snapshot = async () => {
    const stage = stageRef.current
    if (!stage) return
    setSnapshotting(true)
    try {
      download(await stage.capture({ kind: 'snapshot', filter }), stampedName('mmm-studio', 'png'))
      showToast('사진을 저장했어요')
    } catch {
      showToast('사진을 저장하지 못했어요. 캐릭터가 다 나온 뒤 다시 시도해 주세요.')
    } finally {
      setSnapshotting(false)
    }
  }
  const aiCapture = useCallback(
    (framing: AiPhotoFraming) =>
      stageRef.current
        ? stageRef.current.capture({ kind: 'ai', framing })
        : Promise.reject(new Error('the stage is not ready')),
    [],
  )

  const pickTab = (next: StudioTab) => {
    if (viewport.width >= WIDE) setPanelOpen(true)
    if (next === tab) return
    setTab(next)
    setCategory(firstCategory(next, isNpc, shown.avatar))
    setHovered(null)
    setHandleHover(null)
    setListening(null)
    setKeyMessage(null)
    if (FRONT_TABS.has(next)) stageRef.current?.setView('front')
  }
  const selectCategory = (id: string) => {
    setPanelOpen(true)
    if (id === category) return
    setCategory(id)
    if (tab === 'face' && id === 'ears') stageRef.current?.setView('angle')
  }

  const categories = categoriesOf(tab, isNpc)
  const current = categories.find(({ id }) => id === category) ?? categories[0]!
  const subKey = `${tab}/${current.id}`
  const sub = subs[subKey] ?? current.subTabs[0]?.id ?? ''

  const insets = stageInsets(viewport, {
    uiHidden,
    panelOpen,
    sculptBar: tab === 'face' && Boolean(faceTarget),
  })
  const free = freeRect(viewport, insets)
  const freeMiddle = insets.left + free.width / 2
  // The LIVE and view buttons keep to the free room's right, unless the
  // panel lies over it (narrow screens).
  const controlsRight = pushes || !panelOpen

  const region: FaceRegion | null = tab === 'face' ? regionOfCategory(hovered ?? current.id) : null
  const sculpt: SculptSettings | null =
    tab === 'face' && showHandles && !uiHidden && faceTarget ? { ...sculptOptions, region } : null
  const selectedRegion = tab === 'face' ? regionOfCategory(current.id) : null

  const setOptions = (options: SculptOptions) => {
    setSculptOptions(options)
    stored.set(SCULPT_KEY, JSON.stringify(options))
  }
  const pickFilter = (next: StudioFilterId) => {
    setFilter(next)
    stored.set(FILTER_KEY, next)
  }

  // The coach mark shows the first time the handles do (once the camera has
  // come in on the face), for 8 s or until the first drag.
  const handlesShown = sculpt !== null
  const dismissCoach = useCallback(() => {
    setCoach(false)
    stored.set(COACH_KEY, '1')
  }, [])
  useEffect(() => {
    if (!handlesShown || stored.get(COACH_KEY)) return
    const show = window.setTimeout(() => setCoach(true), COACH_DELAY)
    const timer = window.setTimeout(dismissCoach, COACH_DELAY + 8000)
    return () => {
      window.clearTimeout(show)
      window.clearTimeout(timer)
    }
  }, [handlesShown, dismissCoach])

  // The shape when a handle was grabbed: each move is applied to it whole.
  const sculptFrom = useRef<FaceShape | null>(null)
  const onSculpt = (event: SculptEvent) => {
    const label = FACE_HANDLE[event.handle].label
    if (event.phase === 'start') {
      sculptFrom.current = draftRef.current.look.shape
      if (coach) dismissCoach()
      announce(`${label} 잡음. 화살표로 움직이고 Enter로 놓아요`)
      return
    }
    const from = sculptFrom.current
    if (event.phase === 'cancel' || !from || !faceTarget) {
      sculptFrom.current = null
      setPreview(null)
      if (event.phase === 'cancel') announce(`${label} 놓음, 바뀐 것 없음`)
      return
    }
    const shape = applyFaceDrag(
      from,
      {
        handle: event.handle,
        delta: event.delta,
        symmetric: sculptOptions.symmetric,
        radiusScale: sculptOptions.radiusScale,
      },
      faceTarget,
    )
    if (event.phase === 'move') return lookPatch({ shape }, false)
    sculptFrom.current = null
    announce(`${label} 놓음`)
    if (JSON.stringify(shape) === JSON.stringify(from)) return setPreview(null)
    lookPatch({ shape }, true)
    // The rail follows to the region sculpted; the panel stays as it was.
    setCategory(FACE_HANDLE[event.handle].region)
  }

  const resetSelectedRegion = () => {
    if (!selectedRegion) return
    lookPatch({ shape: resetRegion(draftRef.current.look.shape, selectedRegion, faceTarget) }, true)
  }

  // The studio's keys. Everything is kept from the game underneath, which
  // listens on the document (movement, Esc to leave, emote keys); the
  // studio's own widgets still get the navigation keys they need.
  const keyContext = {
    listening,
    confirming,
    aiOpen,
    coach,
    panelOpen,
    tab,
    tabs,
    undo,
    redo,
    pickTab,
    setOptions,
    sculptOptions,
    dismissCoach,
  }
  const keyState = useRef(keyContext)
  keyState.current = keyContext
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    const trapTab = (event: KeyboardEvent) => {
      const root = rootRef.current
      if (!root) return
      const scopes = root.querySelectorAll<HTMLElement>('[data-focus-scope]')
      const scope = scopes[scopes.length - 1] ?? root
      const items = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => !element.closest('[inert]') && element.getClientRects().length > 0,
      )
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!first || !last) return event.preventDefault()
      if (!(active instanceof Node) || !scope.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const onEscape = () => {
      const state = keyState.current
      if (state.confirming) return setConfirming(false)
      // The AI dialog answers Esc itself.
      if (state.aiOpen) return
      if (sculptFrom.current) {
        sculptFrom.current = null
        setPreview(null)
        return
      }
      if (state.coach) return state.dismissCoach()
      if (state.panelOpen) setPanelOpen(false)
    }

    /** A studio shortcut (no modifiers): whether it was one. */
    const shortcut = (event: KeyboardEvent) => {
      const state = keyState.current
      if (state.confirming || state.aiOpen) return false
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)
      if (digit) {
        const next = state.tabs[Number(digit[1]) - 1]
        if (next && !event.repeat) state.pickTab(next.id)
        return Boolean(next)
      }
      switch (event.code) {
        case 'KeyF':
          if (!event.repeat) stageRef.current?.frame()
          return true
        case 'KeyH':
          if (!event.repeat) setUiHidden((hidden) => !hidden)
          return true
      }
      if (state.tab !== 'face') return false
      const options = state.sculptOptions
      switch (event.code) {
        case 'KeyX':
          if (!event.repeat) state.setOptions({ ...options, symmetric: !options.symmetric })
          return true
        case 'BracketLeft':
          state.setOptions({ ...options, radiusScale: stepRadius(options.radiusScale, -0.1) })
          return true
        case 'BracketRight':
          state.setOptions({ ...options, radiusScale: stepRadius(options.radiusScale, 0.1) })
          return true
      }
      return false
    }

    const onKey = (event: KeyboardEvent) => {
      const state = keyState.current
      const waiting = state.listening
      if (waiting) {
        event.preventDefault()
        event.stopPropagation()
        if (event.code === 'Escape') {
          setListening(null)
          return
        }
        if (!canBindKey(event.code)) {
          setKeyMessage(`${keyLabel(event.code)} 키는 이동·조작에 쓰여서 넣을 수 없어요`)
          return
        }
        const current = draftRef.current
        const keys = { ...current.keys }
        if (waiting.mode === 'rebind') {
          const emote = keys[waiting.code]!
          const displaced = keys[event.code]
          delete keys[waiting.code]
          if (displaced && event.code !== waiting.code) keys[waiting.code] = displaced
          keys[event.code] = emote
        } else {
          keys[event.code] ??= 'wave'
        }
        commitRef.current({ ...current, keys })
        setListening(null)
        setKeyMessage(null)
        return
      }

      const target = event.target instanceof Element ? event.target : null
      const typing = Boolean(target?.closest(TYPING)) || event.isComposing
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (typing && target instanceof HTMLElement) target.blur()
        else onEscape()
        return
      }
      if (event.key === 'Tab') {
        event.stopPropagation()
        trapTab(event)
        return
      }
      // A field or slider takes its own keys (the game leaves those be too).
      if (typing) return
      const command = event.ctrlKey || event.metaKey
      if (command && !event.altKey) {
        event.stopPropagation()
        if (event.code !== 'KeyZ' && event.code !== 'KeyY') return
        event.preventDefault()
        if (state.confirming || state.aiOpen) return
        if (event.code === 'KeyY' || event.shiftKey) state.redo()
        else state.undo()
        return
      }
      if (!event.altKey && shortcut(event)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      // Navigation keys go on to the studio's own widgets, and the root's
      // handler stops them there, before the editor's window shortcuts.
      // Every other key stops here, before the game.
      const root = rootRef.current
      const inside = target !== null && root?.contains(target) === true
      const passes = target?.closest('[role="application"]') ? STAGE_KEYS : WIDGET_KEYS
      if (inside && !event.altKey && !command && passes.has(event.key)) return
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const content = panelContent()
  function panelContent(): { body: React.ReactNode; footer?: React.ReactNode } {
    const look = shown.look
    switch (tab) {
      case 'preset':
        return {
          body: (
            <AvatarGallery
              avatar={shown.avatar}
              group={current.id as AvatarTab}
              onPick={pickAvatar}
            />
          ),
        }
      case 'face': {
        if (current.id === 'photo') {
          return {
            body: (
              <FaceEditor
                avatar={shown.avatar}
                look={look}
                onCommit={(patch) => lookPatch(patch, true)}
              />
            ),
          }
        }
        const faceRegion = current.id as FaceRegion
        return {
          body: (
            <FaceRegionBody
              covered={faceTarget === null}
              hasPhoto={Boolean(look.face)}
              onCommit={(shape) => lookPatch({ shape }, true)}
              onPaintCommit={(paint) => lookPatch({ paint }, true)}
              onPaintPreview={(paint) => lookPatch({ paint }, false)}
              onPreview={(shape) => lookPatch({ shape }, false)}
              paint={look.paint}
              photoEyes={look.face?.eyes ?? null}
              region={faceRegion}
              shape={look.shape}
              sub={sub}
            />
          ),
          footer: (
            <FaceRegionFooter
              onCommit={(shape) => lookPatch({ shape }, true)}
              region={faceRegion}
              shape={look.shape}
              target={faceTarget}
            />
          ),
        }
      }
      case 'body': {
        const bodyCategory = current.id as BodyCategory
        return {
          body: (
            <BodyBody
              body={look.body}
              category={bodyCategory}
              feet={look.feet}
              onCommit={(body) => lookPatch({ body }, true)}
              onFeet={(feet) => lookPatch({ feet }, true)}
              onPreview={(body) => lookPatch({ body }, false)}
            />
          ),
          footer: (
            <BodyFooter
              body={look.body}
              category={bodyCategory}
              feet={look.feet}
              onReset={(patch) => lookPatch(patch, true)}
            />
          ),
        }
      }
      case 'hair':
        return {
          body:
            current.id === 'style' ? (
              <HairStyleBody
                avatar={shown.avatar}
                hair={look.hair}
                hairStyle={look.hairStyle}
                onPick={(hairStyle) => lookPatch({ hairStyle }, true)}
                onShaveCommit={(shave) => lookPatch({ shave }, true)}
                onShavePreview={(shave) => lookPatch({ shave }, false)}
                shave={look.shave}
              />
            ) : (
              <HairColorBody
                hair={look.hair}
                hairStyle={look.hairStyle}
                onCommit={(hair) => lookPatch({ hair }, true)}
                onPreview={(hair) => lookPatch({ hair }, false)}
              />
            ),
        }
      case 'makeup':
        return {
          body: (
            <MakeupBody
              category={current.id as MakeupCategory}
              onCommit={(paint) => lookPatch({ paint }, true)}
              onPreview={(paint) => lookPatch({ paint }, false)}
              paint={look.paint}
            />
          ),
          footer: (
            <MakeupFooter onCommit={(paint) => lookPatch({ paint }, true)} paint={look.paint} />
          ),
        }
      case 'skin':
        return {
          body: (
            <ColorPanel
              fallback="#D9A77F"
              onCommit={(skin) => lookPatch({ skin }, true)}
              onPreview={(skin) => lookPatch({ skin }, false)}
              original="원래 피부"
              part={sub === 'custom' ? 'custom' : 'swatches'}
              swatches={SKIN_SWATCHES}
              value={look.skin}
            />
          ),
        }
      case 'motion':
        return {
          body:
            current.id === 'emotes' ? (
              <EmoteGrid
                keys={draft.keys}
                onKeys={(keys) => commit({ ...draftRef.current, keys })}
                onPreview={(id) => setCue({ id, at: Date.now() })}
                preview={cue?.id ?? null}
                slot={null}
              />
            ) : (
              <KeySlots
                keyMessage={keyMessage}
                keys={draft.keys}
                listening={listening}
                onKeys={(keys) => commit({ ...draftRef.current, keys })}
                onPreview={(id) => setCue({ id, at: Date.now() })}
                onSlot={setSlot}
                preview={cue?.id ?? null}
                setListening={(next) => {
                  setListening(next)
                  setKeyMessage(null)
                }}
                slot={slot && draft.keys[slot] ? slot : null}
              />
            ),
        }
    }
  }

  const tabLabel = tabs.find(({ id }) => id === tab)?.label ?? ''
  const highlighted = tab === 'face' && handleHover ? FACE_HANDLE[handleHover].region : null
  const chrome = cn(
    'pointer-events-none absolute inset-0 transition-opacity duration-300 ease-out motion-reduce:transition-none',
    uiHidden && 'opacity-0',
  )
  const changeContext = {
    look: shown.look,
    avatar: shown.avatar,
    keys: draft.keys,
    target: faceTarget,
  }

  return (
    <div
      aria-label="캐릭터 스튜디오"
      aria-modal="true"
      className="dark fixed inset-0 z-[200] select-none overflow-hidden break-keep text-pretty bg-[#0b0c0f] text-white"
      onKeyDown={(event) => {
        // Past the studio's widgets, a key goes no further (the editor's
        // own shortcuts listen on the window).
        event.stopPropagation()
      }}
      ref={rootRef}
      role="dialog"
    >
      {/* First in the tab order, drawn over the stage. */}
      <div className={cn(chrome, 'z-10')} inert={uiHidden}>
        <StudioToolbar
          canRedo={future.length > 0}
          canUndo={past.length > 0}
          filter={filter}
          onAi={() => setAiOpen(true)}
          onFilter={pickFilter}
          onFrame={() => stageRef.current?.frame()}
          onRandom={() => void randomize()}
          onRedo={redo}
          onSnapshot={() => void snapshot()}
          onUndo={undo}
          randomizing={randomizing}
          short={short}
          snapshotting={snapshotting}
        />
      </div>

      <StudioStage
        avatarId={shown.avatar}
        cue={cue}
        filter={filter}
        focus={focusOf(tab, current.id, panelOpen)}
        insets={insets}
        look={stageLook}
        onCueEnd={() => setCue(null)}
        onHandleHover={setHandleHover}
        onSculpt={onSculpt}
        onViewChange={setView}
        pose={stagePose(tab, live)}
        ref={stageRef}
        sculpt={sculpt}
      />

      <div className={chrome} inert={uiHidden}>
        <StageControls
          live={live}
          onLive={setLive}
          onView={(next) => stageRef.current?.setView(next)}
          place={controlsRight ? { right: insets.right + 16 } : { left: 24 }}
          showLive={STILL_TABS.has(tab)}
          view={view}
        />
        <BasicInfoPanel
          avatar={shown.avatar}
          chips={lookChips(shown.look)}
          compact={!wide}
          maxName={isNpc ? MAX_NPC_NAME : MAX_CHARACTER_NAME}
          name={name}
          npc={isNpc}
          onAvatar={pickAvatar}
          onName={setName}
          onReset={resetAll}
        />
        <CategoryRail
          categories={categories}
          changed={(id) => categoryChanged(tab, id, changeContext)}
          highlighted={highlighted}
          label={`${tabLabel} 항목`}
          onHover={setHovered}
          onSelect={selectCategory}
          panelId={PANEL_ID}
          panelOpen={panelOpen}
          selected={current.id}
        />
        <SlidePanel
          footer={content.footer}
          id={PANEL_ID}
          onClose={() => setPanelOpen(false)}
          onSub={(next) => setSubs((all) => ({ ...all, [subKey]: next }))}
          open={panelOpen}
          overlay={!pushes}
          short={short}
          sub={sub}
          subTabs={current.subTabs}
          title={current.label}
        >
          {content.body}
        </SlidePanel>
        {tab === 'face' && faceTarget && (
          <SculptBar
            canReset={
              selectedRegion !== null &&
              regionHasChanges(shown.look.shape, selectedRegion, faceTarget)
            }
            left={freeMiddle}
            onOptions={setOptions}
            onReset={resetSelectedRegion}
            onShowHandles={setShowHandles}
            options={sculptOptions}
            regionLabel={selectedRegion ? FACE_REGION_LABELS[selectedRegion] : null}
            showHandles={showHandles}
          />
        )}
        {tab === 'face' && coach && handlesShown && (
          <SculptCoach
            left={
              controlsRight ? insets.left + 16 : viewport.width - insets.right - 16 - COACH_WIDTH
            }
            onDismiss={dismissCoach}
            top={insets.top + 8}
          />
        )}
        <StudioTabs onPick={pickTab} panelId={PANEL_ID} short={short} tabs={tabs} value={tab} />
      </div>

      <button
        aria-keyshortcuts="H"
        aria-pressed={uiHidden}
        className={cn(
          'absolute bottom-6 left-6 z-10 flex h-10 items-center gap-2 rounded-full bg-black/45 px-4 text-[13px] text-white/80 ring-1 ring-white/10 backdrop-blur-xl transition duration-200 ease-out hover:text-white motion-reduce:transition-none',
          FOCUS_RING,
        )}
        onClick={() => setUiHidden(!uiHidden)}
        type="button"
      >
        {uiHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        {uiHidden ? 'UI 보이기' : 'UI 숨기기'}
      </button>

      <div className={chrome} inert={uiHidden}>
        <div className="pointer-events-auto absolute right-6 bottom-6 flex items-center gap-2">
          <button
            className={cn(
              'h-10 rounded-full px-5 font-medium text-[13px] text-white/70 transition duration-200 ease-out hover:bg-white/10 hover:text-white motion-reduce:transition-none',
              FOCUS_RING,
            )}
            onClick={cancel}
            type="button"
          >
            취소
          </button>
          <button
            className={cn(
              'flex h-11 items-center gap-1.5 rounded-full bg-sky-400 px-6 font-semibold text-[14px] text-neutral-950 shadow-[0_8px_24px_rgba(56,189,248,0.35)] transition duration-200 ease-out hover:bg-sky-300 motion-reduce:transition-none',
              FOCUS_RING,
            )}
            onClick={save}
            type="button"
          >
            <Check className="size-4" strokeWidth={3} /> 완료
          </button>
        </div>
      </div>

      {toast && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 font-medium text-[13px] text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
          style={{ left: freeMiddle, top: insets.top + 8 }}
        >
          {toast}
        </div>
      )}
      <div aria-live="polite" className="sr-only" role="status">
        {announcement}
      </div>

      {confirming && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 backdrop-blur-sm">
          <div
            aria-labelledby="studio-leave-title"
            aria-modal="true"
            className="w-[360px] rounded-3xl bg-neutral-900 p-6 text-center ring-1 ring-white/10"
            data-focus-scope
            role="alertdialog"
          >
            <p className="font-bold text-[16px]" id="studio-leave-title">
              저장하지 않고 나갈까요?
            </p>
            <p className="mt-2 text-[13px] text-white/60 leading-5">
              지금까지 꾸민 내용은 사라져요.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                className={cn(
                  'flex-1 rounded-full bg-white/10 py-2.5 font-medium text-[13px] text-white/85 hover:bg-white/15',
                  FOCUS_RING,
                )}
                data-autofocus
                onClick={() => setConfirming(false)}
                type="button"
              >
                계속 꾸미기
              </button>
              <button
                className={cn(
                  'flex-1 rounded-full bg-rose-500 py-2.5 font-semibold text-[13px] text-white hover:bg-rose-400',
                  FOCUS_RING,
                )}
                onClick={close}
                type="button"
              >
                나가기
              </button>
            </div>
          </div>
        </div>
      )}

      {aiOpen && (
        <AiPhotoDialog
          avatarId={shown.avatar}
          capture={aiCapture}
          focus={TAB_FOCUS[tab]}
          look={shown.look}
          npc={isNpc}
          onAnnounce={announce}
          onClose={() => {
            setAiOpen(false)
            rootRef.current?.querySelector<HTMLElement>('[aria-label="AI 실사 사진"]')?.focus()
          }}
        />
      )}
    </div>
  )
}
