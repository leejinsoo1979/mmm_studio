import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Signed AI replies: the chat route signs each finished reply, and the voice
 * route speaks free text only with a valid signature, so it can't be used as
 * a general text-to-speech service. HMAC-SHA256 over the scene, the NPC and
 * the (trimmed) text, valid for 10 minutes.
 */

export type ReplyClaim = { sceneId: string; npcId: string; text: string }

const TTL_MS = 10 * 60_000
// Without a configured secret, tokens only verify on the process that signed them.
const processSecret = randomBytes(32)

function mac(expires: number, claim: ReplyClaim): string {
  const secret = process.env.NPC_AI_REPLY_SECRET?.trim() || processSecret
  return createHmac('sha256', secret)
    .update(JSON.stringify([expires, claim.sceneId, claim.npcId, claim.text.trim()]))
    .digest('base64url')
}

export function signReply(claim: ReplyClaim, now = Date.now()): string {
  const expires = now + TTL_MS
  return `${expires}.${mac(expires, claim)}`
}

export function verifyReply(token: string, claim: ReplyClaim, now = Date.now()): boolean {
  const [head, signature, ...rest] = token.split('.')
  const expires = Number(head)
  if (!signature || rest.length > 0 || !Number.isSafeInteger(expires)) return false
  if (expires < now || expires > now + TTL_MS) return false
  const expected = Buffer.from(mac(expires, claim))
  const given = Buffer.from(signature)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
