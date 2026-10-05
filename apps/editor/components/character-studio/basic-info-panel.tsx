'use client'

import { avatarGender, avatarThumbnailUrl } from '@pascal-app/editor'
import { ChevronLeft, ChevronRight, Mars, PersonStanding, RotateCcw, Venus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { counterpartAvatar, isChild } from './avatar-counterpart'
import { FOCUS_RING } from './studio-controls'

const AGES = [
  { id: 'child', label: '어린이', size: 'size-6' },
  { id: 'adult', label: '성인', size: 'size-8' },
] as const

function AgeTrack({ avatar, onAvatar }: { avatar: string; onAvatar: (avatar: string) => void }) {
  const child = isChild(avatar)
  const gender = avatarGender(avatar)
  const pick = (next: boolean) => onAvatar(counterpartAvatar(avatar, gender, next))
  const row = useRef<HTMLDivElement>(null)
  return (
    <div
      aria-label="연령대"
      className="relative flex h-14 items-end gap-8 px-2"
      onKeyDown={(event) => {
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        if (!forward && !back) return
        event.preventDefault()
        // 어린이 is first in the row: back is the child.
        const next = back
        if (next !== child) pick(next)
        row.current?.querySelector<HTMLElement>(`[data-age="${next ? 'child' : 'adult'}"]`)?.focus()
      }}
      ref={row}
      role="radiogroup"
    >
      <span aria-hidden className="absolute inset-x-0 bottom-3 h-px bg-white/15" />
      {AGES.map(({ id, label, size }) => {
        const selected = (id === 'child') === child
        return (
          <button
            aria-checked={selected}
            className={cn(
              'relative z-10 flex flex-col items-center gap-0.5 rounded-lg px-1 pb-5 transition duration-200 ease-out motion-reduce:transition-none',
              FOCUS_RING,
              selected ? 'text-white' : 'text-white/35 hover:text-white/70',
            )}
            data-age={id}
            key={id}
            onClick={() => !selected && pick(id === 'child')}
            role="radio"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            <PersonStanding className={size} />
            <span className="text-[11px]">{label}</span>
            <span
              aria-hidden
              className={cn(
                'absolute bottom-[8px] size-2 rounded-full',
                selected ? 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.8)]' : 'bg-white/25',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}

function GenderSwitch({
  avatar,
  onAvatar,
}: {
  avatar: string
  onAvatar: (avatar: string) => void
}) {
  const gender = avatarGender(avatar)
  const other = gender === 'male' ? 'female' : 'male'
  const flip = () => onAvatar(counterpartAvatar(avatar, other, isChild(avatar)))
  const Icon = gender === 'male' ? Mars : Venus
  const arrow = cn(
    'grid size-8 place-items-center rounded-lg text-white/70 transition duration-200 ease-out hover:bg-white/10 hover:text-white motion-reduce:transition-none',
    FOCUS_RING,
  )
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/[0.06] p-1">
      <button aria-label="성별 바꾸기" className={arrow} onClick={flip} type="button">
        <ChevronLeft className="size-4" />
      </button>
      <span aria-live="polite" className="flex items-center gap-1.5">
        <Icon className="size-4 text-white/50" />
        <span className="font-semibold text-[14px]">{gender === 'male' ? '남성' : '여성'}</span>
      </span>
      <button aria-label="성별 바꾸기" className={arrow} onClick={flip} type="button">
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}

const Label = ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) =>
  htmlFor ? (
    <label className="text-[12px] text-white/50" htmlFor={htmlFor}>
      {children}
    </label>
  ) : (
    <span className="text-[12px] text-white/50">{children}</span>
  )

type Props = {
  npc: boolean
  name: string
  onName: (name: string) => void
  maxName: number
  avatar: string
  onAvatar: (avatar: string) => void
  chips: string[]
  onReset: () => void
}

function Card({ npc, name, onName, maxName, avatar, onAvatar, chips, onReset }: Props) {
  const nameId = useId()
  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-neutral-950/75 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-xl">
      <div className="flex flex-col gap-1">
        <Label>연령대</Label>
        <AgeTrack avatar={avatar} onAvatar={onAvatar} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>성별</Label>
        <GenderSwitch avatar={avatar} onAvatar={onAvatar} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>이름</Label>
        <input
          className="h-9 w-full rounded-lg bg-white/[0.06] px-3 text-[13px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-2 focus:ring-sky-400"
          id={nameId}
          maxLength={maxName}
          onChange={(event) => onName(event.target.value)}
          placeholder={npc ? 'NPC 이름' : '이름을 지어 주세요'}
          value={name}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>꾸민 곳</Label>
        <div className="flex flex-wrap gap-1">
          {chips.length > 0 ? (
            chips.map((chip) => (
              <span
                className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-white/70"
                key={chip}
              >
                {chip}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-white/40">기본 모습</span>
          )}
        </div>
      </div>
      <button
        className={cn(
          'flex items-center gap-1.5 self-start rounded-md text-[12px] text-white/50 transition duration-200 ease-out hover:text-white motion-reduce:transition-none',
          FOCUS_RING,
        )}
        onClick={onReset}
        type="button"
      >
        <RotateCcw className="size-3.5" /> 처음 모습으로
      </button>
    </div>
  )
}

/**
 * The left column: who this is (연령대, 성별, 이름), what has been changed,
 * and a way back to how the character came. On narrower screens it folds
 * into a chip that opens it.
 */
export function BasicInfoPanel(props: Props & { compact: boolean }) {
  const { compact, npc, name, avatar } = props
  const shownName = name.trim() || (npc ? 'NPC' : '내 캐릭터')
  const title = npc ? `${shownName}, 어떤 모습인가요?` : `${shownName}, 어떤 모습을 하고 있나요?`
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])

  if (compact) {
    return (
      <div className="pointer-events-auto absolute top-6 left-6 w-[280px]" ref={box}>
        <button
          aria-expanded={open}
          aria-label={`기본 정보: ${shownName}`}
          className={cn(
            'flex h-10 items-center gap-2 rounded-full bg-black/45 py-1 pr-4 pl-1 ring-1 ring-white/10 backdrop-blur-xl hover:bg-black/60',
            FOCUS_RING,
          )}
          onClick={() => setOpen(!open)}
          type="button"
        >
          <img
            alt=""
            className="size-8 rounded-full bg-white/10 object-cover object-top"
            src={avatarThumbnailUrl(avatar)}
          />
          <span className="max-w-40 truncate font-semibold text-[13px]">{shownName}</span>
        </button>
        {open && (
          <div className="mt-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold text-[14px]">기본 정보</span>
              <button
                aria-label="기본 정보 닫기"
                className={cn(
                  'grid size-7 place-items-center rounded-full text-white/60 hover:bg-white/10',
                  FOCUS_RING,
                )}
                onClick={() => setOpen(false)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <Card {...props} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pointer-events-auto absolute top-6 left-6 w-[280px]">
      <h1 className="font-bold text-[20px] text-white leading-tight [text-wrap:balance]">
        {title}
      </h1>
      <p className="mt-1 text-[13px] text-white/60">외모를 만들어 주세요.</p>
      <h2 className="sr-only">기본 정보</h2>
      <div className="mt-5">
        <Card {...props} />
      </div>
    </div>
  )
}
