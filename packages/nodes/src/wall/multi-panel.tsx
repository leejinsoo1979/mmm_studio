'use client'

import {
  type AnyNodeId,
  constructionBuildUpMm,
  useScene,
  type WallConstruction,
  type WallNode,
  wallConstructionError,
  wallCoreThicknessMm,
  withWallConstruction,
} from '@pascal-app/core'
import { PanelSection, PanelWrapper, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

type Kind = 'plain' | WallConstruction['kind']

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'plain', label: '일반 벽' },
  { value: 'timber', label: '목상' },
  { value: 'steel', label: '경량' },
  { value: 'bonded', label: '떡가베' },
]

const common = <T,>(values: T[]): T | null =>
  values.length > 0 && values.every((v) => v === values[0]) ? (values[0] as T) : null

/**
 * mmmcraft 선택한 벽 한꺼번에 설정: the single-wall settings (시공 방식, 마감
 * 방향, 벽 두께, 벽 높이) for every selected wall. Mixed values read "여러 값";
 * a change is written to all selected walls as one undo step.
 */
export default function WallMultiPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const walls = useScene(
    useShallow((s) =>
      selectedIds
        .map((id) => s.nodes[id as AnyNodeId])
        .filter((n): n is WallNode => n?.type === 'wall'),
    ),
  )
  const [error, setError] = useState<string | null>(null)

  if (walls.length === 0) return null

  const apply = (patch: (wall: WallNode) => Partial<WallNode> | null) => {
    const updates = walls.flatMap((wall) => {
      const data = patch(wall)
      return data ? [{ id: wall.id as AnyNodeId, data }] : []
    })
    const invalid = updates
      .map(({ id, data }) => {
        const wall = walls.find((w) => w.id === id)
        return wall ? wallConstructionError({ ...wall, ...data }) : null
      })
      .find(Boolean)
    setError(invalid ?? null)
    if (invalid || updates.length === 0) return
    triggerSFX('sfx:menu-click')
    useScene.getState().updateNodes(updates)
  }

  const kind = common(walls.map((w): Kind => w.construction?.kind ?? 'plain'))
  const built = walls.every((w) => w.construction)
  const side = built ? common(walls.map((w) => w.construction!.side)) : null
  const coreMm = common(walls.map((w) => Math.round(wallCoreThicknessMm(w))))
  const heightMm = common(walls.map((w) => Math.round((w.height ?? 2.5) * 1000)))

  return (
    <PanelWrapper
      icon="/icons/wall.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title={`벽 ${walls.length}개 선택`}
      width={280}
    >
      <PanelSection title="한꺼번에 설정">
        <div className="flex flex-col gap-2.5 px-1 pb-1">
          <Row label="시공 방식">
            {KIND_OPTIONS.map((option) => (
              <Choice
                active={kind === option.value}
                key={option.value}
                label={option.label}
                onClick={() =>
                  apply((wall) => {
                    const current = wall.construction
                    const next: WallConstruction | undefined =
                      option.value === 'plain'
                        ? undefined
                        : {
                            kind: option.value,
                            side: current?.side ?? 'left',
                            ...(option.value !== 'bonded' && current?.studSpacing
                              ? { studSpacing: current.studSpacing }
                              : {}),
                            ...(current?.sheets ? { sheets: current.sheets } : {}),
                          }
                    return withWallConstruction(wall, next)
                  })
                }
              />
            ))}
          </Row>
          {built && (
            <Row label={kind === 'bonded' ? '히든도어 앞면' : '마감 방향'}>
              {(['left', 'right'] as const).map((value) => (
                <Choice
                  active={side === value}
                  key={value}
                  label={value === 'left' ? '왼쪽' : '오른쪽'}
                  onClick={() =>
                    apply((wall) =>
                      wall.construction
                        ? { construction: { ...wall.construction, side: value } }
                        : null,
                    )
                  }
                />
              ))}
            </Row>
          )}
          <MmField
            label={built ? '벽체 두께' : '벽 두께'}
            onCommit={(mm) =>
              apply((wall) => ({
                thickness: (mm + constructionBuildUpMm(wall.construction)) / 1000,
              }))
            }
            value={coreMm}
          />
          <MmField
            label="벽 높이"
            onCommit={(mm) => apply(() => ({ height: mm / 1000 }))}
            value={heightMm}
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          {kind === null && (
            <p className="text-[11px] text-muted-foreground">
              시공 방식이 다른 벽이 섞여 있습니다. 고르면 모두 같은 방식이 됩니다.
            </p>
          )}
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex gap-1">{children}</div>
    </div>
  )
}

function Choice({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`flex-1 rounded-md py-1 text-xs transition-colors ${active ? 'bg-neutral-800 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900' : 'bg-muted text-foreground hover:bg-accent'}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

function MmField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number | null
  onCommit: (mm: number) => void
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])
  const commit = () => {
    const mm = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(mm) && mm > 0) {
      if (mm !== value) onCommit(mm)
    } else setDraft(value === null ? '' : String(value))
  }
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
        <input
          aria-label={label}
          className="w-16 bg-transparent text-right tabular-nums outline-none"
          inputMode="numeric"
          onBlur={commit}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          placeholder={value === null ? '여러 값' : undefined}
          value={draft}
        />
        <span className="text-muted-foreground">mm</span>
      </span>
    </label>
  )
}
