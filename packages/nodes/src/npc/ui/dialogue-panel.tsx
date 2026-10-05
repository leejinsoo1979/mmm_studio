'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { avatarThumbnailUrl, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Undo2, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useReducer, useRef } from 'react'
import { NPC_TYPE_MS_PER_CHAR, useNpcDialogue } from '../dialogue/store'
import { withJosa } from '../josa'
import { NPC_ROLE_COLORS } from '../presets'
import { useNpcRuntime } from '../runtime/store'
import { NPC_ROLE_LABELS, type NpcNode } from '../schema'
import { setNpcVoiceMuted, stopNpcSpeech, useNpcVoiceMuted } from '../voice/engine'
import { AiInput } from './ai-input'
import { ChoiceList, choiceKeyIndex, isTypingTarget, useNpcKeyCapture } from './choice-list'

/** `text` as far as the typewriter has got since `since` (0 shows it whole). */
function useTypewriter(text: string | null, since: number): string {
  const [, redraw] = useReducer((frame: number) => frame + 1, 0)
  useEffect(() => {
    if (!(text && since)) return
    let frame = 0
    const tick = () => {
      redraw()
      if (Date.now() - since < text.length * NPC_TYPE_MS_PER_CHAR) {
        frame = requestAnimationFrame(tick)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text, since])
  if (!text) return ''
  if (!since) return text
  const chars = Math.floor((Date.now() - since) / NPC_TYPE_MS_PER_CHAR)
  return chars >= text.length ? text : Array.from(text).slice(0, chars).join('')
}

function pick(choiceId: string) {
  triggerSFX('sfx:menu-click')
  useNpcDialogue.getState().choose(choiceId)
}

function Transcript() {
  const transcript = useNpcDialogue((state) => state.transcript)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = scroller.current
    if (element && transcript.length > 0) element.scrollTop = element.scrollHeight
  }, [transcript])
  if (transcript.length === 0) return null
  return (
    <div
      className="flex max-h-32 flex-col gap-1 overflow-y-auto pr-1 text-[13px] leading-snug"
      ref={scroller}
    >
      {transcript.map((entry, index) =>
        entry.from === 'player' ? (
          <p
            className="max-w-[85%] self-end rounded-xl rounded-br-sm bg-white/15 px-2.5 py-1 text-white/85"
            key={index}
          >
            {entry.text}
          </p>
        ) : (
          <p className="max-w-[85%] text-white/55" key={index}>
            {entry.text}
          </p>
        ),
      )}
    </div>
  )
}

function Header({ node }: { node: NpcNode }) {
  const muted = useNpcVoiceMuted()
  const aiOn = useNpcDialogue((state) => node.ai.enabled && state.aiStatus?.available === true)
  const iconButton =
    'flex size-8 shrink-0 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white'
  return (
    <div className="flex items-center gap-2.5">
      <img
        alt=""
        className="size-9 shrink-0 rounded-full bg-white/10 object-cover"
        src={avatarThumbnailUrl(node.avatar)}
      />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate font-medium text-sm">{node.name}</span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px] text-white"
          style={{ backgroundColor: NPC_ROLE_COLORS[node.role] }}
        >
          {NPC_ROLE_LABELS[node.role]}
        </span>
        {aiOn && (
          <span className="shrink-0 rounded-full border border-white/25 px-1.5 py-0.5 font-semibold text-[10px] text-white/80">
            AI
          </span>
        )}
      </div>
      {node.voice.enabled && (
        <button
          aria-label={muted ? '목소리 켜기' : '목소리 끄기'}
          aria-pressed={muted}
          className={iconButton}
          onClick={(event) => {
            event.currentTarget.blur()
            if (!muted) stopNpcSpeech()
            setNpcVoiceMuted(!muted)
          }}
          title={muted ? '목소리 켜기' : '목소리 끄기'}
          type="button"
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      )}
      <button
        aria-label="대화 닫기"
        className={iconButton}
        onClick={() => useNpcDialogue.getState().close('polite')}
        title="대화 닫기 (Esc)"
        type="button"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

function Conversation({ node }: { node: NpcNode }) {
  const mode = useNpcDialogue((state) => state.mode)
  const text = useNpcDialogue((state) => state.text)
  const textAt = useNpcDialogue((state) => state.textAt)
  const choices = useNpcDialogue((state) => state.choices)
  const more = useNpcDialogue((state) => state.more)
  const aiBusy = useNpcDialogue((state) => state.aiBusy)
  const canReturn = useNpcDialogue((state) => state.canReturn)
  const input = useRef<HTMLInputElement>(null)
  const typed = useTypewriter(text, textAt)

  useNpcKeyCapture(true, (event) => {
    const dialogue = useNpcDialogue.getState()
    if (event.code === 'Escape') {
      dialogue.close('polite')
      return true
    }
    if (isTypingTarget(event.target)) return false
    const index = choiceKeyIndex(event.code)
    if (index !== null) {
      const choice = dialogue.choices[index]
      if (choice && !event.repeat) pick(choice.id)
      return true
    }
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') {
      if (event.repeat) return true
      if (dialogue.mode === 'ai' && event.code !== 'Space') input.current?.focus()
      else dialogue.advance()
      return true
    }
    return false
  })

  const hints = [
    choices.length > 0 && `1–${choices.length} 선택`,
    mode === 'ai' ? 'Enter 보내기' : more && 'Enter 계속',
    'Esc 닫기',
  ].filter(Boolean)

  return (
    <div
      aria-label={`${withJosa(node.name, '와', '과')} 대화`}
      className="dark pointer-events-auto fixed inset-x-0 bottom-24 z-[60] mx-auto flex w-[calc(100vw-24px)] max-w-[560px] flex-col gap-2.5 rounded-2xl border border-white/10 bg-[#141414]/85 p-3 text-white shadow-xl backdrop-blur-xl"
      role="dialog"
    >
      <Header node={node} />
      <Transcript />
      <div
        className="min-h-12 cursor-default text-[15px] text-white leading-relaxed"
        onClick={() => useNpcDialogue.getState().advance()}
      >
        {aiBusy && !text ? <span className="text-white/50">생각하는 중…</span> : typed}
        {more && typed === text && (
          <span aria-hidden className="ml-1 animate-pulse text-white/50">
            ▸
          </span>
        )}
      </div>
      {mode === 'script' ? (
        <ChoiceList choices={choices} onChoose={pick} />
      ) : (
        <>
          <AiInput
            busy={aiBusy}
            inputRef={input}
            npcId={node.id}
            onSend={(question) => useNpcDialogue.getState().send(question)}
          />
          {canReturn && (
            <button
              className="flex items-center gap-1.5 self-start rounded-lg px-1.5 py-1 text-white/60 text-xs transition hover:bg-white/10 hover:text-white"
              onClick={(event) => {
                event.currentTarget.blur()
                useNpcDialogue.getState().backToChoices()
              }}
              type="button"
            >
              <Undo2 className="size-3.5" />
              선택지로 돌아가기
            </button>
          )}
        </>
      )}
      <p className="text-[11px] text-white/40">{hints.join(' · ')}</p>
    </div>
  )
}

/**
 * The conversation panel of play mode: the NPC's line typing out over what
 * was said, numbered choices or a question box for AI chat, and a voice
 * toggle. Keys are taken on the window while it is open (Esc closes, 1–9
 * choose, Enter and Space go on), so the walkthrough doesn't see them.
 * Mounted by the app in play and in the editor's walkthrough.
 */
export function NpcDialoguePanel() {
  const walkthrough = useViewer((state) => state.walkthroughMode)
  const npcId = useNpcDialogue((state) => state.npcId)
  const notice = useNpcDialogue((state) => state.notice)
  const node = useScene((state) =>
    npcId ? (state.nodes[npcId as AnyNodeId] as unknown as NpcNode | undefined) : undefined,
  )
  const holder = useNpcRuntime((state) => {
    const held = npcId ? state.engagements[npcId] : undefined
    return held && held.m !== 'free' ? held.by : null
  })
  const me = useNpcRuntime((state) => state.localPlayerId)

  useEffect(() => {
    if (walkthrough) useNpcDialogue.getState().refreshAiStatus()
  }, [walkthrough])

  useEffect(() => {
    if (npcId && !(walkthrough && node)) useNpcDialogue.getState().close('walkedAway')
  }, [npcId, walkthrough, node])

  useEffect(() => {
    if (npcId && holder && holder !== me) useNpcDialogue.getState().close('preempted')
  }, [npcId, holder, me])

  if (!walkthrough) return null
  if (npcId && node) return <Conversation key={npcId} node={node} />
  if (!notice) return null
  return (
    <div className="dark pointer-events-none fixed inset-x-0 bottom-24 z-[60] mx-auto w-fit rounded-full border border-white/10 bg-[#141414]/85 px-4 py-2 text-sm text-white shadow-xl backdrop-blur-xl">
      {notice}
    </div>
  )
}
