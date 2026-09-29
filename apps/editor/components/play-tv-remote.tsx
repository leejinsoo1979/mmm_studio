'use client'

import { useEditor } from '@pascal-app/editor'
import { useItemScreens } from '@pascal-app/nodes'
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  FileText,
  Film,
  MonitorUp,
  Power,
  Tv,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { presentationPages } from '@/lib/presentation-pages'

function playingVideo(setup: (video: HTMLVideoElement) => void) {
  const video = document.createElement('video')
  video.playsInline = true
  video.loop = true
  video.crossOrigin = 'anonymous'
  setup(video)
  // Picking a file can outlast the click's permission to play sound: play muted then.
  video.play().catch(() => {
    video.muted = true
    void video.play()
  })
  return video
}

/**
 * The remote for the TV last switched on: put a shared screen, a video file
 * or a presentation (PDF or images) on it, turn its pages (◀ ▶, or , and .),
 * see the page full-size, or switch the TV off.
 */
export function PlayTvRemote() {
  const inGame = useEditor((state) => state.isFirstPersonMode)
  const activeId = useItemScreens((state) => state.activeId)
  const content = useItemScreens((state) =>
    state.activeId ? state.screens[state.activeId]?.content : undefined,
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [enlarged, setEnlarged] = useState(false)
  const videoInput = useRef<HTMLInputElement>(null)
  const deckInput = useRef<HTMLInputElement>(null)

  // Page turning from the keyboard; the arrow keys walk.
  useEffect(() => {
    if (!(activeId && content?.kind === 'slides')) return
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      if (event.key === '.' || event.key === 'PageDown') useItemScreens.getState().step(activeId, 1)
      if (event.key === ',' || event.key === 'PageUp') useItemScreens.getState().step(activeId, -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, content?.kind])

  if (!(inGame && activeId && content)) return null
  const screens = useItemScreens.getState()

  const flash = (message: string) => {
    setBusy(message)
    window.setTimeout(() => setBusy(null), 2500)
  }

  const shareScreen = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const video = playingVideo((v) => {
        v.muted = true
        v.srcObject = stream
      })
      // Stopping the share from the browser's own bar returns the TV to standby.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        const current = useItemScreens.getState().screens[activeId]?.content
        if (current?.kind === 'video' && current.video === video) {
          useItemScreens.getState().setContent(activeId, { kind: 'idle' })
        }
      })
      screens.setContent(activeId, { kind: 'video', video, label: '화면 공유 중' })
    } catch {
      // Cancelled in the browser's picker.
    }
  }

  const playFile = (file: File) => {
    const video = playingVideo((v) => {
      v.src = URL.createObjectURL(file)
    })
    video.addEventListener('error', () => {
      const current = useItemScreens.getState().screens[activeId]?.content
      if (current?.kind === 'video' && current.video === video) {
        useItemScreens.getState().setContent(activeId, { kind: 'idle' })
        flash('이 동영상은 재생할 수 없어요')
      }
    })
    screens.setContent(activeId, { kind: 'video', video, label: file.name })
  }

  const loadDeck = async (files: File[]) => {
    if (files.length === 0) return
    setBusy('발표 자료를 여는 중…')
    try {
      const pages = await presentationPages(files)
      if (pages.length > 0) {
        screens.setContent(activeId, {
          kind: 'slides',
          pages,
          index: 0,
          label: files[0]!.name,
        })
      }
    } catch {
      flash('이 파일은 열 수 없어요')
      return
    }
    setBusy(null)
  }

  const status =
    busy ??
    (content.kind === 'slides'
      ? `${content.label} · ${content.index + 1} / ${content.pages.length}`
      : content.kind === 'video'
        ? content.label
        : '대기 화면')

  return (
    <>
      <div className="dark pointer-events-auto fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2 rounded-2xl border border-white/10 bg-[#141414]/90 p-3 text-white shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2 px-1 text-xs">
          <Tv className="size-4 text-white/60" />
          <span className="font-semibold">TV 리모컨</span>
          <span className="max-w-[260px] truncate text-white/55">{status}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <RemoteButton icon={MonitorUp} label="화면 공유" onClick={shareScreen} />
          <RemoteButton icon={Film} label="동영상" onClick={() => videoInput.current?.click()} />
          <RemoteButton
            icon={FileText}
            label="발표 자료"
            onClick={() => deckInput.current?.click()}
          />
          {content.kind === 'slides' && (
            <div className="flex items-center gap-1 rounded-xl bg-white/5 px-1">
              <button
                aria-label="이전 페이지"
                className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30"
                disabled={content.index === 0}
                onClick={() => screens.step(activeId, -1)}
                type="button"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="min-w-12 text-center font-mono text-xs">
                {content.index + 1}/{content.pages.length}
              </span>
              <button
                aria-label="다음 페이지"
                className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30"
                disabled={content.index >= content.pages.length - 1}
                onClick={() => screens.step(activeId, 1)}
                type="button"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
          {content.kind !== 'idle' && (
            <RemoteButton icon={Expand} label="크게 보기" onClick={() => setEnlarged(true)} />
          )}
          <RemoteButton icon={Power} label="끄기" onClick={() => screens.setOn(activeId, false)} />
        </div>
        <input
          accept="video/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) playFile(file)
            event.target.value = ''
          }}
          ref={videoInput}
          type="file"
        />
        <input
          accept="application/pdf,image/*"
          className="hidden"
          multiple
          onChange={(event) => {
            void loadDeck([...(event.target.files ?? [])])
            event.target.value = ''
          }}
          ref={deckInput}
          type="file"
        />
      </div>

      {enlarged && content.kind !== 'idle' && (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-black/90 p-8">
          <button
            aria-label="닫기"
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setEnlarged(false)}
            type="button"
          >
            <X className="size-5" />
          </button>
          {content.kind === 'slides' ? (
            <img
              alt={`${content.index + 1}쪽`}
              className="max-h-full max-w-full object-contain"
              src={content.pages[content.index]}
            />
          ) : (
            <EnlargedVideo video={content.video} />
          )}
        </div>
      )}
    </>
  )
}

/** The TV's own video, mirrored full-size (the same stream, not a second copy). */
function EnlargedVideo({ video }: { video: HTMLVideoElement }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const mirror = ref.current
    if (!mirror) return
    if (video.srcObject) mirror.srcObject = video.srcObject
    else {
      mirror.src = video.src
      mirror.currentTime = video.currentTime
    }
    mirror.muted = true
    void mirror.play()
  }, [video])
  // biome-ignore lint/a11y/useMediaCaption: a muted mirror of the TV's picture; the TV plays its sound.
  return <video className="max-h-full max-w-full" playsInline ref={ref} />
}

function RemoteButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Tv
  label: string
  onClick: () => void
}) {
  return (
    <button
      className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[11px] text-white/80 transition hover:bg-white/10"
      onClick={(event) => {
        event.currentTarget.blur()
        onClick()
      }}
      type="button"
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}
