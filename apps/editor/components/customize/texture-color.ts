import { useSyncExternalStore } from 'react'

/**
 * The average colour of a finish's texture, so a textured finish (wood,
 * tile…) shows a representative colour in the picker instead of its white
 * tint. Loaded once per URL; components re-render when one arrives.
 */
const colors = new Map<string, string | null>()
const listeners = new Set<() => void>()
let version = 0

function averageHex(image: HTMLImageElement): string | null {
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, size, size)
  const data = context.getImageData(0, 0, size, size).data
  let r = 0
  let g = 0
  let b = 0
  const count = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]!
    g += data[i + 1]!
    b += data[i + 2]!
  }
  const hex = (v: number) =>
    Math.round(v / count)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase()
}

/** The texture's average colour, or undefined until it has loaded. */
export function textureColor(url: string): string | undefined {
  if (colors.has(url)) return colors.get(url) ?? undefined
  colors.set(url, null)
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => {
    try {
      colors.set(url, averageHex(image))
    } catch {
      return
    }
    version += 1
    for (const listener of listeners) listener()
  }
  image.src = url
  return undefined
}

/** Re-renders the caller when a texture colour arrives. */
export function useTextureColors(): void {
  useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => version,
    () => 0,
  )
}
