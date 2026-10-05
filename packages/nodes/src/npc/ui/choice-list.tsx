'use client'

import { useEffect, useRef } from 'react'

/** The choice a number key picks: Digit1–9 (and the keypad's) are 0–8, Digit0 the tenth. */
export function choiceKeyIndex(code: string): number | null {
  const match = /^(?:Digit|Numpad)(\d)$/.exec(code)
  if (!match) return null
  const digit = Number(match[1])
  return digit === 0 ? 9 : digit - 1
}

/** Whether a key goes to a text field (its keys are the field's). */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, [contenteditable="true"]') !== null
  )
}

/**
 * While `active`, `onKey` sees every keydown first: a window capture listener
 * runs before the walkthrough's document capture one, so the keys it takes
 * (returns true for) don't end the tour, play an emote or open the chat.
 */
export function useNpcKeyCapture(active: boolean, onKey: (event: KeyboardEvent) => boolean) {
  const handler = useRef(onKey)
  useEffect(() => {
    handler.current = onKey
  })
  useEffect(() => {
    if (!active) return
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
      if (!handler.current(event)) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [active])
}

/** Numbered choices, big enough to tap; number keys pick them through `useNpcKeyCapture`. */
export function ChoiceList({
  choices,
  onChoose,
}: {
  choices: readonly { id: string; label: string }[]
  onChoose: (id: string) => void
}) {
  if (choices.length === 0) return null
  return (
    <ol className="flex flex-col gap-1.5">
      {choices.map((choice, index) => (
        <li key={choice.id}>
          <button
            className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-white/90 transition hover:bg-white/15 active:bg-white/20"
            onClick={(event) => {
              event.currentTarget.blur()
              onChoose(choice.id)
            }}
            type="button"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/10 font-medium text-white/70 text-xs tabular-nums">
              {index < 9 ? index + 1 : 0}
            </span>
            {choice.label}
          </button>
        </li>
      ))}
    </ol>
  )
}
