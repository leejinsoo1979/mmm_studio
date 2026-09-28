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
/** How far the card overhangs the panel on each side. */
const OVERHANG = 6

type Anchor = { left: number; width: number; bottom: number; tailX: number }

/**
 * inZOI's catalog hover card: after a short hover, a wide card rises over the
 * panel above the tile with the item's picture, name, description and a fact
 * line, and a tail pointing down at the tile. Wraps a single tile element.
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
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    children.props.onMouseEnter?.(e)
    const tile = e.currentTarget.getBoundingClientRect()
    const panel = e.currentTarget.closest('[data-floating-panel]')?.getBoundingClientRect() ?? tile
    const left = panel.left - OVERHANG
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(
      () =>
        setAnchor({
          left,
          width: panel.width + OVERHANG * 2,
          bottom: window.innerHeight - tile.top + 10,
          tailX: tile.left + tile.width / 2 - left,
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
            className="pointer-events-none fixed z-[200] flex min-h-[132px] gap-3 rounded-[14px] bg-white p-3.5 text-neutral-800 shadow-[0_6px_20px_rgba(0,0,0,0.2)] dark:bg-neutral-900 dark:text-neutral-100"
            style={{ left: anchor.left, width: anchor.width, bottom: anchor.bottom }}
          >
            <div className="flex min-w-0 flex-1 flex-col justify-end">
              <div className="font-bold text-[15px] leading-snug">{info.title}</div>
              {info.description && (
                <p className="mt-1.5 line-clamp-4 text-[10.5px] text-neutral-500 leading-relaxed dark:text-neutral-400">
                  {info.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end">
              {info.image && (
                <img alt="" className="h-28 w-36 rounded-lg object-contain" src={info.image} />
              )}
              {info.meta && (
                <div className="mt-auto pt-1.5 font-bold text-[17px] tabular-nums leading-none">
                  {info.meta}
                </div>
              )}
            </div>
            <span
              aria-hidden
              className="absolute -bottom-[7px] size-3.5 rotate-45 bg-white dark:bg-neutral-900"
              style={{ left: anchor.tailX - 7 }}
            />
          </div>,
          document.body,
        )}
    </>
  )
}
