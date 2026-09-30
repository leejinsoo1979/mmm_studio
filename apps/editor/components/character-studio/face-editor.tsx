'use client'

import {
  type AvatarFace,
  type AvatarLook,
  DEFAULT_FACE_BLEND,
  DEFAULT_FACE_LIGHT,
  FACE_POINT_INDICES,
  type FacePoint,
  loadFaceTargets,
  Slider,
  unpackPoints,
} from '@pascal-app/editor'
import {
  Camera,
  Check,
  ImagePlus,
  Loader2,
  RotateCcw,
  ScanFace,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cropFacePhoto, detectFace, poseMessage, sampleFaceColors } from '@/lib/face-detect'
import { pointsFromMarks } from '@/lib/face-fit'
import { cn } from '@/lib/utils'

/** A photo is kept this small: a face needs no more, and it travels to the other players. */
const PHOTO_LONGEST = 768
const VIEW = 288

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('사진을 열 수 없어요'))
    image.src = src
  })
}

function pixelsOf(image: HTMLImageElement) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

/** A picture no larger than PHOTO_LONGEST, as a JPEG data URL. */
function shrink(source: CanvasImageSource, width: number, height: number) {
  const ratio = Math.min(1, PHOTO_LONGEST / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.9)
}

/**
 * The stored face's points as MediaPipe's full list (the ones not kept left
 * empty), in pixels of the stored photo: what the colour samplers read.
 */
function fullPoints(face: Pick<AvatarFace, 'points'>, width: number, height: number): FacePoint[] {
  const points: FacePoint[] = Array.from({ length: 478 }, () => [Number.NaN, Number.NaN])
  unpackPoints(face.points).forEach(([x, y], i) => {
    points[FACE_POINT_INDICES[i]!] = [x * width, y * height]
  })
  return points
}

/**
 * The skin and iris colours of a stored face's photo (the one place they're
 * read from, so a look's skin can be told to be the photo's).
 */
async function faceColors(face: Pick<AvatarFace, 'photo' | 'points'>) {
  const image = await loadImage(face.photo)
  const points = fullPoints(face, image.naturalWidth, image.naturalHeight)
  return sampleFaceColors(pixelsOf(image), points)
}

/** The selfie camera, shown like a mirror; "찍기" takes the frame as others see it. */
function CameraCapture({
  onTake,
  onClose,
}: {
  onTake: (image: HTMLCanvasElement) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
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
      .catch(() => setError('카메라를 켤 수 없어요. 브라우저의 카메라 권한을 확인해 주세요.'))
    return () => {
      stopped = true
      for (const track of stream?.getTracks() ?? []) track.stop()
    }
  }, [])

  const take = () => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    onTake(canvas)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-neutral-900">
        <video
          className="h-full w-full -scale-x-100 object-cover"
          muted
          playsInline
          ref={videoRef}
        />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 400 300">
          <ellipse
            cx="200"
            cy="150"
            fill="none"
            rx="78"
            ry="104"
            stroke="white"
            strokeDasharray="6 6"
            strokeOpacity="0.8"
            strokeWidth="2"
          />
        </svg>
        {error && (
          <p className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 p-2 text-center text-[12px] text-white">
            {error}
          </p>
        )}
      </div>
      <p className="text-center text-[11px] text-neutral-500">
        얼굴을 점선 안에 맞추고, 밝은 곳에서 정면을 바라봐 주세요
      </p>
      <div className="flex gap-2">
        <button
          className="flex-1 rounded-xl border border-neutral-200 bg-white py-2 text-[13px] text-neutral-600 hover:bg-neutral-50"
          onClick={onClose}
          type="button"
        >
          취소
        </button>
        <button
          className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-sky-500 py-2 font-semibold text-[13px] text-white hover:bg-sky-600 disabled:opacity-40"
          disabled={Boolean(error)}
          onClick={take}
          type="button"
        >
          <Camera className="size-4" /> 찍기
        </button>
      </div>
    </div>
  )
}

const MARK_STEPS = ['화면 왼쪽 눈을', '화면 오른쪽 눈을', '입 가운데를'] as const

/**
 * When no face is found in a photo: the player marks its eyes and mouth,
 * and the character's face points are carried onto it by them.
 */
function MarkFeatures({
  photo,
  aspect,
  onDone,
  onCancel,
}: {
  photo: string
  aspect: number
  onDone: (marks: [FacePoint, FacePoint, FacePoint]) => void
  onCancel: () => void
}) {
  const [marks, setMarks] = useState<FacePoint[]>([])
  const width = aspect > 1 ? VIEW / aspect : VIEW
  const height = aspect > 1 ? VIEW : VIEW * aspect
  const left = (VIEW - width) / 2
  const top = (VIEW - height) / 2
  const step = marks.length

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800 leading-5">
        사진에서 얼굴을 찾지 못했어요. 눈과 입을 직접 알려 주세요.
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-sky-500 px-3 py-2 text-[12px] text-white shadow-[0_4px_12px_rgba(14,165,233,0.35)]">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white font-bold text-[11px] text-sky-600">
          {Math.min(3, step + 1)}
        </span>
        <span className="flex-1">
          사진에서 <b>{MARK_STEPS[Math.min(2, step)]}</b> 눌러 주세요
        </span>
      </div>
      <div
        className="relative mx-auto cursor-crosshair overflow-hidden rounded-2xl bg-neutral-900"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const x = (event.clientX - box.left - left) / width
          const y = (event.clientY - box.top - top) / height
          if (x < 0 || y < 0 || x > 1 || y > 1) return
          const next = [...marks, [x, y] as FacePoint]
          if (next.length === 3) onDone(next as [FacePoint, FacePoint, FacePoint])
          else setMarks(next)
        }}
        style={{ width: VIEW, height: VIEW }}
      >
        <img
          alt=""
          className="pointer-events-none absolute select-none"
          draggable={false}
          src={photo}
          style={{ left, top, width, height }}
        />
        {marks.map(([x, y], i) => (
          <span
            className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute grid size-5 place-items-center rounded-full border-2 border-white bg-sky-500 font-bold text-[10px] text-white shadow"
            key={`${x}-${y}`}
            style={{ left: left + x * width, top: top + y * height }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-neutral-200 bg-white py-2 text-[12px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
          disabled={marks.length === 0}
          onClick={() => setMarks([])}
          type="button"
        >
          <RotateCcw className="size-3.5" /> 다시 누르기
        </button>
        <button
          className="flex-1 rounded-xl border border-neutral-200 bg-white py-2 text-[12px] text-neutral-600 hover:bg-neutral-50"
          onClick={onCancel}
          type="button"
        >
          취소
        </button>
      </div>
    </div>
  )
}

function Labeled({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[12px]">
        <span className="text-neutral-600">{label}</span>
        <span className="font-medium text-neutral-400 tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  )
}

/** A 0–1 setting that previews while dragged and commits (one undo step) on release. */
function UnitSlider({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
}) {
  const [shown, setShown] = useState(value)
  useEffect(() => setShown(value), [value])
  return (
    <Labeled label={label} value={`${Math.round(shown * 100)}%`}>
      <Slider
        max={100}
        min={0}
        onValueChange={([next]) => next !== undefined && setShown(next / 100)}
        onValueCommit={([next]) => next !== undefined && onCommit(next / 100)}
        step={1}
        value={[shown * 100]}
      />
    </Labeled>
  )
}

type Status =
  | { kind: 'idle' }
  | { kind: 'camera' }
  | { kind: 'reading'; step: string }
  | { kind: 'marking'; photo: string; aspect: number }

/**
 * The face tab: a photo of the player's face (a file or the camera). Its
 * face is found (MediaPipe's landmarks, in this browser), cropped, and swapped
 * onto the character's — every landmark onto the character's own, blended
 * into the skin around it. The skin and iris colours come from the photo too.
 * With no face found, the player marks the eyes and mouth instead.
 */
export function FaceEditor({
  avatar,
  look,
  onCommit,
}: {
  avatar: string
  look: AvatarLook
  onCommit: (patch: Partial<AvatarLook>) => void
}) {
  const face = look.face
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [pose, setPose] = useState<string | null>(null)
  const [colors, setColors] = useState<{ skin: string; eyes: string | null } | null>(null)
  const [skinBefore, setSkinBefore] = useState<string | null | undefined>(undefined)
  const [covered, setCovered] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // A face hidden by a mask or veil has no landmarks to swap onto.
  useEffect(() => {
    let current = true
    loadFaceTargets()
      .then((targets) => current && setCovered(!targets[avatar]))
      .catch(() => current && setCovered(false))
    return () => {
      current = false
    }
  }, [avatar])

  // The photo's own colours, for the skin and eye choices below.
  useEffect(() => {
    if (!face) {
      setColors(null)
      return
    }
    let current = true
    faceColors(face)
      .then((found) => current && setColors(found))
      .catch(() => current && setColors(null))
    return () => {
      current = false
    }
  }, [face])

  const takeImage = async (image: HTMLImageElement | HTMLCanvasElement) => {
    setError(null)
    setPose(null)
    setStatus({ kind: 'reading', step: '얼굴을 찾고 있어요…' })
    try {
      const found = await detectFace(image)
      const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width
      const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height
      if (!found) {
        setStatus({ kind: 'marking', photo: shrink(image, width, height), aspect: height / width })
        return
      }
      setStatus({ kind: 'reading', step: '얼굴을 입히고 있어요…' })
      const crop = cropFacePhoto(image, found, PHOTO_LONGEST)
      const { skin, eyes } = await faceColors(crop)
      setPose(poseMessage(found))
      setSkinBefore(look.skin)
      onCommit({
        face: {
          photo: crop.photo,
          points: crop.points,
          blend: face?.blend ?? DEFAULT_FACE_BLEND,
          light: face?.light ?? DEFAULT_FACE_LIGHT,
          eyes,
        },
        skin,
      })
      setStatus({ kind: 'idle' })
    } catch {
      setError('얼굴 인식을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.')
      setStatus({ kind: 'idle' })
    }
  }

  const openFile = async (file: File | undefined) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    try {
      await takeImage(await loadImage(url))
    } catch {
      setError('사진을 열 수 없어요. JPG나 PNG 사진을 골라 주세요.')
      setStatus({ kind: 'idle' })
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const picker = (
    <input
      accept="image/*"
      className="hidden"
      onChange={(event) => {
        void openFile(event.target.files?.[0])
        event.target.value = ''
      }}
      ref={fileRef}
      type="file"
    />
  )

  if (covered) {
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-4 text-[12px] text-amber-800 leading-5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />이 캐릭터는 얼굴이 가려져 있어서 얼굴을
        입힐 수 없어요. 캐릭터 단계에서 다른 캐릭터를 골라 주세요.
      </p>
    )
  }

  if (status.kind === 'camera') {
    return (
      <CameraCapture
        onClose={() => setStatus({ kind: 'idle' })}
        onTake={(canvas) => void takeImage(canvas)}
      />
    )
  }

  if (status.kind === 'reading') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-sky-50/70 px-4 py-10 text-center">
        <Loader2 className="size-7 animate-spin text-sky-500" />
        <p className="font-medium text-[13px] text-neutral-700">{status.step}</p>
        <p className="text-[11px] text-neutral-400">처음에는 인식 도구를 불러오느라 조금 걸려요</p>
      </div>
    )
  }

  if (status.kind === 'marking') {
    return (
      <MarkFeatures
        aspect={status.aspect}
        onCancel={() => setStatus({ kind: 'idle' })}
        onDone={async (marks) => {
          const targets = await loadFaceTargets().catch(() => null)
          const target = targets?.[avatar]
          if (!target) {
            setError('이 캐릭터의 얼굴 정보를 불러오지 못했어요.')
            setStatus({ kind: 'idle' })
            return
          }
          onCommit({
            face: {
              photo: status.photo,
              points: pointsFromMarks(marks, status.aspect, target),
              blend: face?.blend ?? DEFAULT_FACE_BLEND,
              light: face?.light ?? DEFAULT_FACE_LIGHT,
              eyes: null,
            },
          })
          setStatus({ kind: 'idle' })
        }}
        photo={status.photo}
      />
    )
  }

  if (!face) {
    return (
      <div className="flex flex-col gap-3">
        {picker}
        <button
          className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-sky-200 border-dashed bg-sky-50/60 px-4 py-7 text-center transition hover:border-sky-400 hover:bg-sky-50"
          onClick={() => fileRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void openFile(event.dataTransfer.files[0])
          }}
          type="button"
        >
          <span className="grid size-12 place-items-center rounded-full bg-white text-sky-500 shadow-sm transition group-hover:scale-105">
            <ImagePlus className="size-6" />
          </span>
          <span className="font-semibold text-[14px] text-neutral-800">얼굴 사진 올리기</span>
          <span className="text-[12px] text-neutral-500 leading-5">
            사진을 끌어다 놓거나 눌러서 고르세요
          </span>
        </button>
        <button
          className="flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white py-2.5 text-[13px] text-neutral-700 transition hover:bg-neutral-50"
          onClick={() => setStatus({ kind: 'camera' })}
          type="button"
        >
          <Camera className="size-4" /> 카메라로 찍기
        </button>
        {error && <p className="text-[12px] text-rose-500">{error}</p>}
        <ul className="space-y-1 rounded-xl bg-neutral-50 p-3 text-[12px] text-neutral-500 leading-5">
          <li>· 정면을 보고 찍은, 밝고 고른 빛의 사진이 가장 자연스러워요</li>
          <li>· 얼굴의 눈·코·입·턱선을 찾아 캐릭터 얼굴에 하나하나 맞춰 입혀요</li>
          <li>· 사진은 이 브라우저에서만 처리되고, 얼굴 부분만 저장돼요</li>
        </ul>
      </div>
    )
  }

  const set = (patch: Partial<AvatarFace>) => onCommit({ face: { ...face, ...patch } })
  const skinFromPhoto = colors && look.skin?.toLowerCase() === colors.skin.toLowerCase()

  return (
    <div className="flex flex-col gap-4">
      {picker}
      <div className="flex gap-3">
        <div className="relative size-24 shrink-0 overflow-hidden rounded-2xl bg-neutral-100 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
          <img alt="" className="h-full w-full object-cover" src={face.photo} />
          <span className="absolute right-1.5 bottom-1.5 grid size-5 place-items-center rounded-full bg-sky-500 text-white shadow">
            <ScanFace className="size-3" />
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <p className="flex items-center gap-1 font-semibold text-[13px] text-neutral-800">
            <Check className="size-4 text-sky-500" strokeWidth={3} /> 내 얼굴을 입혔어요
          </p>
          <p className="text-[11px] text-neutral-500 leading-4">
            눈·코·입·턱선을 캐릭터 얼굴에 하나하나 맞추고 피부와 이어지게 섞었어요
          </p>
        </div>
      </div>

      {pose && (
        <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800 leading-4">
          <TriangleAlert className="mt-px size-3.5 shrink-0" /> {pose}
        </p>
      )}

      <UnitSlider label="경계 자연스럽게" onCommit={(blend) => set({ blend })} value={face.blend} />
      <UnitSlider
        label="사진 그림자 줄이기"
        onCommit={(light) => set({ light })}
        value={face.light}
      />

      {colors && (
        <div className="flex flex-col gap-2 rounded-2xl bg-neutral-50 p-3">
          <div className="flex items-center gap-2">
            <span
              className="size-6 shrink-0 rounded-full ring-1 ring-black/10"
              style={{ background: colors.skin }}
            />
            <span className="flex-1 text-[12px] text-neutral-700">피부색</span>
            {skinFromPhoto ? (
              <button
                className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] text-neutral-600 shadow-sm hover:text-neutral-900"
                onClick={() => onCommit({ skin: skinBefore ?? null })}
                type="button"
              >
                <Undo2 className="size-3" /> 원래 피부
              </button>
            ) : (
              <button
                className="rounded-full bg-sky-500 px-2.5 py-1 font-medium text-[11px] text-white hover:bg-sky-600"
                onClick={() => {
                  setSkinBefore(look.skin)
                  onCommit({ skin: colors.skin })
                }}
                type="button"
              >
                사진 피부색 쓰기
              </button>
            )}
          </div>
          {colors.eyes && (
            <div className="flex items-center gap-2">
              <span
                className="size-6 shrink-0 rounded-full ring-1 ring-black/10"
                style={{
                  background: `radial-gradient(circle, #111 0 28%, ${colors.eyes} 30% 100%)`,
                }}
              />
              <span className="flex-1 text-[12px] text-neutral-700">눈동자 색</span>
              <button
                className={cn(
                  'rounded-full px-2.5 py-1 font-medium text-[11px]',
                  face.eyes
                    ? 'bg-white text-neutral-600 shadow-sm hover:text-neutral-900'
                    : 'bg-sky-500 text-white hover:bg-sky-600',
                )}
                onClick={() => set({ eyes: face.eyes ? null : colors.eyes })}
                type="button"
              >
                {face.eyes ? '캐릭터 눈동자' : '사진 눈동자 쓰기'}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-[12px] text-rose-500">{error}</p>}

      <div className="grid grid-cols-3 gap-2">
        <button
          className="flex flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-white py-2 text-[11px] text-neutral-600 transition hover:bg-neutral-50"
          onClick={() => fileRef.current?.click()}
          type="button"
        >
          <ImagePlus className="size-4" /> 다른 사진
        </button>
        <button
          className="flex flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-white py-2 text-[11px] text-neutral-600 transition hover:bg-neutral-50"
          onClick={() => setStatus({ kind: 'camera' })}
          type="button"
        >
          <Camera className="size-4" /> 다시 찍기
        </button>
        <button
          className="flex flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-white py-2 text-[11px] text-rose-500 transition hover:bg-rose-50"
          onClick={() => onCommit({ face: null })}
          type="button"
        >
          <Trash2 className="size-4" /> 얼굴 지우기
        </button>
      </div>
    </div>
  )
}
