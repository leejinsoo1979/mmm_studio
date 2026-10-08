import type { RenderTarget, WebGPURenderer } from 'three/webgpu'

/** How a backend lays out an RGBA8 read: each row's stride in bytes, and whether the bottom row comes first. */
export type ReadLayout = { bytesPerRow: number; bottomUp: boolean }

/**
 * The layout of `readRenderTargetPixelsAsync` for an RGBA8 target `width` px
 * wide: WebGPU copies rows top-down, each padded to a multiple of 256 bytes
 * (`copyTextureToBuffer`); the WebGL 2 fallback reads tightly packed rows
 * bottom-up (the framebuffer's convention).
 */
export function readLayout(webgpu: boolean, width: number): ReadLayout {
  return webgpu
    ? { bytesPerRow: Math.ceil((width * 4) / 256) * 256, bottomUp: false }
    : { bytesPerRow: width * 4, bottomUp: true }
}

/** An RGBA8 read in `layout` as tightly packed rows, top row first (ImageData's order). */
export function topDownRows(
  pixels: Uint8Array,
  width: number,
  height: number,
  layout: ReadLayout,
): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = width * 4
  const out = new Uint8ClampedArray(rowBytes * height)
  for (let row = 0; row < height; row++) {
    const from = (layout.bottomUp ? height - 1 - row : row) * layout.bytesPerRow
    out.set(pixels.subarray(from, from + rowBytes), row * rowBytes)
  }
  return out
}

/**
 * Reads an RGBA8 render target back as ImageData, whichever backend the
 * renderer runs on. `isWebGPURenderer` stays true when the renderer falls back
 * to WebGL, so the backend itself is asked.
 */
export async function readRenderTargetImage(
  renderer: WebGPURenderer,
  target: RenderTarget,
): Promise<ImageData> {
  const { width, height } = target
  const pixels = (await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    width,
    height,
  )) as Uint8Array
  const webgpu = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend
    ?.isWebGPUBackend
  return new ImageData(
    topDownRows(pixels, width, height, readLayout(webgpu === true, width)),
    width,
    height,
  )
}
