'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { ChevronDown, ChevronLeft, RotateCcw, X } from 'lucide-react'
import Image from 'next/image'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useIsMobile } from '../../../hooks/use-mobile'
import { cn } from '../../../lib/utils'
import { useInspectorCollapsed } from '../../../store/use-inspector-collapsed'
import { useUiHidden } from '../../../store/use-ui-hidden'
import { hasFloatingActionMenu } from '../../editor/floating-action-menu'

const DRAG_MARGIN = 8
// Pointer travel (px) below which a header press is treated as a click
// (toggles collapse) rather than a drag.
const CLICK_SLOP = 4

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Bounds the panel is allowed to occupy — the viewer column (tagged with
 * `data-viewer-bounds`) so it can't slide under the sidebar or top bar.
 * Falls back to the viewport when the marker isn't found.
 */
function getDragBounds(el: HTMLElement | null): {
  left: number
  top: number
  right: number
  bottom: number
} {
  const region = el?.closest('[data-viewer-bounds]')
  const rect = region?.getBoundingClientRect()
  if (!rect) {
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  }
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/**
 * Host-supplied inspector footer (e.g. community's "Save as preset"). The
 * `PanelManager` provides it so every panel — including kind-owned
 * `customPanel`s that render their own `<PanelWrapper>` without threading a
 * `footer` prop — picks it up without per-kind wiring. An explicit `footer`
 * prop still wins over the context.
 */
export const InspectorFooterContext = createContext<React.ReactNode>(null)

interface PanelWrapperProps {
  title: string
  /** Either a URL path (legacy panels pass `/icons/floor.webp` etc.,
   *  rendered via next/image) OR a React node (registry-driven
   *  inspector renders `<Icon icon="lucide:fence" />` from
   *  `def.presentation.icon`). */
  icon?: string | React.ReactNode
  onClose?: () => void
  onReset?: () => void
  onBack?: () => void
  children: React.ReactNode
  /** Pinned below the scrollable body, inside the panel card. */
  footer?: React.ReactNode
  className?: string
  width?: number | string
}

const HEADER_BUTTON_CLASS =
  'flex size-7 items-center justify-center rounded-full bg-[#efefef] text-neutral-500 transition-colors hover:bg-[#e4e4e4] hover:text-neutral-800 dark:bg-white/10 dark:text-neutral-300 dark:hover:bg-white/15 dark:hover:text-white'

/** True when the selection is one object whose floating action menu has 속성. */
function useOpensFromActionMenu(): boolean {
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : null,
  )
  return useScene((s) => {
    const node = selectedId ? s.nodes[selectedId as AnyNodeId] : null
    return !!node && hasFloatingActionMenu(node.type)
  })
}

export function PanelWrapper({
  title,
  icon,
  onClose,
  onReset,
  onBack,
  children,
  footer,
  className,
  width = 320, // default width
}: PanelWrapperProps) {
  const isMobile = useIsMobile()
  const contextFooter = useContext(InspectorFooterContext)
  const resolvedFooter = footer ?? contextFooter

  const panelRef = useRef<HTMLDivElement>(null)

  // The whole panel is collapsed to just its header by default; the chevron
  // expands it to reveal the inspector body. Keep the desktop value shared
  // across inspector swaps (roof ↔ segment, etc.) so navigating between
  // related panels preserves whether the user left the inspector open.
  const collapsed = useInspectorCollapsed((s) => s.collapsed)
  const setCollapsed = useInspectorCollapsed((s) => s.setCollapsed)
  // A single object with a floating action menu opens its inspector from the
  // menu's 속성 (or the paint card's 외형), so its folded card is not drawn at
  // all — inZOI shows only the menu over the object. Other selections (zones,
  // several objects, references) keep the folded header as their way in.
  const opensFromMenu = useOpensFromActionMenu()
  const customizing = useUiHidden((s) => s.customizing)
  const hiddenWhileCollapsed = !isMobile && collapsed && (opensFromMenu || customizing)

  // Esc folds an open card away before it reaches the selection. An Esc typed
  // into one of the card's fields belongs to that field (it cancels the edit),
  // so only the next Esc folds the card.
  useEffect(() => {
    if (isMobile || collapsed || !opensFromMenu) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      event.stopImmediatePropagation()
      setCollapsed(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [collapsed, isMobile, opensFromMenu, setCollapsed])

  // Drag-to-reposition from the header. `offset` is a translation applied on
  // top of the default `top-20 right-4` anchor; null until first dragged.
  // Dragging is clamped so no edge of the panel leaves the viewport.
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{
    startX: number
    startY: number
    baseX: number
    baseY: number
    rectLeft: number
    rectTop: number
    width: number
    height: number
    minLeft: number
    maxLeft: number
    minTop: number
    maxTop: number
    moved: boolean
  } | null>(null)

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Buttons (close / reset / collapse) handle their own clicks.
      if ((e.target as HTMLElement).closest('button')) return
      const rect = panelRef.current?.getBoundingClientRect()
      if (!rect) return
      const bounds = getDragBounds(panelRef.current)
      const base = offset ?? { x: 0, y: 0 }
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: base.x,
        baseY: base.y,
        rectLeft: rect.left,
        rectTop: rect.top,
        width: rect.width,
        height: rect.height,
        minLeft: bounds.left + DRAG_MARGIN,
        maxLeft: bounds.right - rect.width - DRAG_MARGIN,
        minTop: bounds.top + DRAG_MARGIN,
        maxTop: bounds.bottom - rect.height - DRAG_MARGIN,
        moved: false,
      }
      setIsDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [offset],
  )

  const handleHeaderPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    // Hold position until the press clearly becomes a drag, so a click can
    // still toggle collapse.
    if (!drag.moved && Math.hypot(dx, dy) <= CLICK_SLOP) return
    drag.moved = true
    const left = clamp(drag.rectLeft + dx, drag.minLeft, drag.maxLeft)
    const top = clamp(drag.rectTop + dy, drag.minTop, drag.maxTop)
    setOffset({ x: drag.baseX + (left - drag.rectLeft), y: drag.baseY + (top - drag.rectTop) })
  }, [])

  const handleHeaderPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setIsDragging(false)
      e.currentTarget.releasePointerCapture(e.pointerId)
      // A press that never turned into a drag is a click → toggle collapse.
      // A card opened from the action menu has no folded state to show, so
      // a click on its title must not make it vanish; its X closes it.
      if (!(drag.moved || opensFromMenu)) setCollapsed((c) => !c)
    },
    [opensFromMenu, setCollapsed],
  )

  // Expanding can grow the panel past an edge if it was dragged there while
  // collapsed — nudge it back inside the viewer bounds.
  useLayoutEffect(() => {
    if (isMobile || collapsed) return
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const bounds = getDragBounds(el)
    const left = clamp(rect.left, bounds.left + DRAG_MARGIN, bounds.right - rect.width - DRAG_MARGIN)
    const top = clamp(rect.top, bounds.top + DRAG_MARGIN, bounds.bottom - rect.height - DRAG_MARGIN)
    const dx = left - rect.left
    const dy = top - rect.top
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setOffset((prev) => ({ x: (prev?.x ?? 0) + dx, y: (prev?.y ?? 0) + dy }))
    }
  }, [collapsed, isMobile])

  if (hiddenWhileCollapsed) return null

  const closeCard = opensFromMenu ? () => setCollapsed(true) : onClose

  return (
    <div
      className={cn(
        isMobile
          ? 'flex h-full w-full flex-col overflow-hidden bg-transparent dark:text-foreground'
          // inZOI card: light surface, no border, soft shadow, under the
          // top-right cluster. The height cap keeps its bottom clear of the
          // bottom bar; the body below scrolls past it.
          : 'pointer-events-auto fixed top-[72px] right-4 z-50 flex max-h-[calc(100dvh-160px)] flex-col overflow-hidden rounded-[14px] bg-[#f9f9f9]/95 shadow-[0_6px_20px_rgba(0,0,0,0.12)] backdrop-blur-xl dark:bg-neutral-900/95 dark:text-foreground',
        className,
      )}
      ref={panelRef}
      style={
        isMobile
          ? undefined
          : {
              width,
              transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
            }
      }
    >
      {/* Header — desktop only; mobile sheet provides its own header. Doubles
          as the drag handle (grip in the middle) for repositioning the panel. */}
      {!isMobile && (
        <div
          className={cn(
            'relative flex h-11 shrink-0 select-none items-center justify-between pr-2 pl-4',
            !collapsed && 'border-black/5 border-b dark:border-white/10',
            isDragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleHeaderPointerUp}
        >
          <div className="flex min-w-0 items-center gap-2">
            {onBack && (
              <button
                className="mr-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={onBack}
                type="button"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {icon &&
              (typeof icon === 'string' ? (
                <Image
                  alt=""
                  className="shrink-0 object-contain"
                  height={16}
                  src={icon}
                  width={16}
                />
              ) : (
                <span className="flex shrink-0 items-center justify-center">{icon}</span>
              ))}
            <h2 className="truncate font-semibold text-[#222] text-[15px] tracking-tight dark:text-foreground">
              {title}
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {onReset && (
              <button
                aria-label="초기화"
                className={HEADER_BUTTON_CLASS}
                onClick={onReset}
                type="button"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            {!opensFromMenu && (
              <button
                aria-expanded={!collapsed}
                aria-label={collapsed ? '펼치기' : '접기'}
                className={HEADER_BUTTON_CLASS}
                onClick={() => setCollapsed((c) => !c)}
                type="button"
              >
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', collapsed ? '' : 'rotate-180')}
                />
              </button>
            )}
            {closeCard && (
              <button
                aria-label="닫기"
                className={HEADER_BUTTON_CLASS}
                onClick={closeCard}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content — hidden while the panel is collapsed (desktop). */}
      {!(collapsed && !isMobile) && (
        <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      )}

      {resolvedFooter && !(collapsed && !isMobile) && (
        <div className="shrink-0 border-black/5 border-t p-3 dark:border-white/10">
          {resolvedFooter}
        </div>
      )}
    </div>
  )
}
