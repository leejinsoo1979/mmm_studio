import { describe, expect, test } from 'bun:test'
import { sniffImage } from './image-header'
import { jpeg, multipart, photoForm, png, webp } from './test-images'
import { type AiPhotoUploadPolicy, parseAiPhotoUpload } from './upload'

describe('sniffImage', () => {
  test('JPEG baseline and progressive, past other segments', () => {
    expect(sniffImage(jpeg(1024, 1536))).toEqual({ type: 'image/jpeg', width: 1024, height: 1536 })
    expect(sniffImage(jpeg(640, 480, { progressive: true }))).toEqual({
      type: 'image/jpeg',
      width: 640,
      height: 480,
    })
  })

  test('WebP lossy, lossless and extended', () => {
    expect(sniffImage(webp(1024, 1024))).toEqual({ type: 'image/webp', width: 1024, height: 1024 })
    expect(sniffImage(webp(700, 1050, 'lossless'))).toEqual({
      type: 'image/webp',
      width: 700,
      height: 1050,
    })
    expect(sniffImage(webp(16383, 3, 'lossless'))).toMatchObject({ width: 16383, height: 3 })
    expect(sniffImage(webp(2000, 3000, 'extended'))).toEqual({
      type: 'image/webp',
      width: 2000,
      height: 3000,
    })
  })

  test('PNG', () => {
    expect(sniffImage(png(1024, 1536))).toEqual({ type: 'image/png', width: 1024, height: 1536 })
  })

  test('truncated or foreign bytes are nothing', () => {
    expect(sniffImage(new Uint8Array())).toBeNull()
    expect(
      sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull()
    expect(sniffImage(new TextEncoder().encode('GIF89a......'))).toBeNull()
    expect(sniffImage(jpeg(100, 100).slice(0, 30))).toBeNull()
    expect(sniffImage(webp(100, 100).slice(0, 24))).toBeNull()
    expect(sniffImage(png(10, 10).slice(0, 20))).toBeNull()
    // Start of scan before any frame header.
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0]))).toBeNull()
    // A broken VP8 start code.
    const broken = webp(100, 100)
    broken[23] = 0
    expect(sniffImage(broken)).toBeNull()
  })
})

const options = { avatarId: 'Female_Adult_03', framing: 'face' }
const OPEN: AiPhotoUploadPolicy = { face: true, child: true }
const parse = async (form: FormData, policy = OPEN) => {
  const { body, contentType } = await multipart(form)
  return parseAiPhotoUpload(body, contentType, policy)
}

describe('parseAiPhotoUpload', () => {
  test('a render and options; defaults filled in', async () => {
    const result = await parse(photoForm({ render: jpeg(1024, 1024), options }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.upload).toMatchObject({
      framing: 'face',
      style: 'realistic',
      subject: { female: true, child: false },
      hints: {},
      face: null,
      render: { type: 'image/jpeg' },
    })
  })

  test('a consented face photo and colour hints', async () => {
    const result = await parse(
      photoForm({
        render: webp(1000, 1500),
        face: jpeg(512, 640),
        options: {
          avatarId: 'Police_Male_03',
          framing: 'full',
          consent: true,
          hints: { hair: '#112233', lips: null },
        },
      }),
    )
    expect(result.ok && result.upload).toMatchObject({
      framing: 'full',
      subject: { female: false, child: false },
      hints: { hair: '#112233', lips: null },
      render: { type: 'image/webp' },
      face: { type: 'image/jpeg' },
    })
  })

  test('a face photo needs consent, and never goes with a child or a party outfit', async () => {
    const face = jpeg(512, 512)
    expect(await parse(photoForm({ render: jpeg(1024, 1024), face, options }))).toEqual({
      ok: false,
      status: 400,
      code: 'consent_required',
    })
    for (const avatarId of ['Female_Child_01', 'Female_Party_01']) {
      expect(
        await parse(
          photoForm({
            render: jpeg(1024, 1024),
            face,
            options: { avatarId, framing: 'face', consent: true },
          }),
        ),
      ).toEqual({ ok: false, status: 403, code: 'face_not_allowed' })
    }
    // A child without a face photo is fine.
    const child = await parse(
      photoForm({
        render: jpeg(1024, 1024),
        options: { avatarId: 'Male_Child_02', framing: 'face' },
      }),
    )
    expect(child.ok && child.upload.subject).toEqual({ female: false, child: true })
  })

  test('the server policy: no face photo unless allowed, no child unless allowed', async () => {
    const consented = photoForm({
      render: jpeg(1024, 1024),
      face: jpeg(512, 512),
      options: { ...options, consent: true },
    })
    expect(await parse(consented, { face: false, child: true })).toEqual({
      ok: false,
      status: 403,
      code: 'face_not_allowed',
    })
    // Refused before consent is even looked at.
    const unconsented = photoForm({ render: jpeg(1024, 1024), face: jpeg(512, 512), options })
    expect(await parse(unconsented, { face: false, child: true })).toMatchObject({
      code: 'face_not_allowed',
    })
    const child = photoForm({
      render: jpeg(1024, 1024),
      options: { avatarId: 'Male_Child_02', framing: 'face' },
    })
    expect(await parse(child, { face: true, child: false })).toEqual({
      ok: false,
      status: 403,
      code: 'child_not_allowed',
    })
    const adult = photoForm({ render: jpeg(1024, 1024), options })
    expect((await parse(adult, { face: false, child: false })).ok).toBe(true)
  })

  test('bad options are an invalid request', async () => {
    for (const bad of [
      undefined,
      '{not json',
      'x'.repeat(3000),
      { framing: 'face' },
      { ...options, avatarId: 'Somebody_Famous_01' },
      { ...options, framing: 'wide' },
      { ...options, style: 'anime' },
      { ...options, prompt: 'nude' },
      { ...options, consent: 'yes' },
      { ...options, hints: { hair: 'blonde' } },
      { ...options, hints: { tattoo: '#000000' } },
    ]) {
      const result = await parse(photoForm({ render: jpeg(1024, 1024), options: bad }))
      expect(result).toEqual({ ok: false, status: 400, code: 'invalid_request' })
    }
  })

  test('bad parts are an invalid request', async () => {
    const missing = await parse(photoForm({ options }))
    expect(missing).toEqual({ ok: false, status: 400, code: 'invalid_request' })

    const extra = photoForm({ render: jpeg(1024, 1024), options })
    extra.append('prompt', 'take off the jacket')
    expect(await parse(extra)).toEqual({ ok: false, status: 400, code: 'invalid_request' })

    const twice = photoForm({ render: jpeg(1024, 1024), options })
    twice.append('render', new Blob([jpeg(1024, 1024)]), 'again.jpg')
    expect(await parse(twice)).toEqual({ ok: false, status: 400, code: 'invalid_request' })

    const textRender = photoForm({ options })
    textRender.append('render', 'not a file')
    expect(await parse(textRender)).toEqual({ ok: false, status: 400, code: 'invalid_request' })

    expect(await parseAiPhotoUpload(new Uint8Array(8), 'multipart/form-data; boundary=x')).toEqual({
      ok: false,
      status: 400,
      code: 'invalid_request',
    })
  })

  test('images are judged by their bytes, size and shape', async () => {
    const result = async (render: Uint8Array<ArrayBuffer>, framing = 'face') =>
      parse(photoForm({ render, renderType: 'image/jpeg', options: { ...options, framing } }))
    // A PNG declared as JPEG.
    expect(await result(png(1024, 1024))).toMatchObject({
      code: 'unsupported_image_type',
      status: 415,
    })
    expect(await result(new TextEncoder().encode('hello'))).toMatchObject({
      code: 'unsupported_image_type',
    })
    expect(await result(jpeg(1024, 1024, { pad: 2 * 1024 * 1024 }))).toMatchObject({
      code: 'too_large',
      status: 413,
    })
    expect(await result(jpeg(200, 200))).toMatchObject({ code: 'invalid_image', status: 422 })
    expect(await result(jpeg(4096, 4096))).toMatchObject({ code: 'invalid_image' })
    // Square for the face, 2:3 for upper and full, within 3%.
    expect(await result(jpeg(1024, 1536))).toMatchObject({ code: 'invalid_image' })
    expect(await result(jpeg(1024, 1024), 'full')).toMatchObject({ code: 'invalid_image' })
    expect((await result(jpeg(1000, 1530), 'upper')).ok).toBe(true)
    expect((await result(jpeg(1020, 1000))).ok).toBe(true)

    const bigFace = await parse(
      photoForm({
        render: jpeg(1024, 1024),
        face: jpeg(2000, 2000),
        options: { ...options, consent: true },
      }),
    )
    expect(bigFace).toMatchObject({ code: 'invalid_image' })
    const tinyFace = await parse(
      photoForm({
        render: jpeg(1024, 1024),
        face: jpeg(64, 64),
        options: { ...options, consent: true },
      }),
    )
    expect(tinyFace).toMatchObject({ code: 'invalid_image' })
  })
})
