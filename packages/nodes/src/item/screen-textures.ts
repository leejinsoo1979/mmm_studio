import { CanvasTexture, SRGBColorSpace, type Texture, VideoTexture } from 'three'
import type { ScreenContent } from './screen'

/**
 * Screens are unlit, but the display's tone mapping (applied to the whole
 * frame, not per material) still dims their whites to ~89%: their materials
 * lift the picture back by this.
 */
export const SCREEN_GAIN = 1.3

/** A TV panel is 16:9: pictures are fitted onto it, letterboxed. */
const PANEL = { width: 1600, height: 900 }
const PANEL_ASPECT = PANEL.width / PANEL.height

function panelCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = PANEL.width
  canvas.height = PANEL.height
  return canvas
}

/**
 * glTF models map their UVs with images the right way up (no flip); the
 * projection's plane flips its own UVs to match, so both share one texture.
 */
function screenTexture<T extends Texture>(texture: T): T {
  texture.flipY = false
  texture.colorSpace = SRGBColorSpace
  return texture
}

const standbys = new Map<string, CanvasTexture>()
/** The switched-on picture before anything is put on: a soft glow and the remote's hint. */
function standbyTexture(title: string) {
  const known = standbys.get(title)
  if (known) return known
  const canvas = panelCanvas()
  const g = canvas.getContext('2d')!
  const gradient = g.createLinearGradient(0, 0, PANEL.width, PANEL.height)
  gradient.addColorStop(0, '#27457e')
  gradient.addColorStop(1, '#5b2f7a')
  g.fillStyle = gradient
  g.fillRect(0, 0, PANEL.width, PANEL.height)
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.font = '600 96px sans-serif'
  g.textAlign = 'center'
  g.fillText(title, PANEL.width / 2, PANEL.height / 2 - 20)
  g.fillStyle = 'rgba(255,255,255,0.6)'
  g.font = '40px sans-serif'
  g.fillText(
    '리모컨에서 화면 공유 · 동영상 · 발표 자료를 고르세요',
    PANEL.width / 2,
    PANEL.height / 2 + 60,
  )
  const texture = screenTexture(new CanvasTexture(canvas))
  standbys.set(title, texture)
  return texture
}

const videoTextures = new WeakMap<HTMLVideoElement, VideoTexture>()
function videoTexture(video: HTMLVideoElement) {
  let texture = videoTextures.get(video)
  if (!texture) {
    texture = screenTexture(new VideoTexture(video))
    videoTextures.set(video, texture)
  }
  return texture
}

/**
 * Slide pages kept at once (decoded, and on the GPU) for each kind of
 * picture: the ones on screen and a few recent. A deck can run to 80 pages,
 * and a photo to tens of megabytes.
 */
const KEPT_PAGES = 8
/** Longest side a projected page is drawn at: sharp on a wall, well within GPU texture limits. */
const PAGE_LONGEST = 2048

/** A cache that keeps its most recent uses, handing what drops out to `drop`. */
function recentCache<T>(limit: number, drop: (value: T) => void = () => {}) {
  const entries = new Map<string, T>()
  return {
    get(key: string) {
      const value = entries.get(key)
      if (value !== undefined) {
        entries.delete(key)
        entries.set(key, value)
      }
      return value
    },
    set(key: string, value: T) {
      entries.delete(key)
      entries.set(key, value)
      for (const [oldKey, oldValue] of entries) {
        if (entries.size <= limit) break
        entries.delete(oldKey)
        drop(oldValue)
      }
    },
    delete(key: string) {
      const value = entries.get(key)
      entries.delete(key)
      if (value !== undefined) drop(value)
    },
  }
}

const disposeTexture = (texture: Texture) => texture.dispose()

// A page that can't be decoded (say a HEIC photo) is remembered as failed,
// not fetched again every frame.
const pageImages = recentCache<HTMLImageElement | 'loading' | 'failed'>(KEPT_PAGES * 2)
/** A slide's image; null until it has loaded, or if it can't be. */
function pageImage(url: string): HTMLImageElement | null {
  const known = pageImages.get(url)
  if (known === 'loading' || known === 'failed') return null
  if (known) return known
  pageImages.set(url, 'loading')
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => pageImages.set(url, image)
  image.onerror = () => pageImages.set(url, 'failed')
  image.src = url
  return null
}

const panelPages = recentCache<CanvasTexture>(KEPT_PAGES, disposeTexture)
/** A slide fitted onto a TV panel; null until its image has loaded. */
function panelPageTexture(url: string): CanvasTexture | null {
  const known = panelPages.get(url)
  if (known) return known
  const image = pageImage(url)
  if (!image) return null
  const canvas = panelCanvas()
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, PANEL.width, PANEL.height)
  const fit = Math.min(PANEL.width / image.width, PANEL.height / image.height)
  const w = image.width * fit
  const h = image.height * fit
  g.drawImage(image, (PANEL.width - w) / 2, (PANEL.height - h) / 2, w, h)
  const texture = screenTexture(new CanvasTexture(canvas))
  panelPages.set(url, texture)
  return texture
}

const pageTextures = recentCache<CanvasTexture>(KEPT_PAGES, disposeTexture)
/** A slide at its own proportions (at most PAGE_LONGEST across); null until its image has loaded. */
function pageTexture(url: string): CanvasTexture | null {
  const known = pageTextures.get(url)
  if (known) return known
  const image = pageImage(url)
  if (!image) return null
  const fit = Math.min(1, PAGE_LONGEST / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * fit))
  canvas.height = Math.max(1, Math.round(image.height * fit))
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  const texture = screenTexture(new CanvasTexture(canvas))
  pageTextures.set(url, texture)
  return texture
}

/** Frees what a video's picture took on the GPU, once no screen shows it. */
export function releaseVideoTexture(video: HTMLVideoElement) {
  videoTextures.get(video)?.dispose()
  videoTextures.delete(video)
}

/** Frees the pictures made for slide pages no screen shows any more. */
export function releasePageTextures(urls: Iterable<string>) {
  for (const url of urls) {
    panelPages.delete(url)
    pageTextures.delete(url)
    pageImages.delete(url)
  }
}

/** What a TV panel shows for a screen's content; null while a slide loads. */
export function panelTexture(content: ScreenContent): Texture | null {
  if (content.kind === 'video') return videoTexture(content.video)
  if (content.kind === 'slides') {
    const url = content.pages[content.index]
    return url ? panelPageTexture(url) : null
  }
  return standbyTexture('TV')
}

/**
 * What a projection shows, at the picture's own proportions (width ÷
 * height): a slide page or a video as it is, not letterboxed. Null while a
 * slide loads.
 */
export function projectionPicture(
  content: ScreenContent,
  title: string,
): { texture: Texture; aspect: number } | null {
  if (content.kind === 'video') {
    const { videoWidth, videoHeight } = content.video
    return {
      texture: videoTexture(content.video),
      aspect: videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : PANEL_ASPECT,
    }
  }
  if (content.kind === 'slides') {
    const url = content.pages[content.index]
    const texture = url ? pageTexture(url) : null
    const image = url ? pageImage(url) : null
    return texture && image ? { texture, aspect: image.width / image.height } : null
  }
  return { texture: standbyTexture(title), aspect: PANEL_ASPECT }
}
