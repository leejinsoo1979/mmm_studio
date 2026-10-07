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
import {
  AmountSlider,
  Chips,
  ColorPanel,
  FOCUS_RING,
  PanelNote,
  RoundTile,
} from './studio-controls'
import { HAIR_SWATCHES, hairSections } from './studio-data'

type Filter = 'all' | AvatarGender

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

/** An avatar's head, cropped from its full-body thumbnail, in a round tile. */
function HeadThumb({ id }: { id: string }) {
  return (
    <img
      alt=""
      className="absolute top-[4%] max-w-none transition duration-200 ease-out group-hover:scale-[1.05] motion-reduce:transition-none"
      loading="lazy"
      src={avatarThumbnailUrl(id)}
      style={{
        width: `${(THUMB_WIDTH / HEAD_SIZE) * 100}%`,
        left: `${(-HEAD_LEFT / HEAD_SIZE) * 100}%`,
      }}
    />
  )
}

/** A shaved head, drawn: there is no picture of one. */
function BaldHead() {
  return (
    <span className="absolute inset-0 grid place-items-center">
      <svg aria-hidden className="w-[58%] text-white/25" viewBox="0 0 48 56">
        <ellipse cx="24" cy="23" fill="currentColor" rx="15" ry="18" />
        <ellipse cx="9.5" cy="26" fill="currentColor" rx="3" ry="5" />
        <ellipse cx="38.5" cy="26" fill="currentColor" rx="3" ry="5" />
        <path d="M17 38h14v10c0 3-14 3-14 0z" fill="currentColor" />
        <path d="M6 56c2-7 9-10 18-10s16 3 18 10z" fill="currentColor" />
        <ellipse cx="19" cy="11" fill="white" opacity="0.3" rx="5" ry="3" />
      </svg>
    </span>
  )
}

/** The dye on the worn style's tile. */
const DyeBadge = ({ hex }: { hex: string }) => (
  <span
    aria-hidden
    className="absolute right-[6%] bottom-[6%] size-3.5 rounded-full ring-2 ring-neutral-950"
    style={{ background: hex }}
  />
)

/**
 * The hairstyle gallery: the character's own hair, a shaved head (and how
 * much its stubble has grown back), and every other character's hair to
 * borrow, by length and by name (filtered by the sex it was made for,
 * which starts as the character's own). The worn one shows its dye.
 */
export function HairStyleBody({
  avatar,
  hairStyle,
  hair,
  shave,
  onPick,
  onShavePreview,
  onShaveCommit,
}: {
  avatar: string
  hairStyle: HairStyle
  hair: string | null
  shave: number
  onPick: (style: HairStyle) => void
  onShavePreview: (shave: number) => void
  onShaveCommit: (shave: number) => void
}) {
  const [library, retry] = useHairLibrary()
  const [filter, setFilter] = useState<Filter>(() => avatarGender(avatar))
  const worn = hairStyle ?? avatar
  const styles =
    library.kind === 'ready'
      ? library.styles.filter((style) => filter === 'all' || style.gender === filter)
      : []
  const badge = (selected: boolean) => (selected && hair ? <DyeBadge hex={hair} /> : undefined)

  return (
    <div className="flex flex-col gap-4">
      <Chips label="헤어스타일 거르기" onPick={setFilter} options={FILTERS} value={filter} />
      <div className="grid grid-cols-3 gap-x-3 gap-y-4">
        <RoundTile
          badge={badge(hairStyle === null)}
          label="원래 머리"
          onPick={() => onPick(null)}
          selected={hairStyle === null}
        >
          <HeadThumb id={avatar} />
        </RoundTile>
        <RoundTile label="민머리" onPick={() => onPick(BALD)} selected={hairStyle === BALD}>
          <BaldHead />
        </RoundTile>
      </div>
      {hairStyle === BALD && (
        <div className="flex flex-col gap-1.5 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
          <AmountSlider
            label="삭발 정도"
            onCommit={onShaveCommit}
            onPreview={onShavePreview}
            value={shave}
          />
          <div className="flex justify-between text-[10px] text-white/40">
            <span>매끈하게 민 머리</span>
            <span>짧게 자란 머리</span>
          </div>
        </div>
      )}
      {hairSections(styles).map((section) => (
        <section aria-label={section.label} className="flex flex-col gap-2.5" key={section.length}>
          <h3 className="font-medium text-[11px] text-white/45 tracking-wide">{section.label}</h3>
          <div className="grid grid-cols-3 gap-x-3 gap-y-4">
            {section.styles.map((style) => {
              const selected = worn === style.id
              return (
                <RoundTile
                  badge={badge(selected)}
                  key={style.id}
                  label={style.name}
                  // The character's own hair, picked from the library, is its own hair.
                  onPick={() => onPick(style.id === avatar ? null : style.id)}
                  selected={selected}
                >
                  <HeadThumb id={style.id} />
                </RoundTile>
              )
            })}
          </div>
        </section>
      ))}
      {library.kind === 'loading' && (
        <p className="flex items-center justify-center gap-2 rounded-xl bg-white/[0.05] py-4 text-[12px] text-white/60">
          <Loader2 className="size-4 animate-spin text-sky-400" /> 헤어스타일을 불러오고 있어요…
        </p>
      )}
      {library.kind === 'error' && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-amber-400/10 px-3 py-4 text-center text-[12px] text-amber-200">
          헤어스타일 목록을 불러오지 못했어요. 원래 머리와 민머리는 쓸 수 있어요.
          <button
            className={cn(
              'flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 font-medium text-[11px] text-white hover:bg-white/15',
              FOCUS_RING,
            )}
            onClick={retry}
            type="button"
          >
            <RefreshCw className="size-3" /> 다시 시도
          </button>
        </div>
      )}
      {library.kind === 'ready' && styles.length === 0 && (
        <p className="py-4 text-center text-[12px] text-white/40">
          이 조건의 헤어스타일이 아직 없어요
        </p>
      )}
    </div>
  )
}

/** The hair's dye: picked so the strands keep their shine. */
export function HairColorBody({
  hairStyle,
  hair,
  onPreview,
  onCommit,
}: {
  hairStyle: HairStyle
  hair: string | null
  onPreview: (hex: string | null) => void
  onCommit: (hex: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {hairStyle === BALD && (
        <PanelNote>
          민머리에서는 머리색이 보이지 않아요. 스타일에서 머리를 고르면 이 색으로 물들어요.
        </PanelNote>
      )}
      <ColorPanel
        fallback="#4F3426"
        onCommit={onCommit}
        onPreview={onPreview}
        original="원래 머리색"
        swatches={HAIR_SWATCHES}
        value={hair}
      />
    </div>
  )
}
