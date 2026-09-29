'use client'

import { ChevronDown, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '../../../lib/utils'
import useWalkthroughView from '../../../store/use-walkthrough-view'
import {
  ALL_AVATARS,
  AVATAR_TABS,
  type AvatarTab,
  avatarLabel,
  avatarTab,
  avatarThumbnailUrl,
  findAvatar,
} from './avatar-catalog'

/**
 * The walkthrough's character button: the current body's thumbnail, opening a
 * gallery of every Rocketbox avatar sorted into tabs.
 */
export function CharacterPicker() {
  const current = findAvatar(useWalkthroughView((state) => state.character))
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<AvatarTab>(() => avatarTab(current))
  const avatars = useMemo(() => ALL_AVATARS.filter((avatar) => avatarTab(avatar) === tab), [tab])

  return (
    <div className="pointer-events-auto relative">
      <button
        aria-expanded={open}
        aria-label={`캐릭터 선택: ${avatarLabel(current.id)}`}
        className="flex items-center gap-2 rounded-xl border border-border/40 bg-background/90 py-1 pr-2.5 pl-1 font-medium text-foreground text-sm shadow-lg backdrop-blur-xl transition-colors hover:bg-background"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <img
          alt=""
          className="h-8 w-5 rounded-md bg-accent/40 object-cover object-top"
          src={avatarThumbnailUrl(current.id)}
        />
        {avatarLabel(current.id)}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-border/40 bg-background/95 p-3 shadow-xl backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex gap-0.5 rounded-lg bg-accent/40 p-0.5">
              {AVATAR_TABS.map(({ id, label }) => (
                <button
                  aria-pressed={tab === id}
                  className={cn(
                    'rounded-md px-2.5 py-1 font-medium text-xs transition-colors',
                    tab === id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  key={id}
                  onClick={() => setTab(id)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              aria-label="닫기"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid max-h-[min(420px,60vh)] grid-cols-5 gap-1.5 overflow-y-auto pr-0.5">
            {avatars.map((avatar) => (
              <button
                aria-pressed={avatar.id === current.id}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-lg border p-1 transition-colors',
                  avatar.id === current.id
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-transparent hover:border-border hover:bg-accent/50',
                )}
                key={avatar.id}
                onClick={() => useWalkthroughView.getState().setCharacter(avatar.id)}
                title={avatarLabel(avatar.id)}
                type="button"
              >
                <img
                  alt=""
                  className="aspect-[128/208] w-full object-contain"
                  loading="lazy"
                  src={avatarThumbnailUrl(avatar.id)}
                />
                <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                  {avatarLabel(avatar.id)}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
            Microsoft Rocketbox 아바타 {ALL_AVATARS.length}명 · 고르면 바로 바뀝니다
          </p>
        </div>
      )}
    </div>
  )
}
