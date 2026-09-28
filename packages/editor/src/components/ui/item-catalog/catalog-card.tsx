'use client'

import { Box, Check } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { triggerSFX } from '../../../lib/sfx-bus'
import { cn } from '../../../lib/utils'
import { CatalogHover } from './catalog-hover'

export type CatalogCardHover = {
  description?: string
  image?: string
  meta?: string
}

/**
 * inZOI catalog card: a square near-white tile with the render centred, no
 * name, a short fact line at the bottom right and a check badge when active.
 * Hovering opens the wide detail card with the name.
 */
export function CatalogCard({
  label,
  image,
  imageFit = 'contain',
  imageClassName,
  thumb,
  caption,
  meta,
  active = false,
  disabled = false,
  badge,
  hover,
  onClick,
  onDoubleClick,
}: {
  label: string
  image?: string | null
  /** `cover` fills the card edge to edge (photos), `contain` centres a render. */
  imageFit?: 'contain' | 'cover'
  imageClassName?: string
  /** Drawn thumbnail used instead of `image`. */
  thumb?: ReactNode
  /** Overlay drawn above the thumbnail, positioned by the caller (the wall-height label). */
  caption?: ReactNode
  /** Bottom-right fact line (size, height …). */
  meta?: string
  active?: boolean
  disabled?: boolean
  /** Top-left marker (snap target, my-model …). */
  badge?: ReactNode
  /** Detail card content; `false` turns the hover card off. */
  hover?: CatalogCardHover | false
  onClick?: () => void
  onDoubleClick?: () => void
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  useEffect(() => setFailedSrc(null), [image])
  const showImage = !thumb && image && failedSrc !== image
  const cover = imageFit === 'cover'

  const button = (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'group relative aspect-square min-w-0 overflow-hidden rounded-[10px] text-left transition-colors',
        disabled
          ? 'cursor-not-allowed bg-[rgba(200,200,200,0.6)] dark:bg-white/10'
          : 'bg-[var(--panel-card,#f3f3f3)] hover:bg-[var(--panel-card-hover,#fff)]',
      )}
      disabled={disabled}
      onClick={() => {
        triggerSFX('sfx:menu-click')
        onClick?.()
      }}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => triggerSFX('sfx:menu-hover')}
      type="button"
    >
      <span
        className={cn(
          'absolute flex items-center justify-center transition-transform duration-200 group-hover:scale-105',
          cover ? 'inset-0' : 'inset-x-[10%] top-[8%] bottom-[18%]',
          disabled && 'opacity-50',
        )}
      >
        {thumb ??
          (showImage ? (
            <img
              alt=""
              className={cn(
                'h-full w-full',
                cover ? 'object-cover' : 'object-contain',
                imageClassName,
              )}
              draggable={false}
              loading="lazy"
              onError={() => setFailedSrc(image ?? null)}
              src={image ?? undefined}
            />
          ) : (
            <Box className="size-7 text-[#b5b5b5]" strokeWidth={1.25} />
          ))}
      </span>
      {caption}
      {meta && (
        <span
          className={cn(
            'absolute right-1 bottom-1 max-w-[calc(100%-8px)] truncate font-semibold text-[9.5px] text-[var(--panel-card-fg,#333)] tabular-nums leading-none',
            cover &&
              'rounded-[3px] bg-white/80 px-1 py-0.5 text-[#333] dark:bg-neutral-900/75 dark:text-neutral-100',
            disabled && 'opacity-50',
          )}
        >
          {meta}
        </span>
      )}
      {badge && <span className="absolute top-1 left-1 flex">{badge}</span>}
      {active && (
        <span className="absolute top-1 right-1 flex size-[18px] items-center justify-center rounded-full bg-[var(--panel-accent,#8ec3f2)] text-white ring-[1.5px] ring-white">
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
    </button>
  )

  if (hover === false) return button
  return (
    <CatalogHover
      info={{
        title: label,
        description: hover?.description,
        image: hover?.image ?? (showImage && image ? image : undefined),
        meta: hover?.meta ?? meta,
      }}
    >
      {button}
    </CatalogHover>
  )
}
