import type { z } from 'zod'
import { DialogueGraph, type NpcNodeInput, type NpcRole } from './schema'

/** Marker colour per role (2D plan marker, name tag chip). */
export const NPC_ROLE_COLORS: Record<NpcRole, string> = {
  resident: '#14b8a6',
  passerby: '#64748b',
  guide: '#f59e0b',
  consultant: '#8b5cf6',
  custom: '#0ea5e9',
}

export type NpcDialogueTemplateId = 'smallTalk' | 'tour' | 'consult'

type DialogueGraphInput = z.input<typeof DialogueGraph>

const SMALL_TALK: DialogueGraphInput = {
  start: 'hello',
  lines: [
    {
      id: 'hello',
      text: '안녕하세요, {player}님! 오늘 날씨 참 좋죠?',
      emote: 'wave',
      choices: [
        { id: 'weather', label: '날씨 이야기를 해요', next: 'weather' },
        { id: 'house', label: '집이 참 예뻐요', next: 'house' },
        {
          id: 'follow',
          label: '같이 가요',
          next: 'follow',
          actions: [{ kind: 'follow' }, { kind: 'setFlag', flag: 'following' }],
          hideIf: ['following'],
        },
        {
          id: 'stop',
          label: '이제 안 따라와도 돼요',
          next: 'stop',
          actions: [{ kind: 'stopFollow' }, { kind: 'setFlag', flag: 'following', value: false }],
          requires: ['following'],
        },
        { id: 'bye', label: '안녕히 계세요' },
      ],
    },
    {
      id: 'weather',
      text: '{time}에는 창가에 앉아 바깥 구경하기 딱 좋아요.',
      emote: 'stretch',
      next: 'more',
    },
    {
      id: 'house',
      text: '그렇죠? 저도 이 집이 참 마음에 들어요. 천천히 둘러보세요.',
      emote: 'nod',
      next: 'more',
    },
    {
      id: 'more',
      text: '또 이야기 나눌까요?',
      choices: [
        {
          id: 'follow',
          label: '같이 가요',
          next: 'follow',
          actions: [{ kind: 'follow' }, { kind: 'setFlag', flag: 'following' }],
          hideIf: ['following'],
        },
        { id: 'bye', label: '이만 가 볼게요' },
      ],
    },
    { id: 'follow', text: '좋아요, 따라갈게요!', emote: 'nod' },
    { id: 'stop', text: '알겠어요. 여기서 쉬고 있을게요.', emote: 'wave' },
  ],
}

const TOUR: DialogueGraphInput = {
  start: 'welcome',
  lines: [
    {
      id: 'welcome',
      text: '어서 오세요! 저는 이 집을 안내해 드릴 {npc:이에요/예요}. 무엇을 도와드릴까요?',
      emote: 'wave',
      choices: [
        {
          id: 'here',
          label: '여기 소개해 주세요',
          next: 'menu',
          actions: [{ kind: 'describeRoom' }],
        },
        { id: 'rooms', label: '방을 안내해 주세요', next: 'rooms' },
        {
          id: 'tour',
          label: '처음부터 둘러볼래요',
          next: 'lead',
          actions: [{ kind: 'guideTo', room: '@next' }],
        },
        { id: 'ask', label: '궁금한 게 있어요', next: 'menu', actions: [{ kind: 'askAi' }] },
        { id: 'bye', label: '혼자 둘러볼게요' },
      ],
    },
    {
      id: 'menu',
      text: '또 어디를 보여 드릴까요?',
      choices: [
        {
          id: 'next',
          label: '다음 방으로 가요',
          next: 'lead',
          actions: [{ kind: 'guideTo', room: '@next' }],
        },
        { id: 'rooms', label: '방 목록을 보여 주세요', next: 'rooms' },
        { id: 'ask', label: '궁금한 게 있어요', next: 'menu', actions: [{ kind: 'askAi' }] },
        { id: 'bye', label: '고마워요, 혼자 볼게요' },
      ],
    },
    {
      id: 'rooms',
      text: '어느 방으로 가 볼까요?',
      roomMenu: true,
      choices: [{ id: 'back', label: '다음에 볼게요', next: 'menu' }],
    },
    { id: 'lead', text: '이쪽으로 오세요!', emote: 'present', next: 'menu' },
  ],
}

const CONSULT: DialogueGraphInput = {
  start: 'hello',
  lines: [
    {
      id: 'hello',
      text: '안녕하세요, 분양 상담을 맡은 {npc:이에요/예요}. 어떤 걸 도와드릴까요?',
      emote: 'nod',
      choices: [
        { id: 'consult', label: '상담 시작', next: 'more', actions: [{ kind: 'askAi' }] },
        { id: 'facts', label: '자료 보기', next: 'more', actions: [{ kind: 'describeRoom' }] },
        { id: 'bye', label: '다음에 올게요' },
      ],
    },
    {
      id: 'more',
      text: '더 궁금한 점이 있으면 편하게 물어보세요.',
      choices: [
        { id: 'consult', label: '상담 시작', next: 'more', actions: [{ kind: 'askAi' }] },
        { id: 'bye', label: '고마워요' },
      ],
    },
  ],
}

const TEMPLATE_GRAPHS: Record<NpcDialogueTemplateId, DialogueGraphInput> = {
  smallTalk: SMALL_TALK,
  tour: TOUR,
  consult: CONSULT,
}

/** "템플릿으로 시작" in the dialogue tab, and the presets' graphs. */
export const NPC_DIALOGUE_TEMPLATES: readonly { id: NpcDialogueTemplateId; label: string }[] = [
  { id: 'smallTalk', label: '주민 잡담' },
  { id: 'tour', label: '안내 투어' },
  { id: 'consult', label: '상담' },
]

/** A fresh copy of a template graph, safe to store on a node. */
export function npcDialogueTemplate(id: NpcDialogueTemplateId): DialogueGraph {
  return DialogueGraph.parse(TEMPLATE_GRAPHS[id])
}

export type NpcPresetId = 'resident' | 'passerby' | 'guide' | 'consultant'

export type NpcPreset = {
  id: NpcPresetId
  /** Build-tab card title (also the first NPC's name). */
  label: string
  description: string
  /** Fields for `NpcNode.parse`; the tool adds the position, facing, seed and a unique name. */
  fields: NpcNodeInput
}

/** The build tab's "사람 (NPC)" cards. */
export const NPC_PRESETS: readonly NpcPreset[] = [
  {
    id: 'resident',
    label: '주민',
    description: '집 안을 돌아다니며 인사해요',
    fields: {
      name: '주민',
      role: 'resident',
      avatar: 'Female_Adult_03',
      behavior: {
        mode: 'wander',
        wanderRadius: 4,
        idleEmotes: ['lookAround', 'stretch', 'yawn', 'drink'],
        greet: { barks: ['안녕하세요!', '좋은 하루 보내세요', '날씨 참 좋네요'] },
      },
      dialogue: SMALL_TALK,
    },
  },
  {
    id: 'passerby',
    label: '행인',
    description: '정해진 길을 따라 걸어요',
    fields: {
      name: '행인',
      role: 'passerby',
      avatar: 'Male_Adult_05',
      behavior: {
        mode: 'patrol',
        speed: 'brisk',
        greet: { barks: ['안녕하세요~', '잠시 지나갈게요'] },
      },
      interaction: { talkable: false },
    },
  },
  {
    id: 'guide',
    label: '안내원',
    description: '방을 소개하고 안내해요',
    fields: {
      name: '안내원',
      role: 'guide',
      avatar: 'Business_Female_01',
      behavior: {
        mode: 'stand',
        lookAtPlayer: true,
        greet: { emote: 'wave', barks: ['어서 오세요!', '편하게 둘러보세요'] },
      },
      dialogue: TOUR,
      ai: {
        enabled: true,
        persona:
          '모델하우스 안내원입니다. 밝고 친절한 존댓말로 방문자에게 집 구석구석을 소개합니다.',
        greeting: '안녕하세요! 이 집을 안내해 드릴게요. 궁금한 걸 물어보세요.',
      },
    },
  },
  {
    id: 'consultant',
    label: '상담사',
    description: '분양 상담에 답해요',
    fields: {
      name: '상담사',
      role: 'consultant',
      avatar: 'Business_Male_02',
      behavior: { mode: 'stand', lookAtPlayer: true, greet: { barks: ['상담 도와드릴게요'] } },
      dialogue: CONSULT,
      ai: {
        enabled: true,
        persona: '분양 상담사입니다. 차분하고 믿음직한 존댓말로 분양 관련 질문에 답합니다.',
        knowledge:
          '분양가, 옵션, 계약 일정은 아직 정해지지 않았습니다. 자세한 내용은 현장 담당자에게 문의해 주세요.',
        greeting: '안녕하세요, 분양 상담을 도와드릴게요. 무엇이 궁금하세요?',
      },
    },
  },
]

export const getNpcPreset = (id: string): NpcPreset | undefined =>
  NPC_PRESETS.find((preset) => preset.id === id)
