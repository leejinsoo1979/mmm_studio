'use client'

import { Info, MousePointerClick, Redo2, Undo2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

const OFFSET_X = 36
const OFFSET_Y = -14

/**
 * inZOI's unboxed paint hints riding beside the cursor while customizing:
 * shown over the scene only, hidden over the card and other controls.
 */
export function PaintHints({ wall }: { wall: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    let x = 0
    let y = 0
    let shown = false
    const flush = () => {
      frame = 0
      el.style.display = shown ? 'flex' : 'none'
      if (!shown) return
      const left =
        x + OFFSET_X + el.offsetWidth > window.innerWidth
          ? x - OFFSET_X - el.offsetWidth
          : x + OFFSET_X
      const top = Math.max(0, Math.min(y + OFFSET_Y, window.innerHeight - el.offsetHeight))
      el.style.transform = `translate(${left}px, ${top}px)`
    }
    const onMove = (event: PointerEvent) => {
      const target = event.target as Element | null
      x = event.clientX
      y = event.clientY
      shown = !!target?.closest('canvas') && event.buttons === 0
      if (frame === 0) frame = window.requestAnimationFrame(flush)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  const row = 'flex items-center gap-1.5 whitespace-nowrap'
  const icon = 'size-3.5 shrink-0'
  return (
    <div
      aria-hidden="true"
      // Dark text with a white halo: the scene stays light in either UI theme.
      className="pointer-events-none fixed top-0 left-0 z-40 flex-col gap-[9px] font-medium text-[12px] text-neutral-800 [text-shadow:0_0_4px_rgba(255,255,255,0.95),0_0_2px_rgba(255,255,255,0.95)]"
      ref={ref}
      style={{ display: 'none' }}
    >
      <span className={row}>
        <MousePointerClick className={icon} strokeWidth={1.8} />
        클릭: 칠할 부분 선택
      </span>
      <span className={row}>
        <Undo2 className={icon} strokeWidth={1.8} />
        실행 취소 (Ctrl+Z)
        <span className="opacity-70">/</span>
        <Redo2 className={icon} strokeWidth={1.8} />
        재실행 (Ctrl+Shift+Z)
      </span>
      <span className={row}>
        <Info className={icon} strokeWidth={1.8} />
        재질에 마우스를 올려 미리보기, 클릭해 적용
      </span>
      {wall && (
        <span className={row}>
          <Info className={icon} strokeWidth={1.8} />
          벽은 안쪽 면과 바깥쪽 면을 따로 칠할 수 있음
        </span>
      )}
      <span className={row}>
        <span className="rounded-[4px] border border-current px-1 text-[10px] leading-[14px]">
          Esc
        </span>
        닫기
      </span>
    </div>
  )
}
