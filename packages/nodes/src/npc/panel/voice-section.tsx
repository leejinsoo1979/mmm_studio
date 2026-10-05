'use client'

import {
  ActionButton,
  PanelSection,
  SliderControl,
  ToggleControl,
  triggerSFX,
} from '@pascal-app/editor'
import { Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { renderTemplate } from '../dialogue/templates'
import { withJosa } from '../josa'
import type { NpcNode, NpcVoice } from '../schema'
import type { NpcVoiceEngine } from '../types'
import { setNpcVoiceMuted, speakNpc, useNpcVoiceMuted } from '../voice/engine'
import { isKoreanVoice, pickNpcVoice } from '../voice/voices'
import { FieldLabel, Hint, SelectField, TextInput } from './dialogue-line-card'

const AUTO = 'auto'
/** A voice id an OpenAI-compatible speech API takes (the server ignores anything else). */
const SERVER_VOICE_ID = /^[\w.-]{1,64}$/

/** The browser's Korean voices; Chrome lists them only after `voiceschanged`. */
function useKoreanVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    const read = () => setVoices(synth.getVoices().filter(isKoreanVoice))
    read()
    synth.addEventListener('voiceschanged', read)
    return () => synth.removeEventListener('voiceschanged', read)
  }, [])
  return voices
}

/** What 미리 듣기 says: the NPC's own words where it has some, so the server voice may speak them. */
function sampleText(node: NpcNode): string {
  if (node.ai.greeting) return node.ai.greeting
  const start = node.dialogue?.lines.find((line) => line.id === node.dialogue?.start)
  const line = start && renderTemplate(start.text, { npc: node.name, player: '손님' }).trim()
  if (line) return line
  return (
    node.behavior.greet.barks[0] ?? `안녕하세요, 저는 ${withJosa(node.name, '이에요', '예요')}.`
  )
}

function BrowserVoicePicker({
  node,
  setVoice,
}: {
  node: NpcNode
  setVoice: (patch: Partial<NpcVoice>) => void
}) {
  const voices = useKoreanVoices()
  const value = node.voice.voice
  const auto = pickNpcVoice(voices, node.avatar, AUTO)
  const options = [
    { label: auto ? `자동 (지금: ${auto.name})` : '자동 (캐릭터에 맞춰)', value: AUTO },
    ...voices.map((voice) => ({ label: voice.name, value: voice.name })),
  ]
  if (value !== AUTO && !voices.some((voice) => voice.name === value)) {
    options.push({ label: `${value} (이 브라우저에 없음)`, value })
  }
  return (
    <>
      <SelectField
        ariaLabel="목소리"
        onChange={(voice) => setVoice({ voice })}
        options={options}
        value={value}
      />
      <FieldLabel>
        {voices.length === 0
          ? '이 브라우저에는 한국어 목소리가 없어요. 플레이하는 사람의 브라우저 목소리로 말해요.'
          : '목소리 목록은 브라우저마다 달라요. 고른 목소리가 없는 브라우저에서는 자동으로 골라요.'}
      </FieldLabel>
    </>
  )
}

/**
 * 목소리: whether and how the NPC's lines are said aloud. `engine` is the
 * server's answer on who voices NPCs (null while unknown: the browser does).
 */
export function NpcVoiceSection({
  node,
  update,
  engine,
}: {
  node: NpcNode
  update: (patch: Partial<NpcNode>) => void
  engine: NpcVoiceEngine | null
}) {
  const { voice } = node
  const muted = useNpcVoiceMuted()
  const setVoice = (patch: Partial<NpcVoice>) => update({ voice: { ...voice, ...patch } })

  return (
    <PanelSection title="목소리">
      <ToggleControl
        checked={voice.enabled}
        label="목소리로 말하기"
        onChange={(enabled) => setVoice({ enabled })}
      />
      {voice.enabled && (
        <>
          <SliderControl
            label="높낮이"
            max={2}
            min={0.5}
            onChange={(pitch) => setVoice({ pitch })}
            precision={2}
            step={0.05}
            unit="×"
            value={voice.pitch}
          />
          <SliderControl
            label="빠르기"
            max={2}
            min={0.5}
            onChange={(rate) => setVoice({ rate })}
            precision={2}
            step={0.05}
            unit="×"
            value={voice.rate}
          />
          <FieldLabel>목소리 선택</FieldLabel>
          {engine === 'server' ? (
            <>
              <TextInput
                allowEmpty
                maxLength={64}
                onCommit={(id) => setVoice({ voice: id || AUTO })}
                placeholder="비우면 서버 기본 목소리 (NPC_TTS_VOICE)"
                value={voice.voice === AUTO ? '' : voice.voice}
              />
              {voice.voice !== AUTO && !SERVER_VOICE_ID.test(voice.voice) ? (
                <Hint tone="warn">
                  서버 목소리 id는 영문·숫자·-·_·. 만 쓸 수 있어요. 이대로면 기본 목소리로 말해요.
                </Hint>
              ) : (
                <FieldLabel>
                  서버의 음성 서비스가 쓰는 목소리 id예요. 서버가 못 읽는 줄은 브라우저 목소리로
                  말해요.
                </FieldLabel>
              )}
            </>
          ) : (
            <BrowserVoicePicker node={node} setVoice={setVoice} />
          )}
          <ActionButton
            icon={<Volume2 className="h-3.5 w-3.5" />}
            label="미리 듣기"
            onClick={() => {
              triggerSFX('sfx:menu-click')
              speakNpc({ npcId: node.id, text: sampleText(node), kind: 'line' })
            }}
          />
          {muted && (
            <div className="flex items-center gap-2">
              <Hint tone="warn">NPC 소리가 꺼져 있어서 들리지 않아요.</Hint>
              <button
                className="shrink-0 rounded-md px-2 py-1 text-sky-500 text-xs hover:bg-accent"
                onClick={() => setNpcVoiceMuted(false)}
                type="button"
              >
                소리 켜기
              </button>
            </div>
          )}
          {engine === 'server' && (
            <FieldLabel>
              서버 목소리는 저장된 장면의 목소리 id와 빠르기로 읽어요(높낮이는 브라우저 목소리에만
              쓰여요). 바꾼 뒤에는 장면을 저장해야 들려요.
            </FieldLabel>
          )}
        </>
      )}
    </PanelSection>
  )
}
