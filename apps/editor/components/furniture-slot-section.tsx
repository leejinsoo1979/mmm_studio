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
    <section className="mt-2 rounded-xl border border-[#343434] bg-[#202020] p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">슬롯 가이드</h3>
        <button
          className={`h-7 rounded-lg px-3 font-medium text-xs ${
            slot.enabled ? 'bg-[#7564ed] text-white' : 'border border-[#3a3a3a] bg-[#2C2C2E]'
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
        <p className="mt-1 text-[#9a9a9a] text-xs">
          슬롯 생성을 켜면 벽마다 배치 기준을 정할 수 있습니다.
        </p>
      ) : !guide ? (
        <p className="mt-1 text-[#9a9a9a] text-xs">벽을 클릭해 기준 벽을 정하세요.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2 text-xs">
          <p className="text-[#d7d7ff]">
            기준 벽 {guide.wallNumber}
            {guide.segments.length > 1 ? `-${guide.segment + 1}` : ''} · 내경 {fmt(guide.lengthMm)}{' '}
            mm
          </p>
          {guide.segments.length > 1 && (
            <select
              className="h-8 rounded-lg border border-[#3a3a3a] bg-[#2C2C2E] px-2"
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
            <span className="w-14 text-[#9a9a9a]">칸 수</span>
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
              className="rounded border border-[#3a3a3a] px-1.5 py-0.5 disabled:opacity-40"
              disabled={slot.columnCount === null}
              onClick={() => slot.setColumnCount(null)}
              type="button"
            >
              기본
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 text-[#9a9a9a]">프레임</span>
            {(['surround', 'no-surround'] as const).map((mode) => (
              <button
                className={`h-7 flex-1 rounded-lg border ${
                  slot.frameMode === mode
                    ? 'border-[#7564ed] bg-[#26263a]'
                    : 'border-[#3a3a3a] bg-[#2C2C2E]'
                }`}
                key={mode}
                onClick={() => slot.setFrameMode(mode)}
                type="button"
              >
                {mode === 'surround' ? '서라운드' : '노서라운드'}
              </button>
            ))}
          </div>
          <p className="text-[#9a9a9a]">
            {guide.layout.columnCount}칸 × {fmt(guide.layout.slots[0]?.width ?? 0)} mm · 좌{' '}
            {fmt(guide.layout.leftMm)} / 우 {fmt(guide.layout.rightMm)} mm. 모듈을 더블클릭하면 첫
            빈 슬롯에 놓입니다.
          </p>
        </div>
      )}
      {message && <p className="mt-2 text-[#b7b9ff] text-xs">{message}</p>}
    </section>
  )
}
