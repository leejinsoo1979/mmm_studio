'use client'

import { useScene, type WallNode } from '@pascal-app/core'
import { columnCountLimits, selectSlotWall, slotGuideFor, useSlotMode } from '@pascal-app/nodes'
import { useEffect, useMemo, useState } from 'react'

const fmt = (mm: number) =>
  Math.abs(mm - Math.round(mm)) < 0.05 ? String(Math.round(mm)) : mm.toFixed(1)

/**
 * mmmcraft Room "슬롯 가이드" panel: the 슬롯 생성 toggle, the reference
 * wall status and piece, the column count and the frame type. While on, a
 * wall click picks the reference wall (clearing its furniture) and a module
 * double-click drops it into the first free slot.
 */
export function FurnitureSlotSection({ selectedWall }: { selectedWall: WallNode | null }) {
  const slot = useSlotMode()
  const nodes = useScene((s) => s.nodes)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!slot.enabled || !selectedWall || selectedWall.id === useSlotMode.getState().wallId) return
    const removed = selectSlotWall(selectedWall.id)
    setMessage(removed > 0 ? `슬롯을 만들 벽에 있던 가구 ${removed}개를 지웠습니다.` : null)
  }, [slot.enabled, selectedWall])

  const guide = useMemo(
    () => (slot.enabled && slot.wallId ? slotGuideFor(slot.wallId, slot, nodes) : null),
    [slot, nodes],
  )
  const internal = guide ? guide.lengthMm - guide.layout.leftMm - guide.layout.rightMm : 0
  const limits = columnCountLimits(internal)

  return (
    <section className="rounded-[10px] bg-[var(--panel-card,#f3f3f3)] p-3 text-[var(--panel-card-fg,#333)]">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">슬롯 가이드</h3>
        <button
          className={`h-7 rounded-lg px-3 font-medium text-xs ${
            slot.enabled ? 'bg-[#8ec3f2] text-white' : 'bg-white/80 dark:bg-white/10'
          }`}
          onClick={() => {
            setMessage(null)
            slot.setEnabled(!slot.enabled)
          }}
          type="button"
        >
          슬롯 생성
        </button>
      </div>
      {!slot.enabled ? (
        <p className="mt-1 text-muted-foreground text-xs">
          슬롯 생성을 켜면 벽마다 배치 기준을 정할 수 있습니다.
        </p>
      ) : !guide ? (
        <p className="mt-1 text-muted-foreground text-xs">벽을 클릭해 기준 벽을 정하세요.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2 text-xs">
          <p className="font-semibold text-[#3d8fd6] dark:text-sky-300">
            기준 벽 {guide.wallNumber}
            {guide.segments.length > 1 ? `-${guide.segment + 1}` : ''} · 내경 {fmt(guide.lengthMm)}{' '}
            mm
          </p>
          {guide.segments.length > 1 && (
            <select
              className="h-8 rounded-lg bg-white/80 px-2 dark:bg-white/10"
              onChange={(e) => slot.setSegment(Number(e.target.value))}
              value={guide.segment}
            >
              {guide.segments.map(([a, b], i) => (
                <option key={`${a}-${b}`} value={i}>
                  벽 {guide.wallNumber}-{i + 1} · 내경 {fmt(b - a)} mm
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            <span className="w-14 text-muted-foreground">칸 수</span>
            <input
              className="flex-1"
              max={limits.max}
              min={limits.min}
              onChange={(e) => slot.setColumnCount(Number(e.target.value))}
              type="range"
              value={guide.layout.columnCount}
            />
            <span className="w-6 text-right tabular-nums">{guide.layout.columnCount}</span>
            <button
              className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
              disabled={slot.columnCount === null}
              onClick={() => slot.setColumnCount(null)}
              type="button"
            >
              기본
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 text-muted-foreground">프레임</span>
            {(['surround', 'no-surround'] as const).map((mode) => (
              <button
                className={`h-7 flex-1 rounded-lg border ${
                  slot.frameMode === mode
                    ? 'border-[#8ec3f2] bg-[#e3f1fc] text-[#3d8fd6] dark:bg-sky-400/20 dark:text-sky-200'
                    : 'border-transparent bg-white/80 dark:bg-white/10'
                }`}
                key={mode}
                onClick={() => slot.setFrameMode(mode)}
                type="button"
              >
                {mode === 'surround' ? '서라운드' : '노서라운드'}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground">
            {guide.layout.columnCount}칸 × {fmt(guide.layout.slots[0]?.width ?? 0)} mm · 좌{' '}
            {fmt(guide.layout.leftMm)} / 우 {fmt(guide.layout.rightMm)} mm. 모듈을 더블클릭하면 첫
            빈 슬롯에 놓입니다.
          </p>
        </div>
      )}
      {message && <p className="mt-2 text-[#3d8fd6] text-xs dark:text-sky-300">{message}</p>}
    </section>
  )
}
