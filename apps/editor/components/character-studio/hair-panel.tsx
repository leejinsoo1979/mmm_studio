'use client'

import {
  type AvatarGender,
  avatarGender,
  avatarThumbnailUrl,
  BALD,
  type HairStyle,
  type HairStyleEntry,
  loadHairStyles,
} from '@pascal-app/editor'
import { Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ColorPanel, Segmented } from './studio-controls'
import { HAIR_LENGTH_LABELS, HAIR_SWATCHES } from './studio-data'

type Section = 'style' | 'color'
type Filter = 'all' | AvatarGender

const SECTIONS = [
  { id: 'style', label: '스타일' },
  { id: 'color', label: '색' },
] as const

const FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'female', label: '여성' },
  { id: 'male', label: '남성' },
] as const

/**
 * Where the head is in an avatar's thumbnail (a full-body picture, 128 by
 * 208 px): a square this many px wide, from this left edge at the top.
 */
const THUMB_WIDTH = 128
const HEAD_LEFT = 38
const HEAD_SIZE = 52

type Library = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; styles: HairStyleEntry[] }

/** The hairstyle library, and a retry for when it failed to load. */
function useHairLibrary(): [Library, () => void] {
  const [library, setLibrary] = useState<Library>({ kind: 'loading' })
  const mounted = useRef(true)
  const load = useCallback(() => {
    setLibrary({ kind: 'loading' })
    loadHairStyles()
      .then((styles) => mounted.current && setLibrary({ kind: 'ready', styles }))
      .catch(() => mounted.current && setLibrary({ kind: 'error' }))
  }, [])
  useEffect(() => {
    mounted.current = true
    load()
    return () => {
      mounted.current = false
    }
  }, [load])
  return [library, load]
}

/** An avatar's head, cropped from its full-body thumbnail. */
function HeadThumb({ id }: { id: string }) {
  return (
    <span className="relative block aspect-square w-full overflow-hidden">
      <img
        alt=""
        className="absolute top-0 max-w-none transition group-hover:scale-[1.04]"
        loading="lazy"
        src={avatarThumbnailUrl(id)}
        style={{
          width: `${(THUMB_WIDTH / HEAD_SIZE) * 100}%`,
          left: `${(-HEAD_LEFT / HEAD_SIZE) * 100}%`,
        }}
      />
    </span>
  )
}

/** A shaved head, drawn: there is no picture of one. */
function BaldHead() {
  return (
    <span className="grid aspect-square w-full place-items-center">
      <svg aria-hidden className="w-[58%] text-neutral-300" viewBox="0 0 48 56">
        <ellipse cx="24" cy="23" fill="currentColor" rx="15" ry="18" />
        <ellipse cx="9.5" cy="26" fill="currentColor" rx="3" ry="5" />
        <ellipse cx="38.5" cy="26" fill="currentColor" rx="3" ry="5" />
        <path d="M17 38h14v10c0 3-14 3-14 0z" fill="currentColor" />
        <path d="M6 56c2-7 9-10 18-10s16 3 18 10z" fill="currentColor" />
        <ellipse cx="19" cy="11" fill="white" opacity="0.55" rx="5" ry="3" />
      </svg>
    </span>
  )
}

function StyleTile({
  selected,
  label,
  onPick,
  children,
}: {
  selected: boolean
  label: string
  onPick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        'group relative flex flex-col items-center overflow-hidden rounded-2xl bg-gradient-to-b from-neutral-50 to-neutral-100 transition',
        selected
          ? 'shadow-[0_0_0_2px_#0ea5e9,0_6px_16px_rgba(14,165,233,0.25)]'
          : 'shadow-[0_0_0_1px_rgba(0,0,0,0.05)] hover:shadow-[0_0_0_1px_rgba(14,165,233,0.4),0_4px_12px_rgba(0,0,0,0.08)]',
      )}
      onClick={onPick}
      title={label}
      type="button"
    >
      {children}
      <span
        className={cn(
          'w-full truncate py-1 text-center text-[11px]',
          selected ? 'bg-sky-500 font-semibold text-white' : 'bg-white/80 text-neutral-600',
        )}
      >
        {label}
      </span>
    </button>
  )
}

/**
 * The hairstyle gallery: the character's own hair, a shaved head, and
 * every other character's hair to borrow (filtered by the sex it was made
 * for, which starts as the character's own).
 */
function StyleGallery({
  avatar,
  hairStyle,
  onPick,
}: {
  avatar: string
  hairStyle: HairStyle
  onPick: (style: HairStyle) => void
}) {
  const [library, retry] = useHairLibrary()
  const [filter, setFilter] = useState<Filter>(() => avatarGender(avatar))
  const worn = hairStyle ?? avatar
  const styles =
    library.kind === 'ready'
      ? library.styles.filter((style) => filter === 'all' || style.gender === filter)
      : []

  return (
    <div className="flex flex-col gap-3">
      <Segmented onPick={setFilter} options={FILTERS} value={filter} />
      <div className="grid grid-cols-3 gap-2">
        <StyleTile label="원래 머리" onPick={() => onPick(null)} selected={hairStyle === null}>
          <HeadThumb id={avatar} />
        </StyleTile>
        <StyleTile label="민머리" onPick={() => onPick(BALD)} selected={hairStyle === BALD}>
          <BaldHead />
        </StyleTile>
        {styles.map((style) => (
          <StyleTile
            key={style.id}
            label={HAIR_LENGTH_LABELS[style.length]}
            // The character's own hair, picked from the library, is its own hair.
            onPick={() => onPick(style.id === avatar ? null : style.id)}
            selected={worn === style.id}
          >
            <HeadThumb id={style.id} />
          </StyleTile>
        ))}
      </div>
      {library.kind === 'loading' && (
        <p className="flex items-center justify-center gap-2 rounded-xl bg-neutral-50 py-4 text-[12px] text-neutral-500">
          <Loader2 className="size-4 animate-spin text-sky-500" /> 헤어스타일을 불러오고 있어요…
        </p>
      )}
      {library.kind === 'error' && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-amber-50 px-3 py-4 text-center text-[12px] text-amber-800">
          헤어스타일 목록을 불러오지 못했어요. 원래 머리와 민머리는 쓸 수 있어요.
          <button
            className="flex items-center gap-1 rounded-full bg-white px-3 py-1 font-medium text-[11px] text-neutral-700 shadow-sm hover:bg-neutral-50"
            onClick={retry}
            type="button"
          >
            <RefreshCw className="size-3" /> 다시 시도
          </button>
        </div>
      )}
      {library.kind === 'ready' && styles.length === 0 && (
        <p className="py-4 text-center text-[12px] text-neutral-400">
          이 조건의 헤어스타일이 아직 없어요
        </p>
      )}
    </div>
  )
}

/**
 * The hair step: the style (the character's own, shaved, or another
 * character's hair) and its colour, dyed so the strands keep their shine.
 */
export function HairPanel({
  avatar,
  hairStyle,
  hair,
  onStyle,
  onPreviewColor,
  onCommitColor,
}: {
  avatar: string
  hairStyle: HairStyle
  hair: string | null
  onStyle: (style: HairStyle) => void
  onPreviewColor: (hex: string | null) => void
  onCommitColor: (hex: string | null) => void
}) {
  const [section, setSection] = useState<Section>('style')
  return (
    <div className="flex flex-col gap-4">
      <Segmented onPick={setSection} options={SECTIONS} value={section} />
      {section === 'style' ? (
        <StyleGallery avatar={avatar} hairStyle={hairStyle} onPick={onStyle} />
      ) : (
        <>
          {hairStyle === BALD && (
            <p className="rounded-xl bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500 leading-4">
              민머리에서는 머리색이 보이지 않아요. 스타일에서 머리를 고르면 이 색으로 물들어요.
            </p>
          )}
          <ColorPanel
            fallback="#4F3426"
            onCommit={onCommitColor}
            onPreview={onPreviewColor}
            original="원래 머리색"
            swatches={HAIR_SWATCHES}
            value={hair}
          />
        </>
      )}
    </div>
  )
}
