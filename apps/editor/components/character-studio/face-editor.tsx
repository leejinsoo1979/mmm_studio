'use client'

import { type AvatarFace, FACE_OVAL, Slider } from '@pascal-app/editor'
import { Camera, Crosshair, ImagePlus, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fitFace, type Point } from '@/lib/face-fit'
import { cn } from '@/lib/utils'
import type { HeadFront } from './studio-stage'

/** Photos are kept small: a face needs no more, and it travels to the other players. */
const PHOTO_LONGEST = 512
const VIEW = 288

/** Where a new photo starts: centred on the face oval, its face about the oval's width. */
const START: Omit<AvatarFace, 'photo'> = {
  x: FACE_OVAL.x,
  y: FACE_OVAL.y,
  scale: 1.15,
  rotation: 0,
  tone: 0.5,
}

/** A picture scaled down to PHOTO_LONGEST, as a JPEG data URL (mirrored for a selfie camera). */
function shrink(source: CanvasImageSource, width: number, height: number, mirror = false) {
  const ratio = Math.min(1, PHOTO_LONGEST / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  const context = canvas.getContext('2d')!
  if (mirror) {
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.88)
}

function readPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      resolve(shrink(image, image.naturalWidth, image.naturalHeight))
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('사진을 열 수 없어요'))
    }
    image.src = url
  })
}

/** The selfie camera, mirrored like a mirror; "찍기" takes the frame. */
function CameraCapture({
  onTake,
  onClose,
}: {
  onTake: (photo: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: 960, height: 720 } })
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
    onTake(shrink(video, video.videoWidth, video.videoHeight, true))
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
        얼굴을 점선 안에 맞추고, 정면을 바라봐 주세요
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

const MARK_STEPS = ['화면 왼쪽 눈을', '화면 오른쪽 눈을', '입 가운데를'] as const

/**
 * The first step with a new photo: the player marks its eyes and mouth, and
 * the photo is fitted so they land on the character's.
 */
function MarkFeatures({
  photo,
  aspect,
  onDone,
  onSkip,
}: {
  photo: string
  aspect: number
  onDone: (marks: [Point, Point, Point]) => void
  onSkip: () => void
}) {
  const [marks, setMarks] = useState<Point[]>([])
  // The photo contained in the square.
  const width = aspect > 1 ? VIEW / aspect : VIEW
  const height = aspect > 1 ? VIEW : VIEW * aspect
  const left = (VIEW - width) / 2
  const top = (VIEW - height) / 2
  const step = marks.length

  return (
    <div className="flex flex-col gap-3">
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
          const next = [...marks, [x, y] as Point]
          if (next.length === 3) onDone(next as [Point, Point, Point])
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
      <p className="text-center text-[11px] text-neutral-500 leading-4">
        눈동자 가운데와 입 가운데를 차례로 누르면 캐릭터 얼굴에 맞춰져요
      </p>
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
          onClick={onSkip}
          type="button"
        >
          직접 맞추기
        </button>
      </div>
    </div>
  )
}

/**
 * The face tab: a photo of the player's face (a file or the camera), laid
 * over their character's face. The player marks the photo's eyes and mouth
 * and it is fitted onto the character's; then, on the character's own front
 * view shown faintly over it, they can drag it, size it (wheel or slider)
 * and turn it. "피부톤 맞춤" blends its colours into the skin around it.
 */
export function FaceEditor({
  face,
  headFront,
  onPreview,
  onCommit,
}: {
  face: AvatarFace | null
  headFront: HeadFront | null
  onPreview: (face: AvatarFace | null) => void
  onCommit: (face: AvatarFace | null) => void
}) {
  const [capturing, setCapturing] = useState(false)
  const [guide, setGuide] = useState(0.55)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ x: number; y: number; face: AvatarFace } | null>(null)
  const [photoSize, setPhotoSize] = useState<{ width: number; height: number } | null>(null)
  const [marking, setMarking] = useState(false)
  const landmarks = headFront?.landmarks ?? null

  useEffect(() => {
    if (!face) return
    const image = new Image()
    image.onload = () => setPhotoSize({ width: image.naturalWidth, height: image.naturalHeight })
    image.src = face.photo
  }, [face?.photo, face])

  const takePhoto = (photo: string) => {
    setCapturing(false)
    setError(null)
    setPhotoSize(null)
    setMarking(Boolean(landmarks))
    onCommit({ ...START, ...(face ? { tone: face.tone } : {}), photo })
  }

  const openFile = async (file: File | undefined) => {
    if (!file) return
    try {
      takePhoto(await readPhoto(file))
    } catch {
      setError('사진을 열 수 없어요. JPG나 PNG 사진을 골라 주세요.')
    }
  }

  if (capturing) return <CameraCapture onClose={() => setCapturing(false)} onTake={takePhoto} />

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
          onClick={() => setCapturing(true)}
          type="button"
        >
          <Camera className="size-4" /> 카메라로 찍기
        </button>
        {error && <p className="text-[12px] text-rose-500">{error}</p>}
        <ul className="space-y-1 rounded-xl bg-neutral-50 p-3 text-[12px] text-neutral-500 leading-5">
          <li>· 정면을 보고 찍은, 밝고 고른 빛의 사진이 잘 어울려요</li>
          <li>· 앞머리나 안경이 눈썹과 눈을 가리지 않게 해 주세요</li>
          <li>· 사진은 이 브라우저에서만 처리되고, 입힌 얼굴만 저장돼요</li>
        </ul>
      </div>
    )
  }

  const photoAspect = photoSize ? photoSize.height / photoSize.width : 1

  if (marking && landmarks && photoSize) {
    return (
      <MarkFeatures
        aspect={photoAspect}
        onDone={(marks) => {
          setMarking(false)
          onCommit({ ...face, ...fitFace(marks, photoAspect, landmarks) })
        }}
        onSkip={() => setMarking(false)}
        photo={face.photo}
      />
    )
  }

  const width = face.scale * VIEW
  const height = width * photoAspect
  const set = (patch: Partial<AvatarFace>, commit = false) => {
    const next = { ...face, ...patch }
    ;(commit ? onCommit : onPreview)(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {picker}
      <div
        className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-2xl bg-neutral-100 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] active:cursor-grabbing"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { x: event.clientX, y: event.clientY, face }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag) return
          set({
            x: drag.face.x + (event.clientX - drag.x) / VIEW,
            y: drag.face.y + (event.clientY - drag.y) / VIEW,
          })
        }}
        onPointerUp={() => {
          if (!dragRef.current) return
          dragRef.current = null
          onCommit(face)
        }}
        onWheel={(event) => {
          set({ scale: Math.min(3, Math.max(0.3, face.scale * Math.exp(-event.deltaY * 0.001))) })
        }}
        style={{ width: VIEW, height: VIEW }}
      >
        <img
          alt=""
          className="pointer-events-none absolute max-w-none select-none"
          draggable={false}
          src={face.photo}
          style={{
            left: face.x * VIEW - width / 2,
            top: face.y * VIEW - height / 2,
            width,
            height,
            transform: `rotate(${face.rotation}rad)`,
          }}
        />
        {headFront && (
          <img
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full select-none"
            draggable={false}
            src={headFront.image}
            style={{ opacity: guide }}
          />
        )}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
        >
          <ellipse
            cx={FACE_OVAL.x}
            cy={FACE_OVAL.y}
            fill="none"
            rx={FACE_OVAL.rx}
            ry={FACE_OVAL.ry}
            stroke="#0ea5e9"
            strokeDasharray="0.015 0.012"
            strokeWidth="0.006"
          />
          {landmarks &&
            [landmarks.leftEye, landmarks.rightEye].map(([x, y]) => (
              <circle
                cx={x}
                cy={y}
                fill="none"
                key={`${x}`}
                r="0.022"
                stroke="#0ea5e9"
                strokeWidth="0.006"
              />
            ))}
          {landmarks && (
            <line
              stroke="#0ea5e9"
              strokeLinecap="round"
              strokeWidth="0.006"
              x1={landmarks.mouth[0] - 0.05}
              x2={landmarks.mouth[0] + 0.05}
              y1={landmarks.mouth[1]}
              y2={landmarks.mouth[1]}
            />
          )}
        </svg>
        <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] text-white">
          드래그로 이동 · 휠로 크기
        </span>
      </div>
      <p className="text-center text-[11px] text-neutral-500 leading-4">
        파란 표시(캐릭터의 눈과 입)에 사진의 눈과 입이 오도록 맞춰 주세요
      </p>
      {landmarks && (
        <button
          className="flex items-center justify-center gap-1.5 rounded-xl bg-sky-50 py-2 font-medium text-[12px] text-sky-600 transition hover:bg-sky-100"
          onClick={() => setMarking(true)}
          type="button"
        >
          <Crosshair className="size-4" /> 눈·입 눌러서 자동으로 맞추기
        </button>
      )}

      <Labeled label="사진 크기" value={`${Math.round(face.scale * 100)}%`}>
        <Slider
          max={300}
          min={30}
          onValueChange={([value]) => value !== undefined && set({ scale: value / 100 })}
          onValueCommit={([value]) => value !== undefined && set({ scale: value / 100 }, true)}
          step={1}
          value={[face.scale * 100]}
        />
      </Labeled>
      <Labeled label="기울기" value={`${Math.round((face.rotation * 180) / Math.PI)}°`}>
        <Slider
          max={30}
          min={-30}
          onValueChange={([value]) =>
            value !== undefined && set({ rotation: (value * Math.PI) / 180 })
          }
          onValueCommit={([value]) =>
            value !== undefined && set({ rotation: (value * Math.PI) / 180 }, true)
          }
          step={0.5}
          value={[(face.rotation * 180) / Math.PI]}
        />
      </Labeled>
      <Labeled label="피부톤 맞춤" value={`${Math.round(face.tone * 100)}%`}>
        <Slider
          max={100}
          min={0}
          onValueChange={([value]) => value !== undefined && set({ tone: value / 100 })}
          onValueCommit={([value]) => value !== undefined && set({ tone: value / 100 }, true)}
          step={1}
          value={[face.tone * 100]}
        />
      </Labeled>
      <Labeled label="캐릭터 얼굴 비춰 보기" value={`${Math.round(guide * 100)}%`}>
        <Slider
          max={100}
          min={0}
          onValueChange={([value]) => value !== undefined && setGuide(value / 100)}
          step={1}
          value={[guide * 100]}
        />
      </Labeled>

      <div className="grid grid-cols-3 gap-2 pt-1">
        <button
          className={cn(
            'flex flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-white py-2 text-[11px] text-neutral-600 transition hover:bg-neutral-50',
          )}
          onClick={() => fileRef.current?.click()}
          type="button"
        >
          <ImagePlus className="size-4" /> 다른 사진
        </button>
        <button
          className="flex flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-white py-2 text-[11px] text-neutral-600 transition hover:bg-neutral-50"
          onClick={() => setCapturing(true)}
          type="button"
        >
          <Camera className="size-4" /> 다시 찍기
        </button>
        <button
          className="flex flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-white py-2 text-[11px] text-rose-500 transition hover:bg-rose-50"
          onClick={() => onCommit(null)}
          type="button"
        >
          <Trash2 className="size-4" /> 얼굴 지우기
        </button>
      </div>
      <button
        className="flex items-center justify-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600"
        onClick={() => set({ ...START, tone: face.tone }, true)}
        type="button"
      >
        <X className="size-3" /> 위치 처음으로
      </button>
    </div>
  )
}
