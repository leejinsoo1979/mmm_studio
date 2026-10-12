import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { AI_PORTRAIT_TOKEN_TTL_MS, type AiPersonChoices } from './shared'

/**
 * Signed portraits: the portrait route signs every portrait it hands out,
 * and the avatar route takes a photo only with a valid signature over its
 * exact bytes for the same user, so the paid 3D step can't be fed anyone's
 * photo. The token is `<claim>.<expires>.<mac>`: the claim (base64url JSON)
 * carries what the 3D step needs and may trust (sex, age band, outfit, hair),
 * the mac is HMAC-SHA256 over the claim, the expiry and the user. The claim
 * is readable, not secret; it can't be forged or moved to another user or
 * image.
 */

export type PortraitClaim = {
  /** sha256 of the portrait bytes, base64url. */
  sha: string
  sex: AiPersonChoices['sex']
  age: AiPersonChoices['age']
  hairStyle: AiPersonChoices['hairStyle']
  hairColour: AiPersonChoices['hairColour']
  outfit: AiPersonChoices['outfit']
  outfitColour: AiPersonChoices['outfitColour']
  /** Made by the 목업 (development only): only the 목업 3D step takes it. */
  mock?: true
}

type Env = Record<string, string | undefined>

// Without a configured secret, tokens only verify on the process that signed them.
const processSecret = randomBytes(32)

const secret = (env: Env) => env.AI_AVATAR_SECRET?.trim() || processSecret

export const portraitSha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('base64url')

function mac(env: Env, claim: string, expires: number, uid: string) {
  return createHmac('sha256', secret(env))
    .update(JSON.stringify(['photoreal-ai-portrait', claim, expires, uid]))
    .digest('base64url')
}

export function signPortrait(
  claim: PortraitClaim,
  uid: string,
  options: { env?: Env; now?: number } = {},
): string {
  const env = options.env ?? process.env
  const expires = (options.now ?? Date.now()) + AI_PORTRAIT_TOKEN_TTL_MS
  const encoded = Buffer.from(JSON.stringify(claim)).toString('base64url')
  return `${encoded}.${expires}.${mac(env, encoded, expires, uid)}`
}

export type PortraitTokenCheck =
  | { ok: true; claim: PortraitClaim; expires: number }
  | { ok: false; code: 'invalid' | 'expired' | 'mismatch' }

/** The token's claim when it is ours, for this user, unexpired and over exactly these bytes. */
export function verifyPortrait(
  token: string,
  bytes: Uint8Array,
  uid: string,
  options: { env?: Env; now?: number } = {},
): PortraitTokenCheck {
  const env = options.env ?? process.env
  const now = options.now ?? Date.now()
  if (token.length > 1024) return { ok: false, code: 'invalid' }
  const [encoded, head, signature, ...rest] = token.split('.')
  const expires = Number(head)
  if (!encoded || !signature || rest.length > 0 || !Number.isSafeInteger(expires)) {
    return { ok: false, code: 'invalid' }
  }
  const expected = Buffer.from(mac(env, encoded, expires, uid))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, code: 'invalid' }
  }
  if (expires < now || expires > now + AI_PORTRAIT_TOKEN_TTL_MS) {
    return { ok: false, code: 'expired' }
  }
  let claim: PortraitClaim
  try {
    claim = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PortraitClaim
  } catch {
    return { ok: false, code: 'invalid' }
  }
  if (typeof claim?.sha !== 'string') return { ok: false, code: 'invalid' }
  if (claim.sha !== portraitSha(bytes)) return { ok: false, code: 'mismatch' }
  return { ok: true, claim, expires }
}
