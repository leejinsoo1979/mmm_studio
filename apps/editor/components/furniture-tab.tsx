'use client'

import { type AnyNodeId, useScene, type WallNode } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import {
  CABINET_PRESETS,
  type CabinetBrush,
  type CabinetNode,
  type CabinetPreset,
  createKitchenOnWall,
  createWardrobesOnWall,
  cutlistCsv,
  downloadCabinetsDxf,
  downloadCabinetsMpr,
  downloadTextFile,
  useCabinetBrush,
  useMyCabinetModules,
} from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'

const GROUPS: { id: CabinetPreset['group']; label: string }[] = [
  { id: 'wardrobe', label: '옷장' },
  { id: 'shoe', label: '선반장 · 현관장' },
  { id: 'kitchen-base', label: '주방 하부장' },
  { id: 'kitchen-lift', label: '도어올림' },
  { id: 'kitchen-top-down', label: '상판내림' },
  { id: 'kitchen-upper', label: '주방 상부장' },
  { id: 'kitchen-tall', label: '키큰장' },
]

/** Gallery tile. The image is mmmcraft's own module thumbnail; modules
 *  mmmcraft has no picture for show their name only. */
function PresetTile({
  preset,
  active,
  onPick,
}: {
  preset: CabinetPreset
  active: boolean
  onPick: () => void
}) {
  const size = useMemo(() => {
    const spec = preset.spec()
    return `${spec.widthMm}×${spec.heightMm}×${spec.depthMm}`
  }, [preset])
  return (
    <button
      className={`flex flex-col gap-1 rounded-xl border p-1.5 text-left transition-colors ${
        active
          ? 'border-[#7779ff] bg-[#26263a]'
          : 'border-[#3a3a3a] bg-[#242424] hover:border-[#5a5a5a]'
      }`}
      onClick={onPick}
      title={preset.description}
      type="button"
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white">
        {preset.thumbnail ? (
          <img alt={preset.label} className="h-full w-full object-contain" src={preset.thumbnail} />
        ) : (
          <span className="px-2 text-center font-medium text-[#555] text-[11px]">
            {preset.label}
          </span>
        )}
      </div>
      <span className="truncate px-0.5 font-medium text-[11px] text-[#e2e2e2]">{preset.label}</span>
      <span className="truncate px-0.5 text-[10px] text-[#8d8d8d]">{size}</span>
    </button>
  )
}

function startPlacing(brush: CabinetBrush) {
  useCabinetBrush.getState().setBrush(brush)
  useEditor.getState().setMode('build')
  useEditor.getState().setTool('cabinet')
}

/** Left-rail "가구" tab: wardrobe / kitchen presets, wall auto-layout, the
 *  user's saved modules and a whole-scene cutlist. */
export function FurnitureTab() {
  const brush = useCabinetBrush((s) => s.brush)
  const tool = useEditor((s) => s.tool)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes)
  const { modules, load, remove } = useMyCabinetModules()
  const [message, setMessage] = useState<string | null>(null)
  const [dishwasher, setDishwasher] = useState(true)
  const [wardrobePreset, setWardrobePreset] = useState('single-2drawer-hanging')

  useEffect(() => load(), [load])

  const selectedWall = useMemo(() => {
    const id = selectedIds[0]
    const node = id ? nodes[id as AnyNodeId] : undefined
    return node?.type === 'wall' ? (node as WallNode) : null
  }, [selectedIds, nodes])

  const cabinets = useMemo(
    () =>
      Object.values(nodes).filter(
        (n) => (n as { type: string }).type === 'cabinet',
      ) as unknown as CabinetNode[],
    [nodes],
  )
  const labeled = useMemo(
    () => cabinets.map((node, i) => ({ node, label: `${i + 1}. ${node.name ?? '가구'}` })),
    [cabinets],
  )

  const placing = tool === 'cabinet'

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#1b1b1b] px-3 pb-6 text-[#efefef]">
      <div className="sticky top-0 z-10 bg-[#1b1b1b] pt-4 pb-2">
        <h2 className="font-bold text-xl">가구 설계</h2>
        <p className="mt-1 text-[#9a9a9a] text-xs">
          모듈을 고른 뒤 벽 가까이 클릭하면 벽에 붙어 배치됩니다. 배치한 가구를 선택하면 오른쪽
          패널에서 칸·서랍·도어를 편집합니다.
        </p>
      </div>

      <section className="mt-2 rounded-xl border border-[#343434] bg-[#202020] p-3">
        <h3 className="font-semibold text-sm">벽에 자동 배치</h3>
        <p className="mt-1 text-[#9a9a9a] text-xs">
          {selectedWall
            ? '선택한 벽의 방 안쪽 면을 따라 배치합니다.'
            : '먼저 도면에서 벽을 하나 선택하세요.'}
        </p>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            checked={dishwasher}
            onChange={(e) => setDishwasher(e.target.checked)}
            type="checkbox"
          />
          식기세척기 포함
        </label>
        <button
          className="mt-2 h-9 w-full rounded-lg bg-[#5557d9] font-medium text-sm hover:bg-[#6668ea] disabled:opacity-40"
          disabled={!selectedWall}
          onClick={() => {
            if (!selectedWall) return
            const result = createKitchenOnWall(selectedWall, { dishwasher })
            setMessage(
              result
                ? `주방 ${result.created}개 부재를 배치했습니다${result.leftoverMm > 0 ? ` (남는 폭 ${result.leftoverMm}mm)` : ''}`
                : '벽이 너무 짧거나 곡선 벽이라 배치할 수 없습니다',
            )
          }}
          type="button"
        >
          ㅡ자 주방 배치
        </button>
        <div className="mt-2 flex gap-1.5">
          <select
            className="h-9 min-w-0 flex-1 rounded-lg border border-[#3a3a3a] bg-[#2C2C2E] px-2 text-xs"
            onChange={(e) => setWardrobePreset(e.target.value)}
            value={wardrobePreset}
          >
            {CABINET_PRESETS.filter((p) => p.group === 'wardrobe' || p.group === 'shoe').map(
              (p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ),
            )}
          </select>
          <button
            className="h-9 rounded-lg border border-[#3a3a3a] bg-[#2C2C2E] px-3 text-xs hover:bg-[#3e3e3e] disabled:opacity-40"
            disabled={!selectedWall}
            onClick={() => {
              if (!selectedWall) return
              const result = createWardrobesOnWall(selectedWall, wardrobePreset)
              setMessage(
                result
                  ? `붙박이장 ${result.created}개를 배치했습니다`
                  : '벽이 너무 짧아 배치할 수 없습니다',
              )
            }}
            type="button"
          >
            벽 전체 붙박이장
          </button>
        </div>
        {message && <p className="mt-2 text-[#b7b9ff] text-xs">{message}</p>}
      </section>

      {GROUPS.map((group) => (
        <section className="mt-4" key={group.id}>
          <h3 className="mb-2 font-semibold text-[#cfcfcf] text-sm">{group.label}</h3>
          <div className="grid grid-cols-3 gap-2">
            {CABINET_PRESETS.filter((p) => p.group === group.id).map((preset) => (
              <PresetTile
                active={placing && brush.kind === 'preset' && brush.presetId === preset.id}
                key={preset.id}
                onPick={() => startPlacing({ kind: 'preset', presetId: preset.id })}
                preset={preset}
              />
            ))}
            {group.id === 'kitchen-base' && (
              <button
                className={`flex min-h-[122px] flex-col items-center justify-center gap-1 rounded-xl border p-1.5 text-[11px] text-[#e2e2e2] ${
                  tool === ('countertop')
                    ? 'border-[#7779ff] bg-[#26263a]'
                    : 'border-[#3a3a3a] bg-[#242424] hover:border-[#5a5a5a]'
                }`}
                onClick={() => {
                  useEditor.getState().setMode('build')
                  useEditor.getState().setTool('countertop')
                }}
                type="button"
              >
                상판
              </button>
            )}
          </div>
        </section>
      ))}

      <section className="mt-4">
        <h3 className="mb-2 font-semibold text-[#cfcfcf] text-sm">내 모듈</h3>
        {modules.length === 0 ? (
          <p className="text-[#8d8d8d] text-xs">
            가구를 선택하고 오른쪽 패널 “제작 정보”에서 “내 모듈로 저장”을 누르면 여기에 모입니다.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {modules.map((m) => (
              <div
                className="flex items-center gap-2 rounded-lg border border-[#343434] bg-[#222] p-1.5"
                key={m.id}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() =>
                    startPlacing({
                      kind: 'custom',
                      label: m.label,
                      spec: m.spec,
                      elevationMm: m.elevationMm,
                    })
                  }
                  type="button"
                >
                  <div className="truncate text-xs">{m.label}</div>
                  <div className="text-[#8d8d8d] text-[10px]">
                    {m.spec.widthMm}×{m.spec.heightMm}×{m.spec.depthMm}
                  </div>
                </button>
                <button
                  className="px-1 text-[#ff9a9a] text-xs hover:underline"
                  onClick={() => remove(m.id)}
                  type="button"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-[#343434] bg-[#202020] p-3">
        <h3 className="font-semibold text-sm">재단목록 · 가공</h3>
        <p className="mt-1 text-[#9a9a9a] text-xs">
          장면의 가구 {cabinets.length}개의 판재를 CSV, 보링 MPR(가공 비활성 미리보기), DXF로
          내려받습니다.
        </p>
        <button
          className="mt-2 h-9 w-full rounded-lg border border-[#3a3a3a] bg-[#2C2C2E] text-sm hover:bg-[#3e3e3e] disabled:opacity-40"
          disabled={cabinets.length === 0}
          onClick={() => downloadTextFile('재단목록.csv', cutlistCsv(labeled))}
          type="button"
        >
          전체 재단목록 CSV
        </button>
        <div className="mt-1.5 flex gap-1.5">
          <button
            className="h-9 flex-1 rounded-lg border border-[#3a3a3a] bg-[#2C2C2E] text-sm hover:bg-[#3e3e3e] disabled:opacity-40"
            disabled={cabinets.length === 0}
            onClick={() => downloadCabinetsMpr('전체', labeled)}
            type="button"
          >
            MPR 미리보기
          </button>
          <button
            className="h-9 flex-1 rounded-lg border border-[#3a3a3a] bg-[#2C2C2E] text-sm hover:bg-[#3e3e3e] disabled:opacity-40"
            disabled={cabinets.length === 0}
            onClick={() => downloadCabinetsDxf('전체', labeled)}
            type="button"
          >
            보링 DXF
          </button>
        </div>
      </section>
    </div>
  )
}
