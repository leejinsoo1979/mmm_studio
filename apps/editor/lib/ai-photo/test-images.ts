/**
 * Test fixtures: the smallest byte strings that carry a real JPEG, WebP or
 * PNG header of a given size (no pixel data; only headers are ever read),
 * and a request body encoded as the browser would send it.
 */

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]

export function jpeg(
  width: number,
  height: number,
  options: { progressive?: boolean; pad?: number } = {},
): Uint8Array<ArrayBuffer> {
  const app0 = [0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  // A Huffman table (0xC4) sits in the SOFn marker range but is not a frame header.
  const dht = [0xff, 0xc4, 0, 3, 0]
  const sof = [
    0xff,
    options.progressive ? 0xc2 : 0xc0,
    0,
    17,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]
  const sos = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0]
  const data = new Array<number>(options.pad ?? 0).fill(0x55)
  return Uint8Array.from([0xff, 0xd8, ...app0, ...dht, ...sof, ...sos, ...data, 0xff, 0xd9])
}

function riff(chunk: string, data: number[]): Uint8Array<ArrayBuffer> {
  const body = [...ascii(chunk), ...le32(data.length), ...data]
  return Uint8Array.from([...ascii('RIFF'), ...le32(4 + body.length), ...ascii('WEBP'), ...body])
}

export function webp(
  width: number,
  height: number,
  kind: 'lossy' | 'lossless' | 'extended' = 'lossy',
): Uint8Array<ArrayBuffer> {
  if (kind === 'lossless') {
    const bits = ((width - 1) | ((height - 1) << 14)) >>> 0
    return riff('VP8L', [0x2f, ...le32(bits), 0, 0, 0, 0, 0])
  }
  if (kind === 'extended') {
    const w = width - 1
    const h = height - 1
    return riff('VP8X', [
      0,
      0,
      0,
      0,
      w & 255,
      (w >> 8) & 255,
      w >> 16,
      h & 255,
      (h >> 8) & 255,
      h >> 16,
    ])
  }
  return riff('VP8 ', [
    0x30,
    0x01,
    0x00,
    0x9d,
    0x01,
    0x2a,
    width & 255,
    width >> 8,
    height & 255,
    height >> 8,
    0,
    0,
  ])
}

export function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    0x89,
    ...ascii('PNG\r\n\u001a\n'),
    0,
    0,
    0,
    13,
    ...ascii('IHDR'),
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ])
}

export const base64Of = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

/** A multipart body and its content type, as `fetch` would send `form`. */
export async function multipart(
  form: FormData,
): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string }> {
  const response = new Response(form)
  // Read before the body: Bun drops the header once the body is consumed as bytes.
  const contentType = response.headers.get('content-type') ?? ''
  return { body: new Uint8Array(await response.arrayBuffer()), contentType }
}

/** A studio request: the render, an optional face photo and the options JSON. */
export function photoForm(parts: {
  render?: Uint8Array<ArrayBuffer> | null
  renderType?: string
  face?: Uint8Array<ArrayBuffer> | null
  options?: unknown
}): FormData {
  const form = new FormData()
  if (parts.options !== undefined) {
    form.append(
      'options',
      typeof parts.options === 'string' ? parts.options : JSON.stringify(parts.options),
    )
  }
  if (parts.render) {
    form.append(
      'render',
      new Blob([parts.render], { type: parts.renderType ?? 'image/jpeg' }),
      'r.jpg',
    )
  }
  if (parts.face) form.append('face', new Blob([parts.face], { type: 'image/jpeg' }), 'f.jpg')
  return form
}
