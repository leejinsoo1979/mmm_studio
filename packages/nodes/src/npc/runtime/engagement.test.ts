import { beforeEach, describe, expect, test } from 'bun:test'
import type { NpcEngagement } from '../types'
import {
  canonicalEngagement,
  decodeEngagement,
  effectiveEngagement,
  encodeEngagement,
  heldByOther,
  NPC_ENGAGEMENT_EXPIRY_MS,
  NPC_EPOCH_KEY,
  npcEngagementKey,
  npcIdOfKey,
} from './engagement'
import { applyNpcWorldEntry, readNpcWorldEntries, useNpcRuntime } from './store'

const AT = 1_700_000_000_000

const KINDS: NpcEngagement[] = [
  { m: 'talk', by: 'uid-a', at: AT, p: [1.234567, -2.5], yaw: 1.234567, line: '안녕하세요!' },
  { m: 'follow', by: 'uid-a', at: AT + 0.4, p: [0, 0] },
  { m: 'guide', by: 'uid-b', at: AT, p: [3, 4], room: 'zone_living' },
  { m: 'social', by: 'uid-b', at: AT, p: [3, 4], yaw: -0.5, act: 'highFive' },
  { m: 'chase', by: 'uid-c', at: AT, p: [3, 4], ph: 'npc', pt: AT + 800 },
  { m: 'chase', by: 'uid-c', at: AT, p: [3, 4], ph: 'end', pt: AT + 9000, won: 'player' },
  { m: 'free', at: AT, p: [-7.891, 2.001] },
]

describe('encode / decode', () => {
  test('every kind survives the round trip, in canonical form', () => {
    for (const e of KINDS) {
      expect(decodeEngagement(JSON.parse(JSON.stringify(encodeEngagement(e))))).toEqual(
        canonicalEngagement(e),
      )
    }
  })

  test('canonical form is stable: rounding twice changes nothing', () => {
    for (const e of KINDS) {
      const once = encodeEngagement(e)
      expect(encodeEngagement(decodeEngagement(once)!)).toEqual(once)
    }
  })

  test('positions round to the centimetre, facing to 4 decimals, time to the ms', () => {
    const talk = canonicalEngagement(KINDS[0]!)
    expect(talk.p).toEqual([1.23, -2.5])
    expect(talk.m === 'talk' && talk.yaw).toBe(1.2346)
    expect(canonicalEngagement(KINDS[1]!).at).toBe(AT)
    expect(canonicalEngagement({ m: 'free', at: AT, p: [-0.001, 0.004] }).p).toEqual([0, 0])
  })

  test('a shared line is cut to 140 characters; no line, no field', () => {
    const long = canonicalEngagement({
      ...(KINDS[0] as Extract<NpcEngagement, { m: 'talk' }>),
      line: '가'.repeat(300),
    })
    expect(long.m === 'talk' && long.line?.length).toBe(140)
    expect('line' in encodeEngagement(KINDS[2]!)).toBe(false)
  })

  test('malformed entries are rejected', () => {
    const bad: unknown[] = [
      null,
      42,
      'talk',
      { m: 'talk', at: AT, p: [0, 0], yaw: 0 },
      { m: 'talk', by: 'a', at: AT, p: [0], yaw: 0 },
      { m: 'talk', by: 'a', at: 'now', p: [0, 0], yaw: 0 },
      { m: 'guide', by: 'a', at: AT, p: [0, 0] },
      { m: 'social', by: 'a', at: AT, p: [0, 0], yaw: 0, act: 'wrestle' },
      { m: 'chase', by: 'a', at: AT, p: [0, 0], ph: 'run', pt: AT },
      { m: 'chase', by: 'a', at: AT, p: [0, 0], ph: 'end', pt: AT, won: 'nobody' },
      { m: 'dance', by: 'a', at: AT, p: [0, 0] },
      { m: 'free', at: AT, p: [Number.NaN, 0] },
    ]
    for (const value of bad) expect(decodeEngagement(value)).toBeNull()
  })
})

describe('expiry', () => {
  const talk = KINDS[0]!

  test('a held engagement lasts 120 s without a refresh', () => {
    expect(effectiveEngagement(talk, AT + NPC_ENGAGEMENT_EXPIRY_MS)).toBe(talk)
  })

  test('then reads as released where it was held, when it expired', () => {
    expect(effectiveEngagement(talk, AT + NPC_ENGAGEMENT_EXPIRY_MS + 1)).toEqual({
      m: 'free',
      at: AT + NPC_ENGAGEMENT_EXPIRY_MS,
      p: talk.p,
    })
  })

  test('a release never expires; nothing stays nothing', () => {
    const free = KINDS[KINDS.length - 1]!
    expect(effectiveEngagement(free, AT + 10 * NPC_ENGAGEMENT_EXPIRY_MS)).toBe(free)
    expect(effectiveEngagement(undefined, AT)).toBeNull()
  })

  test('held by someone else, until it expires', () => {
    expect(heldByOther(talk, 'uid-b', AT + 1000)).toBe(true)
    expect(heldByOther(talk, 'uid-a', AT + 1000)).toBe(false)
    expect(heldByOther(talk, 'uid-b', AT + NPC_ENGAGEMENT_EXPIRY_MS + 1)).toBe(false)
    expect(heldByOther(KINDS[KINDS.length - 1], 'uid-b', AT)).toBe(false)
  })
})

describe('world entries', () => {
  beforeEach(() => {
    useNpcRuntime.setState({ epoch: null, localPlayerId: 'uid-me', engagements: {}, bubbles: {} })
  })

  test('keys', () => {
    expect(npcEngagementKey('npc_a')).toBe('npc:npc_a')
    expect(npcIdOfKey('npc:npc_a')).toBe('npc_a')
    expect(npcIdOfKey('npc:')).toBeNull()
    expect(npcIdOfKey('door:npc_a')).toBeNull()
    expect(npcIdOfKey(NPC_EPOCH_KEY)).toBeNull()
  })

  test('other keys are not ours', () => {
    expect(applyNpcWorldEntry('door:door_1', { f: 'swingAngle', v: 1 })).toBe(false)
    expect(applyNpcWorldEntry('clock', 12)).toBe(false)
    expect(useNpcRuntime.getState().engagements).toEqual({})
  })

  test('what one player reads, another applies to the same state', () => {
    const runtime = useNpcRuntime.getState()
    runtime.setEpoch(AT)
    runtime.setEngagement('npc_a', KINDS[0]!)
    runtime.setEngagement('npc_b', KINDS[6]!)
    const entries = JSON.parse(JSON.stringify(readNpcWorldEntries()))
    expect(Object.keys(entries).sort()).toEqual([NPC_EPOCH_KEY, 'npc:npc_a', 'npc:npc_b'].sort())

    const mine = useNpcRuntime.getState().engagements
    useNpcRuntime.setState({ epoch: null, engagements: {} })
    for (const [key, value] of Object.entries(entries)) {
      expect(applyNpcWorldEntry(key, value)).toBe(true)
    }
    expect(useNpcRuntime.getState().epoch).toBe(AT)
    expect(useNpcRuntime.getState().engagements).toEqual(mine)
    // And reads back the same, so nothing travels back out.
    expect(JSON.parse(JSON.stringify(readNpcWorldEntries()))).toEqual(entries)
  })

  test('null clears an entry; a malformed one is ignored', () => {
    const runtime = useNpcRuntime.getState()
    runtime.setEngagement('npc_a', KINDS[1]!)
    expect(applyNpcWorldEntry('npc:npc_a', { m: 'bogus' })).toBe(true)
    expect(useNpcRuntime.getState().engagements.npc_a).toEqual(canonicalEngagement(KINDS[1]!))
    expect(applyNpcWorldEntry('npc:npc_a', null)).toBe(true)
    expect(useNpcRuntime.getState().engagements.npc_a).toBeUndefined()
    runtime.setEpoch(AT)
    expect(applyNpcWorldEntry(NPC_EPOCH_KEY, null)).toBe(true)
    expect(useNpcRuntime.getState().epoch).toBeNull()
  })

  test("another player's shared line shows over the NPC; this player's own doesn't", () => {
    applyNpcWorldEntry('npc:npc_a', encodeEngagement(KINDS[0]!))
    expect(useNpcRuntime.getState().bubbles.npc_a?.text).toBe('안녕하세요!')
    useNpcRuntime.setState({ bubbles: {} })
    applyNpcWorldEntry(
      'npc:npc_b',
      encodeEngagement({ ...(KINDS[0] as Extract<NpcEngagement, { m: 'talk' }>), by: 'uid-me' }),
    )
    expect(useNpcRuntime.getState().bubbles.npc_b).toBeUndefined()
  })
})
