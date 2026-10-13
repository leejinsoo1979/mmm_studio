'use client'

import { ChevronDown, FolderPlus, UserRound, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '../../../lib/utils'
import useAvatarProfile from '../../../store/use-avatar-profile'
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
import {
  CHARACTER_EDITIONS,
  type CharacterEdition,
  findPhotoreal,
  PHOTOREAL_CHARACTERS,
  PHOTOREAL_LOCAL_FOLDER,
  type PhotorealCharacter,
  useLocalPhotoreal,
} from './photoreal-catalog'

/** A 실사 character's card picture, or a figure where it has none (a local file). */
export function PhotorealThumbnail({
  character,
  className,
}: {
  character: PhotorealCharacter
  className?: string
}) {
  return character.thumbnail ? (
    <img alt="" className={className} loading="lazy" src={character.thumbnail} />
  ) : (
    <span className={cn('grid place-items-center bg-accent/40 text-muted-foreground', className)}>
      <UserRound className="size-1/2" />
    </span>
  )
}

/** Where the owner adds characters that may not be published, and how. */
export function LocalPhotorealHint({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-2 rounded-lg border border-dashed p-2.5 text-[11px]', className)}>
      <FolderPlus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p className="text-muted-foreground leading-4">
        <span className="font-medium text-foreground">내 실사 캐릭터 추가: </span>
        사람 뼈대가 있는 GLB(MetaHuman·Character Creator·Avaturn 등에서 내보낸 파일)를{' '}
        <code className="break-all rounded bg-accent/60 px-1">{PHOTOREAL_LOCAL_FOLDER}/</code>에
        넣고 새로고침하세요. 이 폴더는 저장소에 올라가지 않아요.
      </p>
    </div>
  )
}

/** The two sets' switch: 기본 (Rocketbox) | 실사. */
export function EditionSwitch({
  value,
  onChange,
  className,
}: {
  value: CharacterEdition
  onChange: (edition: CharacterEdition) => void
  className?: string
}) {
  return (
    <div
      aria-label="캐릭터 버전"
      className={cn('flex gap-0.5 rounded-lg bg-accent/40 p-0.5', className)}
      role="radiogroup"
    >
      {CHARACTER_EDITIONS.map(({ id, label }) => (
        <button
          aria-checked={value === id}
          className={cn(
            'rounded-md px-2.5 py-1 font-semibold text-xs transition-colors',
            value === id
              ? 'bg-sky-500 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          key={id}
          onClick={() => onChange(id)}
          role="radio"
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** The player's body as picked: a 실사 character, else their Rocketbox avatar. */
export function usePickedCharacter() {
  const rocketbox = findAvatar(useWalkthroughView((state) => state.character))
  const id = useAvatarProfile((state) => state.real)
  // A local character's name comes with the folder's listing: shown once it has.
  useLocalPhotoreal()
  return { rocketbox, real: findPhotoreal(id) }
}

/**
 * Every character as a thumbnail grid — the Rocketbox avatars sorted into
 * tabs (기본), or the 실사 set with the owner's local ones (실사): picking
 * one makes it the walkthrough body.
 */
export function CharacterGallery({
  className,
  columns = 5,
  onClose,
}: {
  className?: string
  columns?: number
  onClose?: () => void
}) {
  const { rocketbox: current, real } = usePickedCharacter()
  const [edition, setEdition] = useState<CharacterEdition>(real ? 'real' : 'basic')
  const [tab, setTab] = useState<AvatarTab>(() => avatarTab(current))
  const avatars = useMemo(() => ALL_AVATARS.filter((avatar) => avatarTab(avatar) === tab), [tab])
  const local = useLocalPhotoreal()
  const reals = [...PHOTOREAL_CHARACTERS, ...(local ?? [])]
  const grid = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <EditionSwitch onChange={setEdition} value={edition} />
          {edition === 'basic' && (
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
          )}
        </div>
        {onClose && (
          <button
            aria-label="닫기"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {edition === 'basic' ? (
        <div className="grid max-h-[min(420px,60vh)] gap-1.5 overflow-y-auto pr-0.5" style={grid}>
          {avatars.map((avatar) => {
            const picked = !real && avatar.id === current.id
            return (
              <button
                aria-pressed={picked}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-lg border p-1 transition-colors',
                  picked
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-transparent hover:border-border hover:bg-accent/50',
                )}
                key={avatar.id}
                onClick={() => {
                  useWalkthroughView.getState().setCharacter(avatar.id)
                  useAvatarProfile.getState().setReal(null)
                }}
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
            )
          })}
        </div>
      ) : (
        <div className="flex max-h-[min(420px,60vh)] flex-col gap-2 overflow-y-auto pr-0.5">
          <div className="grid gap-1.5" style={grid}>
            {reals.map((character) => {
              const picked = real?.id === character.id
              return (
                <button
                  aria-pressed={picked}
                  className={cn(
                    'flex flex-col items-center gap-0.5 rounded-lg border p-1 transition-colors',
                    picked
                      ? 'border-sky-500 bg-sky-500/10'
                      : 'border-transparent hover:border-border hover:bg-accent/50',
                  )}
                  key={character.id}
                  onClick={() => useAvatarProfile.getState().setReal(character.id)}
                  title={`${character.label} · ${character.credit}`}
                  type="button"
                >
                  <PhotorealThumbnail
                    character={character}
                    className="aspect-[128/208] w-full rounded-md object-contain"
                  />
                  <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                    {character.label}
                  </span>
                </button>
              )
            })}
          </div>
          {local !== null && local.length === 0 && <LocalPhotorealHint />}
        </div>
      )}
      <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
        {edition === 'basic'
          ? `Microsoft Rocketbox 아바타 ${ALL_AVATARS.length}명 · 고르면 바로 바뀝니다`
          : `실사 ${PHOTOREAL_CHARACTERS.length}명${local?.length ? ` · 내 PC ${local.length}명` : ''} · 얼굴·몸 꾸미기는 기본 캐릭터만 돼요`}
      </p>
    </div>
  )
}

/** The walkthrough's character button: the current body's thumbnail, opening the gallery. */
export function CharacterPicker() {
  const { rocketbox: current, real } = usePickedCharacter()
  const [open, setOpen] = useState(false)
  const label = real ? real.label : avatarLabel(current.id)

  return (
    <div className="pointer-events-auto relative">
      <button
        aria-expanded={open}
        aria-label={`캐릭터 선택: ${label}`}
        className={cn(
          'flex items-center gap-1.5 rounded-full py-1 pr-2 pl-1 font-medium text-foreground text-xs transition-colors hover:bg-accent',
          open && 'bg-accent',
        )}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {real ? (
          <PhotorealThumbnail
            character={real}
            className="size-6 rounded-full bg-accent/60 object-cover object-top"
          />
        ) : (
          <img
            alt=""
            className="size-6 rounded-full bg-accent/60 object-cover object-top"
            src={avatarThumbnailUrl(current.id)}
          />
        )}
        {label}
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <CharacterGallery
          className="absolute top-full right-0 mt-2 w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-border/40 bg-background/95 p-3 shadow-xl backdrop-blur-xl"
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
