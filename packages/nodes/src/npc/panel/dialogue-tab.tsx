'use client'

import { useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  cn,
  EMOTES,
  isEmoteId,
  PanelSection,
  SliderControl,
  ToggleControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  choose,
  type DialogueContext,
  type DialogueEffect,
  enter,
  type RenderedLine,
  roomAt,
} from '../dialogue/engine'
import { dayPartKo, sceneVars } from '../dialogue/templates'
import { withJosa } from '../josa'
import { collectSceneFacts, getNpcNameResolvers } from '../knowledge'
import { NPC_DIALOGUE_TEMPLATES, type NpcDialogueTemplateId, npcDialogueTemplate } from '../presets'
import { npcTalkLabel } from '../runtime/interaction'
import { DialogueGraph, type DialogueLine, type NpcInteraction, type NpcNode } from '../schema'
import type { SceneFacts } from '../types'
import { TextField } from './basic-tab'
import {
  DialogueLineCard,
  FieldLabel,
  Hint,
  lineLabel,
  type RoomOption,
} from './dialogue-line-card'

const MAX_LINES = 64
const GUEST = '손님'

/** Room facts without the app's Korean item names when it gave none. */
const PLAIN_NAMES = {
  item: (asset: { name: string }) => asset.name,
  material: (ref: string) => ref,
}

const readFacts = (): SceneFacts =>
  collectSceneFacts(useScene.getState().nodes, getNpcNameResolvers() ?? PLAIN_NAMES)

const BLANK_GRAPH = {
  start: 'hello',
  lines: [
    {
      id: 'hello',
      text: '안녕하세요, {player}님!',
      choices: [{ id: 'bye', label: '안녕히 계세요' }],
    },
  ],
}

function newLineId(graph: DialogueGraph): string {
  const taken = new Set(graph.lines.map((line) => line.id))
  let n = graph.lines.length + 1
  while (taken.has(`line-${n}`)) n++
  return `line-${n}`
}

/** The graph without line `id`; whatever led there now ends the talk. */
function withoutLine(graph: DialogueGraph, id: string): DialogueGraph {
  const lines = graph.lines
    .filter((line) => line.id !== id)
    .map((line) => ({
      ...line,
      next: line.next === id ? null : line.next,
      choices: line.choices.map((choice) =>
        choice.next === id ? { ...choice, next: null } : choice,
      ),
    }))
  const first = lines[0]
  return { start: graph.start === id && first ? first.id : graph.start, lines }
}

function collectFlags(graph: DialogueGraph | null): string[] {
  const flags = new Set<string>()
  for (const line of graph?.lines ?? []) {
    const actions = [...line.onEnter, ...line.choices.flatMap((choice) => choice.actions)]
    for (const action of actions) if (action.kind === 'setFlag') flags.add(action.flag)
    for (const choice of line.choices)
      for (const flag of [...choice.requires, ...choice.hideIf]) {
        flags.add(flag)
      }
  }
  return [...flags].sort()
}

// ─── 미리 해보기 ─────────────────────────────────────────────────────

type PreviewEntry = { from: 'npc' | 'player' | 'note'; text: string }

type PreviewState = {
  entries: PreviewEntry[]
  line: RenderedLine | null
  flags: Set<string>
  visited: string[]
  /** Where the player stands; a guide's tour moves it. */
  roomId: string | null
  ended: boolean
}

/** The in-game hour, as the conversation reads it. */
function clockHour(): number {
  const { sunTime, sceneTheme } = useViewer.getState()
  return sceneTheme === 'night' ? (sunTime + 12) % 24 : sunTime
}

/**
 * The script played inside the panel with the engine the game uses: the
 * player stands next to the NPC, and a guide's tour "arrives" at once.
 */
function DialoguePreview({ node, graph }: { node: NpcNode; graph: DialogueGraph }) {
  const [state, setState] = useState<PreviewState | null>(null)
  const scene = useRef<{ facts: SceneFacts; tourStart: string | null } | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const levelId = node.parentId

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on each new entry
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [state?.entries.length])

  const context = (s: Pick<PreviewState, 'flags' | 'visited' | 'roomId'>): DialogueContext => {
    const facts = scene.current?.facts ?? null
    return {
      flags: s.flags,
      facts,
      levelId,
      roomId: s.roomId,
      tourStart: scene.current?.tourStart ?? null,
      visited: s.visited,
      vars: {
        player: GUEST,
        npc: node.name,
        time: dayPartKo(clockHour()),
        ...sceneVars(facts, levelId, s.roomId),
      },
    }
  }

  /** The effects as the transcript tells them; `end` ends the preview. */
  const apply = (effects: DialogueEffect[], s: PreviewState): PreviewState => {
    const entries = [...s.entries]
    let { roomId, visited, ended } = s
    const note = (text: string) => entries.push({ from: 'note', text })
    for (const effect of effects) {
      switch (effect.kind) {
        case 'say':
          entries.push({ from: 'npc', text: effect.text })
          break
        case 'follow':
          note('플레이어를 따라오기 시작해요')
          break
        case 'stopFollow':
          note('따라오기를 멈춰요')
          break
        case 'askAi':
          note(
            node.ai.enabled
              ? 'AI 자유 대화로 넘어가요 (AI 탭의 미리 대화해보기로 시험해 보세요)'
              : 'AI 자유 대화로 넘어가려 하지만 AI가 꺼져 있어요',
          )
          break
        case 'emote':
          note(`${isEmoteId(effect.id) ? EMOTES[effect.id].label : effect.id} 동작`)
          break
        case 'guideTo': {
          const room = scene.current?.facts.rooms.find((r) => r.id === effect.roomId)
          note(
            `${room ? withJosa(room.name, '으로', '로') : '그 방으로'} 안내해요 (도착한 셈 칠게요)`,
          )
          roomId = effect.roomId
          if (!visited.includes(effect.roomId)) visited = [...visited, effect.roomId]
          break
        }
        case 'end':
          ended = true
          break
      }
    }
    return { ...s, entries, roomId, visited, ended }
  }

  const finish = (s: PreviewState): PreviewState => ({
    ...s,
    line: null,
    ended: true,
    entries: [...s.entries, { from: 'note', text: '대화가 끝났어요' }],
  })

  const goTo = (lineId: string | null, s: PreviewState): PreviewState => {
    if (lineId === null || s.ended) return finish(s)
    const result = enter(graph, lineId, context(s))
    if (!result) return finish(s)
    const emote = result.line.emote && isEmoteId(result.line.emote) ? result.line.emote : null
    const said: PreviewState = {
      ...s,
      flags: result.flags,
      line: result.line,
      entries: [
        ...s.entries,
        {
          from: 'npc',
          text: emote ? `${result.line.text} (${EMOTES[emote].label})` : result.line.text,
        },
      ],
    }
    const next = apply(result.effects, said)
    return next.ended ? finish(next) : next
  }

  const start = () => {
    triggerSFX('sfx:menu-click')
    const facts = readFacts()
    const npcSpot: [number, number] = [node.position[0], node.position[2]]
    const spawn = Object.values(useScene.getState().nodes).find(
      (n) => n.type === 'spawn' && n.parentId === levelId,
    )
    const from: [number, number] =
      spawn?.type === 'spawn' ? [spawn.position[0], spawn.position[2]] : npcSpot
    scene.current = { facts, tourStart: roomAt(facts, levelId, from)?.id ?? null }
    const initial: PreviewState = {
      entries: [],
      line: null,
      flags: new Set(),
      visited: [],
      roomId: roomAt(facts, levelId, npcSpot)?.id ?? null,
      ended: false,
    }
    setState(goTo(graph.start, initial))
  }

  const pick = (choiceId: string, label: string) => {
    if (!state?.line) return
    triggerSFX('sfx:menu-click')
    const result = choose(graph, state.line.id, choiceId, context(state))
    if (!result) return
    const said = apply(result.effects, {
      ...state,
      flags: result.flags,
      entries: [...state.entries, { from: 'player', text: result.label || label }],
    })
    setState(goTo(result.next, said))
  }

  const proceed = () => {
    if (!state?.line) return
    triggerSFX('sfx:menu-click')
    setState(goTo(state.line.next, state))
  }

  if (!state) {
    return (
      <>
        <FieldLabel>3D 없이 이 창에서 대본을 처음부터 따라가 봐요.</FieldLabel>
        <ActionButton icon={<Play className="h-3.5 w-3.5" />} label="미리 해보기" onClick={start} />
      </>
    )
  }

  const line = state.line
  return (
    <>
      <div
        className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border/50 bg-background/60 p-2"
        ref={log}
      >
        {state.entries.map((entry, index) => (
          <p
            className={cn(
              'max-w-[90%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
              entry.from === 'npc' && 'self-start bg-muted text-foreground',
              entry.from === 'player' && 'self-end bg-sky-500/20 text-foreground',
              entry.from === 'note' &&
                'self-center bg-transparent px-0 py-0 text-[11px] text-muted-foreground',
            )}
            key={index}
          >
            {entry.from === 'npc' && <span className="mr-1 font-semibold">{node.name}</span>}
            {entry.text}
          </p>
        ))}
      </div>
      {line && !state.ended && (
        <div className="flex flex-col gap-1">
          {line.choices.map((choice, index) => (
            <button
              className="flex min-h-8 items-center gap-2 rounded-lg border border-border/50 bg-muted px-2.5 py-1 text-left text-xs transition-colors hover:bg-accent"
              key={choice.id}
              onClick={() => pick(choice.id, choice.label)}
              type="button"
            >
              <span className="font-semibold text-muted-foreground">{index + 1}</span>
              <span className="flex-1">{choice.label}</span>
              {choice.askAi && (
                <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] text-violet-500">
                  AI
                </span>
              )}
            </button>
          ))}
          {line.choices.length === 0 && (
            <ActionButton label={line.next ? '다음 ▸' : '대화 끝'} onClick={proceed} />
          )}
          {!node.ai.enabled && line.choices.some((choice) => choice.askAi) && (
            <Hint>AI가 꺼져 있어서 플레이에서는 AI 표시가 붙은 선택지가 숨겨져요.</Hint>
          )}
        </div>
      )}
      {state.flags.size > 0 && (
        <FieldLabel>지금 켜진 표시: {[...state.flags].join(', ')}</FieldLabel>
      )}
      <ActionGroup>
        <ActionButton
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label="처음부터"
          onClick={start}
        />
        <ActionButton label="닫기" onClick={() => setState(null)} />
      </ActionGroup>
    </>
  )
}

// ─── The tab ────────────────────────────────────────────────────────

export default function NpcDialogueTab({
  node,
  update,
}: {
  node: NpcNode
  update: (patch: Partial<NpcNode>) => void
}) {
  const { interaction, dialogue: graph } = node
  const levelId = node.parentId
  const flagListId = useId()
  const [pendingTemplate, setPendingTemplate] = useState<NpcDialogueTemplateId | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [openLine, setOpenLine] = useState<string | null>(null)

  const setInteraction = (patch: Partial<NpcInteraction>) =>
    update({ interaction: { ...interaction, ...patch } })

  /** Stores the script only when it is valid: every id it names exists. */
  const setGraph = (next: DialogueGraph | null) => {
    if (next === null) {
      update({ dialogue: null })
      return
    }
    const parsed = DialogueGraph.safeParse(next)
    if (parsed.success) update({ dialogue: parsed.data })
  }

  // Read once per level: rooms don't change while an NPC is selected, and the facts walk the scene.
  const rooms: RoomOption[] = useMemo(
    () =>
      readFacts()
        .rooms.filter((room) => room.levelId === levelId)
        .map((room) => ({ id: room.id, name: room.name })),
    [levelId],
  )
  const flags = useMemo(() => collectFlags(graph), [graph])

  const applyTemplate = (id: NpcDialogueTemplateId) => {
    triggerSFX('sfx:menu-click')
    setPendingTemplate(null)
    setOpenLine(null)
    setGraph(npcDialogueTemplate(id))
  }

  const setLine = (index: number, line: DialogueLine) => {
    if (!graph) return
    setGraph({ ...graph, lines: graph.lines.map((l, i) => (i === index ? line : l)) })
  }

  const addLine = () => {
    if (!graph || graph.lines.length >= MAX_LINES) return
    triggerSFX('sfx:menu-click')
    const id = newLineId(graph)
    setOpenLine(id)
    setGraph({
      ...graph,
      lines: [
        ...graph.lines,
        { id, text: '네, 말씀하세요.', onEnter: [], choices: [], roomMenu: false, next: null },
      ],
    })
  }

  const lineOptions = (graph?.lines ?? []).map((line, index) => ({
    label: lineLabel(line, index),
    value: line.id,
  }))

  return (
    <>
      <PanelSection title="말 걸기">
        <ToggleControl
          checked={interaction.talkable}
          label="말 걸기 허용"
          onChange={(talkable) => setInteraction({ talkable })}
        />
        {interaction.talkable ? (
          <>
            <TextField
              label="E 안내 문구"
              maxLength={20}
              onCommit={(prompt) => setInteraction({ prompt })}
              value={interaction.prompt}
            />
            <div className="flex items-center gap-2 px-1 text-muted-foreground text-xs">
              <kbd className="rounded border border-border/60 bg-muted px-1.5 font-mono text-[10px] text-foreground">
                E
              </kbd>
              {npcTalkLabel(node.name, interaction.prompt, false)}
            </div>
            <SliderControl
              label="말 걸 수 있는 거리"
              max={5}
              min={1}
              onChange={(range) => setInteraction({ range })}
              precision={1}
              step={0.5}
              unit="m"
              value={interaction.range}
            />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-1 text-muted-foreground text-xs">
              <kbd className="rounded border border-border/60 bg-muted px-1.5 font-mono text-[10px] text-foreground">
                E
              </kbd>
              {npcTalkLabel(node.name, interaction.prompt, false, false)}
            </div>
            <Hint>
              말 걸기를 끄면 대화 대신 어울리기 메뉴만 열리고, 다가오면 인사말을 해요. 대본은
              지워지지 않아요.
            </Hint>
          </>
        )}
      </PanelSection>

      <PanelSection title="템플릿으로 시작">
        <ActionGroup>
          {NPC_DIALOGUE_TEMPLATES.map((template) => (
            <ActionButton
              className={cn(pendingTemplate === template.id && 'border-sky-500')}
              key={template.id}
              label={template.label}
              onClick={() => (graph ? setPendingTemplate(template.id) : applyTemplate(template.id))}
            />
          ))}
        </ActionGroup>
        {pendingTemplate && (
          <>
            <Hint tone="warn">지금 대본이 템플릿으로 바뀌어요. 계속할까요?</Hint>
            <ActionGroup>
              <ActionButton label="바꾸기" onClick={() => applyTemplate(pendingTemplate)} />
              <ActionButton label="그만두기" onClick={() => setPendingTemplate(null)} />
            </ActionGroup>
          </>
        )}
      </PanelSection>

      <PanelSection title="대본">
        {graph ? (
          <>
            <Hint>
              대사에 {'{player}'}(방문자 이름), {'{npc}'}(이 인물 이름), {'{room}'}(지금 방),{' '}
              {'{time}'}(아침·오후·저녁)을 넣을 수 있어요. {'{npc:이/가}'}처럼 쓰면 조사가 맞춰져요.
            </Hint>
            <datalist id={flagListId}>
              {flags.map((flag) => (
                <option key={flag} value={flag} />
              ))}
            </datalist>
            {graph.lines.map((line, index) => (
              <DialogueLineCard
                defaultOpen={line.id === openLine || graph.lines.length === 1}
                index={index}
                isStart={line.id === graph.start}
                key={line.id}
                knownFlags={flagListId}
                line={line}
                lineOptions={lineOptions}
                onChange={(next) => setLine(index, next)}
                onMakeStart={() => setGraph({ ...graph, start: line.id })}
                onRemove={
                  graph.lines.length > 1 ? () => setGraph(withoutLine(graph, line.id)) : undefined
                }
                rooms={rooms}
              />
            ))}
            <ActionGroup>
              <ActionButton
                className="disabled:pointer-events-none disabled:opacity-40"
                disabled={graph.lines.length >= MAX_LINES}
                icon={<Plus className="h-3.5 w-3.5" />}
                label="대사 추가"
                onClick={addLine}
              />
              <ActionButton
                className="hover:bg-red-500/20"
                icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
                label="대본 지우기"
                onClick={() => setConfirmClear(true)}
              />
            </ActionGroup>
            {confirmClear && (
              <>
                <Hint tone="warn">대사 {graph.lines.length}개가 모두 지워져요. 계속할까요?</Hint>
                <ActionGroup>
                  <ActionButton
                    label="지우기"
                    onClick={() => {
                      triggerSFX('sfx:structure-delete')
                      setConfirmClear(false)
                      setGraph(null)
                    }}
                  />
                  <ActionButton label="그만두기" onClick={() => setConfirmClear(false)} />
                </ActionGroup>
              </>
            )}
          </>
        ) : (
          <>
            <Hint>
              아직 대본이 없어요. 말을 걸면{' '}
              {node.ai.enabled ? '바로 AI 대화가 시작돼요' : '인사말 하나만 하고 끝나요'}.
              템플릿으로 시작하거나 빈 대본을 만들어 보세요.
            </Hint>
            <ActionButton
              icon={<Plus className="h-3.5 w-3.5" />}
              label="빈 대본 만들기"
              onClick={() => {
                triggerSFX('sfx:menu-click')
                setGraph(DialogueGraph.parse(BLANK_GRAPH))
              }}
            />
          </>
        )}
      </PanelSection>

      {graph && (
        <PanelSection title="미리 해보기">
          <DialoguePreview graph={graph} node={node} />
        </PanelSection>
      )}
    </>
  )
}
