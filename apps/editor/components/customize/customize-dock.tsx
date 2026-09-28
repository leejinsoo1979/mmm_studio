'use client'

import { Brush, Check, PaintRoller, RotateCcw } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { MaterialSphere, type SphereMaterial } from './material-sphere'
import { PART_LIST_SPACE } from './part-list'

/** Half the card's width, to keep it clear of the part list. */
const HALF_CARD = 318
export const CARD_FILL = 'bg-[#f3f3f5] dark:bg-neutral-900'

export function ColumnDivider() {
  return <span className="my-3 w-px shrink-0 self-stretch bg-[#e2e2e2] dark:bg-white/10" />
}

function HeaderDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-[#d6d6d6] dark:bg-white/15" />
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors disabled:text-[#d0d0d0] dark:disabled:text-neutral-700 ${
        active
          ? 'bg-[#bcdbf0] text-[#2b7bd0] dark:bg-sky-900/60 dark:text-sky-300'
          : 'text-[#777] hover:bg-black/5 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-white/10'
      }`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

// inZOI's concave shoulders joining the header tab to the card as one shape.
function Shoulder({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      className={`absolute bottom-0 size-4 fill-current text-[#f3f3f5] dark:text-neutral-900 ${
        side === 'left' ? '-left-4' : '-right-4'
      }`}
      viewBox="0 0 16 16"
    >
      <path
        d={
          side === 'left'
            ? 'M16 16V0C16 8.837 8.837 16 0 16H16Z'
            : 'M0 16V0C0 8.837 7.163 16 16 16H0Z'
        }
      />
    </svg>
  )
}

/**
 * inZOI's customize card: 외형 / 색상과 재질 tabs, a folder tab rising from
 * the card's top centre (applied material, paint scope, reset, 확인) and the
 * columns below. Kept compact: one short card centred over the scene.
 */
export function CustomizeDock({
  cardRef,
  hasPartList,
  shown,
  previewing,
  scope,
  canReset,
  onReset,
  onConfirm,
  onShape,
  children,
}: {
  cardRef: RefObject<HTMLDivElement | null>
  hasPartList: boolean
  shown: SphereMaterial | undefined
  previewing: boolean
  /** Single / room paint tools; absent when the kind can't spread. */
  scope?: { room: boolean; onChange: (room: boolean) => void }
  canReset: boolean
  onReset: () => void
  onConfirm: () => void
  onShape: () => void
  children: ReactNode
}) {
  const minLeft = `calc(var(--viewer-left-inset, 0px) + 12px + ${hasPartList ? PART_LIST_SPACE : 0}px + ${HALF_CARD}px)`
  const centre = 'calc(var(--viewer-left-inset, 0px) + (100% - var(--viewer-left-inset, 0px)) / 2)'
  return (
    <div
      className="-translate-x-1/2 pointer-events-auto fixed bottom-[68px] z-50 text-[#333] dark:text-neutral-100"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left: `max(${minLeft}, ${centre})` }}
    >
      <div className="-translate-x-1/2 absolute bottom-[calc(100%+48px)] left-1/2 grid h-7 w-[300px] grid-cols-2 rounded-full border border-white/80 bg-neutral-800/45 p-0.5 backdrop-blur-sm">
        <button
          className="rounded-full text-[12px] text-white transition-colors [text-shadow:0_1px_2px_rgba(0,0,0,0.4)] hover:bg-white/15"
          onClick={onShape}
          type="button"
        >
          외형
        </button>
        <span className="grid place-items-center rounded-full bg-white font-medium text-[#333] text-[12px]">
          색상과 재질
        </span>
      </div>
      {/* One drop shadow follows the card and its tab, so the join has no seam. */}
      <div className="relative [filter:drop-shadow(0_6px_20px_rgba(0,0,0,0.14))]">
        <div
          className={`-translate-x-1/2 absolute bottom-full left-1/2 flex h-10 items-center gap-0.5 rounded-t-[16px] px-2 ${CARD_FILL}`}
        >
          <Shoulder side="left" />
          <Shoulder side="right" />
          <span className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#e6e6e6] pr-1 pl-3 text-[11px] text-[#333] dark:bg-white/10 dark:text-neutral-200">
            {previewing ? '미리보기' : '적용된 재질'}
            <MaterialSphere material={shown} size={20} />
          </span>
          {scope && (
            <>
              <HeaderDivider />
              <ToolButton
                active={!scope.room}
                label="이 면만 칠하기"
                onClick={() => scope.onChange(false)}
              >
                <Brush className="size-[18px]" strokeWidth={1.6} />
              </ToolButton>
              <ToolButton
                active={scope.room}
                label="방 전체 칠하기"
                onClick={() => scope.onChange(true)}
              >
                <PaintRoller className="size-[18px]" strokeWidth={1.6} />
              </ToolButton>
            </>
          )}
          <HeaderDivider />
          <ToolButton disabled={!canReset} label="처음으로 되돌리기" onClick={onReset}>
            <RotateCcw className="size-[18px]" strokeWidth={1.6} />
          </ToolButton>
          <button
            className="ml-1 flex h-[30px] shrink-0 items-center gap-1 rounded-full bg-[#3d8fe0] px-3.5 font-medium text-[12px] text-white transition-colors hover:bg-[#2f7fd0]"
            onClick={onConfirm}
            title="확인 (Esc)"
            type="button"
          >
            <Check className="size-3.5" strokeWidth={2.5} />
            확인
          </button>
        </div>
        <div className={`relative flex h-[146px] rounded-[14px] ${CARD_FILL}`} ref={cardRef}>
          {children}
        </div>
      </div>
    </div>
  )
}
