'use client'

import { RefreshCw, X } from 'lucide-react'

/**
 * Save / sync problems, as a card under the tool bar and its filter row so it
 * never covers their buttons. It rides in the viewer overlays, so hiding the
 * UI hides it too.
 */
export function SceneStatusBanner({
  conflict,
  error,
  onReload,
  onDismiss,
}: {
  conflict: boolean
  error: string | null
  onReload: () => void
  onDismiss: () => void
}) {
  if (!(conflict || error)) return null
  return (
    <div
      className="pointer-events-auto fixed top-[132px] left-[var(--hud-center-x,50%)] z-40 w-max max-w-md -translate-x-1/2 rounded-xl bg-[#f5f5f5]/95 py-2.5 pr-2 pl-3.5 text-neutral-700 shadow-[0_2px_8px_rgba(0,0,0,0.15)] backdrop-blur-md dark:bg-neutral-900/95 dark:text-neutral-200"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {conflict ? (
            <>
              <p className="font-semibold text-[13px]">다른 곳에서 먼저 저장했습니다</p>
              <p className="mt-0.5 text-[12px] text-neutral-500">
                지금 변경 사항은 저장되지 않았습니다. 새로 고쳐 최신 내용을 불러오세요.
              </p>
            </>
          ) : (
            <p className="pt-0.5 font-medium text-[12px] text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
        {conflict && (
          <button
            className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-[#bfe0fa] px-3 font-semibold text-[#2f7fd0] text-[12px] hover:bg-[#aad5f8]"
            onClick={onReload}
            type="button"
          >
            <RefreshCw className="size-3.5" />
            새로 고침
          </button>
        )}
        <button
          aria-label="닫기"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-black/[0.06] dark:hover:bg-white/10"
          onClick={onDismiss}
          title="닫기"
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
