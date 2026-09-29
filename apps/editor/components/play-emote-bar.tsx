'use client'

import { EMOTES, keyLabel, useAvatarEmote, useAvatarProfile, useEditor } from '@pascal-app/editor'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { EMOTE_ICONS } from './character-studio/studio-data'

const order = (code: string) =>
  code.startsWith('Digit') ? `0${code.slice(5) === '0' ? '9z' : code.slice(5)}` : `1${code}`

/**
 * The game's emote bar: the player's emote keys, in order, each playable
 * with its key or a click; the one playing lights up.
 */
export function PlayEmoteBar() {
  const inGame = useEditor((state) => state.isFirstPersonMode)
  const keys = useAvatarProfile((state) => state.keys)
  const playing = useAvatarEmote((state) => state.emote?.id ?? null)
  const slots = useMemo(
    () => Object.keys(keys).sort((a, b) => order(a).localeCompare(order(b))),
    [keys],
  )
  if (!inGame || slots.length === 0) return null

  return (
    <div className="pointer-events-auto fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 gap-1 rounded-2xl border border-white/10 bg-[#141414]/80 p-1.5 shadow-xl backdrop-blur-xl">
      {slots.map((code) => {
        const emote = EMOTES[keys[code]!]
        const Icon = EMOTE_ICONS[emote.id]
        const active = playing === emote.id
        return (
          <button
            aria-label={`${emote.label} (${keyLabel(code)})`}
            className={cn(
              'group relative flex w-12 flex-col items-center gap-0.5 rounded-xl pt-1.5 pb-1 transition',
              active ? 'bg-sky-500 text-white' : 'text-white/80 hover:bg-white/10',
            )}
            key={code}
            onClick={(event) => {
              event.currentTarget.blur()
              useAvatarEmote.getState().play(emote.id)
            }}
            title={emote.label}
            type="button"
          >
            <Icon className="size-4" />
            <span className="w-full truncate px-0.5 text-center text-[9px]">{emote.label}</span>
            <span
              className={cn(
                'absolute -top-1.5 -left-1 rounded border px-1 font-mono text-[9px] leading-[14px]',
                active
                  ? 'border-white/60 bg-sky-600 text-white'
                  : 'border-white/20 bg-[#262626] text-white/70',
              )}
            >
              {keyLabel(code)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
