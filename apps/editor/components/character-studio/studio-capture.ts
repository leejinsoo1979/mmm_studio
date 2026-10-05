import {
  Color,
  type Object3D,
  PerspectiveCamera,
  type Scene,
  Vector2,
  type WebGLRenderer,
} from 'three'
import { AI_PHOTO_SHOTS, type AiPhotoFraming } from '@/lib/ai-photo/client'
import { AI_PHOTO_MAX_IMAGE_BYTES } from '@/lib/ai-photo/shared'
import { AI_SHOT, aiShotFraming, type HeadFraming } from './head-frame'
import type { StageInsets, StudioFilterId } from './stage-contract'
import { drawFiltered } from './studio-filters'

/**
 * Pictures of the stage: a snapshot of what the free room shows, filtered
 * as the live view is (PNG), and the AI photo's clean shot (JPEG: no
 * filter, no platform, a light grey backdrop). Each is drawn in one go —
 * the renderer resized, drawn, read and put back within one task — so no
 * frame in between ever shows.
 */

/** How far above what it looks at the camera stands, as a share of its distance: it looks a little down. */
export const LOOK_DOWN = 0.04

/** Puts a camera where it frames `view` with a `fov`° lens, as the live stage does. */
export function placeCamera(camera: PerspectiveCamera, view: HeadFraming, fov: number) {
  if (Math.abs(camera.fov - fov) > 1e-4) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
  const distance = view.half / Math.tan((fov * Math.PI) / 360)
  camera.position.set(view.x, view.y + distance * LOOK_DOWN, distance)
  camera.lookAt(view.x, view.y, 0)
  camera.updateMatrixWorld()
}

/** What the stage hands the capture: its renderer and scene, and the pieces a clean shot hides. */
export type CaptureRig = {
  gl: WebGLRenderer | null
  scene: Scene | null
  camera: PerspectiveCamera | null
  /** The canvas's CSS size. */
  size: { width: number; height: number }
  /** The live camera's aim, which the lights follow. */
  view: HeadFraming
  /** Aims the lights (and the key light's shadow) at a view. */
  aimLights: (view: HeadFraming) => void
  /** Which part of the whole view a render is (view uv: x, y from the bottom, width, height), for the backdrop. */
  setBackdropWindow: (x: number, y: number, width: number, height: number) => void
  backdrop: Object3D | null
  platform: Object3D | null
  contact: Object3D | null
}

/** The AI photo's backdrop: the light grey its prompt asks for. */
const AI_BACKDROP = new Color('#c9cdd3')
/** The longest side a snapshot may have (px), and how many px per CSS px it has at most. */
const SNAPSHOT_LONGEST = 4096
const SNAPSHOT_SCALE = 2

/** A shot's size in px: its long side `longEdge`, its width / height `aspect`. */
export function shotSize({ aspect, longEdge }: { aspect: number; longEdge: number }) {
  return aspect >= 1
    ? { width: longEdge, height: Math.round(longEdge / aspect) }
    : { width: Math.round(longEdge * aspect), height: longEdge }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('capture: could not encode'))),
      type,
      quality,
    ),
  )
}

/**
 * Draws the scene once at `width` × `height` px with `camera` (after
 * `prepare`), copies it onto a 2D canvas with `copy`, then puts the
 * renderer and whatever `prepare` changed back and draws the live view
 * again so the page never shows the shot.
 */
function renderOnce(
  rig: CaptureRig,
  width: number,
  height: number,
  camera: PerspectiveCamera,
  prepare: () => () => void,
  copy: (source: HTMLCanvasElement) => HTMLCanvasElement,
): HTMLCanvasElement {
  const { gl, scene } = rig
  if (!(gl && scene && rig.camera)) throw new Error('capture: the stage is not ready')
  const ratio = gl.getPixelRatio()
  const size = gl.getSize(new Vector2())
  const target = gl.getRenderTarget()
  const undo = prepare()
  try {
    gl.setPixelRatio(1)
    gl.setSize(width, height, false)
    gl.setRenderTarget(null)
    gl.render(scene, camera)
    return copy(gl.domElement)
  } finally {
    undo()
    gl.setPixelRatio(ratio)
    gl.setSize(size.x, size.y, false)
    gl.setRenderTarget(target)
    rig.aimLights(rig.view)
    gl.render(scene, rig.camera)
  }
}

/** The AI photo's shot of the character as it stands now, at AI_PHOTO_SHOTS[framing]. */
export async function captureAiShot(
  rig: CaptureRig,
  framing: AiPhotoFraming,
  model: Object3D,
  stature: number,
  scale: number,
): Promise<Blob> {
  const { width, height } = shotSize(AI_PHOTO_SHOTS[framing])
  const aim = aiShotFraming(framing, model, stature, scale, width / height)
  const camera = new PerspectiveCamera(AI_SHOT[framing].fov, width / height, 0.05, 50)
  placeCamera(camera, aim, AI_SHOT[framing].fov)
  const canvas = renderOnce(
    rig,
    width,
    height,
    camera,
    () => {
      const { scene, backdrop, platform, contact } = rig
      const background = scene!.background
      const shown = [backdrop?.visible, platform?.visible, contact?.visible]
      scene!.background = AI_BACKDROP
      if (backdrop) backdrop.visible = false
      if (platform) platform.visible = false
      if (contact) contact.visible = framing === 'full'
      rig.aimLights(aim)
      return () => {
        scene!.background = background
        if (backdrop) backdrop.visible = shown[0]!
        if (platform) platform.visible = shown[1]!
        if (contact) contact.visible = shown[2]!
      }
    },
    (source) => {
      const out = document.createElement('canvas')
      out.width = width
      out.height = height
      out.getContext('2d')!.drawImage(source, 0, 0, width, height)
      return out
    },
  )
  const blob = await toBlob(canvas, 'image/jpeg', 0.9)
  return blob.size > AI_PHOTO_MAX_IMAGE_BYTES ? toBlob(canvas, 'image/jpeg', 0.8) : blob
}

/** A snapshot of the free room as the live view shows it (filter and all), at up to twice its CSS size. */
export function captureSnapshot(
  rig: CaptureRig,
  filter: StudioFilterId,
  insets: StageInsets,
): Promise<Blob> {
  const { gl, camera } = rig
  if (!(gl && camera)) return Promise.reject(new Error('capture: the stage is not ready'))
  const { width: W, height: H } = rig.size
  const x = Math.min(Math.max(0, insets.left), W - 1)
  const y = Math.min(Math.max(0, insets.top), H - 1)
  const w = Math.max(1, W - x - Math.max(0, insets.right))
  const h = Math.max(1, H - y - Math.max(0, insets.bottom))
  const longest = Math.min(SNAPSHOT_LONGEST, gl.capabilities.maxTextureSize)
  const scale = Math.min(SNAPSHOT_SCALE, longest / Math.max(w, h))
  const width = Math.max(1, Math.round(w * scale))
  const height = Math.max(1, Math.round(h * scale))
  const box = { width: W, height: H, cx: x + w / 2, cy: y + h / 2 }
  const canvas = renderOnce(
    rig,
    width,
    height,
    camera,
    () => {
      camera.setViewOffset(W, H, x, y, w, h)
      rig.setBackdropWindow(x / W, (H - y - h) / H, w / W, h / H)
      return () => {
        camera.clearViewOffset()
        rig.setBackdropWindow(0, 0, 1, 1)
      }
    },
    (source) => {
      const out = document.createElement('canvas')
      out.width = width
      out.height = height
      drawFiltered(out.getContext('2d')!, source, filter, box, { x, y, width: w, height: h }, scale)
      return out
    },
  )
  return toBlob(canvas, 'image/png')
}
