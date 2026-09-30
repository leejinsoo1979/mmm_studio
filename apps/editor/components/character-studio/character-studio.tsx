'use client'

import {
  ALL_AVATARS,
  AVATAR_TABS,
  type AvatarLook,
  type AvatarTab,
  avatarLabel,
  avatarTab,
  avatarThumbnailUrl,
  BALD,
  canBindKey,
  DEFAULT_EMOTE_KEYS,
  EMOTE_CATEGORIES,
  EMOTE_IDS,
  EMOTES,
  type EmoteCategory,
  type EmoteCue,
  type EmoteId,
  findAvatar,
  hasBodyShape,
  hasFacePaint,
  hasSliders,
  keyLabel,
  loadHairStyles,
  NO_LOOK,
  useAvatarProfile,
  useWalkthroughView,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import {
  ArrowLeft,
  Brush,
  Check,
  Dices,
  Hand,
  Keyboard,
  type LucideIcon,
  Palette,
  PersonStanding,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  ScanFace,
  Scissors,
  SlidersHorizontal,
  Undo2,
  UserRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { BodyPanel } from './body-panel'
import { FaceEditor } from './face-editor'
import { FaceShapePanel } from './face-shape-panel'
import { HairPanel } from './hair-panel'
import { MakeupPanel } from './makeup-panel'
import { randomLook } from './random-look'
import { ColorPanel, PanelSection, Segmented } from './studio-controls'
import { EMOTE_ICONS, SKIN_SWATCHES } from './studio-data'
import { type CameraFocus, StudioStage } from './studio-stage'
import { useCharacterStudio } from './use-character-studio'

type Draft = { avatar: string; look: AvatarLook; keys: Record<string, EmoteId> }

type Tab = 'character' | 'body' | 'face' | 'shape' | 'makeup' | 'hair' | 'skin' | 'motion'

const TABS: { id: Tab; label: string; icon: LucideIcon; title: string; hint: string }[] = [
  {
    id: 'character',
    label: '캐릭터',
    icon: UserRound,
    title: '캐릭터',
    hint: '바탕이 될 캐릭터를 골라요. 체형·얼굴·머리·피부는 다음 단계에서 꾸며요.',
  },
  {
    id: 'body',
    label: '체형',
    icon: PersonStanding,
    title: '체형',
    hint: '성별과 나이를 고르고, 키와 몸의 부위를 하나하나 다듬어요.',
  },
  {
    id: 'face',
    label: '얼굴',
    icon: ScanFace,
    title: '내 얼굴 입히기',
    hint: '사진 한 장으로 캐릭터에 내 얼굴을 입혀요.',
  },
  {
    id: 'shape',
    label: '얼굴형',
    icon: SlidersHorizontal,
    title: '얼굴형 다듬기',
    hint: '얼굴형·눈·눈썹·코·입·귀를 부위별로 다듬어요.',
  },
  {
    id: 'makeup',
    label: '메이크업',
    icon: Brush,
    title: '메이크업',
    hint: '눈동자 색과 눈썹, 입술·볼·눈 화장, 수염과 주근깨를 그려요.',
  },
  {
    id: 'hair',
    label: '헤어',
    icon: Scissors,
    title: '헤어',
    hint: '다른 캐릭터의 머리 모양을 빌려 쓰고, 결과 윤기는 두고 색만 바꿔요.',
  },
  {
    id: 'skin',
    label: '피부',
    icon: Palette,
    title: '피부 톤',
    hint: '얼굴과 몸의 피부색을 함께 바꿔요.',
  },
  {
    id: 'motion',
    label: '동작',
    icon: Hand,
    title: '동작과 단축키',
    hint: '동작을 눌러 미리 보고, 게임에서 쓸 단축키에 넣어요.',
  },
]

const TAB_FOCUS: Record<Tab, CameraFocus> = {
  character: 'full',
  body: 'full',
  face: 'face',
  shape: 'face',
  makeup: 'face',
  hair: 'face',
  skin: 'upper',
  motion: 'full',
}

const FOCUS_OPTIONS: { id: CameraFocus; label: string }[] = [
  { id: 'full', label: '전신' },
  { id: 'upper', label: '상반신' },
  { id: 'face', label: '얼굴' },
]

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

function CharacterPanel({ avatar, onPick }: { avatar: string; onPick: (id: string) => void }) {
  const [tab, setTab] = useState<AvatarTab>(() => avatarTab(findAvatar(avatar)))
  const avatars = useMemo(() => ALL_AVATARS.filter((entry) => avatarTab(entry) === tab), [tab])
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Segmented onPick={setTab} options={AVATAR_TABS} value={tab} />
      <div className="-mr-2 grid min-h-0 grid-cols-3 gap-2 overflow-y-auto pr-2 pb-2">
        {avatars.map((entry) => {
          const selected = entry.id === avatar
          return (
            <button
              aria-pressed={selected}
              className={cn(
                'group relative flex flex-col items-center overflow-hidden rounded-2xl bg-gradient-to-b from-neutral-50 to-neutral-100 pt-1 transition',
                selected
                  ? 'shadow-[0_0_0_2px_#0ea5e9,0_6px_16px_rgba(14,165,233,0.25)]'
                  : 'shadow-[0_0_0_1px_rgba(0,0,0,0.05)] hover:shadow-[0_0_0_1px_rgba(14,165,233,0.4),0_4px_12px_rgba(0,0,0,0.08)]',
              )}
              key={entry.id}
              onClick={() => onPick(entry.id)}
              title={avatarLabel(entry.id)}
              type="button"
            >
              <img
                alt=""
                className="aspect-[128/208] w-full object-contain transition group-hover:scale-[1.03]"
                loading="lazy"
                src={avatarThumbnailUrl(entry.id)}
              />
              <span
                className={cn(
                  'w-full truncate py-1 text-center text-[11px]',
                  selected ? 'bg-sky-500 font-semibold text-white' : 'bg-white/80 text-neutral-600',
                )}
              >
                {avatarLabel(entry.id)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

type Listening = { mode: 'rebind'; code: string } | { mode: 'new' } | null

function MotionPanel({
  keys,
  preview,
  onPreview,
  onKeys,
  listening,
  setListening,
  keyMessage,
}: {
  keys: Record<string, EmoteId>
  preview: EmoteId | null
  onPreview: (emote: EmoteId) => void
  onKeys: (keys: Record<string, EmoteId>) => void
  listening: Listening
  setListening: (listening: Listening) => void
  keyMessage: string | null
}) {
  const [category, setCategory] = useState<EmoteCategory | 'all'>('all')
  const [picked, setSlot] = useState<string | null>(null)
  // A slot whose key was changed or cleared is no longer picked.
  const slot = picked && keys[picked] ? picked : null
  const slots = useMemo(
    () => Object.keys(keys).sort((a, b) => keyOrder(a).localeCompare(keyOrder(b))),
    [keys],
  )
  const keyOf = useMemo(() => {
    const found: Partial<Record<EmoteId, string>> = {}
    for (const code of slots) found[keys[code]!] ??= code
    return found
  }, [keys, slots])
  const emotes = EMOTE_IDS.filter((id) => category === 'all' || EMOTES[id].category === category)

  return (
    <div className="flex flex-col gap-5">
      <PanelSection
        action={
          <button
            className="flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 font-medium text-[11px] text-sky-600 transition hover:bg-sky-100"
            onClick={() => setListening({ mode: 'new' })}
            type="button"
          >
            <Plus className="size-3" /> 키 추가
          </button>
        }
        title="게임 단축키"
      >
        {listening && (
          <div className="flex items-center gap-2 rounded-xl bg-sky-500 px-3 py-2 text-[12px] text-white shadow-[0_4px_12px_rgba(14,165,233,0.35)]">
            <Keyboard className="size-4 shrink-0" />
            <span className="flex-1">
              {listening.mode === 'new'
                ? '새로 쓸 키를 눌러 주세요'
                : `${keyLabel(listening.code)} 대신 쓸 키를 눌러 주세요`}
            </span>
            <button
              className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] hover:bg-white/30"
              onClick={() => setListening(null)}
              type="button"
            >
              취소
            </button>
          </div>
        )}
        {keyMessage && <p className="text-[11px] text-rose-500">{keyMessage}</p>}
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
                    ? 'bg-sky-50 shadow-[0_0_0_2px_#0ea5e9]'
                    : 'bg-neutral-50 shadow-[0_0_0_1px_rgba(0,0,0,0.04)] hover:bg-neutral-100',
                )}
                key={code}
              >
                <button
                  aria-label={`${keyLabel(code)} 키: ${emote.label}`}
                  className="absolute inset-0 rounded-xl"
                  onClick={() => setSlot(selected ? null : code)}
                  type="button"
                />
                <button
                  className="relative z-10 min-w-7 rounded-md border border-neutral-300 border-b-2 bg-white px-1.5 font-mono font-semibold text-[11px] text-neutral-700 transition hover:border-sky-400 hover:text-sky-600"
                  onClick={() => setListening({ mode: 'rebind', code })}
                  title="키 바꾸기"
                  type="button"
                >
                  {keyLabel(code)}
                </button>
                <Icon className="pointer-events-none size-4 text-neutral-600" />
                <span className="pointer-events-none w-full truncate text-center text-[10px] text-neutral-600">
                  {emote.label}
                </span>
                <button
                  aria-label={`${keyLabel(code)} 키 비우기`}
                  className="absolute top-1 right-1 z-10 hidden size-4 place-items-center rounded-full bg-neutral-200 text-neutral-500 hover:bg-rose-100 hover:text-rose-500 group-hover:grid"
                  onClick={() => {
                    const next = { ...keys }
                    delete next[code]
                    if (slot === code) setSlot(null)
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
        <p className="text-[11px] text-neutral-400 leading-4">
          {slot
            ? `아래에서 동작을 누르면 ${keyLabel(slot)} 키에 들어가요`
            : '칸을 고른 뒤 동작을 누르면 그 키에 들어가요 · 키 모양을 누르면 키를 바꿔요'}
        </p>
      </PanelSection>

      <PanelSection title="동작">
        <Segmented
          onPick={setCategory}
          options={[{ id: 'all' as const, label: '전체' }, ...EMOTE_CATEGORIES]}
          value={category}
        />
        <div className="grid grid-cols-3 gap-2">
          {emotes.map((id) => {
            const emote = EMOTES[id]
            const Icon = EMOTE_ICONS[id]
            const bound = keyOf[id]
            return (
              <button
                aria-pressed={preview === id}
                className={cn(
                  'relative flex flex-col items-center gap-1.5 rounded-2xl px-1 pt-3 pb-2 transition',
                  preview === id
                    ? 'bg-sky-500 text-white shadow-[0_6px_16px_rgba(14,165,233,0.35)]'
                    : 'bg-white text-neutral-700 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] hover:shadow-[0_0_0_1px_rgba(14,165,233,0.45),0_4px_10px_rgba(0,0,0,0.06)]',
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
                    preview === id ? 'bg-white/20' : 'bg-sky-50 text-sky-600',
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
                      preview === id ? 'bg-white/25' : 'bg-neutral-100 text-neutral-500',
                    )}
                  >
                    반복
                  </span>
                )}
                {bound && (
                  <span
                    className={cn(
                      'absolute top-1.5 right-1.5 rounded border px-1 font-mono text-[9px]',
                      preview === id
                        ? 'border-white/40'
                        : 'border-neutral-300 bg-white text-neutral-500',
                    )}
                  >
                    {keyLabel(bound)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </PanelSection>
    </div>
  )
}

/**
 * The character studio, inZOI-style: the character on a lit turntable in
 * the middle, a rail of steps on the left (캐릭터 · 체형 · 얼굴 · 얼굴형 ·
 * 메이크업 · 헤어 · 피부 · 동작) with each step's options beside it, undo /
 * redo / random / reset on top, and 완료 to keep the result (body, look and
 * emote keys) for the game.
 */
export function CharacterStudio() {
  const open = useCharacterStudio((state) => state.open)
  if (!open) return null
  return <Studio />
}

function Studio() {
  const initial = useMemo<Draft>(
    () => ({
      avatar: useWalkthroughView.getState().character,
      look: useAvatarProfile.getState().look,
      keys: useAvatarProfile.getState().keys,
    }),
    [],
  )
  const [draft, setDraft] = useState<Draft>(initial)
  const [preview, setPreview] = useState<Draft | null>(null)
  const [past, setPast] = useState<Draft[]>([])
  const [future, setFuture] = useState<Draft[]>([])
  const [tab, setTab] = useState<Tab>('character')
  const [focus, setFocus] = useState<CameraFocus>('full')
  const [zoom, setZoom] = useState(1)
  const [cue, setCue] = useState<EmoteCue | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [listening, setListening] = useState<Listening>(null)
  const [keyMessage, setKeyMessage] = useState<string | null>(null)
  const yaw = useRef(0)
  const dragRef = useRef<{ x: number; yaw: number } | null>(null)

  const shown = preview ?? draft
  const stageLook = useThrottled(shown.look, 90)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

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

  const close = () => useCharacterStudio.getState().hide()
  const save = () => {
    useWalkthroughView.getState().setCharacter(draft.avatar)
    useAvatarProfile.getState().setLook(draft.look)
    useAvatarProfile.getState().setKeys(draft.keys)
    close()
  }
  const cancel = () => (dirty ? setConfirming(true) : close())

  // The game underneath rests while the studio is open.
  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock()
    useViewer.getState().setRenderPaused(true)
    return () => useViewer.getState().setRenderPaused(false)
  }, [])

  // Keys belong to the studio: waiting for a key to bind takes the next
  // one; otherwise they don't reach the game underneath (typing in a field,
  // and a slider's arrow keys, still work: movement leaves those be).
  const listeningRef = useRef(listening)
  listeningRef.current = listening
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const waiting = listeningRef.current
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
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [role="slider"]')) return
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const pickTab = (next: Tab) => {
    setTab(next)
    setFocus(TAB_FOCUS[next])
    setZoom(1)
    setListening(null)
    setKeyMessage(null)
  }
  const current = TABS.find((entry) => entry.id === tab)!
  const lookPatch = (patch: Partial<AvatarLook>, commitIt: boolean) => {
    const current = draftRef.current
    const next = { ...current, look: { ...current.look, ...patch } }
    if (commitIt) commit(next)
    else setPreview(next)
  }
  // The hairstyle library may still be loading (or fail to): the random
  // look is made once it answers, on the draft as it is by then.
  const randomize = async () => {
    const styles = await loadHairStyles().catch(() => null)
    const current = draftRef.current
    commit({ ...current, look: randomLook(current.look, current.avatar, styles) })
  }

  return (
    <div className="fixed inset-0 z-[200] select-none overflow-hidden bg-[radial-gradient(ellipse_at_62%_42%,#ffffff_0%,#f1f4f8_38%,#dde4ec_100%)] text-neutral-900">
      {/* The stage, centred in the room the panel leaves. */}
      <div
        className="absolute inset-0 cursor-grab active:cursor-grabbing md:left-[452px]"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { x: event.clientX, yaw: yaw.current }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (drag) yaw.current = drag.yaw + (event.clientX - drag.x) * 0.012
        }}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onWheel={(event) =>
          setZoom((value) => Math.min(1.6, Math.max(0.55, value * Math.exp(event.deltaY * 0.001))))
        }
      >
        <StudioStage
          avatarId={shown.avatar}
          cue={cue}
          focus={focus}
          look={stageLook}
          onCueEnd={() => setCue(null)}
          yaw={yaw}
          zoom={zoom}
        />
      </div>

      {/* Top bar. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex h-[68px] items-center justify-between px-5">
        <div className="pointer-events-auto flex items-center gap-3">
          <button
            aria-label="나가기"
            className="grid size-10 place-items-center rounded-full bg-white/85 text-neutral-700 shadow-[0_2px_10px_rgba(15,23,42,0.1)] backdrop-blur transition hover:bg-white"
            onClick={cancel}
            type="button"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div>
            <p className="font-medium text-[11px] text-sky-600 tracking-[0.18em]">
              CHARACTER STUDIO
            </p>
            <h1 className="font-bold text-[18px] text-neutral-900 leading-tight">
              나만의 캐릭터 만들기
            </h1>
          </div>
        </div>

        <div className="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-white/85 p-1 shadow-[0_2px_10px_rgba(15,23,42,0.1)] backdrop-blur md:left-[calc(50%+226px)]">
          <button
            aria-label="되돌리기"
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-30"
            disabled={past.length === 0}
            onClick={undo}
            type="button"
          >
            <Undo2 className="size-4" /> 되돌리기
          </button>
          <button
            aria-label="다시 하기"
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-30"
            disabled={future.length === 0}
            onClick={redo}
            type="button"
          >
            <Redo2 className="size-4" /> 다시 하기
          </button>
          <span className="mx-1 h-4 w-px bg-neutral-200" />
          <button
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-neutral-700 transition hover:bg-neutral-100"
            onClick={() => void randomize()}
            title="캐릭터와 얼굴 사진은 두고, 얼굴형·체형·머리·메이크업을 무작위로 바꿔요"
            type="button"
          >
            <Dices className="size-4" /> 무작위
          </button>
          <button
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-neutral-700 transition hover:bg-neutral-100"
            onClick={() => commit({ ...draft, look: NO_LOOK, keys: DEFAULT_EMOTE_KEYS })}
            type="button"
          >
            <RotateCcw className="size-4" /> 초기화
          </button>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            className="rounded-full px-4 py-2 font-medium text-[13px] text-neutral-600 transition hover:bg-white/70"
            onClick={cancel}
            type="button"
          >
            취소
          </button>
          <button
            className="flex items-center gap-1.5 rounded-full bg-sky-500 px-5 py-2.5 font-semibold text-[13px] text-white shadow-[0_6px_18px_rgba(14,165,233,0.4)] transition hover:bg-sky-600"
            onClick={save}
            type="button"
          >
            <Check className="size-4" strokeWidth={3} /> 완료
          </button>
        </div>
      </header>

      {/* The rail of steps and the step's options. */}
      <aside className="absolute top-[84px] bottom-5 left-5 flex gap-3">
        <nav className="flex max-h-full w-[72px] flex-col items-center gap-0.5 self-start overflow-y-auto rounded-[28px] bg-white/85 p-2 shadow-[0_8px_30px_rgba(15,23,42,0.1)] backdrop-blur-xl">
          {TABS.map(({ id, label, icon: Icon }, index) => (
            <button
              aria-pressed={tab === id}
              className={cn(
                'group flex w-full shrink-0 flex-col items-center gap-1 rounded-2xl py-1.5 transition',
                tab === id ? 'text-sky-600' : 'text-neutral-500 hover:text-neutral-800',
              )}
              key={id}
              onClick={() => pickTab(id)}
              type="button"
            >
              <span
                className={cn(
                  'relative grid size-10 place-items-center rounded-full transition',
                  tab === id
                    ? 'bg-sky-500 text-white shadow-[0_6px_14px_rgba(14,165,233,0.4)]'
                    : 'bg-neutral-100 group-hover:bg-neutral-200',
                )}
              >
                <Icon className="size-5" />
                <span
                  className={cn(
                    'absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full font-semibold text-[9px]',
                    tab === id ? 'bg-white text-sky-600' : 'bg-white text-neutral-400',
                  )}
                >
                  {index + 1}
                </span>
              </span>
              <span className="font-medium text-[11px]">{label}</span>
            </button>
          ))}
        </nav>

        <section className="flex w-[348px] flex-col overflow-hidden rounded-[28px] bg-white/90 shadow-[0_8px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="border-neutral-100 border-b px-5 pt-5 pb-4">
            <h2 className="font-bold text-[17px] text-neutral-900">{current.title}</h2>
            <p className="mt-1 text-[12px] text-neutral-500 leading-5">{current.hint}</p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
            {tab === 'character' && (
              <CharacterPanel
                avatar={shown.avatar}
                onPick={(avatar) => avatar !== draft.avatar && commit({ ...draft, avatar })}
              />
            )}
            {tab === 'body' && (
              <BodyPanel
                avatar={shown.avatar}
                body={shown.look.body}
                onAvatar={(avatar) => avatar !== draft.avatar && commit({ ...draft, avatar })}
                onCommit={(body) => lookPatch({ body }, true)}
                onPreview={(body) => lookPatch({ body }, false)}
              />
            )}
            {tab === 'face' && (
              <FaceEditor
                avatar={shown.avatar}
                look={shown.look}
                onCommit={(patch) => lookPatch(patch, true)}
              />
            )}
            {tab === 'shape' && (
              <FaceShapePanel
                hasPhoto={Boolean(shown.look.face)}
                onCommit={(shape) => lookPatch({ shape }, true)}
                onPreview={(shape) => lookPatch({ shape }, false)}
                shape={shown.look.shape}
              />
            )}
            {tab === 'makeup' && (
              <MakeupPanel
                onCommit={(paint) => lookPatch({ paint }, true)}
                onPreview={(paint) => lookPatch({ paint }, false)}
                paint={shown.look.paint}
              />
            )}
            {tab === 'hair' && (
              <HairPanel
                avatar={shown.avatar}
                hair={shown.look.hair}
                hairStyle={shown.look.hairStyle}
                onCommitColor={(hair) => lookPatch({ hair }, true)}
                onPreviewColor={(hair) => lookPatch({ hair }, false)}
                onStyle={(hairStyle) => lookPatch({ hairStyle }, true)}
              />
            )}
            {tab === 'skin' && (
              <ColorPanel
                fallback="#D9A77F"
                onCommit={(skin) => lookPatch({ skin }, true)}
                onPreview={(skin) => lookPatch({ skin }, false)}
                original="원래 피부"
                swatches={SKIN_SWATCHES}
                value={shown.look.skin}
              />
            )}
            {tab === 'motion' && (
              <MotionPanel
                keyMessage={keyMessage}
                keys={draft.keys}
                listening={listening}
                onKeys={(keys) => commit({ ...draft, keys })}
                onPreview={(id) => setCue({ id, at: Date.now() })}
                preview={cue?.id ?? null}
                setListening={(next) => {
                  setListening(next)
                  setKeyMessage(null)
                }}
              />
            )}
          </div>
        </section>
      </aside>

      {/* The character's name, over the stage. */}
      <div className="pointer-events-none absolute top-[88px] right-6 flex items-center gap-2 rounded-full bg-white/80 py-1 pr-3.5 pl-1 shadow-[0_2px_10px_rgba(15,23,42,0.08)] backdrop-blur">
        <img
          alt=""
          className="h-8 w-8 rounded-full bg-neutral-100 object-cover object-top"
          src={avatarThumbnailUrl(shown.avatar)}
        />
        <div className="leading-tight">
          <p className="font-semibold text-[13px]">{avatarLabel(shown.avatar)}</p>
          <p className="text-[10px] text-neutral-500">
            {[
              shown.look.face && '내 얼굴',
              hasSliders(shown.look.shape) && '얼굴형',
              hasBodyShape(shown.look.body) && '체형',
              shown.look.hairStyle && (shown.look.hairStyle === BALD ? '민머리' : '헤어스타일'),
              shown.look.hair && '염색',
              hasFacePaint(shown.look.paint) && '메이크업',
              shown.look.skin && '피부 톤',
            ]
              .filter(Boolean)
              .join(' · ') || '기본 모습'}
          </p>
        </div>
      </div>

      {/* Camera controls under the stage. */}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 md:left-[calc(50%+226px)]">
        <button
          aria-label="왼쪽으로 돌리기"
          className="grid size-10 place-items-center rounded-full bg-white/85 text-neutral-600 shadow-[0_2px_10px_rgba(15,23,42,0.1)] backdrop-blur transition hover:bg-white"
          onClick={() => {
            yaw.current -= Math.PI / 4
          }}
          type="button"
        >
          <RotateCcw className="size-4" />
        </button>
        <div className="flex rounded-full bg-white/85 p-1 shadow-[0_2px_10px_rgba(15,23,42,0.1)] backdrop-blur">
          {FOCUS_OPTIONS.map(({ id, label }) => (
            <button
              aria-pressed={focus === id}
              className={cn(
                'rounded-full px-4 py-1.5 font-medium text-[12px] transition',
                focus === id
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900',
              )}
              key={id}
              onClick={() => {
                setFocus(id)
                setZoom(1)
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          aria-label="오른쪽으로 돌리기"
          className="grid size-10 place-items-center rounded-full bg-white/85 text-neutral-600 shadow-[0_2px_10px_rgba(15,23,42,0.1)] backdrop-blur transition hover:bg-white"
          onClick={() => {
            yaw.current += Math.PI / 4
          }}
          type="button"
        >
          <RotateCw className="size-4" />
        </button>
      </div>
      <p className="pointer-events-none absolute top-[140px] right-7 text-[11px] text-neutral-400">
        드래그로 돌리기 · 휠로 확대
      </p>

      {confirming && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-neutral-900/30 backdrop-blur-sm">
          <div className="w-[340px] rounded-3xl bg-white p-6 text-center shadow-2xl">
            <p className="font-bold text-[16px]">저장하지 않고 나갈까요?</p>
            <p className="mt-2 text-[13px] text-neutral-500 leading-5">
              지금까지 꾸민 내용은 사라져요.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                className="flex-1 rounded-full bg-neutral-100 py-2.5 font-medium text-[13px] text-neutral-700 hover:bg-neutral-200"
                onClick={() => setConfirming(false)}
                type="button"
              >
                계속 꾸미기
              </button>
              <button
                className="flex-1 rounded-full bg-rose-500 py-2.5 font-semibold text-[13px] text-white hover:bg-rose-600"
                onClick={close}
                type="button"
              >
                나가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
