import { readRenderTargetImage } from '@pascal-app/viewer'
import { type Camera, type Object3D, PerspectiveCamera, type Scene } from 'three'
import { RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { AI_PHOTO_SHOTS, type AiPhotoFraming } from '@/lib/ai-photo/client'
import { AI_PHOTO_MAX_IMAGE_BYTES } from '@/lib/ai-photo/shared'
import { AI_SHOT, aiShotFraming, type HeadFraming } from './head-frame'
import type { StageInsets, StudioFilterId } from './stage-contract'
import type { ContactShadow } from './studio-contact-shadow'
import { drawFiltered } from './studio-filters'
import { SHADOW_POWER, untonedColor } from './studio-tone'

/**
 * Pictures of the stage: a snapshot of what the free room shows, filtered
 * as the live view is (PNG), and the AI photo's clean shot (JPEG: no
 * filter, no platform, a light grey backdrop). Each is drawn off screen into
 * its own render target, tone mapped and encoded as the canvas is, and read
 * back; the stage is put back as it was within the same task, so no frame
 * ever shows the shot and the live canvas is never resized.
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
  gl: WebGPURenderer | null
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
  contact: ContactShadow | null
}

/**
 * Draws the stage once with `camera` into whatever the renderer draws to:
 * the contact shadow's map first, where it shows, then the scene.
 */
export function drawStage(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  rig: Pick<CaptureRig, 'contact' | 'backdrop' | 'platform'>,
) {
  if (rig.contact?.group.visible) rig.contact.update(renderer, scene, [rig.backdrop, rig.platform])
  renderer.render(scene, camera)
}

/** The AI photo's backdrop: the light grey its prompt asks for, drawn so the photo shows exactly it. */
const AI_BACKDROP = untonedColor('#c9cdd3')
/** The longest side a snapshot may have (px), and how many px per CSS px it has at most. */
const SNAPSHOT_LONGEST = 4096
const SNAPSHOT_SCALE = 2

/** A shot's size in px: its long side `longEdge`, its width / height `aspect`. */
export function shotSize({ aspect, longEdge }: { aspect: number; longEdge: number }) {
  return aspect >= 1
    ? { width: longEdge, height: Math.round(longEdge / aspect) }
    : { width: Math.round(longEdge * aspect), height: longEdge }
}

/**
 * The snapshot's part of the stage: the free room (CSS px, within the
 * canvas) and its size in px, up to SNAPSHOT_SCALE px per CSS px and no
 * longer than SNAPSHOT_LONGEST or the renderer's largest texture.
 */
export function snapshotFrame(
  size: { width: number; height: number },
  insets: StageInsets,
  maxTextureSize: number,
) {
  const { width: W, height: H } = size
  const x = Math.min(Math.max(0, insets.left), W - 1)
  const y = Math.min(Math.max(0, insets.top), H - 1)
  const w = Math.max(1, W - x - Math.max(0, insets.right))
  const h = Math.max(1, H - y - Math.max(0, insets.bottom))
  const longest = Math.min(SNAPSHOT_LONGEST, maxTextureSize)
  const scale = Math.min(SNAPSHOT_SCALE, longest / Math.max(w, h))
  return {
    x,
    y,
    w,
    h,
    scale,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}

/** The largest 2D texture the renderer's device takes (WebGPU guarantees 8192). */
function maxTextureSize(renderer: WebGPURenderer): number {
  const backend = (
    renderer as unknown as {
      backend?: {
        device?: { limits?: { maxTextureDimension2D?: number } }
        gl?: WebGL2RenderingContext
      }
    }
  ).backend
  return (
    backend?.device?.limits?.maxTextureDimension2D ??
    backend?.gl?.getParameter(backend.gl.MAX_TEXTURE_SIZE) ??
    8192
  )
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
 * Makes every pixel opaque, as the stage is: a backdrop is under every one.
 * Hair and lash edges drawn with alpha to coverage leave their fragment's
 * alpha in the frame over colour already blended by coverage; read as
 * straight alpha, it would darken those edges in a JPEG and leave them
 * see-through in a PNG.
 */
export function makeOpaque(image: { data: Uint8ClampedArray }) {
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255
}

function canvasOf(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext('2d')!.putImageData(image, 0, 0)
  return canvas
}

/**
 * Draws the stage once at `width` × `height` px with `camera` (after
 * `prepare`, undone straight after) into a render target of its own,
 * through the same output pass as the canvas (tone mapping, sRGB) and with
 * its multisampling, and reads the picture back.
 */
async function renderOnce(
  rig: CaptureRig,
  width: number,
  height: number,
  camera: Camera,
  prepare: () => () => void,
): Promise<ImageData> {
  const { gl: renderer, scene } = rig
  if (!(renderer && scene && rig.camera)) throw new Error('capture: the stage is not ready')
  const target = new RenderTarget(width, height)
  const drawTo = renderer.getRenderTarget()
  const output = renderer.getOutputRenderTarget()
  try {
    const undo = prepare()
    try {
      renderer.setRenderTarget(null)
      renderer.setOutputRenderTarget(target)
      drawStage(renderer, scene, camera, rig)
    } finally {
      renderer.setOutputRenderTarget(output)
      renderer.setRenderTarget(drawTo)
      undo()
      rig.aimLights(rig.view)
    }
    const image = await readRenderTargetImage(renderer, target)
    makeOpaque(image)
    return image
  } finally {
    target.dispose()
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
  const image = await renderOnce(rig, width, height, camera, () => {
    const { scene, backdrop, platform, contact } = rig
    const background = scene!.background
    const shown = [backdrop?.visible, platform?.visible, contact?.group.visible]
    const power = contact?.power.value
    scene!.background = AI_BACKDROP
    if (backdrop) backdrop.visible = false
    if (platform) platform.visible = false
    // The whole body keeps its floor shadow, which here lies on the light grey.
    if (contact) {
      contact.group.visible = framing === 'full'
      contact.power.value = SHADOW_POWER.light
    }
    rig.aimLights(aim)
    return () => {
      scene!.background = background
      if (backdrop) backdrop.visible = shown[0]!
      if (platform) platform.visible = shown[1]!
      if (contact) {
        contact.group.visible = shown[2]!
        contact.power.value = power!
      }
    }
  })
  const canvas = canvasOf(image)
  const blob = await toBlob(canvas, 'image/jpeg', 0.9)
  return blob.size > AI_PHOTO_MAX_IMAGE_BYTES ? toBlob(canvas, 'image/jpeg', 0.8) : blob
}

/** A snapshot of the free room as the live view shows it (filter and all), at up to twice its CSS size. */
export async function captureSnapshot(
  rig: CaptureRig,
  filter: StudioFilterId,
  insets: StageInsets,
): Promise<Blob> {
  const { gl, camera } = rig
  if (!(gl && camera)) throw new Error('capture: the stage is not ready')
  const { width: W, height: H } = rig.size
  const { x, y, w, h, scale, width, height } = snapshotFrame(rig.size, insets, maxTextureSize(gl))
  const image = await renderOnce(rig, width, height, camera, () => {
    camera.setViewOffset(W, H, x, y, w, h)
    rig.setBackdropWindow(x / W, (H - y - h) / H, w / W, h / H)
    return () => {
      camera.clearViewOffset()
      rig.setBackdropWindow(0, 0, 1, 1)
    }
  })
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const box = { width: W, height: H, cx: x + w / 2, cy: y + h / 2 }
  drawFiltered(
    out.getContext('2d')!,
    canvasOf(image),
    filter,
    box,
    { x, y, width: w, height: h },
    scale,
  )
  return toBlob(out, 'image/png')
}
