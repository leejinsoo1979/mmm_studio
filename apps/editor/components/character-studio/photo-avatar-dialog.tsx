'use client'

import {
  type AvatarGender,
  addPhotoAvatar,
  CAPTURE_STEPS,
  type CaptureSlot,
  discardPhotoAvatarPreview,
  type GuideState,
  PROFILE_ESTIMATED,
  previewPhotoAvatar,
  type StoredPhotoAvatar,
  startGuide,
} from '@pascal-app/editor'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Images,
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
import { photoSlot, SLOT_YAW } from '@/lib/photo-capture'
import { lensOf, readExifLens } from '@/lib/photo-exif'
import { type PhotorealAiClientStatus, photorealAiClient } from '@/lib/photoreal-ai/client'
import { cn } from '@/lib/utils'
import {
  type MakeProgress,
  makePhotoAvatar,
  openPicture,
  PhotoAvatarError,
  type PhotoInput,
  stageCard,
} from './photo-avatar-make'
import { FOCUS_RING } from './studio-controls'

/**
 * 사진으로 실사 아바타 만들기: from a guided 3D face capture (front, ¾ and
 * full side views each way — the side views give the profile its real
 * shape), from 3 or 5 photos the player uploads (each filed by the way its
 * face is turned), from one photo (its profile a guess: 옆모습 추정), or
 * from an AI-made fictional face (AI 인물). Everything is made and kept in
 * this browser; the avatar is shown on the stage before it is kept, and its
 * card is a render of the avatar, never the photo.
 */

type Source = 'capture' | 'photo'
type Slot = Exclude<CaptureSlot, 'free'>

type Stage =
  | { kind: 'source' }
  | { kind: 'camera' }
  | { kind: 'upload'; source: Source }
  | { kind: 'details'; source: Source }
  | { kind: 'making'; source: Source; progress: MakeProgress }
  | { kind: 'preview'; avatar: StoredPhotoAvatar; notes: string[] }
  | { kind: 'error'; message: string }

/** A photo for a pose, a small copy of it to show, and its lens where its EXIF says (uploads). */
type Shot = { picture: HTMLImageElement | HTMLCanvasElement; url: string; lens?: number | null }

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
const sourceButton = cn(
  'flex items-start gap-3 rounded-2xl border border-white/15 bg-white/[0.04] p-4 text-left transition hover:border-white/40 disabled:opacity-45 disabled:hover:border-white/15',
  FOCUS_RING,
)

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

function EstimatedBadge() {
  return (
    <span className="rounded-full bg-amber-300 px-2 py-0.5 font-bold text-[10px] text-neutral-950">
      {PROFILE_ESTIMATED}
    </span>
  )
}

function shotOf(canvas: HTMLCanvasElement): Shot {
  return { picture: canvas, url: canvas.toDataURL('image/jpeg', 0.7) }
}

/** A chosen picture with a small copy for its slot to show (the file's own URL is let go once read). */
function shotOfPicture(picture: HTMLImageElement, lens: number | null): Shot {
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 320 / Math.max(picture.naturalWidth, picture.naturalHeight))
  canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale))
  canvas.getContext('2d')!.drawImage(picture, 0, 0, canvas.width, canvas.height)
  return { picture, url: canvas.toDataURL('image/jpeg', 0.8), lens }
}

/** A chosen file opened, with the lens its EXIF names for it. */
async function openUpload(file: File) {
  const [picture, exif] = await Promise.all([openPicture(file), readExifLens(file)])
  return { picture, lens: lensOf(exif, picture.naturalWidth, picture.naturalHeight) }
}

/** Whether this is a touch device (a phone or tablet), where a build may run out of memory. */
const touchDevice = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true

/**
 * The guided capture: the camera, an oval to put the face in, which way to
 * turn, and each pose taken by itself once the person holds it still and
 * sharp, alone, well and evenly lit, eyes open and mouth shut (the guide
 * says what to fix). Poses can be taken again or skipped (not the front).
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
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('이 브라우저에서는 카메라를 쓸 수 없어요. 사진을 올려 주세요.')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: 1280, height: 960 } })
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
      .catch((reason: unknown) => {
        const name = reason instanceof DOMException ? reason.name : ''
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? '카메라 권한이 없어요. 주소창 왼쪽의 자물쇠 아이콘에서 카메라를 허용하고 다시 열어 주세요. Mac에서는 시스템 설정 › 개인정보 보호 및 보안 › 카메라에서 Chrome도 켜져 있어야 해요. 사진을 올려서 만들 수도 있어요.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? '카메라를 찾지 못했어요. 카메라가 연결돼 있는지 확인하거나 사진을 올려 주세요.'
              : name === 'NotReadableError'
                ? '다른 앱이 카메라를 쓰고 있어요. 그 앱을 닫고 다시 열어 주세요.'
                : '카메라를 켤 수 없어요. 브라우저의 카메라 권한을 확인하거나 사진을 올려 주세요.',
        )
      })
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
          data-guide-message
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
              data-capture-step={one.slot}
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
      <p className="text-[11px] text-white/45 leading-4">
        밝고 고른 빛을 마주 보고, 안경과 모자는 벗고, 입을 다문 무표정으로 찍어 주세요. 자세를 잡고
        잠깐 멈추면 저절로 찍혀요.
      </p>
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
  busy,
  onPick,
  onClear,
}: {
  slot: Slot
  shot: Shot | undefined
  required: boolean
  busy: boolean
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
        data-upload-slot={slot}
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
          disabled={busy}
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
  capture,
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
  /** The stage's full-length shot of the character on it (the avatar shown): its card. */
  capture?: () => Promise<Blob>
}) {
  const titleId = useId()
  const multiId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Stage>({ kind: 'source' })
  const [faceAllowed, setFaceAllowed] = useState<boolean | null>(null)
  const [aiStatus, setAiStatus] = useState<PhotorealAiClientStatus | null>(null)
  const [consent, setConsent] = useState(false)
  const [gender, setGender] = useState<AvatarGender>(defaultGender)
  const [name, setName] = useState('')
  const [shots, setShots] = useState<Partial<Record<Slot, Shot>>>({})
  const [filing, setFiling] = useState(false)
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
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

  /** One photo into a slot: the slot its face shows when it can tell, else the one picked. */
  const pick = async (slot: Slot, file: File, source: Source) => {
    setFiling(true)
    setUploadNote(null)
    try {
      const { picture, lens } = await openUpload(file)
      const seen = await photoSlot(picture).catch(() => null)
      if (seen && seen.faces > 1) {
        setUploadNote('사진에 얼굴이 여러 개 있어요. 한 사람만 나온 사진을 골라 주세요.')
        return
      }
      let target = slot
      if (source === 'photo') {
        if (seen?.slot && seen.slot !== 'front')
          setUploadNote('정면 사진이 아닌 것 같아요. 정면을 보는 사진이 가장 잘 맞아요.')
      } else if (seen?.slot && seen.slot !== slot) {
        target = seen.slot
        onAnnounce(`사진 속 얼굴 방향을 보고 ‘${SLOT_LABEL[target]}’ 칸에 넣었어요`)
        setUploadNote(`사진 속 얼굴 방향을 보고 ‘${SLOT_LABEL[target]}’ 칸에 넣었어요.`)
      }
      // The front photo is where the face is read from: one without a face is no use.
      if (target === 'front' && seen && seen.yaw === null) {
        setUploadNote(
          '이 사진에서 얼굴을 찾지 못했어요. 얼굴 전체가 밝고 크게 나온 정면 사진을 골라 주세요.',
        )
        return
      }
      setShots((old) => ({ ...old, [target]: shotOfPicture(picture, lens) }))
    } catch (error) {
      onAnnounce(error instanceof PhotoAvatarError ? error.message : '사진을 열 수 없어요')
    } finally {
      setFiling(false)
    }
  }

  /** Several photos at once, each filed in the slot its face shows (the nearest to it, if two do). */
  const pickMany = async (files: File[]) => {
    setFiling(true)
    setUploadNote(null)
    const found = new Map<Slot, { shot: Shot; off: number }>()
    let unknown = 0
    let crowded = 0
    for (const file of files.slice(0, 8)) {
      try {
        const { picture, lens } = await openUpload(file)
        const seen = await photoSlot(picture)
        if (seen.faces > 1) {
          crowded++
          continue
        }
        if (!seen.slot) {
          unknown++
          continue
        }
        const off = seen.yaw === null ? 0 : Math.abs(seen.yaw - SLOT_YAW[seen.slot])
        const had = found.get(seen.slot)
        if (!had || off < had.off) found.set(seen.slot, { shot: shotOfPicture(picture, lens), off })
      } catch {
        unknown++
      }
    }
    setShots((old) => {
      const next = { ...old }
      for (const [slot, { shot }] of found) next[slot] = shot
      return next
    })
    const parts = [`사진 ${found.size}장을 얼굴 방향대로 칸에 넣었어요.`]
    if (unknown)
      parts.push(`방향을 알 수 없는 사진 ${unknown}장은 아래 칸을 눌러 직접 넣어 주세요.`)
    if (crowded) parts.push(`얼굴이 여러 개인 사진 ${crowded}장은 뺐어요.`)
    setUploadNote(parts.join(' '))
    onAnnounce(parts[0]!)
    setFiling(false)
  }

  const make = async (source: Source) => {
    const slots = source === 'photo' ? (['front'] as const) : UPLOAD_SLOTS.capture
    const photos: PhotoInput[] = slots.flatMap((slot) => {
      const shot = shots[slot]
      return shot ? [{ picture: shot.picture, slot, lens: shot.lens }] : []
    })
    const controller = new AbortController()
    making.current = controller
    setStage({ kind: 'making', source, progress: { fraction: 0, text: '시작하고 있어요' } })
    onAnnounce('아바타를 만들기 시작했어요')
    try {
      const { avatar, notes } = await makePhotoAvatar({
        photos,
        gender,
        name: name.trim() || '사진 아바타',
        source,
        signal: controller.signal,
        onProgress: (progress) => {
          if (making.current === controller) setStage({ kind: 'making', source, progress })
        },
      })
      if (making.current !== controller) return
      making.current = null
      const character = previewPhotoAvatar(avatar)
      onShow(character.id)
      setSaveFailed(false)
      setStage({ kind: 'preview', avatar, notes })
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

  /** 멈추기: the build let go of at once (whatever it finishes afterwards is not shown). */
  const stop = (source: Source) => {
    const controller = making.current
    making.current = null
    controller?.abort()
    setStage({ kind: 'details', source })
    onAnnounce('만들기를 멈췄어요')
  }

  const keep = async (avatar: StoredPhotoAvatar) => {
    setSaving(true)
    setSaveFailed(false)
    // The card is the avatar as the stage shows it; only a fictional AI portrait may be its own card.
    const card =
      avatar.source !== 'ai' && capture
        ? await capture()
            .then(stageCard)
            .catch(() => null)
        : null
    try {
      const character = await addPhotoAvatar({
        ...avatar,
        name: name.trim() || avatar.name,
        ...(card ? { thumbnail: card } : {}),
      })
      onKeep(character.id)
      onAnnounce(`‘${character.label}’을 실사 목록에 저장했어요`)
      onClose()
    } catch {
      // The avatar stays on the stage, to be saved again once there is room.
      setSaving(false)
      setSaveFailed(true)
      onAnnounce('저장하지 못했어요. 다시 시도할 수 있어요')
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
    const { avatar, notes } = stage
    return (
      <div
        aria-labelledby={titleId}
        className="fixed bottom-6 left-1/2 z-10 flex max-h-[60vh] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-3 overflow-y-auto rounded-3xl bg-neutral-950/95 p-5 text-white shadow-2xl ring-1 ring-white/15 backdrop-blur"
        data-focus-scope
        data-photo-avatar-preview
        ref={dialog}
        role="dialog"
      >
        <p className="flex items-center gap-2 font-bold text-[16px]" id={titleId}>
          무대에서 확인해 보세요 {avatar.profileEstimated && <EstimatedBadge />}
        </p>
        <p className="text-[12px] text-white/65 leading-5">
          옆으로 돌려 코·이마·턱 모양도 확인해 보세요. 마음에 들면 이름을 정해 저장하세요. 저장한
          아바타는 이 브라우저에만 남고, 다른 플레이어에게는 기본 캐릭터로 보여요.
        </p>
        {notes.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-xl bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100 leading-5">
            {notes.map((note) => (
              <li className="flex items-start gap-2" key={note}>
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                {note}
              </li>
            ))}
          </ul>
        )}
        {saveFailed && (
          <p
            className="flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-[12px] text-rose-100 leading-5"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-rose-300" />이 브라우저에
            저장하지 못했어요. 저장 공간이 부족하거나 시크릿(개인정보 보호) 창일 수 있어요. 아바타는
            그대로 있으니 공간을 비운 뒤 ‘저장 다시 시도’를 눌러 주세요.
          </p>
        )}
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
            data-photo-avatar-keep
            disabled={saving}
            onClick={() => void keep(avatar)}
            type="button"
          >
            {saving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" strokeWidth={3} />
            )}
            {saveFailed ? '저장 다시 시도' : '저장'}
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
        data-photo-avatar-dialog
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
            {faceAllowed === false ? (
              <p
                className="flex items-start gap-2 rounded-xl bg-white/[0.05] px-3 py-2.5 text-[12px] text-white/65 leading-5"
                data-photo-avatar-off
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
                <span>
                  실제 사람 사진으로 만들기는 지금 꺼져 있어요. 켜려면 이 앱을 실행하는 서버의 환경
                  변수에{' '}
                  <code className="rounded bg-white/10 px-1">PHOTO_AVATAR_FACE_ENABLED=true</code>를
                  넣고 서버를 다시 시작해 주세요. 개발 모드(<code>bun dev</code>)에서는 따로 켜지
                  않아도 켜져 있어요.
                </span>
              </p>
            ) : (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                <input
                  checked={consent}
                  className="mt-0.5 size-4 shrink-0 accent-sky-400"
                  data-photo-avatar-consent
                  disabled={faceAllowed === null}
                  onChange={(event) => setConsent(event.target.checked)}
                  type="checkbox"
                />
                <span className="flex flex-col gap-1">
                  <span className="text-[13px] text-white/90">
                    성인(만 19세 이상)의 얼굴이고, 본인 얼굴이거나 얼굴 주인에게 동의를 받았어요.
                  </span>
                  <span className="flex items-start gap-1.5 text-[11px] text-white/50 leading-4">
                    <ShieldCheck className="size-3.5 shrink-0 text-sky-300" />
                    사진은 이 브라우저 안에서만 처리되고 어디에도 보내지 않아요. 사진 자체는
                    저장하지 않고, 사진으로 만든 아바타(얼굴 모양과 피부)와 아바타를 찍은 카드
                    그림만 이 브라우저에 저장돼요. 다른 사람을 흉내 내거나 선정적인 용도로 쓰면 안
                    돼요.
                  </span>
                </span>
              </label>
            )}
            <button
              className={cn(
                sourceButton,
                'border-sky-300/40 bg-sky-400/[0.08] hover:border-sky-300/80 disabled:hover:border-sky-300/40',
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
                  카메라 앞에서 정면 → 왼쪽 45° → 왼쪽 옆얼굴 → 오른쪽 45° → 오른쪽 옆얼굴 순서로
                  안내에 따라 찍어요. 옆모습까지 실제 얼굴 모양으로 만들어요.
                </span>
              </span>
            </button>
            <button
              className={sourceButton}
              data-photo-source="upload"
              disabled={!realPhotos}
              onClick={() => setStage({ kind: 'upload', source: 'capture' })}
              type="button"
            >
              <Images className="mt-0.5 size-6 shrink-0 text-white/70" />
              <span className="flex flex-col gap-1">
                <span className="font-semibold text-[14px]">사진 3장 또는 5장 올리기</span>
                <span className="text-[12px] text-white/60 leading-5">
                  정면·좌우 45°(·좌우 옆얼굴) 사진을 한꺼번에 올리면 얼굴 방향을 보고 알아서 나눠
                  넣어요.
                </span>
              </span>
            </button>
            <button
              className={sourceButton}
              data-photo-source="photo"
              disabled={!realPhotos}
              onClick={() => setStage({ kind: 'upload', source: 'photo' })}
              type="button"
            >
              <UserRound className="mt-0.5 size-6 shrink-0 text-white/70" />
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2 font-semibold text-[14px]">
                  내 사진 한 장 <EstimatedBadge />
                </span>
                <span className="text-[12px] text-white/60 leading-5">
                  정면 사진 한 장으로 빠르게 만들어요. 옆모습(코 높이·이마·턱)은 사진으로 알 수 없어
                  평균 얼굴로 추정해요. 덜 정확해요.
                </span>
              </span>
            </button>
            <button
              className={sourceButton}
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
                      ? '생김새를 고르면 AI가 가상의 성인 얼굴을 정면·45°·옆얼굴로 그리고, 그 얼굴로 아바타를 만들어요.'
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
                data-photo-avatar-next
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
                : '같은 날 같은 조명에서 찍은 정면·좌우 45° 사진 3장, 좌우 옆얼굴까지 5장을 한꺼번에 골라 주세요. 얼굴 방향을 보고 칸에 나눠 넣어요. 옆얼굴(90°)이 있으면 코·턱 같은 옆모습이 정확해져요.'}
            </p>
            {stage.source === 'capture' && (
              <label
                className={cn(
                  secondary,
                  'cursor-pointer self-start focus-within:ring-2 focus-within:ring-sky-400',
                  filing && 'pointer-events-none opacity-50',
                )}
                htmlFor={multiId}
              >
                {filing ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Images className="size-4" />
                )}
                사진 여러 장 한 번에 고르기
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  data-photo-avatar-many
                  disabled={filing}
                  id={multiId}
                  multiple
                  onChange={(event) => {
                    const files = [...(event.target.files ?? [])]
                    event.target.value = ''
                    if (files.length) void pickMany(files)
                  }}
                  type="file"
                />
              </label>
            )}
            <div
              className={cn(
                'grid gap-2',
                stage.source === 'photo' ? 'w-40 grid-cols-1' : 'grid-cols-5',
              )}
            >
              {UPLOAD_SLOTS[stage.source].map((slot) => (
                <UploadSlot
                  busy={filing}
                  key={slot}
                  onClear={() => setShots(({ [slot]: _, ...rest }) => rest)}
                  onPick={(file) => void pick(slot, file, stage.source)}
                  required={slot === 'front'}
                  shot={shots[slot]}
                  slot={slot}
                />
              ))}
            </div>
            {uploadNote && (
              <p className="text-[12px] text-amber-100/90 leading-5" role="status">
                {uploadNote}
              </p>
            )}
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
                data-photo-avatar-next
                disabled={!hasFront || filing}
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
            <p className="flex flex-wrap items-center gap-2 text-[12px] text-white/50 leading-5">
              사진{' '}
              {Object.keys(shots).filter((slot) => source === 'capture' || slot === 'front').length}
              장으로 만들어요. 1~2분쯤 걸려요.
              {(source === 'photo' || Object.keys(shots).length === 1) && <EstimatedBadge />}
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
                data-photo-avatar-make
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
              {touchDevice() &&
                ' 메모리가 적은 휴대폰이나 태블릿에서는 만들다 멈출 수 있어요. 그럴 땐 컴퓨터에서 해 주세요.'}
            </p>
            <button
              className={cn(secondary, 'self-start')}
              onClick={() => stop(stage.source)}
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
