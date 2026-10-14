import type { PictureCodec } from './avatar-job'

/**
 * The avatar job's pictures through the browser's own image decoder and an
 * offscreen canvas (in the worker). Pictures are written as WebP, as the
 * base body's are, where the browser can; Safari's canvas can't (it hands
 * back PNG when asked for WebP), so there a picture with any see-through
 * pixel (hair cut from its alpha) is written as PNG and the rest as JPEG.
 */

/** As much of an OffscreenCanvas as writing a picture takes. */
type Canvas = {
  getContext(id: '2d'): {
    createImageData(width: number, height: number): ImageData
    putImageData(image: ImageData, x: number, y: number): void
  } | null
  convertToBlob(options?: ImageEncodeOptions): Promise<Blob>
}

export function canvasCodec(
  makeCanvas: (width: number, height: number) => Canvas = (width, height) =>
    new OffscreenCanvas(width, height),
): PictureCodec {
  return {
    async decode(bytes, mimeType) {
      const bitmap = await createImageBitmap(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }),
      )
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      return { data, width: canvas.width, height: canvas.height }
    },
    async encode(data, width, height, quality) {
      const canvas = makeCanvas(width, height)
      const context = canvas.getContext('2d')!
      const image = context.createImageData(width, height)
      image.data.set(data)
      context.putImageData(image, 0, 0)
      let blob = await canvas.convertToBlob({ type: 'image/webp', quality })
      if (blob.type !== 'image/webp') {
        blob = await canvas.convertToBlob(
          hasAlpha(data) ? { type: 'image/png' } : { type: 'image/jpeg', quality },
        )
      }
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type }
    },
  }
}

function hasAlpha(data: ArrayLike<number>): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true
  return false
}
