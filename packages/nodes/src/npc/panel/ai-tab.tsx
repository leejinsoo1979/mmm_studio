'use client'

import {
  ActionButton,
  ActionGroup,
  cn,
  PanelSection,
  SegmentedControl,
  ToggleControl,
  triggerSFX,
} from '@pascal-app/editor'
import { MessageCircle, RotateCcw, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getNpcChatTransport } from '../dialogue/chat-transport'
import type { NpcAi, NpcNode } from '../schema'
import type { NpcChatErrorCode, NpcChatStatus, NpcChatTransport, NpcChatTurn } from '../types'
import { FieldLabel, Hint, TextAreaField } from './dialogue-line-card'
import { NpcVoiceSection } from './voice-section'

/** How long the server's answer on AI availability is trusted (ms), as in play. */
const STATUS_MS = 60_000
/** The route takes 600 characters a turn and 24 turns; the store keeps 500 and 12. */
const QUESTION_MAX = 500
const HISTORY_TURNS = 12
/** The route allows this many questions per conversation. */
const QUESTIONS_MAX = 20

const SCOPE_OPTIONS: { label: string; value: NpcAi['sceneScope'] }[] = [
  { label: '알려주지 않기', value: 'none' },
  { label: '방만', value: 'rooms' },
  { label: '방과 가구', value: 'rooms-furniture' },
]

const LANGUAGE_OPTIONS: { label: string; value: NpcAi['language'] }[] = [
  { label: '한국어', value: 'ko' },
  { label: '영어', value: 'en' },
  { label: '방문자 언어 따라', value: 'auto' },
]

const CHAT_ERRORS: Record<NpcChatErrorCode, string> = {
  unavailable:
    'AI가 답할 수 없어요. AI 대화를 켠 뒤 장면을 저장했는지 확인해 주세요. 서버는 저장된 장면의 설정을 읽어요.',
  rate_limited: '사용량 제한에 걸렸어요. 잠시 후 다시 물어봐 주세요.',
  refusal: 'AI가 이 질문에는 답하지 않았어요.',
  upstream: 'AI 서비스에서 오류가 났어요. 잠시 후 다시 물어봐 주세요.',
  network: '연결이 끊겼어요. 다시 물어봐 주세요.',
}

// ─── Server status ──────────────────────────────────────────────────

type StatusView =
  | { state: 'loading' }
  /** No transport, or the server didn't answer. */
  | { state: 'offline' }
  | { state: 'ready'; status: NpcChatStatus }

let statusCache: {
  transport: NpcChatTransport
  at: number
  status: Promise<NpcChatStatus | null>
} | null = null

function fetchStatus(transport: NpcChatTransport): Promise<NpcChatStatus | null> {
  const now = Date.now()
  if (!statusCache || statusCache.transport !== transport || now - statusCache.at > STATUS_MS) {
    statusCache = {
      transport,
      at: now,
      status: transport.status().catch(() => null),
    }
  }
  return statusCache.status
}

function useNpcChatStatus(): StatusView {
  const [view, setView] = useState<StatusView>({ state: 'loading' })
  useEffect(() => {
    const transport = getNpcChatTransport()
    if (!transport) {
      setView({ state: 'offline' })
      return
    }
    let live = true
    void fetchStatus(transport).then((status) => {
      if (live) setView(status ? { state: 'ready', status } : { state: 'offline' })
    })
    return () => {
      live = false
    }
  }, [])
  return view
}

/** Why the AI can't be switched on, and what the server owner sets to change that. */
function UnavailableHint({ view }: { view: StatusView }) {
  const reason = view.state === 'ready' ? view.status.reason : 'offline'
  const lead =
    reason === 'offline'
      ? 'AI 서버에 연결할 수 없어 대본 대화만 쓸 수 있어요.'
      : reason === 'disabled'
        ? '서버에서 AI 대화를 꺼 두어(NPC_AI_ENABLED=false) 대본 대화만 쓸 수 있어요.'
        : '서버에 AI 키가 설정되지 않아 대본 대화만 쓸 수 있어요.'
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed">
      <p>{lead}</p>
      {reason !== 'disabled' && reason !== 'offline' && (
        <>
          <p className="text-muted-foreground">
            서버 환경 변수에 아래를 넣고 서버를 다시 시작하면 켤 수 있어요.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
            <dt className="font-mono text-[10px] text-foreground">NPC_AI_PROVIDER</dt>
            <dd>openai(호환 API) 또는 anthropic</dd>
            <dt className="font-mono text-[10px] text-foreground">NPC_AI_BASE_URL</dt>
            <dd>API 주소 (비우면 기본 주소, 로컬 서버도 돼요)</dd>
            <dt className="font-mono text-[10px] text-foreground">NPC_AI_API_KEY</dt>
            <dd>API 키 (로컬 주소면 없어도 돼요)</dd>
            <dt className="font-mono text-[10px] text-foreground">NPC_AI_MODEL</dt>
            <dd>쓸 모델 이름</dd>
          </dl>
        </>
      )}
    </div>
  )
}

// ─── 미리 대화해보기 ─────────────────────────────────────────────────

/** A v4 UUID for the route; `crypto.randomUUID` needs a secure context (not a LAN dev server). */
function uuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The recent turns, opening with a question as the route expects. */
function history(turns: NpcChatTurn[]): NpcChatTurn[] {
  const recent = turns.slice(-HISTORY_TURNS)
  while (recent[0]?.role === 'assistant') recent.shift()
  return recent
}

/**
 * A test chat through the same route play uses. The route answers only the
 * scene's owner (or a published scene), and reads the saved scene, so changes
 * count once saved.
 */
function AiTestChat({ node }: { node: NpcNode }) {
  const [turns, setTurns] = useState<NpcChatTurn[]>([])
  const [reply, setReply] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const conversation = useRef<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const busy = reply !== null
  const questions = turns.filter((turn) => turn.role === 'user').length

  useEffect(() => () => request.current?.abort(), [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll as the reply grows
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [turns.length, reply])

  const restart = () => {
    request.current?.abort()
    request.current = null
    conversation.current = null
    setTurns([])
    setReply(null)
    setError(null)
  }

  const send = async () => {
    const text = draft.trim().slice(0, QUESTION_MAX)
    const transport = getNpcChatTransport()
    if (!text || busy || questions >= QUESTIONS_MAX) return
    if (!transport) {
      setError(CHAT_ERRORS.unavailable)
      return
    }
    triggerSFX('sfx:menu-click')
    const asked = [...turns, { role: 'user' as const, text }]
    const controller = new AbortController()
    request.current = controller
    setTurns(asked)
    setDraft('')
    setError(null)
    setReply('')
    conversation.current ??= uuid()
    let answer = ''
    const result = await transport
      .send(
        {
          npcId: node.id,
          conversationId: conversation.current,
          messages: history(asked),
          context: node.parentId ? { levelId: node.parentId } : {},
          signal: controller.signal,
        },
        (delta) => {
          if (request.current !== controller) return
          answer += delta
          setReply(answer)
        },
      )
      .catch(() => ({ ok: false as const, code: 'network' as const }))
    if (request.current !== controller) return
    request.current = null
    setReply(null)
    answer = answer.trim()
    if (result.ok && answer) {
      setTurns([...asked, { role: 'assistant', text: answer }])
      return
    }
    // Unanswered: the question is taken back so the history stays question, answer, question …
    setTurns(turns)
    setDraft(text)
    setError(CHAT_ERRORS[result.ok ? 'upstream' : result.code])
  }

  return (
    <>
      <div
        className="flex max-h-72 min-h-16 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border/50 bg-background/60 p-2"
        ref={log}
      >
        {node.ai.greeting && <ChatBubble from="npc" name={node.name} text={node.ai.greeting} />}
        {turns.map((turn, index) => (
          <ChatBubble
            from={turn.role === 'user' ? 'player' : 'npc'}
            key={index}
            name={node.name}
            text={turn.text}
          />
        ))}
        {busy && <ChatBubble from="npc" name={node.name} text={reply || '…'} />}
        {!node.ai.greeting && turns.length === 0 && !busy && (
          <span className="self-center text-[11px] text-muted-foreground">
            방문자처럼 물어보세요. 예: 여기 거실은 몇 평이에요?
          </span>
        )}
      </div>
      {error && <Hint tone="warn">{error}</Hint>}
      <div className="flex items-center gap-1">
        <input
          className="h-9 min-w-0 flex-1 rounded-lg border border-border/50 bg-muted px-3 text-foreground text-sm outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-foreground/30 disabled:opacity-50"
          disabled={questions >= QUESTIONS_MAX}
          maxLength={QUESTION_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
            e.stopPropagation()
          }}
          placeholder={
            questions >= QUESTIONS_MAX ? '대화가 길어졌어요. 다시 시작해 주세요.' : '물어볼 말'
          }
          type="text"
          value={draft}
        />
        <button
          aria-label="보내기"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          disabled={busy || !draft.trim()}
          onClick={() => void send()}
          type="button"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
      {(turns.length > 0 || error) && (
        <ActionButton
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label="새 대화로"
          onClick={restart}
        />
      )}
    </>
  )
}

function ChatBubble({ from, name, text }: { from: 'npc' | 'player'; name: string; text: string }) {
  return (
    <p
      className={cn(
        'max-w-[90%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
        from === 'npc' ? 'self-start bg-muted' : 'self-end bg-sky-500/20',
      )}
    >
      {from === 'npc' && <span className="mr-1 font-semibold">{name}</span>}
      {text}
    </p>
  )
}

// ─── The tab ────────────────────────────────────────────────────────

export default function NpcAiTab({
  node,
  update,
}: {
  node: NpcNode
  update: (patch: Partial<NpcNode>) => void
}) {
  const { ai } = node
  const view = useNpcChatStatus()
  const [testing, setTesting] = useState(false)
  const setAi = (patch: Partial<NpcAi>) => update({ ai: { ...ai, ...patch } })

  const unavailable = view.state === 'offline' || (view.state === 'ready' && !view.status.available)
  // Switching on needs the server; switching off never does (the setting is kept either way).
  const locked = unavailable && !ai.enabled
  const asksAi =
    node.dialogue?.lines.some((line) =>
      line.choices.some((choice) => choice.actions.some((action) => action.kind === 'askAi')),
    ) ?? false

  return (
    <>
      <PanelSection title="AI 대화">
        <div
          aria-disabled={locked}
          className={cn(locked && 'pointer-events-none opacity-50')}
          title={locked ? '서버에 AI가 설정되지 않았어요' : undefined}
        >
          <ToggleControl
            checked={ai.enabled}
            label="AI 대화 사용"
            onChange={(enabled) => {
              if (enabled && unavailable) return
              setAi({ enabled })
            }}
          />
        </div>
        {view.state === 'loading' && <FieldLabel>서버에 AI가 켜져 있는지 확인하는 중…</FieldLabel>}
        {unavailable && <UnavailableHint view={view} />}
        {unavailable && ai.enabled && (
          <Hint>
            켜 둔 설정은 그대로 남아요. 지금은 플레이에서 대본 대화로 대신하고, 서버에 AI가 설정되면
            바로 쓰여요.
          </Hint>
        )}
        {!unavailable && ai.enabled && (
          <Hint>
            {node.dialogue === null
              ? '대본이 없어서 말을 걸면 바로 AI 대화가 시작돼요.'
              : asksAi
                ? "대본에서 'AI 자유 대화로' 행동이 있는 선택지를 고르면 AI 대화로 넘어가요."
                : "대본에 'AI 자유 대화로' 행동이 있는 선택지가 없어서 AI 대화로 넘어갈 수 없어요. 대화 탭에서 선택지에 추가해 보세요."}
          </Hint>
        )}
      </PanelSection>

      <PanelSection title="성격과 지식">
        <FieldLabel>성격·말투</FieldLabel>
        <TextAreaField
          maxLength={1200}
          onCommit={(persona) => setAi({ persona })}
          placeholder="예: 밝고 친절한 존댓말을 쓰는 모델하우스 안내원이에요."
          rows={3}
          value={ai.persona}
        />
        <FieldLabel>알려줄 정보</FieldLabel>
        <TextAreaField
          maxLength={4000}
          onCommit={(knowledge) => setAi({ knowledge })}
          placeholder="분양가, 옵션, 일정, 연락처처럼 방문자에게 알려 줄 내용을 적어 주세요."
          rows={5}
          value={ai.knowledge}
        />
        <Hint>
          AI는 여기와 집 정보에 적힌 것만 근거로 답해요. 적혀 있지 않은 가격·일정은 모른다고 하고
          담당자 문의를 권해요.
        </Hint>
        <FieldLabel>첫 인사</FieldLabel>
        <TextAreaField
          maxLength={200}
          onCommit={(greeting) => setAi({ greeting })}
          placeholder="안녕하세요! 무엇이든 물어보세요."
          value={ai.greeting}
        />
        <FieldLabel>AI에게 알려줄 집 정보</FieldLabel>
        <SegmentedControl
          onChange={(sceneScope) => setAi({ sceneScope })}
          options={SCOPE_OPTIONS}
          value={ai.sceneScope}
        />
        <FieldLabel>답하는 언어</FieldLabel>
        <SegmentedControl
          onChange={(language) => setAi({ language })}
          options={LANGUAGE_OPTIONS}
          value={ai.language}
        />
      </PanelSection>

      {view.state === 'ready' && view.status.available && (
        <PanelSection title="미리 대화해보기">
          <Hint>
            장면 주인만 쓸 수 있는 시험 대화예요. 저장된 장면의 설정으로 답하니, 바꾼 내용은 저장한
            뒤에 반영돼요.
          </Hint>
          {!ai.enabled ? (
            <FieldLabel>AI 대화 사용을 켜야 시험할 수 있어요.</FieldLabel>
          ) : testing ? (
            <AiTestChat node={node} />
          ) : (
            <ActionGroup>
              <ActionButton
                icon={<MessageCircle className="h-3.5 w-3.5" />}
                label="미리 대화해보기"
                onClick={() => {
                  triggerSFX('sfx:menu-click')
                  setTesting(true)
                }}
              />
            </ActionGroup>
          )}
        </PanelSection>
      )}

      <NpcVoiceSection
        engine={view.state === 'ready' ? view.status.voice : null}
        node={node}
        update={update}
      />

      <div className="px-4 py-3 text-[11px] text-muted-foreground leading-relaxed">
        AI 대화 요금: 대화 1번에 약 ₩10 내외 (모델·길이에 따라 다름). 서버에 설정한 AI 서비스
        계정으로 청구되고, 미리 대화해보기도 같아요. 하루 한도는 서버의 NPC_AI_DAILY_LIMIT로 정해요.
      </div>
    </>
  )
}
