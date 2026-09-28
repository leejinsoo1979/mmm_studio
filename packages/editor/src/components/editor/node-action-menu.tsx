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
  RotateCw,
  Scissors,
  Search,
  Spline,
  Trash2,
} from 'lucide-react'
import type { MouseEventHandler, PointerEventHandler, ReactNode } from 'react'

type NodeActionMenuProps = {
  /** inZOI's blue '확인' pill: ends the edit (clears the selection). */
  onConfirm?: MouseEventHandler<HTMLButtonElement>
  onFind?: MouseEventHandler<HTMLButtonElement>
  onAddHole?: MouseEventHandler<HTMLButtonElement>
  onDelete?: MouseEventHandler<HTMLButtonElement>
  onDuplicate?: MouseEventHandler<HTMLButtonElement>
  onMove?: MouseEventHandler<HTMLButtonElement>
  onCurve?: MouseEventHandler<HTMLButtonElement>
  onRotate?: MouseEventHandler<HTMLButtonElement>
  onPaint?: MouseEventHandler<HTMLButtonElement>
  onFocus?: MouseEventHandler<HTMLButtonElement>
  /** mmmcraft 벽 분절 / 좌우대칭 / 상하반전. */
  onSplit?: MouseEventHandler<HTMLButtonElement>
  onFlipHinge?: MouseEventHandler<HTMLButtonElement>
  onFlipSwing?: MouseEventHandler<HTMLButtonElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
}

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
      className={
        danger
          ? 'tooltip-trigger flex size-9 items-center justify-center rounded-full text-red-500 transition-colors hover:bg-red-50'
          : 'tooltip-trigger flex size-9 items-center justify-center rounded-full text-neutral-600 dark:text-neutral-300 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10 hover:text-neutral-900 dark:hover:text-white'
      }
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
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
  onRotate,
  onPaint,
  onFocus,
  onSplit,
  onFlipHinge,
  onFlipSwing,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: NodeActionMenuProps) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-white/95 dark:bg-neutral-900/95 px-1.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.28)] backdrop-blur-md"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
    >
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
          <Move className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
      {onRotate && (
        <MenuButton label="45° 회전 (R)" onClick={onRotate}>
          <RotateCw className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
      {onCurve && (
        <MenuButton label="곡선" onClick={onCurve}>
          <Spline className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
      {onSplit && (
        <MenuButton label="벽 분절 (가운데서 나누기)" onClick={onSplit}>
          <Scissors className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
      {onFlipHinge && (
        <MenuButton label="좌우대칭 (경첩 방향)" onClick={onFlipHinge}>
          <FlipHorizontal2 className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
      {onFlipSwing && (
        <MenuButton label="상하반전 (여는 방향)" onClick={onFlipSwing}>
          <FlipVertical2 className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
      {onPaint && (
        <MenuButton label="색상·재질" onClick={onPaint}>
          <Paintbrush className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
      {onDuplicate && (
        <MenuButton label="복제" onClick={onDuplicate}>
          <Copy className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
      {onAddHole && (
        <MenuButton label="구멍 내기" onClick={onAddHole}>
          <Icon height={18} icon="carbon:cut-out" width={18} />
        </MenuButton>
      )}
      {onFocus && (
        <MenuButton label="시점 이동 (더블클릭)" onClick={onFocus}>
          <Focus className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
      {onFind && (
        <MenuButton label="카탈로그에서 찾기" onClick={onFind}>
          <Search className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
      {onDelete && (
        <MenuButton danger label="삭제" onClick={onDelete}>
          <Trash2 className="h-[18px] w-[18px]" />
        </MenuButton>
      )}
    </div>
  )
}
