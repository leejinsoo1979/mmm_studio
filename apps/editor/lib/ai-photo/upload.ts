import { z } from 'zod'
import { type AiPhotoImageType, sniffImage } from './image-header'
import {
  AI_PHOTO_FACE_MAX_SIDE,
  AI_PHOTO_FRAMINGS,
  AI_PHOTO_MAX_IMAGE_BYTES,
  AI_PHOTO_SHOTS,
  AI_PHOTO_STYLES,
  type AiPhotoFraming,
  type AiPhotoHints,
  type AiPhotoOptions,
  type AiPhotoRouteError,
  type AiPhotoStyle,
  avatarSubject,
  avatarTakesFace,
} from './shared'

/**
 * A `POST /api/ai-photo` body, read and checked: the multipart parts, the
 * options, the face, consent and child rules, and each image by its real
 * bytes.
 */

export type AiPhotoImage = { bytes: Uint8Array<ArrayBuffer>; type: AiPhotoImageType }

export type AiPhotoUpload = {
  render: AiPhotoImage
  face: AiPhotoImage | null
  framing: AiPhotoFraming
  style: AiPhotoStyle
  subject: { female: boolean; child: boolean }
  hints: AiPhotoHints
}

export type AiPhotoUploadError = { status: number; code: AiPhotoRouteError }

/** What this server and visitor may send, beyond a render of an adult avatar. */
export type AiPhotoUploadPolicy = { face: boolean; child: boolean }

const MAX_OPTIONS_CHARS = 2048
/** How far the render may stray from its framing's aspect. */
const ASPECT_TOLERANCE = 0.03
const RENDER_SIDES = { min: 256, max: 2048 }
const FACE_SIDES = { min: 128, max: AI_PHOTO_FACE_MAX_SIDE }
const PARTS = new Set(['render', 'face', 'options'])

const Hex = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .nullable()
  .optional()

const Options = z
  .object({
    avatarId: z.string().max(40),
    framing: z.enum(AI_PHOTO_FRAMINGS),
    style: z.enum(AI_PHOTO_STYLES).default('realistic'),
    consent: z.boolean().default(false),
    hints: z.object({ hair: Hex, skin: Hex, eyes: Hex, lips: Hex }).strict().optional(),
  })
  .strict() satisfies z.ZodType<AiPhotoOptions, unknown>

const fail = (status: number, code: AiPhotoRouteError) => ({ ok: false as const, status, code })

function checkImage(
  bytes: Uint8Array<ArrayBuffer>,
  sides: { min: number; max: number },
  aspect?: number,
): { ok: true; image: AiPhotoImage } | ({ ok: false } & AiPhotoUploadError) {
  if (bytes.byteLength > AI_PHOTO_MAX_IMAGE_BYTES) return fail(413, 'too_large')
  const header = sniffImage(bytes)
  if (!header || header.type === 'image/png') return fail(415, 'unsupported_image_type')
  const { width, height } = header
  const inRange = (side: number) => side >= sides.min && side <= sides.max
  if (!inRange(width) || !inRange(height)) return fail(422, 'invalid_image')
  if (aspect !== undefined && Math.abs(width / height - aspect) / aspect > ASPECT_TOLERANCE) {
    return fail(422, 'invalid_image')
  }
  return { ok: true, image: { bytes, type: header.type } }
}

async function fileBytes(part: FormDataEntryValue | null): Promise<Uint8Array<ArrayBuffer> | null> {
  if (part === null || typeof part === 'string') return null
  return new Uint8Array(await part.arrayBuffer())
}

/** The checked upload, or the status and error code to refuse it with. */
export async function parseAiPhotoUpload(
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
  policy: AiPhotoUploadPolicy,
): Promise<{ ok: true; upload: AiPhotoUpload } | ({ ok: false } & AiPhotoUploadError)> {
  let form: FormData
  try {
    form = await new Response(body, { headers: { 'content-type': contentType } }).formData()
  } catch {
    return fail(400, 'invalid_request')
  }
  const names = [...form.keys()]
  if (names.some((name) => !PARTS.has(name)) || new Set(names).size !== names.length) {
    return fail(400, 'invalid_request')
  }

  const rawOptions = form.get('options')
  if (typeof rawOptions !== 'string' || rawOptions.length > MAX_OPTIONS_CHARS) {
    return fail(400, 'invalid_request')
  }
  let json: unknown
  try {
    json = JSON.parse(rawOptions)
  } catch {
    return fail(400, 'invalid_request')
  }
  const options = Options.safeParse(json)
  if (!options.success) return fail(400, 'invalid_request')
  const { avatarId, framing, style, consent, hints = {} } = options.data
  const subject = avatarSubject(avatarId)
  if (!subject) return fail(400, 'invalid_request')
  if (subject.child && !policy.child) return fail(403, 'child_not_allowed')

  const renderBytes = await fileBytes(form.get('render'))
  if (!renderBytes) return fail(400, 'invalid_request')
  const facePart = form.get('face')
  if (facePart !== null) {
    if (!policy.face || !avatarTakesFace(avatarId)) return fail(403, 'face_not_allowed')
    if (!consent) return fail(400, 'consent_required')
  }
  const faceBytes = await fileBytes(facePart)
  if (facePart !== null && !faceBytes) return fail(400, 'invalid_request')

  const render = checkImage(renderBytes, RENDER_SIDES, AI_PHOTO_SHOTS[framing].aspect)
  if (!render.ok) return render
  let face: AiPhotoImage | null = null
  if (faceBytes) {
    const checked = checkImage(faceBytes, FACE_SIDES)
    if (!checked.ok) return checked
    face = checked.image
  }
  return {
    ok: true,
    upload: { render: render.image, face, framing, style, subject, hints },
  }
}
