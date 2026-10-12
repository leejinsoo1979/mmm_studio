import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode, nodeRegistry, registerNode, useScene } from '@pascal-app/core'
import { npcDefinition } from './definition'
import { NPC_DIALOGUE_TEMPLATES, NPC_PRESETS, npcDialogueTemplate } from './presets'
import { DialogueGraph, isChildAvatar, NpcNode } from './schema'

// The scene store schedules work with requestAnimationFrame; bun:test has no DOM.
type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn

const line = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  text: '안녕하세요',
  ...extra,
})

describe('NpcNode', () => {
  test('parse({}) fills every nested default', () => {
    const npc = NpcNode.parse({})
    expect(npc.id.startsWith('npc_')).toBe(true)
    expect(npc.type).toBe('npc')
    expect(npc.name).toBe('주민')
    expect(npc.role).toBe('resident')
    expect(npc.avatar).toBe('Female_Adult_01')
    expect(npc.look).toBeNull()
    expect(npc.dialogue).toBeNull()
    expect(npc.behavior).toMatchObject({
      mode: 'stand',
      speed: 'normal',
      wanderRadius: 4,
      dwell: [3, 10],
      idleEmotes: ['lookAround'],
      greet: { enabled: true, radius: 3, emote: 'wave', barks: [], cooldown: 45 },
    })
    expect(npc.interaction).toEqual({ talkable: true, prompt: '대화하기', range: 2.5 })
    expect(npc.ai).toMatchObject({ enabled: false, sceneScope: 'rooms-furniture', language: 'ko' })
    expect(npc.voice).toEqual({ enabled: true, pitch: 1, rate: 1, voice: 'auto' })
  })

  test('the seed defaults to 0, never a random draw', () => {
    expect(NpcNode.parse({}).behavior.seed).toBe(0)
    expect(NpcNode.parse({ behavior: { seed: 12345 } }).behavior.seed).toBe(12345)
    expect(NpcNode.safeParse({ behavior: { seed: -1 } }).success).toBe(false)
  })

  test('a partial nested object keeps its siblings defaulted', () => {
    const npc = NpcNode.parse({ behavior: { mode: 'wander', greet: { radius: 5 } } })
    expect(npc.behavior.speed).toBe('normal')
    expect(npc.behavior.greet).toMatchObject({ enabled: true, radius: 5, emote: 'wave' })
  })

  test('rejects an avatar id that is not a Rocketbox id', () => {
    expect(NpcNode.safeParse({ avatar: 'Business_Female_01' }).success).toBe(true)
    expect(NpcNode.safeParse({ avatar: '../Female_Adult_01' }).success).toBe(false)
    expect(NpcNode.safeParse({ avatar: 'Female_Adult_1' }).success).toBe(false)
  })

  test('rejects a look with an embedded image or that is too large', () => {
    expect(NpcNode.safeParse({ look: { hair: '#332211', face: null } }).success).toBe(true)
    const photo = { face: { photo: 'data:image/png;base64,AAAA' } }
    expect(NpcNode.safeParse({ look: photo }).success).toBe(false)
    expect(NpcNode.safeParse({ look: { blob: 'x'.repeat(20_000) } }).success).toBe(false)
  })

  test('voice settings stay in range', () => {
    expect(NpcNode.safeParse({ voice: { pitch: 1.3, voice: 'SunHi' } }).success).toBe(true)
    expect(NpcNode.safeParse({ voice: { pitch: 3 } }).success).toBe(false)
  })
})

describe('DialogueGraph', () => {
  test('accepts a looping graph whose refs all exist', () => {
    const graph = DialogueGraph.parse({
      start: 'a',
      lines: [
        line('a', {
          choices: [
            { id: 'go', label: '다음', next: 'b' },
            { id: 'bye', label: '끝' },
          ],
        }),
        line('b', { next: 'a' }),
      ],
    })
    expect(graph.lines[0]?.choices[1]?.next).toBeNull()
    expect(graph.lines[0]?.choices[0]?.actions).toEqual([])
  })

  test('rejects a missing start, next or choice target', () => {
    expect(DialogueGraph.safeParse({ start: 'x', lines: [line('a')] }).success).toBe(false)
    expect(DialogueGraph.safeParse({ start: 'a', lines: [line('a', { next: 'b' })] }).success).toBe(
      false,
    )
    const badChoice = line('a', { choices: [{ id: 'c', label: '가기', next: 'nowhere' }] })
    const result = DialogueGraph.safeParse({ start: 'a', lines: [badChoice] })
    expect(result.error?.issues[0]?.path).toEqual(['lines', 0, 'choices', 0, 'next'])
  })

  test('rejects duplicate line and choice ids', () => {
    expect(DialogueGraph.safeParse({ start: 'a', lines: [line('a'), line('a')] }).success).toBe(
      false,
    )
    const twice = [
      { id: 'c', label: '하나' },
      { id: 'c', label: '둘' },
    ]
    expect(
      DialogueGraph.safeParse({ start: 'a', lines: [line('a', { choices: twice })] }).success,
    ).toBe(false)
  })

  test('rejects unknown actions and bad flag ids', () => {
    const act = (action: unknown) =>
      DialogueGraph.safeParse({ start: 'a', lines: [line('a', { onEnter: [action] })] }).success
    expect(act({ kind: 'guideTo', room: '@next' })).toBe(true)
    expect(act({ kind: 'setFlag', flag: 'met' })).toBe(true)
    expect(act({ kind: 'teleport' })).toBe(false)
    expect(act({ kind: 'setFlag', flag: 'Not A Flag' })).toBe(false)
  })
})

describe('presets', () => {
  test('every dialogue template is a valid graph', () => {
    for (const { id } of NPC_DIALOGUE_TEMPLATES) {
      expect(npcDialogueTemplate(id).lines.length).toBeGreaterThan(0)
    }
    expect(npcDialogueTemplate('tour')).not.toBe(npcDialogueTemplate('tour'))
  })

  test('every preset parses into an NPC of its role', () => {
    for (const preset of NPC_PRESETS) {
      const npc = NpcNode.parse(preset.fields)
      expect(npc.role).toBe(preset.id)
      expect(npc.name).toBe(preset.label)
      expect(npc.behavior.seed).toBe(0)
    }
  })
})

test('isChildAvatar', () => {
  expect(isChildAvatar('Female_Child_01')).toBe(true)
  expect(isChildAvatar('Male_Child_02')).toBe(true)
  expect(isChildAvatar('Female_Adult_01')).toBe(false)
  expect(isChildAvatar('Business_Male_03')).toBe(false)
})

describe('npcDefinition', () => {
  test('defaults are a parsed NPC without an id', () => {
    const defaults = npcDefinition.defaults()
    expect('id' in defaults).toBe(false)
    expect(defaults).toMatchObject({ type: 'npc', role: 'resident', behavior: { seed: 0 } })
  })

  test('an NPC is created under a level like any registry kind', () => {
    if (!nodeRegistry.has('npc')) registerNode(npcDefinition as never)
    const level = LevelNode.parse({ level: 0 })
    const npc = NpcNode.parse({ name: '지아', position: [1, 0, 2] })
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
    useScene.getState().createNode(level)
    useScene.getState().createNode(npc as unknown as AnyNode, level.id)
    const nodes = useScene.getState().nodes as Record<string, unknown>
    expect(nodes[npc.id]).toMatchObject({ type: 'npc', name: '지아', parentId: level.id })
    expect((nodes[level.id] as { children: string[] }).children).toContain(npc.id)
    expect(nodeRegistry.get('npc')?.category).toBe('site')
    expect(nodeRegistry.get('npc')?.bake).toBe('strip')
  })
})
