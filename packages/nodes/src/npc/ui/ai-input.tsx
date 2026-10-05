'use client'

import { Mic, SendHorizontal } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { NPC_MESSAGE_MAX } from '../dialogue/store'
import { stopNpcSpeech } from '../voice/engine'

/** The Web Speech recognizer, as far as we use it (lib.dom lists only its events). */
type Recognizer = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

/** Chrome and Safari still prefix it; Firefox has none. */
function recognizerClass(): (new () => Recognizer) | null {
  const scope = window as unknown as {
    SpeechRecognition?: new () => Recognizer
    webkitSpeechRecognition?: new () => Recognizer
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/**
 * The AI chat's question box: Enter or the arrow sends it. Where the browser
 * can listen, the mic dictates in Korean, what it hears filling the box as it
 * goes, ready to send.
 */
export function AiInput({
  npcId,
  busy,
  inputRef,
  onSend,
}: {
  npcId: string
  busy: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onSend: (text: string) => boolean
}) {
  const [text, setText] = useState('')
  const [canListen, setCanListen] = useState(false)
  const [listening, setListening] = useState(false)
  const recognizer = useRef<Recognizer | null>(null)

  useEffect(() => {
    // After mount, so the server render and the first client render agree.
    setCanListen(recognizerClass() !== null)
    inputRef.current?.focus()
    return () => recognizer.current?.abort()
  }, [inputRef])

  const submit = () => {
    if (busy || !text.trim()) return
    recognizer.current?.abort()
    if (onSend(text)) setText('')
  }

  const toggleMic = () => {
    if (recognizer.current) {
      recognizer.current.stop()
      return
    }
    const RecognizerClass = recognizerClass()
    if (!RecognizerClass) return
    const before = text.trim() ? `${text.trim()} ` : ''
    const next = new RecognizerClass()
    next.lang = 'ko-KR'
    next.interimResults = true
    next.continuous = false
    next.onresult = (event) => {
      let heard = ''
      for (let i = 0; i < event.results.length; i++)
        heard += event.results[i]?.[0]?.transcript ?? ''
      setText((before + heard).slice(0, NPC_MESSAGE_MAX))
    }
    next.onend = () => {
      recognizer.current = null
      setListening(false)
      inputRef.current?.focus()
    }
    recognizer.current = next
    // Otherwise it would hear the NPC.
    stopNpcSpeech(npcId)
    next.start()
    setListening(true)
  }

  const iconButton =
    'flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 transition disabled:opacity-40'

  return (
    <div className="flex items-center gap-2">
      <input
        className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/30"
        enterKeyHint="send"
        maxLength={NPC_MESSAGE_MAX}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter also ends a Korean syllable being composed; that one isn't a send.
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          submit()
        }}
        placeholder={listening ? '듣고 있어요…' : '궁금한 걸 물어보세요'}
        ref={inputRef}
        value={text}
      />
      {canListen && (
        <button
          aria-label={listening ? '그만 듣기' : '말로 물어보기'}
          aria-pressed={listening}
          className={`${iconButton} ${listening ? 'animate-pulse bg-rose-500 text-white' : 'text-white/80 hover:bg-white/10'}`}
          onClick={toggleMic}
          title={listening ? '그만 듣기' : '말로 물어보기'}
          type="button"
        >
          <Mic className="size-4" />
        </button>
      )}
      <button
        aria-label="보내기"
        className={`${iconButton} bg-white text-black hover:bg-white/90`}
        disabled={busy || !text.trim()}
        onClick={submit}
        title="보내기"
        type="button"
      >
        <SendHorizontal className="size-4" />
      </button>
    </div>
  )
}
