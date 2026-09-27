'use client'

import { Icon } from '@iconify/react'
import { Copy, Focus, Move, Paintbrush, RotateCw, Search, Spline, Trash2 } from 'lucide-react'
import type { MouseEventHandler, PointerEventHandler, ReactNode } from 'react'

type NodeActionMenuProps = {
  onFind?: MouseEventHandler<HTMLButtonElement>
  onAddHole?: MouseEventHandler<HTMLButtonElement>
  onDelete?: MouseEventHandler<HTMLButtonElement>
  onDuplicate?: MouseEventHandler<HTMLButtonElement>
  onMove?: MouseEventHandler<HTMLButtonElement>
  onCurve?: MouseEventHandler<HTMLButtonElement>
  onRotate?: MouseEventHandler<HTMLButtonElement>
  onPaint?: MouseEventHandler<HTMLButtonElement>
  onFocus?: MouseEventHandler<HTMLButtonElement>
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
          : 'tooltip-trigger flex size-9 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900'
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
  onFind,
  onAddHole,
  onDelete,
  onDuplicate,
  onMove,
  onCurve,
  onRotate,
  onPaint,
  onFocus,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: NodeActionMenuProps) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-white/95 px-1.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.28)] backdrop-blur-md"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
    >
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
