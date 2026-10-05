import { describe, expect, test } from 'bun:test'
import { BARK_RANGE, speaksNow, speechTimeoutMs } from './queue'

const line = (npcId: string) => ({ npcId, kind: 'line' as const })
const ai = (npcId: string) => ({ npcId, kind: 'ai' as const })
const bark = (npcId: string) => ({ npcId, kind: 'bark' as const })

describe('speaksNow', () => {
  test('conversation lines always speak, over anything', () => {
    for (const next of [line('a'), ai('a')]) {
      expect(speaksNow(null, next, null)).toBe(true)
      expect(speaksNow(line('a'), next, null)).toBe(true)
      expect(speaksNow(bark('b'), next, null)).toBe(true)
      expect(speaksNow(ai('b'), next, null)).toBe(true)
    }
  })

  test('a bark speaks over silence within range only', () => {
    expect(speaksNow(null, bark('a'), 3)).toBe(true)
    expect(speaksNow(null, bark('a'), BARK_RANGE)).toBe(true)
    expect(speaksNow(null, bark('a'), BARK_RANGE + 0.1)).toBe(false)
    expect(speaksNow(null, bark('a'), null)).toBe(false)
  })

  test("a bark replaces the same NPC's bark, but not another's", () => {
    expect(speaksNow(bark('a'), bark('a'), 2)).toBe(true)
    expect(speaksNow(bark('b'), bark('a'), 2)).toBe(false)
  })

  test('a bark never interrupts a conversation line', () => {
    expect(speaksNow(line('a'), bark('a'), 1)).toBe(false)
    expect(speaksNow(ai('b'), bark('a'), 1)).toBe(false)
  })
})

describe('speechTimeoutMs', () => {
  test('longer lines and slower voices get longer', () => {
    const short = speechTimeoutMs('안녕하세요!', 1)
    expect(short).toBeGreaterThan(5000)
    expect(speechTimeoutMs('안녕하세요! 여기는 거실이에요.', 1)).toBeGreaterThan(short)
    expect(speechTimeoutMs('안녕하세요!', 0.5)).toBeGreaterThan(short)
  })

  test('outlasts even a slow reading of the longest line', () => {
    // 300 characters at half speed, spoken at 4 characters a second.
    expect(speechTimeoutMs('가'.repeat(300), 0.5)).toBeGreaterThan((300 / 4 / 0.5) * 1000)
  })
})
