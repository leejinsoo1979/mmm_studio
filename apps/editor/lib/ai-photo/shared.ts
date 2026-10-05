/**
 * What the AI photo route and its browser client agree on: the framings and
 * the capture each one asks for, the upload limits, the status and error
 * codes, and how an avatar id names a woman, a man or a child. Safe on both
 * sides (no Node or DOM-only APIs).
 */

export const AI_PHOTO_FRAMINGS = ['face', 'upper', 'full'] as const
export type AiPhotoFraming = (typeof AI_PHOTO_FRAMINGS)[number]

/** 사실적. A later style is another fixed template on the server, never free text. */
export const AI_PHOTO_STYLES = ['realistic'] as const
export type AiPhotoStyle = (typeof AI_PHOTO_STYLES)[number]

/** Colours (#rrggbb) of the look on stage; they only sharpen colour fidelity. */
export type AiPhotoHints = {
  hair?: string | null
  skin?: string | null
  eyes?: string | null
  lips?: string | null
}

/** The `options` part of a request. Sex and age come from `avatarId` on the server. */
export type AiPhotoOptions = {
  avatarId: string
  framing: AiPhotoFraming
  style?: AiPhotoStyle
  /** Required true when a face photo is sent. */
  consent?: boolean
  hints?: AiPhotoHints
}

/**
 * The render each framing asks for: width / height, and the longer side in
 * px (never upscaled). The route checks the render's aspect against it.
 */
export const AI_PHOTO_SHOTS: Record<AiPhotoFraming, { aspect: number; longEdge: number }> = {
  face: { aspect: 1, longEdge: 1024 },
  upper: { aspect: 2 / 3, longEdge: 1536 },
  full: { aspect: 2 / 3, longEdge: 1536 },
}

/** Each uploaded image (the render, the face photo). */
export const AI_PHOTO_MAX_IMAGE_BYTES = 2 * 1024 * 1024
/** The whole multipart body: under the 4.5 MB request cap of serverless hosts. */
export const AI_PHOTO_MAX_BODY_BYTES = 4_400_000
/** The longest side the face photo may have. */
export const AI_PHOTO_FACE_MAX_SIDE = 1024

/** `moderation_required`: the setup needs `AI_PHOTO_MODERATION_MODEL` and has none. */
export type AiPhotoUnavailableReason =
  | 'disabled'
  | 'not_configured'
  | 'no_api_key'
  | 'moderation_required'

/** `GET /api/ai-photo`. `remainingToday` counts this server instance only: a hint. */
export type AiPhotoStatus =
  | {
      available: true
      signInRequired: boolean
      signedIn: boolean
      remainingToday: number | null
      maxImageBytes: number
      /** This visitor may attach a face photo (the owner turned it on, and they are signed in). */
      faceAllowed: boolean
      /** Child avatars may be sent (the provider has its own child-safety filters). */
      childAllowed: boolean
    }
  | { available: false; reason: AiPhotoUnavailableReason }

/** The `error` of a refused `POST /api/ai-photo`. */
export type AiPhotoRouteError =
  | 'invalid_request'
  | 'consent_required'
  | 'face_not_allowed'
  | 'child_not_allowed'
  | 'sign_in_required'
  | 'too_large'
  | 'unsupported_image_type'
  | 'invalid_image'
  | 'blocked'
  | 'rate_limited'
  | 'busy'
  | 'upstream'
  | 'unavailable'
  | 'timeout'

export type AiPhotoLimitScope = 'burst' | 'daily' | 'global'

const JOBS = [
  'Business',
  'Chef',
  'Construction',
  'Delivery',
  'Fire',
  'Gardener',
  'Medical',
  'Military',
  'Pilot',
  'Police',
  'Security',
  'Sports',
  'Wood',
].join('|')

/** Rocketbox ids: Sex_Kind_NN (Male_Adult_07, Female_Child_01, Female_Party_02) or Job_Sex_NN (Police_Male_03). */
export const AI_PHOTO_AVATAR_ID = new RegExp(
  `^(?:(?:Male|Female)_(?:Adult|Child|Party)|(?:${JOBS})_(?:Male|Female))_\\d{2}$`,
)

/** Who the avatar shows, read from its id; null for an id that isn't a Rocketbox avatar. */
export function avatarSubject(avatarId: string): { female: boolean; child: boolean } | null {
  if (!AI_PHOTO_AVATAR_ID.test(avatarId)) return null
  return { female: /(^|_)Female(_|$)/.test(avatarId), child: avatarId.includes('_Child_') }
}

/** A face photo never goes with a child avatar or a party outfit. */
export function avatarTakesFace(avatarId: string): boolean {
  const subject = avatarSubject(avatarId)
  return subject !== null && !subject.child && !avatarId.includes('_Party_')
}
