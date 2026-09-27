'use client'

import { cloneElement, type ReactElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type CatalogHoverInfo = {
  title: string
  description?: string
  image?: string
  /** Bottom-right line — size or another short fact (inZOI shows the price). */
  meta?: string
}

const SHOW_DELAY_MS = 250

/**
 * inZOI's catalog hover card: after a short hover, a wide card rises over the
 * panel above the tile with the item's picture, name, description and a fact
 * line. Wraps a single tile element; the card spans the panel's width.
 */
export function CatalogHover({
  info,
  children,
}: {
  info: CatalogHoverInfo
  children: ReactElement<{
    onMouseEnter?: (e: React.MouseEvent<HTMLElement>) => void
    onMouseLeave?: (e: React.MouseEvent<HTMLElement>) => void
  }>
}) {
  const [anchor, setAnchor] = useState<{ left: number; width: number; bottom: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    children.props.onMouseEnter?.(e)
    const tile = e.currentTarget.getBoundingClientRect()
    const panel = e.currentTarget.closest('[data-floating-panel]')?.getBoundingClientRect() ?? tile
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(
      () =>
        setAnchor({
          left: panel.left + 6,
          width: panel.width - 12,
          bottom: window.innerHeight - tile.top + 8,
        }),
      SHOW_DELAY_MS,
    )
  }
  const onLeave = (e: React.MouseEvent<HTMLElement>) => {
    children.props.onMouseLeave?.(e)
    window.clearTimeout(timer.current)
    setAnchor(null)
  }

  return (
    <>
      {cloneElement(children, { onMouseEnter: onEnter, onMouseLeave: onLeave })}
      {anchor &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[200] flex min-h-[120px] gap-3 rounded-2xl bg-white p-3.5 text-neutral-800 shadow-[0_10px_36px_rgba(0,0,0,0.28)] ring-1 ring-black/5 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/10"
            style={{ left: anchor.left, width: anchor.width, bottom: anchor.bottom }}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="font-semibold text-[15px] leading-snug">{info.title}</div>
              {info.description && (
                <p className="mt-1.5 line-clamp-4 text-[11px] text-neutral-500 leading-relaxed dark:text-neutral-400">
                  {info.description}
                </p>
              )}
              {info.meta && (
                <div className="mt-auto pt-2 text-right font-semibold text-[13px] tabular-nums">
                  {info.meta}
                </div>
              )}
            </div>
            {info.image && (
              <img
                alt=""
                className="h-28 w-28 shrink-0 rounded-lg object-contain"
                src={info.image}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
