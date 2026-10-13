'use client'

import {
  type AvatarGender,
  addPhotoAvatar,
  CAPTURE_STEPS,
  type CaptureSlot,
  discardPhotoAvatarPreview,
  type GuideState,
  previewPhotoAvatar,
  type StoredPhotoAvatar,
  startGuide,
} from '@pascal-app/editor'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ImageUp,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { runGuidedCapture } from '@/lib/guided-capture'
import { readPhotoAvatarStatus } from '@/lib/photo-avatar-policy'
import { type PhotorealAiClientStatus, photorealAiClient } from '@/lib/photoreal-ai/client'
import { cn } from '@/lib/utils'
import {
  type MakeProgress,
  makePhotoAvatar,
  openPicture,
  PhotoAvatarError,
  type PhotoInput,
} from './photo-avatar-make'
import { FOCUS_RING } from './studio-controls'

/**
 * 사진으로 실사 아바타 만들기: from a guided 3D face capture (front, ¾ and
 * full side views each way — the side views give the profile its real
 * shape), from photos the player uploads, from one photo, or from an AI-made
 * fictional face (AI 인물). Everything is made and kept in this browser; the
 * avatar is shown on the stage before it is kept.
 */

type Source = 'capture' | 'photo'
type Slot = Exclude<CaptureSlot, 'free'>

type Stage =
  | { kind: 'source' }
  | { kind: 'camera' }
  | { kind: 'upload'; source: Source }
  | { kind: 'details'; source: Source }
  | { kind: 'making'; progress: MakeProgress }
  | { kind: 'preview'; avatar: StoredPhotoAvatar }
  | { kind: 'error'; message: string }

type Shot = { picture: HTMLImageElement | HTMLCanvasElement; url: string }

/**
 * An uploaded photo's slot by where the nose points in the picture (a turn to one's left puts it
 * on the picture's right): what the fit reads the side from, whoever took the photo.
 */
const SLOT_LABEL: Record<Slot, string> = {
  front: '정면',
  left45: '45° · 코가 오른쪽',
  right45: '45° · 코가 왼쪽',
  left90: '옆얼굴 · 코가 오른쪽',
  right90: '옆얼굴 · 코가 왼쪽',
}
const UPLOAD_SLOTS: Record<Source, readonly Slot[]> = {
  capture: ['front', 'left45', 'right45', 'left90', 'right90'],
  photo: ['front'],
}

const primary = cn(
  'flex h-11 items-center justify-center gap-1.5 rounded-full bg-sky-400 px-6 font-semibold text-[14px] text-neutral-950 shadow-[0_8px_24px_rgba(56,189,248,0.35)] transition duration-200 ease-out hover:bg-sky-300 disabled:opacity-40 disabled:shadow-none disabled:hover:bg-sky-400 motion-reduce:transition-none',
  FOCUS_RING,
)
const secondary = cn(
  'flex h-10 items-center justify-center gap-1.5 rounded-full bg-white/10 px-4 font-medium text-[13px] text-white/85 transition duration-200 ease-out hover:bg-white/15 disabled:opacity-40 motion-reduce:transition-none',
  FOCUS_RING,
)

const development = process.env.NODE_ENV !== 'production'

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

function shotOf(canvas: HTMLCanvasElement): Shot {
  return { picture: canvas, url: canvas.toDataURL('image/jpeg', 0.7) }
}

/**
 * The guided capture: the camera, an oval to put the face in, which way to
 * turn, and each pose taken by itself once the person holds it (the
 * sharpest frame of the moment). Poses can be taken again or skipped (not
 * the front one).
 */
function GuidedCapture({
  shots,
  onShot,
  onAnnounce,
  onUpload,
}: {
  shots: Partial<Record<Slot, Shot>>
  onShot: (slot: Slot, shot: Shot) => void
  onAnnounce: (text: string) => void
  onUpload: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<GuideState>(() => startGuide(firstMissing(shots)))
  const [message, setMessage] = useState('카메라를 켜고 있어요…')
  const [ready, setReady] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 960 } })
      .then((media) => {
        if (stopped) {
          for (const track of media.getTracks()) track.stop()
          return
        }
        stream = media
        if (videoRef.current) {
          videoRef.current.srcObject = media
          void videoRef.current.play()
        }
      })
      .catch(() =>
        setError('카메라를 켤 수 없어요. 브라우저의 카메라 권한을 확인하거나 사진을 올려 주세요.'),
      )
    if (!navigator.mediaDevices)
      setError('이 브라우저에서는 카메라를 쓸 수 없어요. 사진을 올려 주세요.')
    return () => {
      stopped = true
      for (const track of stream?.getTracks() ?? []) track.stop()
    }
  }, [])

  // Frame by frame (a few a second): read the pose, tell the person, keep the sharpest steady frame.
  useEffect(
    () =>
      runGuidedCapture(() => videoRef.current, stateRef, {
        onAdvice: (text, inPosition) => {
          setMessage(text)
          setReady(inPosition)
        },
        onShot: (step, frame) => {
          onShot(step.slot, shotOf(frame))
          onAnnounce(`${step.label} 사진을 찍었어요`)
        },
        onState: setState,
        onError: () => setMessage('얼굴을 읽지 못했어요. 잠시만 기다려 주세요'),
      }),
    [onAnnounce, onShot],
  )

  const step = CAPTURE_STEPS[state.step]
  const goTo = (index: number) => {
    const next = { ...startGuide(index), lastYaw: stateRef.current.lastYaw }
    stateRef.current = next
    setState(next)
  }
  // On the mirrored picture, turning to one's left moves the nose to the screen's left.
  const arrow = !step || step.yaw === 0 ? null : step.yaw > 0 ? 'left' : 'right'

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <p
          className="flex items-start gap-2 rounded-xl bg-amber-400/10 px-3 py-3 text-[13px] text-amber-100 leading-5"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
          {error}
        </p>
        <button className={secondary} onClick={onUpload} type="button">
          <ImageUp className="size-4" /> 사진 올리기로 하기
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-neutral-900">
        <video
          className="h-full w-full -scale-x-100 object-cover"
          muted
          playsInline
          ref={videoRef}
        />
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full"
          viewBox="0 0 400 300"
        >
          <ellipse
            cx={200}
            cy={140}
            fill="none"
            rx={step && Math.abs(step.yaw) === 90 ? 62 : 70}
            ry={92}
            stroke={ready ? '#34d399' : 'rgba(255,255,255,0.85)'}
            strokeDasharray={ready ? undefined : '8 6'}
            strokeWidth={3}
          />
          {arrow && (
            <path
              d={
                arrow === 'left'
                  ? 'M110 140 l-34 0 m0 0 l14 -14 m-14 14 l14 14'
                  : 'M290 140 l34 0 m0 0 l-14 -14 m14 14 l-14 14'
              }
              fill="none"
              stroke="#38bdf8"
              strokeLinecap="round"
              strokeWidth={6}
            />
          )}
        </svg>
        <p
          aria-live="polite"
          className={cn(
            'absolute inset-x-3 bottom-3 rounded-xl px-3 py-2 text-center font-semibold text-[13px]',
            ready ? 'bg-emerald-500/85 text-white' : 'bg-black/65 text-white',
          )}
        >
          {step
            ? `${step.label} · ${message}`
            : '다 찍었어요. 아래에서 다시 찍거나 만들기로 넘어가세요'}
        </p>
      </div>
      <div aria-label="촬영 단계" className="grid grid-cols-5 gap-1.5" role="group">
        {CAPTURE_STEPS.map((one, index) => {
          const shot = shots[one.slot]
          const current = index === state.step
          return (
            <button
              aria-current={current ? 'step' : undefined}
              className={cn(
                'relative flex aspect-[3/4] flex-col items-center justify-end overflow-hidden rounded-xl bg-white/[0.06] p-1 text-[10px] text-white/75',
                FOCUS_RING,
                current ? 'ring-2 ring-sky-400' : 'ring-1 ring-white/10 hover:ring-white/40',
              )}
              key={one.slot}
              onClick={() => goTo(index)}
              title={shot ? `${one.label} 다시 찍기` : `${one.label} 찍기`}
              type="button"
            >
              {shot && (
                <img
                  alt=""
                  className="absolute inset-0 size-full -scale-x-100 object-cover"
                  src={shot.url}
                />
              )}
              <span className="relative flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5">
                {shot && <Check className="size-3 text-emerald-300" strokeWidth={3} />}
                {one.label}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {step && step.slot !== 'front' && (
          <button className={secondary} onClick={() => goTo(state.step + 1)} type="button">
            이 각도 건너뛰기
          </button>
        )}
        <button className={secondary} onClick={onUpload} type="button">
          <ImageUp className="size-4" /> 사진 올리기로 바꾸기
        </button>
      </div>
    </div>
  )
}

function firstMissing(shots: Partial<Record<Slot, Shot>>): number {
  const index = CAPTURE_STEPS.findIndex((step) => !shots[step.slot])
  return index < 0 ? CAPTURE_STEPS.length : index
}

/** One upload slot: a photo the player picks for a pose. */
function UploadSlot({
  slot,
  shot,
  required,
  onPick,
  onClear,
}: {
  slot: Slot
  shot: Shot | undefined
  required: boolean
  onPick: (file: File) => void
  onClear: () => void
}) {
  const inputId = useId()
  return (
    <div className="relative">
      <label
        className={cn(
          'flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed text-center text-[11px] focus-within:ring-2 focus-within:ring-sky-400',
          shot
            ? 'border-transparent'
            : 'border-white/25 bg-white/[0.04] text-white/70 hover:border-white/50',
        )}
        htmlFor={inputId}
      >
        {shot ? (
          <img
            alt={`${SLOT_LABEL[slot]} 사진`}
            className="absolute inset-0 size-full object-cover"
            src={shot.url}
          />
        ) : (
          <>
            <ImageUp className="size-5 text-white/50" />
            <span>{SLOT_LABEL[slot]}</span>
            <span className="text-[10px] text-white/40">{required ? '필수' : '선택'}</span>
          </>
        )}
        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          id={inputId}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onPick(file)
          }}
          type="file"
        />
      </label>
      {shot && (
        <>
          <span className="pointer-events-none absolute inset-x-1 bottom-1 rounded-full bg-black/60 px-1.5 py-0.5 text-center text-[10px] text-white">
            {SLOT_LABEL[slot]}
          </span>
          <button
            aria-label={`${SLOT_LABEL[slot]} 사진 빼기`}
            className={cn(
              'absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white/85 hover:bg-rose-500',
              FOCUS_RING,
            )}
            onClick={onClear}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

export function PhotoAvatarDialog({
  defaultGender,
  onClose,
  onAnnounce,
  onShow,
  onKeep,
  onAiPerson,
}: {
  defaultGender: AvatarGender
  onClose: () => void
  onAnnounce: (text: string) => void
  /** Shows a 실사 character on the stage without picking it (null: back to what was there). */
  onShow: (id: string | null) => void
  /** The avatar was kept: pick it. */
  onKeep: (id: string) => void
  /** Go on to AI 인물 (an AI-made fictional face). */
  onAiPerson: () => void
}) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Stage>({ kind: 'source' })
  const [faceAllowed, setFaceAllowed] = useState<boolean | null>(null)
  const [aiStatus, setAiStatus] = useState<PhotorealAiClientStatus | null>(null)
  const [consent, setConsent] = useState(false)
  const [gender, setGender] = useState<AvatarGender>(defaultGender)
  const [name, setName] = useState('')
  const [shots, setShots] = useState<Partial<Record<Slot, Shot>>>({})
  const [saving, setSaving] = useState(false)
  const making = useRef<AbortController | null>(null)

  useEffect(() => {
    let current = true
    fetch('/api/photo-avatar', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((value) => current && setFaceAllowed(readPhotoAvatarStatus(value).faceAllowed))
    photorealAiClient()
      .status()
      .then((status) => current && setAiStatus(status))
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])

  // A build stopped, and an avatar shown but not kept let go, on closing.
  useEffect(
    () => () => {
      making.current?.abort()
      discardPhotoAvatarPreview()
    },
    [],
  )

  const close = useCallback(() => {
    if (stage.kind === 'preview') onShow(null)
    onClose()
  }, [onClose, onShow, stage.kind])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.target instanceof Element && event.target.closest('textarea, input')) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close])

  const onShot = useCallback((slot: Slot, shot: Shot) => {
    setShots((old) => ({ ...old, [slot]: shot }))
  }, [])

  const pick = async (slot: Slot, file: File) => {
    try {
      const picture = await openPicture(file)
      // The slot shows a small copy: the file's own URL is let go once it is read.
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 320 / Math.max(picture.naturalWidth, picture.naturalHeight))
      canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale))
      canvas.getContext('2d')!.drawImage(picture, 0, 0, canvas.width, canvas.height)
      const url = canvas.toDataURL('image/jpeg', 0.8)
      setShots((old) => ({ ...old, [slot]: { picture, url } }))
    } catch (error) {
      onAnnounce(error instanceof PhotoAvatarError ? error.message : '사진을 열 수 없어요')
    }
  }

  const make = async (source: Source) => {
    const slots = source === 'photo' ? (['front'] as const) : UPLOAD_SLOTS.capture
    const photos: PhotoInput[] = slots.flatMap((slot) => {
      const shot = shots[slot]
      return shot ? [{ picture: shot.picture, slot }] : []
    })
    const controller = new AbortController()
    making.current = controller
    setStage({ kind: 'making', progress: { fraction: 0, text: '시작하고 있어요' } })
    onAnnounce('아바타를 만들기 시작했어요')
    try {
      const avatar = await makePhotoAvatar({
        photos,
        gender,
        name: name.trim() || '사진 아바타',
        source,
        signal: controller.signal,
        onProgress: (progress) => {
          if (making.current === controller) setStage({ kind: 'making', progress })
        },
      })
      if (making.current !== controller) return
      making.current = null
      const character = previewPhotoAvatar(avatar)
      onShow(character.id)
      setStage({ kind: 'preview', avatar })
      onAnnounce('아바타가 나왔어요. 무대에서 돌려 보며 확인해 보세요')
    } catch (error) {
      if (making.current !== controller) return
      making.current = null
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStage({ kind: 'details', source })
        return
      }
      setStage({
        kind: 'error',
        message:
          error instanceof PhotoAvatarError
            ? error.message
            : '아바타를 만들지 못했어요. 다시 시도해 주세요.',
      })
      onAnnounce('아바타를 만들지 못했어요')
    }
  }

  const keep = async (avatar: StoredPhotoAvatar) => {
    setSaving(true)
    try {
      const character = await addPhotoAvatar({ ...avatar, name: name.trim() || avatar.name })
      onKeep(character.id)
      onAnnounce(`‘${character.label}’을 실사 목록에 저장했어요`)
      onClose()
    } catch {
      setSaving(false)
      discard()
      onAnnounce('저장하지 못했어요')
      setStage({
        kind: 'error',
        message:
          '이 브라우저에 저장하지 못했어요. 저장 공간이 부족하거나 개인정보 보호 모드일 수 있어요.',
      })
    }
  }

  const discard = () => {
    discardPhotoAvatarPreview()
    onShow(null)
  }

  const source = stage.kind === 'upload' || stage.kind === 'details' ? stage.source : null
  const hasFront = Boolean(shots.front)
  const sideCount = (['left90', 'right90'] as const).filter((slot) => shots[slot]).length
  const aiReady = aiStatus?.available === true
  const realPhotos = faceAllowed === true && consent

  // While the avatar is shown on the stage, the dialog steps aside to a card at the bottom.
  if (stage.kind === 'preview') {
    const { avatar } = stage
    return (
      <div
        aria-labelledby={titleId}
        className="fixed bottom-6 left-1/2 z-10 flex w-[min(520px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-3 rounded-3xl bg-neutral-950/95 p-5 text-white shadow-2xl ring-1 ring-white/15 backdrop-blur"
        data-focus-scope
        ref={dialog}
        role="dialog"
      >
        <p className="font-bold text-[16px]" id={titleId}>
          무대에서 확인해 보세요
        </p>
        <p className="text-[12px] text-white/65 leading-5">
          옆으로 돌려 코·이마·턱 모양도 확인해 보세요. 마음에 들면 이름을 정해 저장하세요. 저장한
          아바타는 이 브라우저에만 남고, 다른 플레이어에게는 기본 캐릭터로 보여요.
        </p>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-[12px] text-white/50">이름</span>
          <input
            className={cn(
              'h-10 rounded-xl bg-white/[0.07] px-3 text-[14px] text-white ring-1 ring-white/10',
              FOCUS_RING,
            )}
            maxLength={24}
            onChange={(event) => setName(event.target.value)}
            placeholder={avatar.name}
            value={name}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className={primary}
            disabled={saving}
            onClick={() => void keep(avatar)}
            type="button"
          >
            {saving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" strokeWidth={3} />
            )}
            저장
          </button>
          <button
            className={secondary}
            disabled={saving}
            onClick={() => {
              discard()
              setStage({ kind: 'details', source: avatar.source === 'photo' ? 'photo' : 'capture' })
            }}
            type="button"
          >
            <RefreshCw className="size-4" /> 다시 만들기
          </button>
          <button
            className={secondary}
            disabled={saving}
            onClick={() => {
              discard()
              onClose()
            }}
            type="button"
          >
            버리기
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-10 grid place-items-center bg-black/60 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && stage.kind !== 'making') close()
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative flex max-h-[calc(100vh-32px)] w-[min(620px,calc(100vw-32px))] flex-col gap-4 overflow-y-auto rounded-3xl bg-neutral-950 p-6 text-white shadow-2xl ring-1 ring-white/10"
        data-focus-scope
        ref={dialog}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="font-bold text-[18px]" id={titleId}>
              사진으로 실사 아바타 만들기
            </p>
            <p className="text-[12px] text-white/55 leading-5">
              얼굴을 여러 방향에서 찍을수록 옆모습(코·이마·입술·턱)까지 실제 모양에 가까워져요.
            </p>
          </div>
          <button
            aria-label="닫기"
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/15',
              FOCUS_RING,
            )}
            data-autofocus
            onClick={close}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {stage.kind === 'source' && (
          <div className="flex flex-col gap-3">
            <button
              className={cn(
                'flex items-start gap-3 rounded-2xl border border-sky-300/40 bg-sky-400/[0.08] p-4 text-left transition hover:border-sky-300/80 disabled:opacity-45 disabled:hover:border-sky-300/40',
                FOCUS_RING,
              )}
              data-photo-source="capture"
              disabled={!realPhotos}
              onClick={() => setStage({ kind: 'camera' })}
              type="button"
            >
              <Camera className="mt-0.5 size-6 shrink-0 text-sky-300" />
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2 font-semibold text-[14px]">
                  3D 얼굴 촬영{' '}
                  <span className="rounded-full bg-sky-400 px-2 py-0.5 font-bold text-[10px] text-neutral-950">
                    추천
                  </span>
                </span>
                <span className="text-[12px] text-white/60 leading-5">
                  카메라 앞에서 정면, 좌·우 45°, 좌·우 옆얼굴을 안내에 따라 찍어요. 옆모습까지 실제
                  얼굴 모양으로 만들어요. 사진을 올려서 할 수도 있어요.
                </span>
              </span>
            </button>
            <button
              className={cn(
                'flex items-start gap-3 rounded-2xl border border-white/15 bg-white/[0.04] p-4 text-left transition hover:border-white/40 disabled:opacity-45 disabled:hover:border-white/15',
                FOCUS_RING,
              )}
              data-photo-source="photo"
              disabled={!realPhotos}
              onClick={() => setStage({ kind: 'upload', source: 'photo' })}
              type="button"
            >
              <UserRound className="mt-0.5 size-6 shrink-0 text-white/70" />
              <span className="flex flex-col gap-1">
                <span className="font-semibold text-[14px]">내 사진 한 장</span>
                <span className="text-[12px] text-white/60 leading-5">
                  정면 사진 한 장으로 빠르게 만들어요. 옆모습은 사진으로 알 수 없어 평균 얼굴에
                  가깝게 나와요.
                </span>
              </span>
            </button>
            {faceAllowed === false ? (
              <p className="flex items-start gap-2 rounded-xl bg-white/[0.05] px-3 py-2.5 text-[12px] text-white/65 leading-5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
                <span>
                  실제 사람 사진으로 만들기는 지금 꺼져 있어요.
                  {development && (
                    <>
                      {' '}
                      켜려면 서버 환경 변수{' '}
                      <code className="rounded bg-white/10 px-1">
                        PHOTO_AVATAR_FACE_ENABLED=true
                      </code>
                      를 넣고 다시 시작해 주세요.
                    </>
                  )}
                </span>
              </p>
            ) : (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                <input
                  checked={consent}
                  className="mt-0.5 size-4 shrink-0 accent-sky-400"
                  disabled={faceAllowed === null}
                  onChange={(event) => setConsent(event.target.checked)}
                  type="checkbox"
                />
                <span className="flex flex-col gap-1">
                  <span className="text-[13px] text-white/90">
                    성인의 얼굴이고, 본인 얼굴이거나 얼굴 주인에게 동의를 받았어요.
                  </span>
                  <span className="flex items-start gap-1.5 text-[11px] text-white/50 leading-4">
                    <ShieldCheck className="size-3.5 shrink-0 text-sky-300" />
                    사진은 이 브라우저 안에서만 처리되고 어디에도 보내지 않아요. 만든 아바타도 이
                    브라우저에만 저장돼요.
                  </span>
                </span>
              </label>
            )}
            <button
              className={cn(
                'flex items-start gap-3 rounded-2xl border border-white/15 bg-white/[0.04] p-4 text-left transition hover:border-white/40 disabled:opacity-45 disabled:hover:border-white/15',
                FOCUS_RING,
              )}
              data-photo-source="ai"
              disabled={!aiReady}
              onClick={onAiPerson}
              type="button"
            >
              <Sparkles className="mt-0.5 size-6 shrink-0 text-violet-300" />
              <span className="flex flex-col gap-1">
                <span className="font-semibold text-[14px]">AI 가상 인물</span>
                <span className="text-[12px] text-white/60 leading-5">
                  {aiStatus === null
                    ? 'AI 인물을 쓸 수 있는지 확인하고 있어요…'
                    : aiReady
                      ? '생김새를 고르면 AI가 가상의 성인 얼굴을 그리고, 그 얼굴로 아바타를 만들어요.'
                      : 'AI 인물 사진 설정이 없어 지금은 쓸 수 없어요.'}
                </span>
              </span>
            </button>
          </div>
        )}

        {stage.kind === 'camera' && (
          <>
            <GuidedCapture
              onAnnounce={onAnnounce}
              onShot={onShot}
              onUpload={() => setStage({ kind: 'upload', source: 'capture' })}
              shots={shots}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={secondary}
                onClick={() => setStage({ kind: 'source' })}
                type="button"
              >
                <ArrowLeft className="size-4" /> 처음으로
              </button>
              <button
                className={primary}
                disabled={!hasFront}
                onClick={() => setStage({ kind: 'details', source: 'capture' })}
                type="button"
              >
                다음 <ArrowRight className="size-4" />
              </button>
              {hasFront && sideCount === 0 && (
                <span className="text-[12px] text-amber-200/90">
                  옆얼굴이 없으면 옆모습은 평균 얼굴에 가깝게 나와요
                </span>
              )}
            </div>
          </>
        )}

        {stage.kind === 'upload' && (
          <>
            <p className="text-[12px] text-white/60 leading-5">
              {stage.source === 'photo'
                ? '얼굴 전체가 밝고 크게 나온 정면 사진 한 장을 골라 주세요. 한 사람만 나와야 해요.'
                : '같은 날 같은 조명에서 찍은 사진을 골라 주세요. 정면은 꼭 필요하고, 옆얼굴(90°)이 있으면 코·턱 같은 옆모습이 정확해져요. 사진 속에서 코가 향한 쪽에 맞춰 넣어 주세요.'}
            </p>
            <div
              className={cn(
                'grid gap-2',
                stage.source === 'photo' ? 'w-40 grid-cols-1' : 'grid-cols-5',
              )}
            >
              {UPLOAD_SLOTS[stage.source].map((slot) => (
                <UploadSlot
                  key={slot}
                  onClear={() => setShots(({ [slot]: _, ...rest }) => rest)}
                  onPick={(file) => void pick(slot, file)}
                  required={slot === 'front'}
                  shot={shots[slot]}
                  slot={slot}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={secondary}
                onClick={() => setStage({ kind: 'source' })}
                type="button"
              >
                <ArrowLeft className="size-4" /> 처음으로
              </button>
              <button
                className={primary}
                disabled={!hasFront}
                onClick={() => setStage({ kind: 'details', source: stage.source })}
                type="button"
              >
                다음 <ArrowRight className="size-4" />
              </button>
            </div>
          </>
        )}

        {stage.kind === 'details' && source && (
          <>
            <div className="flex flex-col gap-1.5" role="group" aria-label="성별">
              <span className="font-semibold text-[12px] text-white/50">성별</span>
              <div className="flex gap-2">
                {(
                  [
                    ['female', '여성'],
                    ['male', '남성'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    aria-pressed={gender === id}
                    className={cn(
                      'h-9 rounded-full px-5 font-medium text-[13px]',
                      FOCUS_RING,
                      gender === id
                        ? 'bg-white text-neutral-900'
                        : 'bg-white/[0.08] text-white/75 ring-1 ring-white/10 hover:bg-white/15',
                    )}
                    key={id}
                    onClick={() => setGender(id)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-white/45">
                몸과 걷는 모습, 감정 동작이 이 성별의 기본 몸으로 정해져요.
              </span>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="font-semibold text-[12px] text-white/50">이름 (선택)</span>
              <input
                className={cn(
                  'h-10 rounded-xl bg-white/[0.07] px-3 text-[14px] text-white ring-1 ring-white/10',
                  FOCUS_RING,
                )}
                maxLength={24}
                onChange={(event) => setName(event.target.value)}
                placeholder="사진 아바타"
                value={name}
              />
            </label>
            <p className="text-[12px] text-white/50 leading-5">
              사진{' '}
              {Object.keys(shots).filter((slot) => source === 'capture' || slot === 'front').length}
              장으로 만들어요. 1~2분쯤 걸려요.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className={secondary}
                onClick={() =>
                  setStage(source === 'photo' ? { kind: 'upload', source } : { kind: 'camera' })
                }
                type="button"
              >
                <ArrowLeft className="size-4" /> 사진 바꾸기
              </button>
              <button
                className={primary}
                disabled={!hasFront}
                onClick={() => void make(source)}
                type="button"
              >
                <Sparkles className="size-4" /> 아바타 만들기
              </button>
            </div>
          </>
        )}

        {stage.kind === 'making' && (
          <div className="flex flex-col gap-3" role="status">
            <Bar value={stage.progress.fraction} />
            <p className="flex items-center gap-2 text-[13px] text-white/75">
              <LoaderCircle className="size-4 animate-spin text-sky-300 motion-reduce:animate-none" />
              {stage.progress.text}
            </p>
            <p className="rounded-xl bg-white/[0.05] px-3 py-2 text-[12px] text-white/55 leading-5">
              모든 계산은 이 브라우저에서 해요. 창을 닫으면 멈춰요.
            </p>
            <button
              className={cn(secondary, 'self-start')}
              onClick={() => {
                making.current?.abort()
              }}
              type="button"
            >
              멈추기
            </button>
          </div>
        )}

        {stage.kind === 'error' && (
          <div className="flex flex-col gap-3">
            <p
              className="flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-3 text-[13px] text-rose-100 leading-5"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-300" />
              {stage.message}
            </p>
            <button
              className={cn(primary, 'self-start')}
              onClick={() => setStage({ kind: 'source' })}
              type="button"
            >
              <RefreshCw className="size-4" /> 처음으로
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
