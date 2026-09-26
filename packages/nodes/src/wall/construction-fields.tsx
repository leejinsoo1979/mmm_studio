'use client'

import {
  constructionBuildUpMm,
  normalizeWallConstruction,
  WALL_CONSTRUCTION_KINDS,
  type WallConstruction,
} from '@pascal-app/core'
import { SegmentedControl } from '@pascal-app/editor'
import { useEffect, useState } from 'react'

type Kind = 'plain' | WallConstruction['kind']

/**
 * mmmcraft `WallConstructionFields` (시공 방식 · 마감 방향 · 목상 간격), laid
 * out with this editor's panel controls. `onChange(undefined)` = 일반 벽.
 */
export function WallConstructionFields({
  value,
  onChange,
}: {
  value: WallConstruction | undefined
  onChange: (next: WallConstruction | undefined) => void
}) {
  const kind: Kind = value?.kind ?? 'plain'
  const set = (next: WallConstruction | undefined) => onChange(normalizeWallConstruction(next))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-muted-foreground text-xs">시공 방식</div>
      <SegmentedControl
        onChange={(next: Kind) =>
          set(
            next === 'plain'
              ? undefined
              : {
                  kind: next,
                  side: value?.side ?? 'left',
                  ...(next === 'timber' && value?.studSpacing
                    ? { studSpacing: value.studSpacing }
                    : {}),
                },
          )
        }
        options={[
          { label: '일반 벽', value: 'plain' },
          { label: '목상', value: 'timber' },
          { label: '떡가베', value: 'bonded' },
        ]}
        value={kind}
      />
      {value && (
        <>
          <div className="mt-1 text-muted-foreground text-xs">
            {value.kind === 'bonded' ? '히든도어 앞면 방향' : '마감 방향'} (벽 진행 방향 기준)
          </div>
          <SegmentedControl
            onChange={(side: WallConstruction['side']) => set({ ...value, side })}
            options={[
              { label: '왼쪽', value: 'left' },
              { label: '오른쪽', value: 'right' },
            ]}
            value={value.side}
          />
          {value.kind === 'timber' && (
            <StudSpacingField
              onChange={(studSpacing) => {
                const { studSpacing: _old, ...rest } = value
                set(studSpacing === undefined ? rest : { ...rest, studSpacing })
              }}
              value={value.studSpacing}
            />
          )}
          <p className="text-[11px] text-muted-foreground leading-snug">
            {WALL_CONSTRUCTION_KINDS[value.kind].label} · 마감 포함 추가 두께{' '}
            {constructionBuildUpMm(value).toFixed(2)} mm ·{' '}
            {value.kind === 'bonded'
              ? '양면 각각 석고 2PLY (앞면 2겹 · 뒷면 2겹)'
              : '마감판 1P + 2P'}
          </p>
        </>
      )}
    </div>
  )
}

function StudSpacingField({
  value,
  onChange,
}: {
  value: number | undefined
  onChange: (next: number | undefined) => void
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value])
  const commit = () => {
    if (draft.trim() === '') {
      if (value !== undefined) onChange(undefined)
      return
    }
    const parsed = Number(draft)
    if (!(Number.isFinite(parsed) && parsed >= 30)) {
      setDraft(value === undefined ? '' : String(value))
      return
    }
    if (parsed !== value) onChange(parsed)
  }
  return (
    <label className="mt-1 flex h-9 items-center justify-between gap-2 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">목상 간격</span>
      <span className="flex min-w-0 items-center gap-1">
        <input
          className="w-full min-w-0 bg-transparent text-right text-foreground outline-none placeholder:text-[10px]"
          inputMode="decimal"
          onBlur={commit}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          placeholder="간격 지정 전에는 문 주변만 표시"
          value={draft}
        />
        <span className="text-muted-foreground text-xs">mm</span>
      </span>
    </label>
  )
}
