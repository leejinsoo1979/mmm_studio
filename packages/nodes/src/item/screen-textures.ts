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

const pageImages = new Map<string, HTMLImageElement | 'loading'>()
/** A slide's image; null until it has loaded. */
function pageImage(url: string): HTMLImageElement | null {
  const known = pageImages.get(url)
  if (known === 'loading') return null
  if (known) return known
  pageImages.set(url, 'loading')
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => pageImages.set(url, image)
  image.onerror = () => pageImages.delete(url)
  image.src = url
  return null
}

const panelPages = new Map<string, CanvasTexture>()
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

const pageTextures = new Map<string, Texture>()
/** A slide at its own proportions; null until its image has loaded. */
function pageTexture(url: string): Texture | null {
  const known = pageTextures.get(url)
  if (known) return known
  const image = pageImage(url)
  if (!image) return null
  const texture = screenTexture(new CanvasTexture(image))
  pageTextures.set(url, texture)
  return texture
}

/** Frees what a video's picture took on the GPU, once no screen shows it. */
export function releaseVideoTexture(video: HTMLVideoElement) {
  videoTextures.get(video)?.dispose()
  videoTextures.delete(video)
}

/** Frees the pictures made for slide pages no screen shows any more. */
export function releasePageTextures(urls: readonly string[]) {
  for (const url of urls) {
    panelPages.get(url)?.dispose()
    panelPages.delete(url)
    pageTextures.get(url)?.dispose()
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
