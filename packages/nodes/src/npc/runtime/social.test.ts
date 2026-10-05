import { beforeEach, describe, expect, test } from 'bun:test'
import { estimateBodyAnchors } from '@pascal-app/editor'
import { Vector3 } from 'three'
import { NpcNode } from '../schema'
import type { NpcEngagement, NpcPose } from '../types'
import {
  envelope,
  hugAllowed,
  isBehind,
  MENU_REASONS,
  type NpcMenuInput,
  npcMenuItems,
  npcSocialEmote,
  resetSocialMinds,
  SOCIAL_DISTANCE,
  SOCIAL_DURATION,
  socialArmGoals,
  socialEngagementHandler,
  socialProgress,
  socialStance,
} from './social'
import { useNpcRuntime } from './store'

const ADULT = 'Female_Adult_03'
const CHILD = 'Male_Child_01'

const MENU: NpcMenuInput = {
  talkable: true,
  npcAvatar: ADULT,
  playerAvatar: 'Male_Adult_01',
  busy: false,
  following: false,
  // Facing +Z; the player stands 1 m in front of it.
  npc: { p: [0, 0], yaw: 0 },
  player: [0, 1],
  surpriseCooldownMs: 0,
}

const itemOf = (input: NpcMenuInput, action: string) =>
  npcMenuItems(input).find((item) => item.action === action)!

describe('the E menu', () => {
  test('lists the ten items in key order', () => {
    expect(npcMenuItems(MENU).map((item) => item.action)).toEqual([
      'talk',
      'highFive',
      'handshake',
      'fistBump',
      'shoulderPat',
      'hug',
      'dance',
      'photo',
      'follow',
      'surprise',
    ])
    expect(npcMenuItems(MENU).map((item) => item.label)).toEqual([
      '대화하기',
      '하이파이브',
      '악수',
      '주먹 인사',
      '어깨 토닥이기',
      '포옹',
      '같이 춤추기',
      '같이 사진 찍기',
      '따라와요',
      '왁! 놀래키기',
    ])
  })

  test('offers a hug only when both are adults', () => {
    expect(hugAllowed('Male_Adult_01', ADULT)).toBe(true)
    expect(hugAllowed(CHILD, ADULT)).toBe(false)
    expect(hugAllowed('Male_Adult_01', 'Female_Child_02')).toBe(false)
    expect(itemOf(MENU, 'hug').enabled).toBe(true)
    const withChild = itemOf({ ...MENU, playerAvatar: CHILD }, 'hug')
    expect(withChild.enabled).toBe(false)
    expect(withChild.reason).toBe(MENU_REASONS.hugAdults)
    expect(itemOf({ ...MENU, npcAvatar: 'Female_Child_02' }, 'hug').enabled).toBe(false)
    // Every other gesture is for everyone.
    const child = npcMenuItems({ ...MENU, playerAvatar: CHILD })
    for (const item of child) {
      if (item.action !== 'hug' && item.action !== 'surprise') expect(item.enabled).toBe(true)
    }
  })

  test('talks only with a talkable NPC', () => {
    expect(itemOf(MENU, 'talk').enabled).toBe(true)
    const quiet = itemOf({ ...MENU, talkable: false }, 'talk')
    expect(quiet.enabled).toBe(false)
    expect(quiet.reason).toBe(MENU_REASONS.notTalkable)
  })

  test('swaps follow for stop following', () => {
    const following = npcMenuItems({ ...MENU, following: true })
    expect(following[8]).toMatchObject({
      action: 'stopFollow',
      label: '그만 따라와요',
      enabled: true,
    })
  })

  test('an NPC someone else holds offers nothing', () => {
    for (const item of npcMenuItems({ ...MENU, busy: true })) {
      expect(item.enabled).toBe(false)
      expect(item.reason).toBe(MENU_REASONS.busy)
    }
  })

  test('surprises only from behind, close by, and not again too soon', () => {
    expect(itemOf(MENU, 'surprise')).toMatchObject({ enabled: false, reason: MENU_REASONS.sneak })
    const behind: NpcMenuInput = { ...MENU, player: [0.3, -1.2] }
    expect(itemOf(behind, 'surprise').enabled).toBe(true)
    expect(itemOf({ ...behind, player: [0, -2.2] }, 'surprise').enabled).toBe(false)
    // Off to the side (90°) isn't behind.
    expect(itemOf({ ...behind, player: [1.2, 0] }, 'surprise').enabled).toBe(false)
    const cooling = itemOf({ ...behind, surpriseCooldownMs: 12_300 }, 'surprise')
    expect(cooling.enabled).toBe(false)
    expect(cooling.reason).toBe(MENU_REASONS.cooldown(13))
  })

  test('behind means more than 100° off the facing', () => {
    const at = (deg: number): [number, number] => [
      Math.sin((deg * Math.PI) / 180),
      Math.cos((deg * Math.PI) / 180),
    ]
    expect(isBehind([0, 0], 0, at(95))).toBe(false)
    expect(isBehind([0, 0], 0, at(105))).toBe(true)
    expect(isBehind([0, 0], 0, at(-170))).toBe(true)
    expect(isBehind([0, 0], Math.PI, at(0))).toBe(true)
  })
})

describe('standing for a gesture', () => {
  test('stands the gesture distance from the player toward the NPC', () => {
    for (const act of ['highFive', 'hug', 'dance', 'photo'] as const) {
      const spot = socialStance(act, [1, 2], Math.PI / 2)
      expect(Math.hypot(spot[0] - 1, spot[1] - 2)).toBeCloseTo(SOCIAL_DISTANCE[act], 6)
      expect(spot[1]).toBeCloseTo(2, 6)
      expect(spot[0]).toBeGreaterThan(1)
    }
  })

  test('a pat on the shoulder stands a little to the player’s right', () => {
    // The player faces +Z (toward the NPC); their right is -X.
    const spot = socialStance('shoulderPat', [0, 0], 0)
    expect(spot[1]).toBeCloseTo(0.65, 6)
    expect(spot[0]).toBeLessThan(-0.2)
  })
})

describe('choreography', () => {
  // Face to face 0.75 m apart: the NPC at z = 0.75 facing -Z, the player at the origin facing +Z.
  const npc = estimateBodyAnchors(new Vector3(0, 0, 0.75), Math.PI, 1.7)
  const player = estimateBodyAnchors(new Vector3(0, 0, 0), 0, 1.75)

  test('right hands meet over the heads for a high five', () => {
    const goals = socialArmGoals('highFive', 0.45, npc, player)
    expect(goals.map((goal) => `${goal.who}:${goal.side}`).sort()).toEqual([
      'npc:right',
      'player:right',
    ])
    const y = (npc.head.y + player.head.y) / 2 + 0.15
    for (const goal of goals) {
      expect(goal.weight).toBeCloseTo(1, 6)
      expect(goal.target.y).toBeCloseTo(y, 6)
      expect(Math.abs(goal.target.z - 0.375)).toBeLessThan(0.05)
    }
    expect(socialArmGoals('highFive', 1.05, npc, player)).toEqual([])
  })

  test('a handshake pumps at waist height and a fist bump curls the fingers', () => {
    const shake = socialArmGoals('handshake', 0.5, npc, player)
    expect(shake[0]!.target.y).toBeCloseTo((npc.waist.y + player.waist.y) / 2 + 0.1, 3)
    const pumped = socialArmGoals('handshake', 0.5 + 1.1 / 12, npc, player)
    expect(pumped[0]!.target.y - shake[0]!.target.y).toBeGreaterThan(0.03)
    const bump = socialArmGoals('fistBump', 0.45, npc, player)
    expect(bump.every((goal) => goal.fist === 1)).toBe(true)
  })

  test('a pat puts only the player’s hand on the NPC’s left shoulder', () => {
    const goals = socialArmGoals('shoulderPat', 1, npc, player)
    expect(goals).toHaveLength(1)
    expect(goals[0]!.who).toBe('player')
    expect(goals[0]!.target.distanceTo(npc.leftShoulder)).toBeLessThan(0.15)
    expect(goals[0]!.target.y).toBeGreaterThan(npc.leftShoulder.y)
  })

  test('a hug wraps both arms round the other’s upper back, never lower', () => {
    const goals = socialArmGoals('hug', 1, npc, player)
    expect(goals).toHaveLength(4)
    for (const goal of goals) {
      const other = goal.who === 'npc' ? player : npc
      expect(goal.target.y).toBeGreaterThanOrEqual(other.chest.y)
      // Behind the other's chest.
      const behind = goal.target.clone().sub(other.chest).dot(other.forward)
      expect(behind).toBeLessThan(0)
    }
  })

  test('a dance and a photo leave the arms to the emotes', () => {
    expect(socialArmGoals('dance', 2, npc, player)).toEqual([])
    expect(socialArmGoals('photo', 1, npc, player)).toEqual([])
  })

  test('gestures are the same on every client', () => {
    expect(npcSocialEmote('highFive', 1001)).toEqual(npcSocialEmote('highFive', 1001))
    expect(npcSocialEmote('dance', 0, 'silly').id).toBe('danceSilly')
    expect(npcSocialEmote('handshake', 5).id).toBe('nod')
  })

  test('envelope rises, holds and falls', () => {
    expect(envelope(0, 0, 1, 2, 3)).toBe(0)
    expect(envelope(0.5, 0, 1, 2, 3)).toBeCloseTo(0.5, 6)
    expect(envelope(1.5, 0, 1, 2, 3)).toBe(1)
    expect(envelope(3, 0, 1, 2, 3)).toBe(0)
  })
})

describe('the gesture engagement', () => {
  const npc = NpcNode.parse({ id: 'npc_social1', position: [0, 0, 3] })
  const pose = (p: [number, number]): NpcPose => ({
    levelId: 'level_x',
    p,
    y: 0,
    yaw: 0,
    speed: 0,
    state: 'idle',
    emote: null,
    lookAt: null,
    visible: true,
  })

  beforeEach(() => {
    resetSocialMinds()
    useNpcRuntime.setState({ engagements: {}, bubbles: {}, localPlayerId: 'me' })
  })

  test('walks to its spot, plays its part, and is let go when done', () => {
    const at = 1_700_000_000_000
    const player = { p: [0, 0] as [number, number], y: 0, yaw: 0 }
    const engagement: Extract<NpcEngagement, { m: 'social' }> = {
      m: 'social',
      by: 'me',
      at,
      p: socialStance('highFive', player.p, 0),
      yaw: Math.PI,
      act: 'highFive',
    }
    useNpcRuntime.getState().setEngagement(npc.id, engagement)
    let last = pose([0, 3])
    let now = at
    let arrivedAt: number | null = null
    const dt = 1 / 30
    while (now < at + 10_000 && useNpcRuntime.getState().engagements[npc.id]?.m === 'social') {
      const override = socialEngagementHandler({
        npc,
        engagement,
        pose: last,
        player,
        owner: true,
        now,
        dt,
      })
      expect(override.state).toBe('social')
      last = { ...last, p: override.p!, yaw: override.yaw! }
      const progress = socialProgress(npc.id, now)
      if (arrivedAt === null && progress?.arrivedAt) {
        arrivedAt = progress.arrivedAt
        expect(Math.hypot(last.p[0], last.p[1])).toBeCloseTo(SOCIAL_DISTANCE.highFive, 2)
        // Facing the player.
        expect(Math.cos(override.yaw! - Math.PI)).toBeGreaterThan(0.99)
      }
      if (arrivedAt !== null) expect(override.emote?.at).toBe(Math.round(arrivedAt + 1000))
      now += dt * 1000
    }
    expect(arrivedAt).not.toBeNull()
    const released = useNpcRuntime.getState().engagements[npc.id]
    expect(released?.m).toBe('free')
    expect(released!.at - arrivedAt!).toBeGreaterThanOrEqual(SOCIAL_DURATION.highFive * 1000)
    expect(released!.at - arrivedAt!).toBeLessThan(SOCIAL_DURATION.highFive * 1000 + 100)
  })

  test('the holder lets go when its player is gone', () => {
    const engagement: Extract<NpcEngagement, { m: 'social' }> = {
      m: 'social',
      by: 'me',
      at: 1000,
      p: [0, 1],
      yaw: Math.PI,
      act: 'dance',
    }
    useNpcRuntime.getState().setEngagement(npc.id, engagement)
    socialEngagementHandler({
      npc,
      engagement,
      pose: pose([0, 1]),
      player: null,
      owner: true,
      now: 1000,
      dt: 0.016,
    })
    expect(useNpcRuntime.getState().engagements[npc.id]?.m).toBe('free')
  })
})
