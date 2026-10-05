import { BaseNode, nodeType, objectId } from '@pascal-app/core/schema'
import { z } from 'zod'

/**
 * Non-player character (`npc`) for play mode: a Rocketbox avatar that stands,
 * wanders or patrols on its level, greets and follows visitors, and talks
 * through a scripted dialogue graph or, when switched on, the AI route.
 *
 * Server-safe (only `@pascal-app/core/schema` and zod): the API validates
 * saved scenes and the AI route reads the NPC through `./npc/schema`.
 * Metres and radians; `position` is level-local like every positioned node.
 */

/** Dialogue line and choice ids, and flags. */
const LocalId = z.string().regex(/^[a-z0-9_-]{1,32}$/)
/** Zone or slab ids a behaviour or action points at. */
const NodeRef = z.string().min(1).max(64)
const Vec2 = z.tuple([z.number().finite(), z.number().finite()])
/** Emote ids are checked at runtime with the editor's `isEmoteId`; the schema stays server-safe. */
const EmoteRef = z.string().regex(/^[a-zA-Z]{2,24}$/)
const Text = (max: number) => z.string().trim().max(max)

export const NpcRole = z.enum(['resident', 'passerby', 'guide', 'consultant', 'custom'])
export type NpcRole = z.infer<typeof NpcRole>

/** Shown on the name tag chip and dialogue header, and given to the AI as the NPC's role —
 *  hence here with the server-safe schema. */
export const NPC_ROLE_LABELS: Record<NpcRole, string> = {
  resident: '주민',
  passerby: '행인',
  guide: '안내원',
  consultant: '상담사',
  custom: '인물',
}

export const NpcBehaviorMode = z.enum(['stand', 'wander', 'patrol'])
export type NpcBehaviorMode = z.infer<typeof NpcBehaviorMode>

/** Walking pace: slow 0.9, normal 1.25, brisk 1.6 m/s. */
export const NpcSpeed = z.enum(['slow', 'normal', 'brisk'])
export type NpcSpeed = z.infer<typeof NpcSpeed>

export const DialogueAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('end') }),
  /** The NPC follows the player it is talking to. */
  z.object({ kind: z.literal('follow') }),
  z.object({ kind: z.literal('stopFollow') }),
  /** `@next` is the next room of the tour. */
  z.object({ kind: z.literal('guideTo'), room: z.union([NodeRef, z.literal('@next')]) }),
  /** No `room` describes the room the player stands in. */
  z.object({ kind: z.literal('describeRoom'), room: NodeRef.optional() }),
  z.object({ kind: z.literal('emote'), emote: EmoteRef }),
  z.object({ kind: z.literal('setFlag'), flag: LocalId, value: z.boolean().default(true) }),
  /** Switches the conversation to free-text AI chat. */
  z.object({ kind: z.literal('askAi') }),
])
export type DialogueAction = z.infer<typeof DialogueAction>

export const DialogueChoice = z.object({
  id: LocalId,
  label: Text(60).min(1),
  /** null ends the conversation. */
  next: LocalId.nullable().default(null),
  actions: z.array(DialogueAction).max(4).default([]),
  /** Flags that must be set for the choice to show. */
  requires: z.array(LocalId).max(4).default([]),
  hideIf: z.array(LocalId).max(4).default([]),
})
export type DialogueChoice = z.infer<typeof DialogueChoice>

export const DialogueLine = z.object({
  id: LocalId,
  /** Template text: `{player}`, `{npc}`, `{room}` … and josa suffixes like `{npc:이/가}`. */
  text: Text(300).min(1),
  emote: EmoteRef.optional(),
  onEnter: z.array(DialogueAction).max(4).default([]),
  choices: z.array(DialogueChoice).max(6).default([]),
  /** Appends one generated choice per room that guides the player there. */
  roomMenu: z.boolean().default(false),
  /** Where a line without choices continues; null ends the conversation. */
  next: LocalId.nullable().default(null),
})
export type DialogueLine = z.infer<typeof DialogueLine>

/** Lines may loop back (menus), but every id a line or choice names must exist. */
export const DialogueGraph = z
  .object({ start: LocalId, lines: z.array(DialogueLine).min(1).max(64) })
  .superRefine((graph, ctx) => {
    const ids = new Set<string>()
    graph.lines.forEach((line, i) => {
      if (ids.has(line.id)) {
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'id'], message: 'duplicate line id' })
      }
      ids.add(line.id)
    })
    const checkRef = (ref: string | null, path: (string | number)[]) => {
      if (ref !== null && !ids.has(ref)) {
        ctx.addIssue({ code: 'custom', path, message: `unknown line "${ref}"` })
      }
    }
    checkRef(graph.start, ['start'])
    graph.lines.forEach((line, i) => {
      checkRef(line.next, ['lines', i, 'next'])
      const choiceIds = new Set<string>()
      line.choices.forEach((choice, j) => {
        if (choiceIds.has(choice.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['lines', i, 'choices', j, 'id'],
            message: 'duplicate choice id',
          })
        }
        choiceIds.add(choice.id)
        checkRef(choice.next, ['lines', i, 'choices', j, 'next'])
      })
    })
  })
export type DialogueGraph = z.infer<typeof DialogueGraph>

export const NpcAi = z.object({
  enabled: z.boolean().default(false),
  /** 성격·말투·역할, written by the scene owner. */
  persona: Text(1200).default(''),
  /** 알려줄 정보 (prices, options, contacts …), written by the scene owner. */
  knowledge: Text(4000).default(''),
  /** First line when a conversation opens straight into AI chat. */
  greeting: Text(200).default(''),
  sceneScope: z.enum(['none', 'rooms', 'rooms-furniture']).default('rooms-furniture'),
  language: z.enum(['ko', 'en', 'auto']).default('ko'),
})
export type NpcAi = z.infer<typeof NpcAi>

export const NpcGreet = z.object({
  enabled: z.boolean().default(true),
  radius: z.number().min(1).max(8).default(3),
  emote: EmoteRef.default('wave'),
  barks: z.array(Text(80).min(1)).max(8).default([]),
  /** Seconds before the same player is greeted again. */
  cooldown: z.number().min(5).max(600).default(45),
})
export type NpcGreet = z.infer<typeof NpcGreet>

export const NpcBehavior = z.object({
  mode: NpcBehaviorMode.default('stand'),
  speed: NpcSpeed.default('normal'),
  wanderRadius: z.number().min(0.5).max(30).default(4),
  /** Rooms wandering may head for; empty = anywhere reachable. */
  rooms: z.array(NodeRef).max(16).default([]),
  /** Level-local XZ points. */
  patrol: z.array(Vec2).max(32).default([]),
  patrolLoop: z.enum(['loop', 'pingpong']).default('loop'),
  /** Seconds spent at each stop, min and max. */
  dwell: z.tuple([z.number().min(0).max(120), z.number().min(0).max(120)]).default([3, 10]),
  idleEmotes: z.array(EmoteRef).max(8).default(['lookAround']),
  lookAtPlayer: z.boolean().default(true),
  greet: NpcGreet.prefault({}),
  /**
   * Written once by the placement tool; 0 = derive from the id. Never drawn at
   * parse time: every client parses the node and must reach the same schedule.
   */
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31 - 1)
    .default(0),
})
export type NpcBehavior = z.infer<typeof NpcBehavior>

export const NpcInteraction = z.object({
  talkable: z.boolean().default(true),
  /** The E prompt after the name: "지아와 대화하기". */
  prompt: Text(20).default('대화하기'),
  range: z.number().min(1).max(5).default(2.5),
})
export type NpcInteraction = z.infer<typeof NpcInteraction>

export const NpcVoice = z.object({
  enabled: z.boolean().default(true),
  /** Multiplied onto the avatar's default pitch. */
  pitch: z.number().min(0.5).max(2).default(1),
  rate: z.number().min(0.5).max(2).default(1),
  /** 'auto' or a voice name / id of the speaking engine. */
  voice: z.string().max(64).default('auto'),
})
export type NpcVoice = z.infer<typeof NpcVoice>

/**
 * The avatar look as JSON (read with the editor's `readAvatarLook` at runtime),
 * without the face photo: scenes are public and a photo is both personal and big.
 */
export const NpcLook = z
  .record(z.string(), z.json())
  .refine((look) => JSON.stringify(look).length <= 16_384, 'look too large')
  .refine((look) => !JSON.stringify(look).includes('data:'), 'no embedded images')
export type NpcLook = z.infer<typeof NpcLook>

export const NpcNode = BaseNode.extend({
  id: objectId('npc'),
  type: nodeType('npc'),
  name: z.string().trim().min(1).max(24).default('주민'),
  role: NpcRole.default('resident'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  /** Yaw, like spawn. */
  rotation: z.number().default(0),
  avatar: z
    .string()
    .regex(/^[A-Za-z]+(_[A-Za-z]+)*_\d{2}$/)
    .default('Female_Adult_01'),
  look: NpcLook.nullable().default(null),
  showNameTag: z.boolean().default(true),
  behavior: NpcBehavior.prefault({}),
  interaction: NpcInteraction.prefault({}),
  dialogue: DialogueGraph.nullable().default(null),
  ai: NpcAi.prefault({}),
  voice: NpcVoice.prefault({}),
})
export type NpcNode = z.infer<typeof NpcNode>
export type NpcNodeInput = z.input<typeof NpcNode>

/** Rocketbox children (`Female_Child_01`, …): no hugs, a higher voice. */
export const isChildAvatar = (avatarId: string) => avatarId.includes('Child')
