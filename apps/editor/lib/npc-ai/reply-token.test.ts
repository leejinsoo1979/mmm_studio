import { describe, expect, test } from 'bun:test'
import { signReply, verifyReply } from './reply-token'

const claim = { sceneId: 'scene-1', npcId: 'npc_a', text: '여기는 거실이에요.' }
const NOW = 1_800_000_000_000

describe('reply tokens', () => {
  test('a signed reply verifies for the same scene, NPC and text', () => {
    const token = signReply(claim, NOW)
    expect(verifyReply(token, claim, NOW)).toBe(true)
    expect(verifyReply(token, { ...claim, text: `  ${claim.text}\n` }, NOW + 60_000)).toBe(true)
  })

  test('any other scene, NPC or text fails', () => {
    const token = signReply(claim, NOW)
    expect(verifyReply(token, { ...claim, sceneId: 'scene-2' }, NOW)).toBe(false)
    expect(verifyReply(token, { ...claim, npcId: 'npc_b' }, NOW)).toBe(false)
    expect(verifyReply(token, { ...claim, text: '여기는 주방이에요.' }, NOW)).toBe(false)
  })

  test('expires after 10 minutes', () => {
    const token = signReply(claim, NOW)
    expect(verifyReply(token, claim, NOW + 10 * 60_000)).toBe(true)
    expect(verifyReply(token, claim, NOW + 10 * 60_000 + 1)).toBe(false)
  })

  test('tampered or malformed tokens fail', () => {
    const [expires, signature] = signReply(claim, NOW).split('.')
    expect(verifyReply(`${Number(expires) + 60_000}.${signature}`, claim, NOW)).toBe(false)
    expect(verifyReply(`${expires}.${signature}x`, claim, NOW)).toBe(false)
    expect(verifyReply(`${expires}.${signature}.x`, claim, NOW)).toBe(false)
    expect(verifyReply('', claim, NOW)).toBe(false)
    expect(verifyReply('abc.def', claim, NOW)).toBe(false)
  })

  test('the configured secret signs, and replaces the per-process one', () => {
    const before = process.env.NPC_AI_REPLY_SECRET
    try {
      process.env.NPC_AI_REPLY_SECRET = 'first'
      const token = signReply(claim, NOW)
      expect(verifyReply(token, claim, NOW)).toBe(true)
      process.env.NPC_AI_REPLY_SECRET = 'second'
      expect(verifyReply(token, claim, NOW)).toBe(false)
    } finally {
      if (before === undefined) delete process.env.NPC_AI_REPLY_SECRET
      else process.env.NPC_AI_REPLY_SECRET = before
    }
  })
})
