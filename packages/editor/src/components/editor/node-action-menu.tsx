'use client'

import { Icon } from '@iconify/react'
import {
  Check,
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  Focus,
  Move,
  Paintbrush,
  RotateCcw,
  RotateCw,
  Scissors,
  Search,
  SlidersHorizontal,
  Spline,
  Trash2,
} from 'lucide-react'
import type { MouseEventHandler, PointerEventHandler, ReactNode } from 'react'
import { cn } from '../../lib/utils'

type NodeActionMenuProps = {
  /** inZOI's blue '확인' pill: ends the edit (clears the selection). */
  onConfirm?: MouseEventHandler<HTMLButtonElement>
  onFind?: MouseEventHandler<HTMLButtonElement>
  onAddHole?: MouseEventHandler<HTMLButtonElement>
  onDelete?: MouseEventHandler<HTMLButtonElement>
  onDuplicate?: MouseEventHandler<HTMLButtonElement>
  onMove?: MouseEventHandler<HTMLButtonElement>
  onCurve?: MouseEventHandler<HTMLButtonElement>
  /** 45° to the left (counter-clockwise seen from above) — the R key. */
  onRotateLeft?: MouseEventHandler<HTMLButtonElement>
  /** 45° to the right (clockwise seen from above) — the T key. */
  onRotateRight?: MouseEventHandler<HTMLButtonElement>
  onPaint?: MouseEventHandler<HTMLButtonElement>
  /** Opens the inspector card (속성). */
  onInspect?: MouseEventHandler<HTMLButtonElement>
  onFocus?: MouseEventHandler<HTMLButtonElement>
  /** mmmcraft 벽 분절 / 좌우대칭 / 상하반전. */
  onSplit?: MouseEventHandler<HTMLButtonElement>
  onFlipHinge?: MouseEventHandler<HTMLButtonElement>
  onFlipSwing?: MouseEventHandler<HTMLButtonElement>
  /** The small tail pointing at the object (inZOI): under the pill, over it, or none. */
  tail?: 'down' | 'up' | 'none'
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
}

const ICON_CLASS = 'size-5'
const ICON_STROKE = 1.5

function MenuButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string
  onClick: MouseEventHandler<HTMLButtonElement>
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        'group relative flex size-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none',
        danger
          ? 'text-[#e86060] hover:text-[#f08a84] focus-visible:text-[#f08a84]'
          : 'text-[#8a8a8a] hover:text-[#7db8ee] focus-visible:text-[#7db8ee] dark:text-neutral-400',
      )}
      onClick={onClick}
      type="button"
    >
      {children}
      <span className="-translate-x-1/2 pointer-events-none absolute bottom-full left-1/2 mb-2.5 whitespace-nowrap rounded-md bg-neutral-900/90 px-2 py-1 font-medium text-[11px] text-white leading-none opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  )
}

/** inZOI-style white pill of actions floating above the selected object. */
export function NodeActionMenu({
  onConfirm,
  onFind,
  onAddHole,
  onDelete,
  onDuplicate,
  onMove,
  onCurve,
  onRotateLeft,
  onRotateRight,
  onPaint,
  onInspect,
  onFocus,
  onSplit,
  onFlipHinge,
  onFlipSwing,
  tail = 'down',
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: NodeActionMenuProps) {
  return (
    <div
      className="pointer-events-auto relative flex items-center gap-0.5 rounded-full bg-white/95 px-1.5 py-0.5 shadow-[0_4px_16px_rgba(0,0,0,0.18)] backdrop-blur-md dark:bg-neutral-900/95"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
    >
      {tail === 'down' && (
        <span
          aria-hidden
          className="-translate-x-1/2 absolute top-full left-1/2 size-0 border-x-[7px] border-x-transparent border-t-[8px] border-t-white/95 drop-shadow-[0_2px_2px_rgba(0,0,0,0.12)] dark:border-t-neutral-900/95"
        />
      )}
      {tail === 'up' && (
        <span
          aria-hidden
          className="-translate-x-1/2 absolute bottom-full left-1/2 size-0 border-x-[7px] border-x-transparent border-b-[8px] border-b-white/95 dark:border-b-neutral-900/95"
        />
      )}
      {onConfirm && (
        <button
          className="relative mr-1 inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#2B8CE8] px-3 font-semibold text-white text-xs shadow-[0_2px_8px_rgba(0,0,0,0.25)] ring-2 ring-white after:absolute after:top-full after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:-translate-y-[3px] after:rotate-45 after:border-white after:border-r-2 after:border-b-2 after:bg-[#2B8CE8] hover:bg-[#1f7fd9]"
          onClick={onConfirm}
          title="확인 (Enter)"
          type="button"
        >
          <Check className="size-3.5" strokeWidth={2.5} />
          확인
        </button>
      )}
      {onMove && (
        <MenuButton label="이동" onClick={onMove}>
          <Move className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onRotateLeft && (
        <MenuButton label="왼쪽으로 45° 회전 (R)" onClick={onRotateLeft}>
          <RotateCcw className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onRotateRight && (
        <MenuButton label="오른쪽으로 45° 회전 (T)" onClick={onRotateRight}>
          <RotateCw className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onCurve && (
        <MenuButton label="곡선 아크" onClick={onCurve}>
          <Spline className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onSplit && (
        <MenuButton label="벽 분절 (가운데서 나누기)" onClick={onSplit}>
          <Scissors className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onFlipHinge && (
        <MenuButton label="좌우대칭 (경첩 방향)" onClick={onFlipHinge}>
          <FlipHorizontal2 className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onFlipSwing && (
        <MenuButton label="상하반전 (여는 방향)" onClick={onFlipSwing}>
          <FlipVertical2 className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onInspect && (
        <MenuButton label="속성" onClick={onInspect}>
          <SlidersHorizontal className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onPaint && (
        <MenuButton label="색상·재질" onClick={onPaint}>
          <Paintbrush className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onFind && (
        <MenuButton label="카탈로그에서 찾기" onClick={onFind}>
          <Search className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onDuplicate && (
        <MenuButton label="복제" onClick={onDuplicate}>
          <Copy className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onAddHole && (
        <MenuButton label="구멍 내기" onClick={onAddHole}>
          <Icon height={20} icon="carbon:cut-out" width={20} />
        </MenuButton>
      )}
      {onFocus && (
        <MenuButton label="시점 이동 (더블클릭)" onClick={onFocus}>
          <Focus className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
      {onDelete && (
        <MenuButton danger label="삭제" onClick={onDelete}>
          <Trash2 className={ICON_CLASS} strokeWidth={ICON_STROKE} />
        </MenuButton>
      )}
    </div>
  )
}

/**
 * inZOI's floating delta over the menu ('- M 170' after a duplicate): a
 * short label that rises from `anchor` and fades. Imperative so it outlives
 * the menu, which unmounts as soon as the copy is handed to the move tool.
 */
export function flashAbove(anchor: Element | null, text: string) {
  if (!(anchor && typeof document !== 'undefined')) return
  const rect = anchor.getBoundingClientRect()
  const el = document.createElement('div')
  el.textContent = text
  el.setAttribute('aria-hidden', 'true')
  Object.assign(el.style, {
    position: 'fixed',
    left: `${rect.left + rect.width / 2}px`,
    top: `${rect.top - 6}px`,
    transform: 'translate(-50%, -100%)',
    pointerEvents: 'none',
    zIndex: '60',
    whiteSpace: 'nowrap',
    font: '600 13px/1 var(--font-sans, system-ui, sans-serif)',
    color: '#2f8fe0',
    textShadow: '0 1px 2px rgba(255,255,255,0.9)',
  })
  document.body.appendChild(el)
  const animation = el.animate(
    [
      { opacity: 1, transform: 'translate(-50%, -100%)' },
      { opacity: 1, transform: 'translate(-50%, calc(-100% - 10px))', offset: 0.5 },
      { opacity: 0, transform: 'translate(-50%, calc(-100% - 18px))' },
    ],
    { duration: 900, easing: 'ease-out', fill: 'forwards' },
  )
  animation.onfinish = () => el.remove()
}
