'use client'

import { type ScreenContent, useItemScreens } from '@pascal-app/nodes'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', '.'])
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', ','])

/**
 * Takes the browser full screen, unless it already is or refuses (no
 * gesture, an iframe): the view then fills the window instead.
 */
export function enterFullscreen() {
  if (document.pointerLockElement) document.exitPointerLock()
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return
  void document.documentElement.requestFullscreen().catch(() => {})
}

function exitOwnFullscreen(took: boolean) {
  if (took && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
}

/**
 * A screen's picture over the whole display, letterboxed in its own
 * proportions: slides turn with the arrow keys, space, PageUp / PageDown or
 * the buttons, and Esc (or the browser leaving full screen) closes it. While
 * it is up, keys go to it rather than to walking.
 */
export function ScreenFullscreen({
  screenId,
  content,
  onClose,
}: {
  screenId: string
  content: Exclude<ScreenContent, { kind: 'idle' }>
  onClose: () => void
}) {
  // Whether this view took the browser full screen: one the page already had
  // (chosen from the command palette) is left as it was.
  const tookFullscreen = useRef(false)

  useEffect(() => {
    const close = () => {
      exitOwnFullscreen(tookFullscreen.current)
      onClose()
    }
    const onFullscreenChange = () => {
      if (document.fullscreenElement) tookFullscreen.current = true
      else onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      // Before the walkthrough's own keys (Esc would leave the game, arrows walk).
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      const step = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0
      if (step !== 0) {
        event.preventDefault()
        useItemScreens.getState().step(screenId, step)
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, screenId])

  // Closed from elsewhere (the screen switched off, the game left): leave full screen too.
  useEffect(() => () => exitOwnFullscreen(tookFullscreen.current), [])

  const close = () => {
    exitOwnFullscreen(tookFullscreen.current)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-black">
      <button
        aria-label="전체화면 닫기"
        className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        onClick={close}
        type="button"
      >
        <X className="size-5" />
      </button>
      {content.kind === 'slides' ? (
        <>
          <img
            alt={`${content.index + 1}쪽`}
            className="h-full w-full object-contain"
            src={content.pages[content.index]}
          />
          <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-2 py-1 text-white opacity-60 transition hover:opacity-100">
            <button
              aria-label="이전 페이지"
              className="rounded-full p-2 hover:bg-white/15 disabled:opacity-30"
              disabled={content.index === 0}
              onClick={() => useItemScreens.getState().step(screenId, -1)}
              type="button"
            >
              <ChevronLeft className="size-5" />
            </button>
            <span className="min-w-14 text-center font-mono text-sm">
              {content.index + 1} / {content.pages.length}
            </span>
            <button
              aria-label="다음 페이지"
              className="rounded-full p-2 hover:bg-white/15 disabled:opacity-30"
              disabled={content.index >= content.pages.length - 1}
              onClick={() => useItemScreens.getState().step(screenId, 1)}
              type="button"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        </>
      ) : (
        <MirroredVideo video={content.video} />
      )}
    </div>
  )
}

/** The screen's own video, mirrored full-size (the same stream, not a second capture). */
function MirroredVideo({ video }: { video: HTMLVideoElement }) {
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
  // biome-ignore lint/a11y/useMediaCaption: a muted mirror of the screen's picture; the screen plays its sound.
  return <video className="h-full w-full object-contain" playsInline ref={ref} />
}
