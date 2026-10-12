import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { MeshStandardMaterial, Texture } from 'three'
import { CROWD_SIZE, fitHeadForCrowd, headImages } from './head-detail'

const GLB = new URL(
  '../../../../../../apps/editor/public/characters/rocketbox/Female_Adult_01.glb',
  import.meta.url,
)

/** The size a WebP's header gives (lossy VP8 or lossless VP8L). */
async function webpSize(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const chunk = new TextDecoder().decode(bytes.slice(12, 16))
  if (chunk === 'VP8 ') {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') {
    const at = (i: number) => bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16)
    return { width: at(24) + 1, height: at(27) + 1 }
  }
  throw new Error(`not a WebP chunk: ${chunk}`)
}

describe('headImages', () => {
  const glb = readFileSync(GLB)
  const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer

  test("finds the head's normal and roughness images, larger than a crowd draws them", async () => {
    const images = headImages(buffer)
    expect(images.normalMap?.type).toBe('image/webp')
    expect(images.roughnessMap?.type).toBe('image/webp')
    expect(await webpSize(images.normalMap!)).toEqual({ width: 2048, height: 2048 })
    expect(await webpSize(images.roughnessMap!)).toEqual({ width: 1024, height: 1024 })
    expect(CROWD_SIZE.normalMap).toBeLessThan(2048)
    expect(CROWD_SIZE.roughnessMap).toBeLessThan(1024)
  })

  test('finds nothing in what is not a binary glTF', () => {
    expect(headImages(new ArrayBuffer(64))).toEqual({ normalMap: null, roughnessMap: null })
  })
})

describe('fitHeadForCrowd', () => {
  const real = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
  const drawn: { width: number; height: number }[] = []
  class FakeCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
    getContext() {
      return { drawImage: () => drawn.push({ width: this.width, height: this.height }) }
    }
    transferToImageBitmap() {
      return { width: this.width, height: this.height }
    }
  }
  afterEach(() => {
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = real
    drawn.length = 0
  })

  const picture = (size: number) => {
    const image = { width: size, height: size, closed: false, close: () => {} }
    image.close = () => {
      image.closed = true
    }
    return image
  }
  const texture = (size: number) => {
    const made = new Texture()
    made.image = picture(size)
    return made
  }

  test("shrinks a head's large maps once, letting the full-size images go", () => {
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeCanvas
    const normal = texture(2048)
    const rough = texture(1024)
    const full = normal.image as ReturnType<typeof picture>
    const material = new MeshStandardMaterial({
      name: 'f001_head',
      normalMap: normal,
      roughnessMap: rough,
    })
    const version = normal.version
    fitHeadForCrowd(material)
    expect(normal.image).toEqual({ width: 1024, height: 1024 })
    expect(rough.image).toEqual({ width: 512, height: 512 })
    expect(full.closed).toBe(true)
    expect(normal.version).toBe(version + 1)
    fitHeadForCrowd(material)
    expect(drawn).toHaveLength(2)
  })

  test("leaves small maps and other parts' maps be", () => {
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeCanvas
    const small = texture(1024)
    const body = texture(2048)
    fitHeadForCrowd(new MeshStandardMaterial({ name: 'f001_head', normalMap: small }))
    fitHeadForCrowd(new MeshStandardMaterial({ name: 'f001_body', normalMap: body }))
    expect(drawn).toHaveLength(0)
    expect((body.image as ReturnType<typeof picture>).width).toBe(2048)
  })
})
