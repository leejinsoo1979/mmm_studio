'use client'

import { addPhotoAvatar } from '@pascal-app/editor'
import {
  Box,
  Check,
  CircleCheck,
  Dices,
  Download,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { detectFaces } from '@/lib/face-detect'
import { type PhotorealAiClientStatus, photorealAiClient } from '@/lib/photoreal-ai/client'
import { portraitIssues } from '@/lib/photoreal-ai/portrait-check'
import {
  AI_PERSON_AGES,
  AI_PERSON_DEFAULTS,
  AI_PERSON_DETAILS,
  AI_PERSON_DETAILS_MAX,
  AI_PERSON_FACE_SHAPES,
  AI_PERSON_FACIAL_HAIR,
  AI_PERSON_HAIR_COLOURS,
  AI_PERSON_HERITAGES,
  AI_PERSON_IMPRESSIONS,
  AI_PERSON_LABELS,
  AI_PERSON_NOTICE,
  AI_PERSON_OUTFIT_COLOURS,
  AI_PERSON_OUTFITS,
  AI_PERSON_SEXES,
  AI_PERSON_SKIN_TONES,
  type AiPersonChoices,
  PHOTOREAL_AI_ERROR_TEXT,
} from '@/lib/photoreal-ai/shared'
import { cn } from '@/lib/utils'
import { avatarJobs, useAvatarJob } from './ai-person-jobs'
import {
  type AiPersonStep,
  aiPersonView,
  backAfter,
  buildStageText,
  detailOpen,
  elapsedText,
  HAIR_COLOUR_SWATCH,
  hairStylesFor,
  leftText,
  OUTFIT_COLOUR_SWATCH,
  optionsOf,
  type Portrait,
  type PortraitCheck,
  portraitExpired,
  portraitProgressAt,
  randomChoices,
  refusalText,
  requestChoices,
  SKIN_TONE_SWATCH,
  toggleDetail,
  unavailableCopy,
} from './ai-person-view'
import { AI_LABEL_TEXT, download, labelImage, stampedName } from './ai-photo-label'
import { makePhotoAvatar, openPicture, PhotoAvatarError } from './photo-avatar-make'
import { FOCUS_RING, Segmented } from './studio-controls'

/** The portraits of this dialog the player can go back to. */
const KEPT_PORTRAITS = 4

/** The choices last made, so the dialog opens on them again (this page only). */
let lastChoices: AiPersonChoices = AI_PERSON_DEFAULTS

const primary = cn(
  'flex h-11 items-center justify-center gap-1.5 rounded-full bg-sky-400 px-6 font-semibold text-[14px] text-neutral-950 shadow-[0_8px_24px_rgba(56,189,248,0.35)] transition duration-200 ease-out hover:bg-sky-300 disabled:opacity-40 disabled:shadow-none disabled:hover:bg-sky-400 motion-reduce:transition-none',
  FOCUS_RING,
)
const secondary = cn(
  'flex h-10 items-center justify-center gap-1.5 rounded-full bg-white/10 px-4 font-medium text-[13px] text-white/85 transition duration-200 ease-out hover:bg-white/15 disabled:opacity-40 motion-reduce:transition-none',
  FOCUS_RING,
)

/** Whether the portrait suits the 3D service, read with MediaPipe in the browser. */
async function checkPortrait(blob: Blob): Promise<PortraitCheck> {
  try {
    const bitmap = await createImageBitmap(blob)
    try {
      const { largest, count } = await detectFaces(bitmap)
      const issues = portraitIssues(largest, count, { width: bitmap.width, height: bitmap.height })
      return { kind: 'checked', issues }
    } finally {
      bitmap.close()
    }
  } catch {
    return { kind: 'unchecked' }
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId()
  return (
    <div aria-labelledby={id} className="flex flex-col gap-1.5" role="group">
      <span className="font-semibold text-[12px] text-white/50 tracking-wide" id={id}>
        {label}
      </span>
      {children}
    </div>
  )
}

/** Several of a fixed list, each a pill that can be turned on and off. */
function ToggleChips<T extends string>({
  options,
  picked,
  open,
  onToggle,
}: {
  options: readonly { id: T; label: string }[]
  picked: readonly T[]
  /** Whether a pill not picked yet can be. */
  open: (id: T) => boolean
  onToggle: (id: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(({ id, label }) => {
        const on = picked.includes(id)
        return (
          <button
            aria-pressed={on}
            className={cn(
              'flex h-7 items-center gap-1 rounded-full px-3 font-medium text-[12px] transition duration-200 ease-out disabled:opacity-35 motion-reduce:transition-none',
              FOCUS_RING,
              on
                ? 'bg-white text-neutral-900'
                : 'bg-white/[0.08] text-white/75 ring-1 ring-white/10 hover:bg-white/15 hover:text-white disabled:hover:bg-white/[0.08]',
            )}
            disabled={!on && !open(id)}
            key={id}
            onClick={() => onToggle(id)}
            type="button"
          >
            {on && <Check className="size-3" strokeWidth={3} />}
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** Pill choices; with `swatches`, each with its colour. */
function ChoiceChips<T extends string>({
  options,
  value,
  onPick,
  swatches,
}: {
  options: readonly { id: T; label: string }[]
  value: T
  onPick: (id: T) => void
  swatches?: Record<T, string>
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(({ id, label }) => (
        <button
          aria-pressed={value === id}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-full px-3 font-medium text-[12px] transition duration-200 ease-out motion-reduce:transition-none',
            FOCUS_RING,
            swatches && 'pl-1.5',
            value === id
              ? 'bg-white text-neutral-900'
              : 'bg-white/[0.08] text-white/75 ring-1 ring-white/10 hover:bg-white/15 hover:text-white',
          )}
          key={id}
          onClick={() => onPick(id)}
          type="button"
        >
          {swatches && (
            <span
              aria-hidden
              className="size-4 rounded-full ring-1 ring-black/20 ring-inset"
              style={{ background: swatches[id] }}
            />
          )}
          {label}
        </button>
      ))}
    </div>
  )
}

function Notice({ mock }: { mock: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-sky-400/10 px-3 py-2.5 text-[12px] text-sky-100 leading-5">
      <p className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-300" />
        <span>{AI_PERSON_NOTICE}</span>
      </p>
      <ul className="ml-6 list-disc text-[11px] text-sky-100/75 leading-4">
        <li>가상의 성인(20대 이상)만 만들 수 있어요.</li>
        <li>실존 인물의 이름이나 닮은 얼굴은 만들 수 없어요.</li>
        <li>선정적이거나 폭력적인 표현은 넣을 수 없어요.</li>
        <li>만든 아바타는 실사 목록에 ‘AI 생성 인물’로 표시돼요.</li>
      </ul>
      {mock && (
        <p className="text-[11px] text-amber-200">
          목업 모드예요: 외부 서비스 없이 그린 사진과 시험용 3D 모델로 흐름만 보여 줘요.
        </p>
      )}
    </div>
  )
}

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-sky-400 transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  )
}

/**
 * AI 인물 만들기: a fictional adult made from Korean choices as a photo,
 * shown for approval with a check that it suits the 3D service, then sent
 * back as it came, with the token the server signed for it, to be made into
 * an avatar. The build takes minutes and goes on with the dialog closed;
 * when it is done the studio picks the new 실사 character (see `avatarJobs`).
 * With no paid 3D service configured, this browser makes the avatar from the
 * portrait itself (the photo avatar pipeline) and keeps it here.
 */
export function AiPersonDialog({
  onClose,
  onAnnounce,
  onMade,
}: {
  onClose: () => void
  onAnnounce: (text: string) => void
  /** An avatar made in this browser was kept: pick it. */
  onMade: (id: string) => void
}) {
  const titleId = useId()
  const client = photorealAiClient()
  const job = useAvatarJob()
  const [status, setStatus] = useState<PhotorealAiClientStatus | null>(null)
  const [choices, setChoicesState] = useState<AiPersonChoices>(lastChoices)
  const [step, setStep] = useState<AiPersonStep>({ kind: 'choose' })
  const [portraits, setPortraits] = useState<Portrait[]>([])
  /** The portrait shown, by its object URL. */
  const [shownUrl, setShownUrl] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  const [retryAt, setRetryAt] = useState(0)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const inFlight = useRef<AbortController | null>(null)
  const making = useRef<AbortController | null>(null)
  const urls = useRef(new Set<string>())
  const dialog = useRef<HTMLDivElement>(null)

  const setChoices = (next: AiPersonChoices) => {
    lastChoices = next
    setChoicesState(next)
  }
  const patch = (part: Partial<AiPersonChoices>) => setChoices({ ...choices, ...part })

  const shown = portraits.find(({ url }) => url === shownUrl) ?? null
  const view = aiPersonView({
    status,
    job,
    step,
    portrait: shown,
    now: clock,
  })
  const mock = status?.available === true && status.mock

  // Every image let go, and a portrait on its way stopped, on closing.
  useEffect(
    () => () => {
      inFlight.current?.abort()
      inFlight.current = null
      making.current?.abort()
      for (const url of urls.current) URL.revokeObjectURL(url)
      urls.current.clear()
    },
    [],
  )

  const askStatus = useCallback(
    (fresh: boolean) => {
      setStatus(null)
      let current = true
      client.status({ fresh }).then((answer) => current && setStatus(answer))
      return () => {
        current = false
      }
    },
    [client],
  )
  useEffect(() => askStatus(false), [askStatus])

  useEffect(() => {
    avatarJobs().resume()
    dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])

  // A clock for the bars, the waits and the portraits' time limit.
  const tick =
    view.kind === 'generating'
      ? 250
      : view.kind === 'building' || retryAt > clock || portraits.length > 0
        ? 1000
        : 0
  useEffect(() => {
    if (!tick) return
    const timer = window.setInterval(() => setClock(Date.now()), tick)
    return () => window.clearInterval(timer)
  }, [tick])

  // The confirm sheet takes the focus while it is up.
  const confirming = view.kind === 'confirm'
  useEffect(() => {
    if (confirming) {
      dialog.current?.querySelector<HTMLElement>('[role="alertdialog"] [data-autofocus]')?.focus()
    }
  }, [confirming])

  const leftCounts = (update: { portraitsLeft?: number | null; avatarsLeft?: number | null }) =>
    setStatus((old) => {
      if (!old?.available) return old
      return {
        ...old,
        ...(update.portraitsLeft != null ? { portraitsLeft: update.portraitsLeft } : {}),
        ...(update.avatarsLeft != null ? { avatarsLeft: update.avatarsLeft } : {}),
      }
    })

  const keep = (portrait: Portrait) => {
    urls.current.add(portrait.url)
    setPortraits((list) => {
      const next = [portrait, ...list]
      for (const dropped of next.slice(KEPT_PORTRAITS)) {
        URL.revokeObjectURL(dropped.url)
        urls.current.delete(dropped.url)
      }
      return next.slice(0, KEPT_PORTRAITS)
    })
    setShownUrl(portrait.url)
  }

  const generate = async () => {
    if (inFlight.current) return
    const back = portraits.length > 0 ? 'review' : 'choose'
    const controller = new AbortController()
    inFlight.current = controller
    setStep({ kind: 'generating' })
    setStartedAt(Date.now())
    setClock(Date.now())
    setRetryAt(0)
    onAnnounce('AI 인물 사진을 만들기 시작했어요')
    const result = await client.createPortrait(requestChoices(choices), controller.signal)
    if (inFlight.current !== controller) return
    if (!result.ok) {
      inFlight.current = null
      if (result.code === 'aborted') {
        setStep({ kind: back })
        onAnnounce(PHOTOREAL_AI_ERROR_TEXT.aborted)
        return
      }
      if (result.retryAfter) setRetryAt(Date.now() + result.retryAfter * 1000)
      setStep({
        kind: 'error',
        message: refusalText(result, 'portrait'),
        retryAfter: result.retryAfter ?? null,
        back: backAfter(result.code, portraits.length > 0),
      })
      onAnnounce('인물 사진을 만들지 못했어요')
      // Signed out or switched off meanwhile: the dialog says so.
      if (result.code === 'sign_in_required' || result.code === 'unavailable') askStatus(true)
      return
    }
    inFlight.current = null
    leftCounts({ portraitsLeft: result.portraitsLeft })
    const blob = result.image
    const portrait: Portrait = {
      url: URL.createObjectURL(blob),
      blob,
      token: result.token,
      madeAt: Date.now(),
      sex: choices.sex,
      check: { kind: 'checking' },
    }
    keep(portrait)
    setStep({ kind: 'review' })
    onAnnounce('AI 인물 사진이 나왔어요. 3D로 만들기 좋은 사진인지 확인하고 있어요')
    const check = await checkPortrait(blob)
    setPortraits((list) => list.map((one) => (one.url === portrait.url ? { ...one, check } : one)))
  }

  const cancel = () => {
    inFlight.current?.abort()
    making.current?.abort()
  }

  const build = async () => {
    if (!shown) return
    setStep({ kind: 'starting' })
    const result = await avatarJobs().begin(shown.blob, shown.token)
    if (!result.ok) {
      if (result.retryAfter) setRetryAt(Date.now() + result.retryAfter * 1000)
      setStep({
        kind: 'error',
        message: refusalText(result, 'avatar'),
        retryAfter: result.retryAfter ?? null,
        back: 'review',
      })
      onAnnounce('3D 아바타를 만들지 못했어요')
      return
    }
    leftCounts({ avatarsLeft: result.avatarsLeft })
    // One portrait makes one avatar.
    setPortraits((list) =>
      list.map((one) => (one.url === shown.url ? { ...one, used: true } : one)),
    )
    setStep({ kind: 'review' })
    onAnnounce('3D 아바타를 만들기 시작했어요. 몇 분 걸려요')
  }

  /** No paid service: this browser makes the avatar from the portrait, and keeps it. */
  const makeHere = async () => {
    if (!shown || making.current) return
    const controller = new AbortController()
    making.current = controller
    setStep({ kind: 'making', fraction: 0, text: '시작하고 있어요' })
    onAnnounce('이 얼굴로 아바타를 만들기 시작했어요')
    try {
      const picture = await openPicture(shown.blob)
      const avatar = await makePhotoAvatar({
        photos: [{ picture, slot: 'front' }],
        gender: shown.sex,
        name: 'AI 인물',
        source: 'ai',
        signal: controller.signal,
        onProgress: ({ fraction, text }) => {
          if (making.current === controller) setStep({ kind: 'making', fraction, text })
        },
      })
      const character = await addPhotoAvatar(avatar)
      if (making.current !== controller) return
      making.current = null
      onMade(character.id)
      setStep({ kind: 'made', name: character.label })
      onAnnounce('AI 인물 아바타가 완성됐어요')
    } catch (error) {
      if (making.current !== controller) return
      making.current = null
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStep({ kind: 'review' })
        return
      }
      setStep({
        kind: 'error',
        message:
          error instanceof PhotoAvatarError
            ? error.message
            : '아바타를 만들지 못했어요. 다시 시도해 주세요.',
        retryAfter: null,
        back: 'review',
      })
      onAnnounce('아바타를 만들지 못했어요')
    }
  }

  /** After a finished job: back to the choices for another person (a portrait makes one avatar). */
  const again = () => {
    avatarJobs().clear()
    setStep({ kind: 'choose' })
  }

  const close = useCallback(() => {
    if (inFlight.current || making.current) {
      setConfirmingClose(true)
      return
    }
    // A finished build has been read; one still running goes on without the dialog.
    avatarJobs().clear()
    onClose()
  }, [onClose])

  // Esc: the studio's own handler leaves it to the dialog while it is open,
  // and blurs a text field itself.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.target instanceof Element && event.target.closest('textarea, input')) return
      event.preventDefault()
      if (confirmingClose) setConfirmingClose(false)
      else if (step.kind === 'confirm') setStep({ kind: 'review' })
      else close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close, confirmingClose, step.kind])

  const seconds = Math.max(0, (clock - startedAt) / 1000)
  const waitLeft = Math.max(0, Math.ceil((retryAt - clock) / 1000))
  const portraitLeft = status?.available ? status.portraitsLeft : null
  // The choices show no portrait: it would read as a preview of them.
  const portraitShown = shown !== null && view.kind !== 'choose'

  return (
    <div
      className="fixed inset-0 z-10 grid place-items-center bg-black/60 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative flex max-h-[calc(100vh-32px)] w-[min(860px,calc(100vw-32px))] flex-col gap-6 overflow-y-auto rounded-3xl bg-neutral-950 p-6 pb-0 text-white shadow-2xl ring-1 ring-white/10 md:flex-row"
        data-focus-scope
        ref={dialog}
        role="dialog"
      >
        <div className="flex w-full max-w-[260px] shrink-0 flex-col gap-2 self-center md:sticky md:top-0 md:w-[300px] md:max-w-none md:self-start md:pb-6">
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-gradient-to-b from-white/[0.09] to-white/[0.02]">
            {portraitShown ? (
              <>
                <img
                  alt="AI가 만든 가상 인물 사진"
                  className={cn(
                    'absolute inset-0 size-full object-cover',
                    portraitExpired(shown, clock) && 'opacity-40 grayscale',
                  )}
                  src={shown.url}
                />
                <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-1 font-semibold text-[11px] text-white">
                  {AI_LABEL_TEXT}
                </span>
                <button
                  aria-label="사진 저장"
                  className={cn(
                    'absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/55 text-white/85 hover:bg-black/75 hover:text-white',
                    FOCUS_RING,
                  )}
                  onClick={() =>
                    void labelImage(shown.blob)
                      .then((labelled) => download(labelled, stampedName('mmm-ai-person', 'jpg')))
                      .catch(() => onAnnounce('사진을 저장하지 못했어요'))
                  }
                  title="AI 생성 이미지 표시를 넣어 저장해요"
                  type="button"
                >
                  <Download className="size-4" />
                </button>
              </>
            ) : (
              <div className="absolute inset-0 grid place-items-center text-white/25">
                {view.kind === 'building' || view.kind === 'done' ? (
                  <Box className="size-12" />
                ) : (
                  <UserRound className="size-16" />
                )}
              </div>
            )}
            {(view.kind === 'generating' || view.kind === 'building') && (
              <div className="absolute inset-0 animate-pulse bg-gradient-to-t from-sky-400/25 to-transparent motion-reduce:animate-none" />
            )}
          </div>
          {portraits.length > 1 && (
            <div aria-label="만든 사진" className="grid grid-cols-4 gap-1.5" role="group">
              {portraits.map((portrait, index) => {
                const expired = portraitExpired(portrait, clock)
                const picked = portrait.url === shownUrl
                return (
                  <button
                    aria-label={`${index + 1}번째 사진${expired ? ' (시간 지남)' : ''}`}
                    aria-pressed={picked}
                    className={cn(
                      'relative aspect-square overflow-hidden rounded-lg',
                      FOCUS_RING,
                      picked ? 'ring-2 ring-sky-400' : 'ring-1 ring-white/10 hover:ring-white/40',
                    )}
                    disabled={view.kind === 'generating' || view.kind === 'starting'}
                    key={portrait.url}
                    onClick={() => {
                      setShownUrl(portrait.url)
                      if (step.kind === 'error' || step.kind === 'choose')
                        setStep({ kind: 'review' })
                    }}
                    title={expired ? '시간이 지났어요' : undefined}
                    type="button"
                  >
                    <img
                      alt=""
                      className={cn('size-full object-cover', expired && 'opacity-40 grayscale')}
                      src={portrait.url}
                    />
                  </button>
                )
              })}
            </div>
          )}
          <p className="text-center text-[11px] text-white/45 leading-4">
            {portraitShown
              ? '실제 사람이 아닌, AI가 만든 가상의 인물이에요'
              : '정면을 보는 증명사진처럼 만들어요'}
          </p>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <header className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-bold text-[18px]" id={titleId}>
                <Sparkles className="size-5 text-sky-300" /> AI로 새 인물 만들기
                {mock && (
                  <span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-semibold text-[11px] text-amber-200">
                    목업
                  </span>
                )}
              </h2>
              <p className="mt-1 text-[12px] text-white/50 leading-5">
                고른 생김새로 AI가 인물 사진을 만들고, 그 사진으로 걷고 움직이는 3D 아바타를
                만들어요.
              </p>
            </div>
            <button
              aria-label="닫기"
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white',
                FOCUS_RING,
              )}
              data-autofocus
              onClick={close}
              type="button"
            >
              <X className="size-4" />
            </button>
          </header>

          <Notice mock={mock} />

          {view.kind === 'loading' && (
            <p className="flex items-center gap-2 text-[13px] text-white/70">
              <LoaderCircle className="size-4 animate-spin text-sky-300" /> 확인하고 있어요…
            </p>
          )}

          {view.kind === 'unavailable' && (
            <div className="flex flex-col gap-3">
              <p className="flex items-start gap-2 rounded-xl bg-amber-400/10 px-3 py-3 text-[12px] text-amber-100 leading-5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
                <span>
                  {unavailableCopy(view.reason, process.env.NODE_ENV !== 'production').map(
                    (part, index) =>
                      'code' in part ? (
                        <code
                          className="rounded bg-white/10 px-1 font-mono text-[11px]"
                          key={index}
                        >
                          {part.code}
                        </code>
                      ) : (
                        <span key={index}>{part.text}</span>
                      ),
                  )}
                </span>
              </p>
              {view.retry && (
                <button
                  className={cn(secondary, 'self-start')}
                  onClick={() => askStatus(true)}
                  type="button"
                >
                  <RefreshCw className="size-4" /> 다시 시도
                </button>
              )}
            </div>
          )}

          {view.kind === 'blocked' && (
            <div className="flex flex-col gap-3">
              <p className="flex items-start gap-2 rounded-xl bg-white/[0.05] px-3 py-3 text-[13px] text-white/75 leading-5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
                {view.message}
              </p>
              <button
                className={cn(secondary, 'self-start')}
                onClick={() => askStatus(true)}
                type="button"
              >
                <RefreshCw className="size-4" /> 로그인했어요
              </button>
            </div>
          )}

          {view.kind === 'choose' && (
            <div className="flex flex-col gap-4">
              <Field label="성별">
                <Segmented
                  onPick={(sex) =>
                    patch({ sex, facialHair: sex === 'male' ? choices.facialHair : 'none' })
                  }
                  options={optionsOf('sex', AI_PERSON_SEXES)}
                  value={choices.sex}
                />
              </Field>
              <Field label="나이대">
                <Segmented
                  onPick={(age) => patch({ age })}
                  options={optionsOf('age', AI_PERSON_AGES)}
                  value={choices.age}
                />
              </Field>
              <Field label="인상">
                <ChoiceChips
                  onPick={(impression) => patch({ impression })}
                  options={optionsOf('impression', AI_PERSON_IMPRESSIONS)}
                  value={choices.impression}
                />
              </Field>
              <Field label="얼굴형">
                <ChoiceChips
                  onPick={(faceShape) => patch({ faceShape })}
                  options={optionsOf('faceShape', AI_PERSON_FACE_SHAPES)}
                  value={choices.faceShape}
                />
              </Field>
              <Field label="피부톤">
                <ChoiceChips
                  onPick={(skinTone) => patch({ skinTone })}
                  options={optionsOf('skinTone', AI_PERSON_SKIN_TONES)}
                  swatches={SKIN_TONE_SWATCH}
                  value={choices.skinTone}
                />
              </Field>
              <Field label="외모 계열">
                <ChoiceChips
                  onPick={(heritage) => patch({ heritage })}
                  options={optionsOf('heritage', AI_PERSON_HERITAGES)}
                  value={choices.heritage}
                />
              </Field>
              <Field label="헤어스타일">
                <ChoiceChips
                  onPick={(hairStyle) => patch({ hairStyle })}
                  options={optionsOf('hairStyle', hairStylesFor(choices.sex))}
                  value={choices.hairStyle}
                />
              </Field>
              {choices.hairStyle !== 'shaved' && (
                <Field label="머리색">
                  <ChoiceChips
                    onPick={(hairColour) => patch({ hairColour })}
                    options={optionsOf('hairColour', AI_PERSON_HAIR_COLOURS)}
                    swatches={HAIR_COLOUR_SWATCH}
                    value={choices.hairColour}
                  />
                </Field>
              )}
              {choices.sex === 'male' && (
                <Field label="수염">
                  <ChoiceChips
                    onPick={(facialHair) => patch({ facialHair })}
                    options={optionsOf('facialHair', AI_PERSON_FACIAL_HAIR)}
                    value={choices.facialHair}
                  />
                </Field>
              )}
              <Field label="옷">
                <ChoiceChips
                  onPick={(outfit) => patch({ outfit })}
                  options={optionsOf('outfit', AI_PERSON_OUTFITS)}
                  value={choices.outfit}
                />
              </Field>
              <Field label="옷 색">
                <ChoiceChips
                  onPick={(outfitColour) => patch({ outfitColour })}
                  options={optionsOf('outfitColour', AI_PERSON_OUTFIT_COLOURS)}
                  swatches={OUTFIT_COLOUR_SWATCH}
                  value={choices.outfitColour}
                />
              </Field>
              <Field label={`세부 특징 (선택, ${AI_PERSON_DETAILS_MAX}개까지)`}>
                <ToggleChips
                  onToggle={(detail) => patch({ details: toggleDetail(choices.details, detail) })}
                  open={(detail) => detailOpen(choices.details, detail)}
                  options={AI_PERSON_DETAILS.map((id) => ({
                    id,
                    label: AI_PERSON_LABELS.details[id],
                  }))}
                  picked={choices.details}
                />
                <p className="text-[11px] text-white/45 leading-4">
                  생김새는 고른 항목으로만 정해요. 이름이나 다른 설명은 넣을 수 없어서 실존 인물을
                  닮게 만들 수 없어요. 표정·자세는 3D용으로 정면·무표정으로 정해져 있어요.
                </p>
              </Field>
              {view.spent && (
                <p className="rounded-xl bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100">
                  {view.spent}
                </p>
              )}
            </div>
          )}

          {view.kind === 'generating' && (
            <div className="flex flex-col gap-3" role="status">
              <Bar value={portraitProgressAt(seconds)} />
              <p className="flex items-start justify-between gap-3 text-[12px] text-white/70 leading-5">
                <span>AI가 인물 사진을 만들고 있어요… 보통 15~60초 걸려요</span>
                <span className="shrink-0 text-white/45 tabular-nums">{Math.floor(seconds)}초</span>
              </p>
              <button className={cn(secondary, 'self-start')} onClick={cancel} type="button">
                취소
              </button>
            </div>
          )}

          {view.kind === 'review' && (
            <div className="flex flex-col gap-2" role="status">
              {view.gate.good ? (
                <p className="flex items-center gap-2 rounded-xl bg-emerald-400/10 px-3 py-2 text-[12px] text-emerald-100">
                  <CircleCheck className="size-4 shrink-0 text-emerald-300" />
                  3D로 만들기 좋은 사진이에요.
                </p>
              ) : (
                view.gate.issues.length > 0 && (
                  <ul className="flex flex-col gap-1 rounded-xl bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100 leading-5">
                    {view.gate.issues.map((issue) => (
                      <li className="flex items-start gap-2" key={issue}>
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                )
              )}
              {view.gate.note && (
                <p className="flex items-center gap-2 text-[12px] text-white/60 leading-5">
                  {shown?.check.kind === 'checking' && (
                    <LoaderCircle className="size-3.5 shrink-0 animate-spin text-sky-300" />
                  )}
                  {view.gate.note}
                </p>
              )}
              <p className="text-[12px] text-white/45">
                {[
                  leftText('사진', view.portraitsLeft, '장'),
                  leftText('3D 변환', view.avatarsLeft, '번'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          )}

          {view.kind === 'starting' && (
            <p className="flex items-center gap-2 text-[13px] text-white/70" role="status">
              <LoaderCircle className="size-4 animate-spin text-sky-300" /> 3D 아바타 서비스에
              보내고 있어요…
            </p>
          )}

          {view.kind === 'error' && (
            <p
              className="flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-3 text-[13px] text-rose-100 leading-5"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-300" />
              {view.message}
            </p>
          )}

          {view.kind === 'making' && (
            <div className="flex flex-col gap-3" role="status">
              <Bar value={view.fraction} />
              <p className="flex items-center gap-2 text-[12px] text-white/70 leading-5">
                <LoaderCircle className="size-3.5 shrink-0 animate-spin text-sky-300 motion-reduce:animate-none" />
                {view.text}
              </p>
              <p className="rounded-xl bg-white/[0.05] px-3 py-2 text-[12px] text-white/60 leading-5">
                이 브라우저에서 바로 만들어요 (1분쯤). 창을 닫으면 멈춰요.
              </p>
            </div>
          )}

          {view.kind === 'made' && (
            <div className="flex flex-col gap-2" role="status">
              <p className="flex items-center gap-2 font-bold text-[16px]">
                <CircleCheck className="size-5 text-emerald-300" /> AI 인물이 완성됐어요
              </p>
              <p className="text-[13px] text-white/70 leading-5">
                ‘{view.name}’ — 실사 목록에 AI 생성 인물로 추가하고 골라 두었어요. 이 브라우저에만
                저장돼요. 걷기·뛰기와 감정 동작을 바로 쓸 수 있어요.
              </p>
            </div>
          )}

          {view.kind === 'building' && (
            <div className="flex flex-col gap-3" role="status">
              <Bar value={view.job.progress / 100} />
              <p className="flex items-start justify-between gap-3 text-[12px] text-white/70 leading-5">
                <span>{buildStageText(view.job)}</span>
                <span className="shrink-0 text-white/45 tabular-nums">
                  {elapsedText(clock - view.job.startedAt)}
                </span>
              </p>
              {view.job.signInNeeded && (
                <p className="flex items-start gap-2 rounded-xl bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100 leading-5">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                  로그인이 풀린 것 같아요. 다시 로그인하면 이어서 확인해요. 만들기는 서버에서
                  계속돼요.
                </p>
              )}
              <p className="rounded-xl bg-white/[0.05] px-3 py-2 text-[12px] text-white/60 leading-5">
                보통 몇 분 걸려요. 이 창이나 스튜디오를 닫아도, 페이지를 새로고침해도 서버에서 계속
                만들어요. 다 되면 실사 목록에 나타나고 바로 골라 둘게요.
              </p>
            </div>
          )}

          {view.kind === 'done' && (
            <div className="flex flex-col gap-2" role="status">
              <p className="flex items-center gap-2 font-bold text-[16px]">
                <CircleCheck className="size-5 text-emerald-300" /> AI 인물이 완성됐어요
              </p>
              <p className="text-[13px] text-white/70 leading-5">
                ‘{view.name}’ — 실사 목록에 AI 생성 인물로 추가하고 골라 두었어요. 걷기·뛰기와 감정
                동작을 바로 쓸 수 있어요. ‘완료’를 누르면 게임 캐릭터가 바뀌어요.
              </p>
            </div>
          )}

          {view.kind === 'failed' && (
            <p
              className="flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-3 text-[13px] text-rose-100 leading-5"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-300" />
              {view.message}
            </p>
          )}

          {/* Kept in sight at the bottom while the long list of choices scrolls. */}
          <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-2 bg-gradient-to-t from-75% from-neutral-950 to-neutral-950/0 pt-4 pb-6">
            {view.kind === 'choose' && (
              <>
                <button
                  className={primary}
                  disabled={!view.canGenerate}
                  onClick={() => void generate()}
                  type="button"
                >
                  <Sparkles className="size-4" /> 인물 사진 만들기
                </button>
                <button
                  className={secondary}
                  onClick={() => setChoices(randomChoices(choices))}
                  type="button"
                >
                  <Dices className="size-4" /> 무작위
                </button>
                {portraits.length > 0 && (
                  <button
                    className={secondary}
                    onClick={() => setStep({ kind: 'review' })}
                    type="button"
                  >
                    만든 사진 보기
                  </button>
                )}
                {portraitLeft !== null && (
                  <span className="text-[12px] text-white/45">오늘 {portraitLeft}장 남음</span>
                )}
              </>
            )}
            {view.kind === 'review' && shown && (
              <>
                {status?.available && !status.avatarService ? (
                  <button
                    className={primary}
                    disabled={!view.gate.ready}
                    onClick={() => void makeHere()}
                    type="button"
                  >
                    <Box className="size-4" /> 이 얼굴로 아바타 만들기
                  </button>
                ) : (
                  <button
                    className={primary}
                    disabled={!view.gate.ready}
                    onClick={() => setStep({ kind: 'confirm' })}
                    type="button"
                  >
                    <Box className="size-4" /> 이 얼굴로 3D 아바타 만들기
                  </button>
                )}
                <button
                  className={secondary}
                  disabled={view.portraitsLeft === 0}
                  onClick={() => void generate()}
                  type="button"
                >
                  <RefreshCw className="size-4" /> 다시 만들기
                </button>
                <button
                  className={secondary}
                  onClick={() => setStep({ kind: 'choose' })}
                  type="button"
                >
                  생김새 바꾸기
                </button>
              </>
            )}
            {view.kind === 'error' && (
              <>
                <button
                  className={primary}
                  disabled={waitLeft > 0}
                  onClick={() =>
                    setStep({ kind: view.back === 'review' && shown ? 'review' : 'choose' })
                  }
                  type="button"
                >
                  <RefreshCw className="size-4" />
                  {waitLeft > 0 ? `${waitLeft}초 뒤에 다시 시도` : '돌아가기'}
                </button>
              </>
            )}
            {view.kind === 'building' && (
              <button className={primary} onClick={close} type="button">
                닫고 기다리기
              </button>
            )}
            {view.kind === 'making' && (
              <button className={secondary} onClick={() => making.current?.abort()} type="button">
                멈추기
              </button>
            )}
            {view.kind === 'made' && (
              <>
                <button className={primary} onClick={close} type="button">
                  <Check className="size-4" strokeWidth={3} /> 확인
                </button>
                <button
                  className={secondary}
                  onClick={() => setStep({ kind: 'choose' })}
                  type="button"
                >
                  <Sparkles className="size-4" /> 한 명 더 만들기
                </button>
              </>
            )}
            {view.kind === 'done' && (
              <>
                <button className={primary} onClick={close} type="button">
                  <Check className="size-4" strokeWidth={3} /> 확인
                </button>
                <button className={secondary} onClick={again} type="button">
                  <Sparkles className="size-4" /> 한 명 더 만들기
                </button>
              </>
            )}
            {view.kind === 'failed' && (
              <>
                <button className={primary} onClick={again} type="button">
                  <RefreshCw className="size-4" /> 사진부터 다시 만들기
                </button>
                <button className={secondary} onClick={close} type="button">
                  닫기
                </button>
              </>
            )}
          </div>
        </div>

        {view.kind === 'confirm' && shown && (
          <div className="absolute inset-0 grid place-items-center rounded-3xl bg-neutral-950/85 backdrop-blur-sm">
            <div
              aria-labelledby={`${titleId}-confirm`}
              className="flex w-[min(340px,calc(100%-32px))] flex-col gap-3 text-center"
              data-focus-scope
              role="alertdialog"
            >
              <p className="font-bold text-[16px]" id={`${titleId}-confirm`}>
                3D 아바타를 만들까요?
              </p>
              <p className="text-[13px] text-white/70 leading-5">
                이 사진을 3D 아바타 서비스로 보내 움직이는 아바타를 만들어요. 몇 분 걸리고, 그동안
                창을 닫아도 돼요.
              </p>
              {view.avatarsLeft !== null && (
                <p className="text-[12px] text-white/55">
                  오늘 {view.avatarsLeft}번 더 만들 수 있어요.
                </p>
              )}
              <p className="text-[12px] text-white/55">
                만든 아바타는 실사 목록에 ‘AI 생성 인물’로 표시돼요.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  className={cn(secondary, 'flex-1')}
                  onClick={() => setStep({ kind: 'review' })}
                  type="button"
                >
                  취소
                </button>
                <button
                  className={cn(primary, 'h-10 flex-1 px-4 text-[13px]')}
                  data-autofocus
                  onClick={() => void build()}
                  type="button"
                >
                  3D 아바타 만들기
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmingClose && (
          <div className="absolute inset-0 grid place-items-center rounded-3xl bg-neutral-950/85 backdrop-blur-sm">
            <div
              className="flex w-[300px] flex-col gap-4 text-center"
              data-focus-scope
              role="alertdialog"
            >
              <p className="font-bold text-[15px]">만들기를 멈추고 닫을까요?</p>
              <div className="flex gap-2">
                <button
                  className={cn(secondary, 'flex-1')}
                  onClick={() => setConfirmingClose(false)}
                  type="button"
                >
                  계속 만들기
                </button>
                <button
                  className={cn(
                    'h-10 flex-1 rounded-full bg-rose-500 font-semibold text-[13px] text-white hover:bg-rose-400',
                    FOCUS_RING,
                  )}
                  onClick={() => {
                    cancel()
                    onClose()
                  }}
                  type="button"
                >
                  멈추고 닫기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
