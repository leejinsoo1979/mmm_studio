'use client'

import { ActionButton, ActionGroup, PanelSection, ToggleControl } from '@pascal-app/editor'
import { useEffect, useState } from 'react'
import { hingeGapEdit, hingeGapEqualize } from './engine/hinges'
import { type CabinetBuild, cabinetFrame } from './engine/parts'
import { MmField } from './panel-fields'
import type { CabinetNode, CellFront } from './schema'

type Update = (patch: Partial<CabinetNode>) => void

/** A compact number cell for the gap table (commits on Enter / blur). */
function GapInput({
  value,
  disabled,
  onCommit,
}: {
  value: number
  disabled?: boolean
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    if (!/^-?\d+$/.test(draft.trim())) {
      setDraft(String(value))
      return
    }
    const v = Number(draft)
    if (v !== value) onCommit(v)
  }
  return (
    <span className="flex items-center gap-1">
      <input
        className="w-14 rounded border border-border/50 bg-[#2C2C2E] px-1.5 py-1 text-right text-xs outline-none disabled:opacity-40"
        disabled={disabled}
        inputMode="numeric"
        onBlur={commit}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            if (!disabled) onCommit(value + (e.key === 'ArrowUp' ? 1 : -1))
          }
        }}
        value={draft}
      />
      <span className="text-[10px] text-muted-foreground">mm</span>
    </span>
  )
}

/**
 * mmmcraft 도어 셋팅: top/bottom gaps against the carcass body (+ extends the
 * door), mirrored against the ceiling/floor. The ceiling reference is the
 * 상단몰딩, the floor one the 걸레받이 or the 띄움.
 */
export function DoorSettingsSection({ node, update }: { node: CabinetNode; update: Update }) {
  const rev = node.frontReveal
  const topGap = -rev.top
  const bottomGap = -rev.bottom
  const ceilingRef =
    node.family !== 'base' && node.topMoulding.enabled ? node.topMoulding.heightMm : 0
  const floorRef =
    node.family !== 'upper' && node.toeKick.enabled
      ? node.toeKick.heightMm
      : Math.round(node.position[1] * 1000)
  const setTop = (gap: number) => update({ frontReveal: { ...rev, top: -gap } })
  const setBottom = (gap: number) => update({ frontReveal: { ...rev, bottom: -gap } })
  return (
    <PanelSection defaultExpanded={false} title="도어 셋팅">
      <div className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
        <span />
        <span className="text-muted-foreground">몸통 기준</span>
        <span className="text-muted-foreground">천장·바닥 기준</span>
        <span className="text-muted-foreground">상단갭</span>
        <GapInput onCommit={setTop} value={topGap} />
        <GapInput
          disabled={node.family === 'base'}
          onCommit={(v) => setTop(Math.round(ceilingRef - Math.max(0, v)))}
          value={ceilingRef - topGap}
        />
        <span className="text-muted-foreground">하단갭</span>
        <GapInput onCommit={setBottom} value={bottomGap} />
        <GapInput
          disabled={node.family === 'upper'}
          onCommit={(v) => setBottom(Math.round(floorRef - Math.max(0, v)))}
          value={floorRef - bottomGap}
        />
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        좌측: 몸통 기준 / 우측: 천장·바닥 기준 (양쪽 동기화). + 는 도어가 몸통 밖으로 늘어납니다.
      </p>
      <MmField
        label="도어 옆 여유"
        max={20}
        min={0}
        onCommit={(side) => update({ frontReveal: { ...rev, side } })}
        step={0.5}
        value={rev.side}
      />
      <MmField
        label="도어 사이 틈"
        max={20}
        min={0}
        onCommit={(between) => update({ frontReveal: { ...rev, between } })}
        step={0.5}
        value={rev.between}
      />
    </PanelSection>
  )
}

/** 도어치수 (read-only leaf sizes) and 도어 확장/축소. */
export function DoorSizeSection({
  node,
  build,
  update,
}: {
  node: CabinetNode
  build: CabinetBuild
  update: Update
}) {
  const doors = build.parts.filter((p) => p.role === 'door')
  if (doors.length === 0) return null
  const adjust = node.doorWidthAdjust
  return (
    <PanelSection defaultExpanded={false} title="도어치수">
      <ul className="flex flex-col gap-0.5 text-xs tabular-nums">
        {doors.map((d) => (
          <li className="flex justify-between" key={d.id}>
            <span className="text-muted-foreground">{d.name}</span>
            <span>
              {d.box.w} × {d.box.h} × {d.box.d}
            </span>
          </li>
        ))}
      </ul>
      <ToggleControl
        checked={adjust.enabled}
        label="도어 확장/축소"
        // Switching on starts at −1.5 (the unadjusted width), as in mmmcraft.
        onChange={(enabled) => update({ doorWidthAdjust: { enabled, mm: -1.5 } })}
      />
      {adjust.enabled && (
        <>
          <MmField
            label="확장/축소"
            max={500}
            min={-500}
            onCommit={(mm) =>
              update({ doorWidthAdjust: { ...adjust, mm: Math.round(mm * 10) / 10 } })
            }
            step={0.1}
            value={adjust.mm}
          />
          <p className="text-[11px] text-muted-foreground leading-snug">
            (+ 확장 / − 축소, 경첩 반대 방향)
          </p>
        </>
      )}
    </PanelSection>
  )
}

/**
 * 경첩 위치: the owner's door hinges as distances from the door top, with
 * the gaps between them (lockable), 등분 / 추가 / N번 삭제. Stored on the
 * front as side-panel heights so the hinges stay put when door gaps change.
 */
export function HingeEditor({
  node,
  build,
  ownerId,
  front,
  onFront,
}: {
  node: CabinetNode
  build: CabinetBuild
  ownerId: string
  front: CellFront
  onFront: (next: CellFront) => void
}) {
  const [locked, setLocked] = useState<number[]>([])
  const leaf = build.parts.find(
    (p) => p.role === 'door' && p.cellId === ownerId && p.hinge !== 'top',
  )
  if (!leaf?.hingePositionsMm) return null
  const doorH = leaf.box.h
  const bottomOnSide = leaf.box.y - cabinetFrame(node).toe
  const tops = [...leaf.hingePositionsMm].map((p) => Math.round(doorH - p)).sort((a, b) => a - b)
  const boundaries = [0, ...tops, doorH]
  const custom = !!front.hingesMm?.length
  const save = (topDistances: number[]) =>
    onFront({
      ...front,
      hingesMm: topDistances
        .map((t) => Math.round((bottomOnSide + doorH - t) * 1000) / 1000)
        .sort((a, b) => a - b),
    })
  const clamp = (t: number) => Math.max(1, Math.min(doorH - 1, Math.round(t)))
  const segLabel = (i: number) =>
    i === 0 ? '상단-1번' : i === tops.length ? `${tops.length}번-하단` : `${i}번-${i + 1}번`

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/50 p-2">
      <ToggleControl
        checked={custom}
        label="경첩 위치 변경"
        onChange={(on) => {
          setLocked([])
          if (on) save(tops)
          else {
            const { hingesMm: _drop, ...rest } = front
            onFront(rest)
          }
        }}
      />
      <div className="text-muted-foreground text-xs">도어 경첩 (상단 기준)</div>
      {tops.map((t, i) => (
        <div className="flex items-center justify-between text-xs" key={`${i}-${t}`}>
          <span>{i + 1}번</span>
          <span className="flex items-center gap-1.5">
            <GapInput
              disabled={!custom}
              onCommit={(v) => save(tops.map((x, j) => (j === i ? clamp(v) : x)))}
              value={t}
            />
            <button
              className="text-[#ff8a8a] text-[11px] hover:underline disabled:opacity-40"
              disabled={!custom || tops.length <= 1}
              onClick={() => {
                setLocked([])
                save(tops.filter((_, j) => j !== i))
              }}
              type="button"
            >
              {i + 1}번 삭제
            </button>
          </span>
        </div>
      ))}
      <div className="mt-1 text-muted-foreground text-xs">간격</div>
      {boundaries.slice(0, -1).map((b, i) => (
        <div className="flex items-center justify-between text-xs" key={`gap-${i}-${b}`}>
          <span>{segLabel(i)}</span>
          <span className="flex items-center gap-1.5">
            <GapInput
              disabled={!custom}
              onCommit={(v) => {
                const next = hingeGapEdit(boundaries, i, v, locked)
                if (next) save(next)
              }}
              value={(boundaries[i + 1] as number) - b}
            />
            <button
              className={`rounded px-1 text-[11px] ${locked.includes(i) ? 'bg-[#7779ff]/30 text-foreground' : 'text-muted-foreground'}`}
              disabled={!custom}
              onClick={() =>
                setLocked((l) => (l.includes(i) ? l.filter((x) => x !== i) : [...l, i]))
              }
              title={locked.includes(i) ? '간격 잠금 해제' : '간격 잠금 (다른 간격 편집 시 고정)'}
              type="button"
            >
              {locked.includes(i) ? '잠김' : '잠금'}
            </button>
          </span>
        </div>
      ))}
      {custom && (
        <ActionGroup>
          <ActionButton
            label="등분"
            onClick={() => {
              const next = hingeGapEqualize(boundaries, locked)
              if (next) save(next)
            }}
          />
          <ActionButton
            label="추가"
            onClick={() => {
              setLocked([])
              // mmmcraft: the middle of the largest gap between hinges.
              let at = doorH / 2
              if (tops.length === 1)
                at = (tops[0] as number) + ((tops[0] as number) + 100 < doorH ? 100 : -100)
              if (tops.length >= 2) {
                let best = 0
                for (let i = 0; i < tops.length - 1; i += 1) {
                  const g = (tops[i + 1] as number) - (tops[i] as number)
                  if (g > best) {
                    best = g
                    at = ((tops[i] as number) + (tops[i + 1] as number)) / 2
                  }
                }
              }
              save([...tops, clamp(at)].sort((a, b) => a - b))
            }}
          />
        </ActionGroup>
      )}
      <p className="text-[11px] text-muted-foreground leading-snug">
        뷰어와 같은 상단/경첩 사이/하단 간격입니다. 체크 시 직접 수정됩니다. 선반에서 50mm 안쪽의
        경첩은 자동으로 비켜납니다.
      </p>
    </div>
  )
}
