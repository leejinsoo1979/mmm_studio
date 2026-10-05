'use client'

import type { AvatarLook } from '@pascal-app/editor'
import { Download, LoaderCircle, RefreshCw, TriangleAlert, WandSparkles, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  type AiPhotoClientStatus,
  type AiPhotoFraming,
  type AiPhotoResult,
  avatarSubject,
  avatarTakesFace,
  createAiPhoto,
  facePhotoBlob,
  getAiPhotoStatus,
} from '@/lib/ai-photo/client'
import { cn } from '@/lib/utils'
import {
  type AiPhotoRequestState,
  aiPhotoView,
  defaultFraming,
  download,
  FRAMING_LABELS,
  labelImage,
  progressAt,
  progressText,
  showsConsent,
  stampedName,
  unavailableCopy,
} from './ai-photo-label'
import type { CameraFocus } from './stage-contract'
import { FOCUS_RING, Segmented } from './studio-controls'

const FRAMINGS = (['face', 'upper', 'full'] as const).map((id) => ({
  id,
  label: FRAMING_LABELS[id],
}))

type Shot =
  | { kind: 'capturing'; framing: AiPhotoFraming }
  | { kind: 'ready'; framing: AiPhotoFraming; blob: Blob; url: string }
  | { kind: 'failed'; framing: AiPhotoFraming }

const primary = cn(
  'flex h-11 items-center justify-center gap-1.5 rounded-full bg-sky-400 px-6 font-semibold text-[14px] text-neutral-950 shadow-[0_8px_24px_rgba(56,189,248,0.35)] transition duration-200 ease-out hover:bg-sky-300 disabled:opacity-40 disabled:shadow-none disabled:hover:bg-sky-400 motion-reduce:transition-none',
  FOCUS_RING,
)
const secondary = cn(
  'flex h-10 items-center justify-center gap-1.5 rounded-full bg-white/10 px-4 font-medium text-[13px] text-white/85 transition duration-200 ease-out hover:bg-white/15 disabled:opacity-40 motion-reduce:transition-none',
  FOCUS_RING,
)

/**
 * AI 실사 사진: the character as posed now, captured clean, turned into a
 * photorealistic portrait by the server. The dialog walks the states the
 * route can be in (off, signed out, ready, making it, done, failed), shows
 * exactly what will be sent, asks before a face photo goes along, and hands
 * out the result only with "AI 생성 이미지" burned in.
 */
export function AiPhotoDialog({
  avatarId,
  look,
  npc,
  focus,
  capture,
  onClose,
  onAnnounce,
}: {
  avatarId: string
  look: AvatarLook
  npc: boolean
  focus: CameraFocus
  /** A clean capture for the framing (rejects while the character loads). */
  capture: (framing: AiPhotoFraming) => Promise<Blob>
  onClose: () => void
  onAnnounce: (text: string) => void
}) {
  const titleId = useId()
  const [status, setStatus] = useState<AiPhotoClientStatus | null>(null)
  const [framing, setFraming] = useState<AiPhotoFraming>(() => defaultFraming(focus))
  const [shot, setShot] = useState<Shot | null>(null)
  const [consent, setConsent] = useState(false)
  const [request, setRequest] = useState<AiPhotoRequestState>({ kind: 'idle' })
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(() => performance.now())
  const [retryAt, setRetryAt] = useState(0)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [captureTry, setCaptureTry] = useState(0)
  const urls = useRef(new Set<string>())
  const inFlight = useRef<AbortController | null>(null)
  const dialog = useRef<HTMLDivElement>(null)

  const child = avatarSubject(avatarId)?.child ?? false
  const view = aiPhotoView(status, { child, request })
  const usable = status?.available === true
  const consentShown = showsConsent({
    status,
    hasFacePhoto: Boolean(look.face),
    takesFace: avatarTakesFace(avatarId),
    npc,
  })

  const keep = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob)
    urls.current.add(url)
    return url
  }, [])
  const letGo = useCallback((url: string | undefined) => {
    if (!url) return
    URL.revokeObjectURL(url)
    urls.current.delete(url)
  }, [])

  // Everything handed out is let go, and a request on its way stopped, on closing.
  useEffect(
    () => () => {
      inFlight.current?.abort()
      inFlight.current = null
      for (const url of urls.current) URL.revokeObjectURL(url)
      urls.current.clear()
    },
    [],
  )

  const askStatus = useCallback((fresh: boolean) => {
    setStatus(null)
    let current = true
    getAiPhotoStatus({ fresh }).then((answer) => current && setStatus(answer))
    return () => {
      current = false
    }
  }, [])
  useEffect(() => askStatus(false), [askStatus])

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])

  // The capture follows the framing, so the preview is exactly what is sent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: captureTry asks for it again
  useEffect(() => {
    if (!usable) return
    let current = true
    setShot({ kind: 'capturing', framing })
    capture(framing)
      .then((blob) => {
        if (!current) return
        const url = keep(blob)
        setShot((old) => {
          if (old?.kind === 'ready') letGo(old.url)
          return { kind: 'ready', framing, blob, url }
        })
      })
      .catch(() => current && setShot({ kind: 'failed', framing }))
    return () => {
      current = false
    }
  }, [usable, framing, capture, keep, letGo, captureTry])

  const generating = request.kind === 'generating'
  useEffect(() => {
    if (!generating && retryAt <= Date.now()) return
    const timer = window.setInterval(() => setNow(performance.now()), 250)
    return () => window.clearInterval(timer)
  }, [generating, retryAt])

  const generate = async () => {
    if (shot?.kind !== 'ready' || generating) return
    const controller = new AbortController()
    inFlight.current = controller
    setRequest({ kind: 'generating' })
    setStartedAt(performance.now())
    setNow(performance.now())
    setRetryAt(0)
    setPhoto((old) => {
      letGo(old?.url)
      return null
    })
    onAnnounce('AI 실사 사진을 만들기 시작했어요')
    const sendFace = consentShown && consent && look.face
    const face = sendFace ? await facePhotoBlob(sendFace.photo) : null
    let result: AiPhotoResult = await createAiPhoto({
      render: shot.blob,
      face,
      consent: Boolean(sendFace),
      avatarId,
      framing: shot.framing,
      hints: {
        hair: look.hair,
        skin: look.skin,
        eyes: look.paint.eyes ?? look.face?.eyes ?? null,
        lips: look.paint.lips,
      },
      signal: controller.signal,
    })
    if (inFlight.current !== controller) return
    inFlight.current = null
    if (result.ok) {
      try {
        const blob = await labelImage(result.image)
        setPhoto({ blob, url: keep(blob) })
      } catch {
        // Never handed out without its label.
        result = { ok: false, code: 'invalid_image' }
      }
    }
    if (!result.ok && result.code === 'rate_limited' && result.retryAfter) {
      setRetryAt(Date.now() + result.retryAfter * 1000)
    }
    setRequest({ kind: 'done', result })
    onAnnounce(result.ok ? 'AI 실사 사진이 완성됐어요' : '사진을 만들지 못했어요')
  }

  const cancel = () => {
    inFlight.current?.abort()
  }

  const close = useCallback(() => {
    if (inFlight.current) {
      setConfirmingClose(true)
      return
    }
    onClose()
  }, [onClose])

  // Esc: the studio's own handler leaves it to the dialog while it is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (confirmingClose) setConfirmingClose(false)
      else close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close, confirmingClose])

  const pickFraming = (next: AiPhotoFraming) => {
    if (generating || next === framing) return
    setFraming(next)
    setRequest({ kind: 'idle' })
  }

  const seconds = Math.max(0, (now - startedAt) / 1000)
  const waitLeft = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
  const shown =
    photo && view.kind === 'result' ? photo.url : shot?.kind === 'ready' ? shot.url : null
  const tall = (view.kind === 'result' ? framing : (shot?.framing ?? framing)) !== 'face'
  const controlsShown = view.kind === 'ready' || view.kind === 'result' || view.kind === 'error'

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
        className="relative flex max-h-[calc(100vh-48px)] w-[min(760px,calc(100vw-48px))] gap-6 overflow-y-auto rounded-3xl bg-neutral-950 p-6 text-white shadow-2xl ring-1 ring-white/10"
        data-focus-scope
        ref={dialog}
        role="dialog"
      >
        <div className="flex w-[300px] shrink-0 flex-col gap-2">
          <div
            className={cn(
              'relative w-full overflow-hidden rounded-2xl bg-white/5',
              tall ? 'aspect-[2/3]' : 'aspect-square',
            )}
          >
            {shown ? (
              <img
                alt={view.kind === 'result' ? 'AI가 만든 실사 사진' : '보낼 캐릭터 사진'}
                className="absolute inset-0 size-full object-contain"
                src={shown}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-white/30">
                {shot?.kind === 'capturing' ? (
                  <LoaderCircle className="size-6 animate-spin" />
                ) : (
                  <WandSparkles className="size-8" />
                )}
              </div>
            )}
            {generating && (
              <div className="absolute inset-0 animate-pulse bg-gradient-to-t from-sky-400/25 to-transparent motion-reduce:animate-none" />
            )}
          </div>
          <p className="text-center text-[12px] text-white/50">
            {view.kind === 'result'
              ? '사진 왼쪽 아래에 AI 생성 이미지 표시가 들어가요'
              : shot?.kind === 'failed'
                ? '캐릭터를 아직 불러오고 있어요'
                : usable
                  ? '이 모습으로 만들어요'
                  : ''}
          </p>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <header className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-bold text-[18px]" id={titleId}>
                <WandSparkles className="size-5 text-sky-300" /> AI 실사 사진
              </h2>
              <p className="mt-1 text-[12px] text-white/50 leading-5">
                지금 모습 그대로, 사진 같은 인물 사진으로 만들어요.
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
                  {unavailableCopy(view.reason).map((part, index) =>
                    'code' in part ? (
                      <code className="rounded bg-white/10 px-1 font-mono text-[11px]" key={index}>
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
            <p className="flex items-start gap-2 rounded-xl bg-white/[0.05] px-3 py-3 text-[13px] text-white/75 leading-5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
              {view.message}
            </p>
          )}

          {controlsShown && (
            <div className="flex flex-col gap-2">
              <span className="text-[12px] text-white/50">구도</span>
              <Segmented onPick={pickFraming} options={FRAMINGS} value={framing} />
            </div>
          )}

          {controlsShown && consentShown && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
              <input
                checked={consent}
                className="mt-0.5 size-4 shrink-0 accent-sky-400"
                onChange={(event) => setConsent(event.target.checked)}
                type="checkbox"
              />
              <span className="flex flex-col gap-1">
                <span className="text-[13px] text-white/90">
                  내 얼굴 사진도 함께 보내 더 닮게 만들기
                </span>
                <span className="text-[11px] text-white/50 leading-4">
                  본인 얼굴이거나 얼굴 주인에게 동의를 받았어요. 사진은 서버에 저장되지 않아요.
                </span>
              </span>
            </label>
          )}

          {view.kind === 'generating' && (
            <div className="flex flex-col gap-3" role="status">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-sky-400 transition-[width] duration-200 ease-out motion-reduce:transition-none"
                  style={{ width: `${progressAt(seconds) * 100}%` }}
                />
              </div>
              <p className="flex items-start justify-between gap-3 text-[12px] text-white/70 leading-5">
                <span>{progressText(seconds)}</span>
                <span className="shrink-0 text-white/45 tabular-nums">{Math.floor(seconds)}초</span>
              </p>
              <button className={cn(secondary, 'self-start')} onClick={cancel} type="button">
                취소
              </button>
            </div>
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

          {view.kind === 'result' && view.remainingToday !== null && (
            <p className="text-[12px] text-white/50">
              오늘 {view.remainingToday}장 더 만들 수 있어요
            </p>
          )}

          <div className="mt-auto flex flex-wrap items-center gap-2">
            {(view.kind === 'ready' || view.kind === 'blocked') && (
              <button
                className={primary}
                disabled={view.kind === 'blocked' || shot?.kind !== 'ready'}
                onClick={() => void generate()}
                type="button"
              >
                <WandSparkles className="size-4" /> 만들기
              </button>
            )}
            {view.kind === 'ready' && shot?.kind === 'failed' && (
              <button
                className={secondary}
                onClick={() => setCaptureTry((n) => n + 1)}
                type="button"
              >
                <RefreshCw className="size-4" /> 다시 찍기
              </button>
            )}
            {view.kind === 'error' && (
              <button
                className={primary}
                disabled={waitLeft > 0 || shot?.kind !== 'ready'}
                onClick={() => void generate()}
                type="button"
              >
                <RefreshCw className="size-4" />
                {waitLeft > 0 ? `${waitLeft}초 뒤에 다시 시도` : '다시 시도'}
              </button>
            )}
            {view.kind === 'result' && photo && (
              <>
                <button
                  className={primary}
                  onClick={() => download(photo.blob, stampedName('mmm-ai-photo', 'jpg'))}
                  type="button"
                >
                  <Download className="size-4" /> 저장
                </button>
                <button className={secondary} onClick={() => void generate()} type="button">
                  <RefreshCw className="size-4" /> 다시 만들기
                </button>
              </>
            )}
          </div>
        </div>

        {confirmingClose && (
          <div className="absolute inset-0 grid place-items-center rounded-3xl bg-neutral-950/85 backdrop-blur-sm">
            <div className="flex w-[300px] flex-col gap-4 text-center" role="alertdialog">
              <p className="font-bold text-[15px]">사진 만들기를 멈추고 닫을까요?</p>
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
