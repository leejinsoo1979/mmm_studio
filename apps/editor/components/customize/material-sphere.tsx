'use client'

import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'

export type SphereMaterial = { previewColor?: string; previewThumbnailUrl?: string }

/**
 * A flat swatch drawn as a lit ball (inZOI): a top-left highlight and a
 * darker lower-right limb over the texture, so even white paint reads on the
 * pale card.
 */
export function sphereStyle(material: SphereMaterial | undefined, size: number): CSSProperties {
  const texture = material?.previewThumbnailUrl
  return {
    width: size,
    height: size,
    borderRadius: 999,
    backgroundColor: material?.previewColor ?? (texture ? '#bbbbbb' : '#dcdcdc'),
    backgroundImage: [
      'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.7) 0, rgba(255,255,255,0) 34%)',
      'radial-gradient(circle at 46% 42%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.34) 100%)',
      ...(texture ? [`url("${texture}")`] : []),
    ].join(', '),
    backgroundSize: texture ? 'auto, auto, 180%' : 'auto, auto',
    backgroundPosition: 'center',
    boxShadow: 'inset 0 -2px 4px rgba(0,0,0,0.16), 0 1px 2px rgba(0,0,0,0.18)',
  }
}

export function MaterialSphere({
  material,
  size = 26,
  selected = false,
  className = '',
}: {
  material: SphereMaterial | undefined
  size?: number
  /** inZOI's picked state: light-blue ring with a gap, white disc, blue check. */
  selected?: boolean
  className?: string
}) {
  // The ring sits on a wrapper: the sphere's own box-shadow would hide it.
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center rounded-full ${
        selected
          ? 'ring-2 ring-[#8cc4f0] ring-offset-2 ring-offset-[#f3f3f5] dark:ring-offset-neutral-900'
          : ''
      } ${className}`}
    >
      <span style={sphereStyle(material, size)} />
      {selected && (
        <span className="absolute inset-[20%] grid place-items-center rounded-full bg-white/75">
          <Check className="size-[62%] text-[#3d8fe0]" strokeWidth={3.5} />
        </span>
      )}
    </span>
  )
}
