'use client'

import { cn, EMOTES, isEmoteId, ToggleControl, triggerSFX } from '@pascal-app/editor'
import { ChevronDown, Plus, Star, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DialogueAction, DialogueChoice, DialogueLine } from '../schema'
import { TextField } from './basic-tab'

/** A room an action can point at. */
export type RoomOption = { id: string; name: string }

type Option = { label: string; value: string }

const MAX_ACTIONS = 4
const MAX_CHOICES = 6
const MAX_FLAGS = 4

const EMOTE_OPTIONS: Option[] = Object.values(EMOTES).map(({ id, label }) => ({
  label,
  value: id,
}))

const ACTION_OPTIONS: { label: string; value: DialogueAction['kind'] }[] = [
  { label: '따라오기 시작', value: 'follow' },
  { label: '따라오기 그만', value: 'stopFollow' },
  { label: '방으로 안내', value: 'guideTo' },
  { label: '방 소개하기', value: 'describeRoom' },
  { label: '동작 하기', value: 'emote' },
  { label: 'AI 자유 대화로', value: 'askAi' },
  { label: '표시 남기기', value: 'setFlag' },
  { label: '대화 끝내기', value: 'end' },
]

const NEXT_ROOM = '@next'
const HERE = ''
const END = ''

/** Flags and ids are lower-case latin letters, digits, `-` and `_` (up to 32). */
export const toLocalId = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32)

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="px-1 pt-1 text-muted-foreground text-xs">{children}</span>
}

export function Hint({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'info' }) {
  return (
    <p
      className={cn(
        'px-1 text-xs leading-relaxed',
        tone === 'warn'
          ? 'text-amber-500'
          : tone === 'info'
            ? 'rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-foreground'
            : 'text-muted-foreground',
      )}
    >
      {children}
    </p>
  )
}

export function IconButton({
  label,
  icon,
  onClick,
}: {
  label: string
  icon?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon ?? <X className="h-3.5 w-3.5" />}
    </button>
  )
}

export function SelectField({
  value,
  options,
  onChange,
  disabled,
  className,
  ariaLabel,
}: {
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      className={cn(
        'h-8 min-w-0 rounded-md border border-border/50 bg-muted px-2 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30 disabled:opacity-40',
        className,
      )}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * A one-line input that commits on Enter / blur; Escape restores. `sanitize`
 * shapes the text first; empty text commits only with `allowEmpty`.
 */
export function TextInput({
  value,
  maxLength,
  placeholder,
  allowEmpty,
  sanitize = (text) => text.trim(),
  onCommit,
  className,
  list,
  clearOnCommit,
}: {
  value: string
  maxLength: number
  placeholder?: string
  allowEmpty?: boolean
  sanitize?: (text: string) => string
  onCommit: (value: string) => void
  className?: string
  list?: string
  /** An "add" box: empty again after each commit. */
  clearOnCommit?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = sanitize(draft)
    if ((next || allowEmpty) && next !== value) {
      onCommit(next)
      if (clearOnCommit) setDraft(value)
    } else setDraft(value)
  }
  return (
    <input
      className={cn(
        'h-8 min-w-0 flex-1 rounded-md border border-border/50 bg-muted px-2 text-foreground text-xs outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-foreground/30',
        className,
      )}
      list={list}
      maxLength={maxLength}
      onBlur={commit}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
        e.stopPropagation()
      }}
      placeholder={placeholder}
      type="text"
      value={draft}
    />
  )
}

/**
 * A multi-line text box that commits trimmed text on blur or Ctrl/⌘+Enter;
 * Escape restores. `required` text never commits empty.
 */
export function TextAreaField({
  value,
  maxLength,
  rows = 2,
  placeholder,
  required,
  onCommit,
}: {
  value: string
  maxLength: number
  rows?: number
  placeholder?: string
  required?: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = draft.trim()
    if ((next || !required) && next !== value) onCommit(next)
    else setDraft(value)
  }
  return (
    <div className="relative">
      <textarea
        className="w-full resize-y rounded-lg border border-border/50 bg-muted px-3 py-2 text-foreground text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-foreground/30"
        maxLength={maxLength}
        onBlur={() => {
          setFocused(false)
          commit()
        }}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLElement).blur()
          if (e.key === 'Escape') {
            setDraft(value)
            ;(e.target as HTMLElement).blur()
          }
          e.stopPropagation()
        }}
        placeholder={placeholder}
        rows={rows}
        value={draft}
      />
      {focused && (
        <span className="pointer-events-none absolute right-2 bottom-1.5 text-[10px] text-muted-foreground tabular-nums">
          {draft.length}/{maxLength}
        </span>
      )}
    </div>
  )
}

function SmallButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      className="flex h-7 items-center gap-1 rounded-md px-2 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onClick={() => {
        triggerSFX('sfx:menu-click')
        onClick()
      }}
      type="button"
    >
      {icon}
      {label}
    </button>
  )
}

/** Room choices, keeping a room that no longer exists visible as such. */
function roomOptions(rooms: RoomOption[], current: string | undefined): Option[] {
  const options = rooms.map((room) => ({ label: room.name, value: room.id }))
  if (current && current !== NEXT_ROOM && !rooms.some((room) => room.id === current)) {
    options.push({ label: '(없어진 방)', value: current })
  }
  return options
}

function newAction(kind: DialogueAction['kind']): DialogueAction {
  switch (kind) {
    case 'guideTo':
      return { kind, room: NEXT_ROOM }
    case 'describeRoom':
      return { kind }
    case 'emote':
      return { kind, emote: 'nod' }
    case 'setFlag':
      return { kind, flag: 'done', value: true }
    case 'follow':
    case 'stopFollow':
    case 'askAi':
    case 'end':
      return { kind }
  }
}

function ActionRow({
  action,
  rooms,
  knownFlags,
  onChange,
  onRemove,
}: {
  action: DialogueAction
  rooms: RoomOption[]
  knownFlags: string
  onChange: (action: DialogueAction) => void
  onRemove: () => void
}) {
  let detail: React.ReactNode = null
  switch (action.kind) {
    case 'guideTo':
      detail = (
        <SelectField
          ariaLabel="안내할 방"
          className="flex-1"
          onChange={(room) => onChange({ kind: 'guideTo', room })}
          options={[
            { label: '투어 순서의 다음 방', value: NEXT_ROOM },
            ...roomOptions(rooms, action.room),
          ]}
          value={action.room}
        />
      )
      break
    case 'describeRoom':
      detail = (
        <SelectField
          ariaLabel="소개할 방"
          className="flex-1"
          onChange={(room) =>
            onChange(room === HERE ? { kind: 'describeRoom' } : { kind: 'describeRoom', room })
          }
          options={[
            { label: '플레이어가 있는 방', value: HERE },
            ...roomOptions(rooms, action.room),
          ]}
          value={action.room ?? HERE}
        />
      )
      break
    case 'emote':
      detail = (
        <SelectField
          ariaLabel="동작"
          className="flex-1"
          onChange={(emote) => onChange({ kind: 'emote', emote })}
          options={
            isEmoteId(action.emote)
              ? EMOTE_OPTIONS
              : [...EMOTE_OPTIONS, { label: action.emote, value: action.emote }]
          }
          value={action.emote}
        />
      )
      break
    case 'setFlag':
      detail = (
        <>
          <TextInput
            list={knownFlags}
            maxLength={32}
            onCommit={(flag) => onChange({ ...action, flag })}
            placeholder="표시 이름"
            sanitize={toLocalId}
            value={action.flag}
          />
          <SelectField
            ariaLabel="켜기 또는 끄기"
            onChange={(value) => onChange({ ...action, value: value === 'on' })}
            options={[
              { label: '켜기', value: 'on' },
              { label: '끄기', value: 'off' },
            ]}
            value={action.value ? 'on' : 'off'}
          />
        </>
      )
      break
  }
  return (
    <div className="flex items-center gap-1">
      <SelectField
        ariaLabel="행동"
        className={detail ? 'w-[108px] shrink-0' : 'flex-1'}
        onChange={(kind) => onChange(newAction(kind as DialogueAction['kind']))}
        options={ACTION_OPTIONS}
        value={action.kind}
      />
      {detail}
      <IconButton label="행동 지우기" onClick={onRemove} />
    </div>
  )
}

/** Up to four actions, run in order. */
function ActionList({
  actions,
  rooms,
  knownFlags,
  onChange,
}: {
  actions: DialogueAction[]
  rooms: RoomOption[]
  knownFlags: string
  onChange: (actions: DialogueAction[]) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {actions.map((action, index) => (
        <ActionRow
          action={action}
          key={`${index}:${action.kind}`}
          knownFlags={knownFlags}
          onChange={(next) => onChange(actions.map((a, i) => (i === index ? next : a)))}
          onRemove={() => onChange(actions.filter((_, i) => i !== index))}
          rooms={rooms}
        />
      ))}
      {actions.length < MAX_ACTIONS && (
        <SelectField
          ariaLabel="행동 추가"
          className="text-muted-foreground"
          onChange={(kind) => {
            if (!kind) return
            triggerSFX('sfx:menu-click')
            onChange([...actions, newAction(kind as DialogueAction['kind'])])
          }}
          options={[{ label: '+ 행동 추가', value: '' }, ...ACTION_OPTIONS]}
          value=""
        />
      )}
    </div>
  )
}

/** Flags a choice needs (`requires`) or hides on (`hideIf`). */
function FlagList({
  label,
  flags,
  knownFlags,
  onChange,
}: {
  label: string
  flags: string[]
  knownFlags: string
  onChange: (flags: string[]) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-full px-1 text-[11px] text-muted-foreground">{label}</span>
      {flags.map((flag) => (
        <span
          className="flex h-6 items-center gap-0.5 rounded-full border border-border/50 bg-muted pr-0.5 pl-2 text-xs"
          key={flag}
        >
          {flag}
          <button
            aria-label={`${flag} 지우기`}
            className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onChange(flags.filter((f) => f !== flag))}
            type="button"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {flags.length < MAX_FLAGS && (
        <TextInput
          className="h-6 max-w-[120px] rounded-full"
          clearOnCommit
          list={knownFlags}
          maxLength={32}
          onCommit={(flag) => {
            if (!flags.includes(flag)) onChange([...flags, flag])
          }}
          placeholder="+ 표시"
          sanitize={toLocalId}
          value=""
        />
      )}
    </div>
  )
}

function ChoiceEditor({
  choice,
  index,
  nextOptions,
  rooms,
  knownFlags,
  onChange,
  onRemove,
}: {
  choice: DialogueChoice
  index: number
  nextOptions: Option[]
  rooms: RoomOption[]
  knownFlags: string
  onChange: (choice: DialogueChoice) => void
  onRemove: () => void
}) {
  const extras = choice.actions.length + choice.requires.length + choice.hideIf.length
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/40 bg-background/40 p-1.5">
      <div className="flex items-center gap-1">
        <span className="w-4 shrink-0 text-center font-semibold text-muted-foreground text-xs">
          {index + 1}
        </span>
        <TextField
          maxLength={60}
          onCommit={(label) => onChange({ ...choice, label })}
          value={choice.label}
        />
        <IconButton label="선택지 지우기" onClick={onRemove} />
      </div>
      <div className="flex items-center gap-1 pl-5">
        <span className="shrink-0 text-muted-foreground text-xs">→</span>
        <SelectField
          ariaLabel="고르면 이어질 대사"
          className="flex-1"
          onChange={(next) => onChange({ ...choice, next: next === END ? null : next })}
          options={nextOptions}
          value={choice.next ?? END}
        />
        <button
          aria-expanded={open}
          className={cn(
            'flex h-8 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-xs transition-colors hover:bg-accent',
            extras > 0 ? 'text-sky-500' : 'text-muted-foreground',
          )}
          onClick={() => setOpen(!open)}
          type="button"
        >
          행동·조건{extras > 0 && ` ${extras}`}
          <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 pt-1 pl-5">
          <span className="px-1 text-[11px] text-muted-foreground">
            고르면 하는 행동 (차례대로)
          </span>
          <ActionList
            actions={choice.actions}
            knownFlags={knownFlags}
            onChange={(actions) => onChange({ ...choice, actions })}
            rooms={rooms}
          />
          <FlagList
            flags={choice.requires}
            knownFlags={knownFlags}
            label="이 표시가 모두 있을 때만 보여요"
            onChange={(requires) => onChange({ ...choice, requires })}
          />
          <FlagList
            flags={choice.hideIf}
            knownFlags={knownFlags}
            label="이 표시 중 하나라도 있으면 숨겨요"
            onChange={(hideIf) => onChange({ ...choice, hideIf })}
          />
        </div>
      )}
    </div>
  )
}

function uniqueChoiceId(line: DialogueLine): string {
  const taken = new Set(line.choices.map((choice) => choice.id))
  let n = line.choices.length + 1
  while (taken.has(`c${n}`)) n++
  return `c${n}`
}

/** "3. 어서 오세요! 저는…" for line selects and collapsed cards. */
export function lineLabel(line: DialogueLine, index: number, max = 22): string {
  const text = line.text.length > max ? `${line.text.slice(0, max)}…` : line.text
  return `${index + 1}. ${text}`
}

/**
 * One line of the script: what the NPC says (and does), and the choices the
 * player answers with, each leading to another line or ending the talk.
 */
export function DialogueLineCard({
  line,
  index,
  isStart,
  lineOptions,
  rooms,
  knownFlags,
  defaultOpen,
  onChange,
  onRemove,
  onMakeStart,
}: {
  line: DialogueLine
  index: number
  isStart: boolean
  /** Every line of the script, as `lineLabel`s. */
  lineOptions: Option[]
  rooms: RoomOption[]
  /** The id of a `<datalist>` of the script's flags. */
  knownFlags: string
  defaultOpen: boolean
  onChange: (line: DialogueLine) => void
  /** Absent for the script's only line. */
  onRemove?: () => void
  onMakeStart: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const endOption: Option = { label: '대화 끝', value: END }
  const choiceNext = [endOption, ...lineOptions]
  const ownNext = [
    line.roomMenu ? { label: '이 대사로 돌아오기', value: END } : endOption,
    ...lineOptions.filter((option) => option.value !== line.id),
  ]
  const setChoice = (i: number, choice: DialogueChoice) =>
    onChange({ ...line, choices: line.choices.map((c, j) => (j === i ? choice : c)) })

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border bg-muted/40',
        isStart ? 'border-sky-500/50' : 'border-border/50',
      )}
    >
      <div className="flex items-center gap-1 pr-1">
        <button
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 text-left text-xs"
          onClick={() => setOpen(!open)}
          type="button"
        >
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
              open ? 'rotate-0' : '-rotate-90',
            )}
          />
          <span className="truncate">{lineLabel(line, index, 40)}</span>
          {isStart && (
            <span className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-500">
              시작
            </span>
          )}
        </button>
        {!isStart && (
          <IconButton
            icon={<Star className="h-3.5 w-3.5" />}
            label="첫 대사로 정하기"
            onClick={onMakeStart}
          />
        )}
        {onRemove && (
          <IconButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="대사 지우기"
            onClick={onRemove}
          />
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
          <TextAreaField
            maxLength={300}
            onCommit={(text) => onChange({ ...line, text })}
            required
            value={line.text}
          />
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 px-1 text-muted-foreground text-xs">말할 때 동작</span>
            <SelectField
              ariaLabel="말할 때 동작"
              className="flex-1"
              onChange={(emote) => {
                const { emote: _old, ...rest } = line
                onChange(emote ? { ...rest, emote } : rest)
              }}
              options={[
                { label: '없음', value: '' },
                ...(line.emote && !isEmoteId(line.emote)
                  ? [...EMOTE_OPTIONS, { label: line.emote, value: line.emote }]
                  : EMOTE_OPTIONS),
              ]}
              value={line.emote ?? ''}
            />
          </div>

          <span className="px-1 pt-1 text-[11px] text-muted-foreground">
            이 대사를 말할 때 하는 행동
          </span>
          <ActionList
            actions={line.onEnter}
            knownFlags={knownFlags}
            onChange={(onEnter) => onChange({ ...line, onEnter })}
            rooms={rooms}
          />

          <span className="px-1 pt-1 text-[11px] text-muted-foreground">
            선택지
            {line.choices.length === 0 && !line.roomMenu && ' (없으면 아래 다음 대사로 이어져요)'}
          </span>
          {line.choices.map((choice, i) => (
            <ChoiceEditor
              choice={choice}
              index={i}
              key={choice.id}
              knownFlags={knownFlags}
              nextOptions={choiceNext}
              onChange={(next) => setChoice(i, next)}
              onRemove={() =>
                onChange({ ...line, choices: line.choices.filter((_, j) => j !== i) })
              }
              rooms={rooms}
            />
          ))}
          <div className="flex">
            <SmallButton
              disabled={line.choices.length >= MAX_CHOICES}
              icon={<Plus className="h-3.5 w-3.5" />}
              label="선택지 추가"
              onClick={() =>
                onChange({
                  ...line,
                  choices: [
                    ...line.choices,
                    {
                      id: uniqueChoiceId(line),
                      label: '네',
                      next: null,
                      actions: [],
                      requires: [],
                      hideIf: [],
                    },
                  ],
                })
              }
            />
          </div>
          <ToggleControl
            checked={line.roomMenu}
            label="방 목록을 선택지로 붙이기"
            onChange={(roomMenu) => onChange({ ...line, roomMenu })}
          />
          {(line.choices.length === 0 || line.roomMenu) && (
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 px-1 text-muted-foreground text-xs">
                {line.roomMenu ? '방으로 안내한 뒤' : '다음 대사'}
              </span>
              <SelectField
                ariaLabel={line.roomMenu ? '방으로 안내한 뒤' : '다음 대사'}
                className="flex-1"
                onChange={(next) => onChange({ ...line, next: next === END ? null : next })}
                options={ownNext}
                value={line.next ?? END}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
