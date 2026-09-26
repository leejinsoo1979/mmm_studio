'use client'

import { ActionButton, ActionGroup, ToggleControl } from '@pascal-app/editor'
import type { CabinetBuild } from './engine/parts'
import {
  applyShelfGap,
  defaultRodShelfTopGapMm,
  gapsFromCentres,
  resetShelfGaps,
} from './engine/shelf-gaps'
import { MmField } from './panel-fields'
import type { CabinetNode, CellContent } from './schema'

type Shelves = Extract<CellContent, { type: 'shelves' }>
type Hanging = Extract<CellContent, { type: 'hanging' }>

const note = 'text-[11px] text-muted-foreground leading-snug'

function leafRect(build: CabinetBuild, leafId: string) {
  return build.leaves.find((l) => l.id === leafId)?.rect
}

/** 선반 갯수, 초기화, 칸 내경 (numbered from the top) and 다보보링 추가. */
export function ShelfSettings({
  node,
  build,
  leafId,
  content,
  onContent,
}: {
  node: CabinetNode
  build: CabinetBuild
  leafId: string
  content: Shelves
  onContent: (next: CellContent) => void
}) {
  const rect = leafRect(build, leafId)
  if (!rect) return null
  const t = node.panelThicknessMm
  const innerH = rect.y1 - rect.y0
  const centres = build.parts
    .filter((p) => p.cellId === leafId && (p.role === 'shelf' || p.role === 'fixed-shelf'))
    .map((p) => p.box.y - rect.y0 + t / 2)
    .sort((a, b) => a - b)
  const gaps = gapsFromCentres(centres, innerH, t)
  const n = content.count
  const setCount = (count: number) => {
    const { positionsMm: _drop, ...rest } = content
    onContent({ ...rest, count: Math.max(0, Math.min(10, count)) })
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">선반 갯수 (칸 높이 {Math.round(innerH)}mm)</span>
        <span className="flex items-center gap-1">
          <button
            className="h-7 w-7 rounded border border-border/50 bg-[#2C2C2E] disabled:opacity-40"
            disabled={n <= 0}
            onClick={() => setCount(n - 1)}
            type="button"
          >
            −
          </button>
          <span className="w-6 text-center tabular-nums">{n}</span>
          <button
            className="h-7 w-7 rounded border border-border/50 bg-[#2C2C2E] disabled:opacity-40"
            disabled={n >= 10}
            onClick={() => setCount(n + 1)}
            type="button"
          >
            +
          </button>
        </span>
      </div>
      {n > 0 && (
        <>
          <div className="text-muted-foreground text-xs">칸 내경</div>
          {gaps
            .map((g, i) => ({ g, i }))
            .reverse()
            .map(({ g, i }, row) => (
              <MmField
                key={`gap-${i}`}
                label={`칸 ${row + 1}`}
                min={0}
                onCommit={(v) =>
                  onContent({ ...content, positionsMm: applyShelfGap(innerH, n, t, i, v) })
                }
                value={g}
              />
            ))}
          <ActionGroup>
            <ActionButton
              label="초기화"
              onClick={() => onContent({ ...content, positionsMm: resetShelfGaps(innerH, n, t) })}
            />
          </ActionGroup>
          <p className={note}>칸 하나를 바꾸면 나머지 칸은 남는 높이를 똑같이 나눠 갖습니다.</p>
          {content.kind === 'dowel' && (
            <>
              <ToggleControl
                checked={content.extraDowels !== undefined}
                label="다보보링 추가"
                onChange={(on) => {
                  const { extraDowels: _drop, ...rest } = content
                  onContent(on ? { ...rest, extraDowels: content.extraDowels ?? 1 } : rest)
                }}
              />
              {content.extraDowels !== undefined && (
                <MmField
                  label="상하 각각 32mm 간격 (개)"
                  max={20}
                  min={1}
                  onCommit={(v) =>
                    onContent({ ...content, extraDowels: Math.max(1, Math.min(20, Math.round(v))) })
                  }
                  value={content.extraDowels}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

/** 상부 선반: 선반 제거 (옷봉을 상판에 부착) and 옷봉선반 간격. */
export function RodShelfSettings({
  node,
  build,
  leafId,
  content,
  onContent,
}: {
  node: CabinetNode
  build: CabinetBuild
  leafId: string
  content: Hanging
  onContent: (next: CellContent) => void
}) {
  const rect = leafRect(build, leafId)
  if (!rect) return null
  const innerH = rect.y1 - rect.y0
  const removed = content.shelfTopGapMm === undefined
  return (
    <>
      <ToggleControl
        checked={removed}
        label="선반 제거 (옷봉을 상판에 부착)"
        onChange={(remove) => {
          const { shelfTopGapMm: _drop, ...rest } = content
          onContent(
            remove
              ? rest
              : {
                  ...rest,
                  shelfTopGapMm: defaultRodShelfTopGapMm(innerH, node.panelThicknessMm),
                },
          )
        }}
      />
      {!removed && (
        <MmField
          label="옷봉선반 간격"
          max={2000}
          min={0}
          onCommit={(shelfTopGapMm) => onContent({ ...content, shelfTopGapMm })}
          value={content.shelfTopGapMm ?? 0}
        />
      )}
    </>
  )
}
