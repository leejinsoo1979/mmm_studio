import { describe, expect, test } from 'bun:test'
import { canvasCodec } from './picture-codec'

/** A canvas that writes what it is asked for, or PNG for WebP as Safari's does; what it was given. */
function standIn(writesWebp: boolean) {
  const asked: string[] = []
  let given: Uint8ClampedArray | null = null
  const make = (width: number, height: number) => ({
    getContext: () => ({
      createImageData: (w: number, h: number) =>
        ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
      putImageData: (image: ImageData) => {
        given = Uint8ClampedArray.from(image.data)
        expect([image.width, image.height]).toEqual([width, height])
      },
    }),
    convertToBlob: async (options?: ImageEncodeOptions) => {
      const type = options?.type ?? 'image/png'
      asked.push(type)
      const written = type === 'image/webp' && !writesWebp ? 'image/png' : type
      return new Blob([new Uint8Array([1, 2, 3])], { type: written })
    },
  })
  return { codec: canvasCodec(make), asked, given: () => given }
}

/** 2 × 2 RGBA pixels, the last one `alpha`. */
const pixels = (alpha: number) =>
  Uint8ClampedArray.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 1, 2, 3, alpha])

describe('picture codec', () => {
  test('writes WebP where the browser can', async () => {
    const { codec, asked } = standIn(true)
    const out = await codec.encode(pixels(0), 2, 2, 0.9)
    expect(out.mimeType).toBe('image/webp')
    expect(asked).toEqual(['image/webp'])
  })

  test('where it can’t (Safari), a picture with see-through pixels keeps them as PNG', async () => {
    const { codec, asked, given } = standIn(false)
    const out = await codec.encode(pixels(0), 2, 2, 0.9)
    expect(out.mimeType).toBe('image/png')
    expect(asked).toEqual(['image/webp', 'image/png'])
    // The canvas was given the alpha to keep.
    expect(given()![15]).toBe(0)
  })

  test('where it can’t, an opaque picture is written as JPEG', async () => {
    const { codec, asked } = standIn(false)
    const out = await codec.encode(pixels(255), 2, 2, 0.9)
    expect(out.mimeType).toBe('image/jpeg')
    expect(asked).toEqual(['image/webp', 'image/jpeg'])
  })
})
