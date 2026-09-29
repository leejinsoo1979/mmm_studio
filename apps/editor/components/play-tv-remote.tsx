'use client'

import { Slider, useEditor } from '@pascal-app/editor'
import { PROJECTION_WIDTH, PROJECTOR_ID, useItemScreens } from '@pascal-app/nodes'
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  FileText,
  Film,
  MonitorUp,
  Power,
  Projector,
  Tv,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { presentationPages } from '@/lib/presentation-pages'
import { enterFullscreen, ScreenFullscreen } from './play-screen-fullscreen'

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

const formatMetres = (metres: number) => `${metres.toFixed(metres < 1 ? 2 : 1)}m`

/**
 * The remote for the TV (or the projector) last switched on: put a shared
 * screen, a video file or a presentation (PDF or images) on it, turn its
 * pages (◀ ▶, or , and .), show it full screen, throw it onto a wall, floor
 * or ceiling at the size wanted (its proportions kept), or switch it off.
 */
export function PlayTvRemote() {
  const inGame = useEditor((state) => state.isFirstPersonMode)
  const activeId = useItemScreens((state) => state.activeId)
  const content = useItemScreens((state) =>
    state.activeId ? state.screens[state.activeId]?.content : undefined,
  )
  const projection = useItemScreens((state) =>
    state.activeId ? state.screens[state.activeId]?.projection : undefined,
  )
  const placing = useItemScreens((state) => state.placing)
  const [busy, setBusy] = useState<string | null>(null)
  const [enlarged, setEnlarged] = useState(false)
  const closeFullscreen = useCallback(() => setEnlarged(false), [])
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

  // Leaving the game ends any aiming.
  useEffect(() => {
    if (!inGame) useItemScreens.getState().cancelPlacing()
  }, [inGame])

  // Full screen ends with the remote (the screen switched off, here or by another player).
  const shown = Boolean(inGame && activeId && content && content.kind !== 'idle')
  useEffect(() => {
    if (!shown) setEnlarged(false)
  }, [shown])

  if (!(inGame && activeId && content)) return null
  const screens = useItemScreens.getState()
  const isProjector = activeId === PROJECTOR_ID

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

  if (placing) return <ProjectionAimHint width={placing.width} />

  return (
    <>
      <div className="dark pointer-events-auto fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2 rounded-2xl border border-white/10 bg-[#141414]/90 p-3 text-white shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2 px-1 text-xs">
          {isProjector ? (
            <Projector className="size-4 text-white/60" />
          ) : (
            <Tv className="size-4 text-white/60" />
          )}
          <span className="font-semibold">{isProjector ? '빔 프로젝터' : 'TV 리모컨'}</span>
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
            <RemoteButton
              icon={Expand}
              label="전체화면"
              onClick={() => {
                setEnlarged(true)
                enterFullscreen()
              }}
            />
          )}
          <RemoteButton
            icon={Projector}
            label={projection ? '투영 옮기기' : '벽에 투영'}
            onClick={() => screens.startPlacing(activeId)}
          />
          <RemoteButton icon={Power} label="끄기" onClick={() => screens.setOn(activeId, false)} />
        </div>
        {projection && (
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-[11px] text-white/70">
            <span className="shrink-0">투영 크기</span>
            <Slider
              aria-label="투영 크기"
              className="w-40"
              max={Math.log(PROJECTION_WIDTH.max)}
              min={Math.log(PROJECTION_WIDTH.min)}
              onValueChange={([next]) =>
                next !== undefined && screens.setProjectionWidth(activeId, Math.exp(next))
              }
              onValueCommit={() => (document.activeElement as HTMLElement | null)?.blur()}
              step={0.01}
              value={[Math.log(projection.width)]}
            />
            <span className="w-12 shrink-0 font-mono text-white/85">
              {formatMetres(projection.width)}
            </span>
            <button
              className="shrink-0 rounded-lg px-2 py-1 text-white/70 hover:bg-white/10"
              onClick={(event) => {
                event.currentTarget.blur()
                screens.setProjection(activeId, null)
              }}
              type="button"
            >
              투영 끄기
            </button>
          </div>
        )}
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
        <ScreenFullscreen content={content} onClose={closeFullscreen} screenId={activeId} />
      )}
    </>
  )
}

/**
 * While a projection is being aimed: a crosshair at the view's centre, where
 * the picture lands, and what the keys do.
 */
function ProjectionAimHint({ width }: { width: number }) {
  return (
    <>
      <div className="pointer-events-none fixed top-1/2 left-1/2 z-[60] size-5 -translate-x-1/2 -translate-y-1/2">
        <div className="absolute top-1/2 left-0 h-px w-full bg-white/90 shadow" />
        <div className="absolute top-0 left-1/2 h-full w-px bg-white/90 shadow" />
      </div>
      <div className="dark pointer-events-none fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-[#141414]/90 px-4 py-3 text-xs text-white shadow-2xl backdrop-blur-xl">
        <Projector className="size-4 text-sky-300" />
        <span className="font-semibold">투영할 곳을 조준하세요</span>
        <span className="font-mono text-white/85">가로 {formatMetres(width)}</span>
        <span className="text-white/55">휠 또는 [ ] 크기 · 클릭 또는 E 투영 · Esc 취소</span>
      </div>
    </>
  )
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
