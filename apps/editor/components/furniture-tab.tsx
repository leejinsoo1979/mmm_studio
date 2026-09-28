'use client'

import { type AnyNodeId, useScene, type WallNode } from '@pascal-app/core'
import {
  CATALOG_BAND_ACTION,
  CATALOG_SCROLL,
  CatalogCard,
  CatalogSearchBand,
  CatalogSection,
  useEditor,
} from '@pascal-app/editor'
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
  placePresetInSlot,
  useCabinetBrush,
  useMyCabinetModules,
  useSlotMode,
} from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { Info, Layers2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/toolbar-tooltip'
import { FurnitureSlotSection } from './furniture-slot-section'

const GROUPS: { id: CabinetPreset['group']; label: string }[] = [
  { id: 'wardrobe', label: '옷장' },
  { id: 'shoe', label: '선반장 · 현관장' },
  { id: 'kitchen-base', label: '주방 하부장' },
  { id: 'kitchen-lift', label: '도어올림' },
  { id: 'kitchen-top-down', label: '상판내림' },
  { id: 'kitchen-upper', label: '주방 상부장' },
  { id: 'kitchen-tall', label: '키큰장' },
]

/** Gallery card. The image is mmmcraft's own module thumbnail. */
function PresetCard({
  preset,
  active,
  onPick,
  onDoublePick,
}: {
  preset: CabinetPreset
  active: boolean
  onPick: () => void
  onDoublePick: () => void
}) {
  const spec = useMemo(() => preset.spec(), [preset])
  return (
    <CatalogCard
      active={active}
      hover={{
        description: `${preset.description} · 더블클릭하면 슬롯 가이드의 첫 빈 칸에 놓입니다.`,
        meta: `${spec.widthMm}×${spec.heightMm}×${spec.depthMm} mm`,
      }}
      image={preset.thumbnail}
      label={preset.label}
      meta={`${spec.widthMm}`}
      onClick={onPick}
      onDoubleClick={onDoublePick}
    />
  )
}

const PANEL_FORM =
  'rounded-[10px] bg-[var(--panel-card,#f3f3f3)] p-3 text-[var(--panel-card-fg,#333)]'
const FORM_BUTTON =
  'h-9 rounded-lg bg-white/80 px-3 text-xs transition-colors hover:bg-white disabled:opacity-40 dark:bg-white/10 dark:hover:bg-white/15'

function startPlacing(brush: CabinetBrush) {
  useCabinetBrush.getState().setBrush(brush)
  useEditor.getState().setMode('build')
  useEditor.getState().setTool('cabinet')
}

/** "가구" tab: wardrobe / kitchen preset cards, the user's saved modules,
 *  then the slot guide, wall auto-layout and whole-scene cutlist. */
export function FurnitureTab() {
  const brush = useCabinetBrush((s) => s.brush)
  const tool = useEditor((s) => s.tool)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes)
  const { modules, load, remove } = useMyCabinetModules()
  const [message, setMessage] = useState<string | null>(null)
  const [dishwasher, setDishwasher] = useState(true)
  const [wardrobePreset, setWardrobePreset] = useState('single-2drawer-hanging')
  const [query, setQuery] = useState('')

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
  const slotEnabled = useSlotMode((s) => s.enabled)

  // mmmcraft: double-clicking a module places it straight into the first
  // free slot of the reference wall (the single click's free placement is
  // dropped again).
  const placeInSlot = (presetId: string) => {
    if (!slotEnabled) return
    useEditor.getState().setTool(null)
    useEditor.getState().setMode('select')
    const result = placePresetInSlot(presetId)
    if ('error' in result) setMessage(result.error)
    else {
      setMessage(null)
      useViewer.getState().setSelection({ selectedIds: [result.id as AnyNodeId] })
    }
  }

  const needle = query.trim()
  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    presets: CABINET_PRESETS.filter(
      (p) =>
        p.group === group.id &&
        (!needle || group.label.includes(needle) || p.label.includes(needle)),
    ),
    countertop: group.id === 'kitchen-base' && (!needle || '상판 주방 하부장'.includes(needle)),
  })).filter((group) => group.presets.length > 0 || group.countertop)
  const visibleModules = modules.filter((m) => !needle || m.label.includes(needle))

  return (
    <div className="flex h-full flex-col text-foreground">
      <CatalogSearchBand
        actions={
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span aria-label="도움말" className={CATALOG_BAND_ACTION} role="img">
                  <Info />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[240px]" side="right">
                모듈을 고른 뒤 벽 가까이 클릭하면 벽에 붙어 배치됩니다. 배치한 가구를 선택하면
                오른쪽 패널에서 칸·서랍·도어를 편집합니다.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
        onChange={setQuery}
        value={query}
      />

      <div className={`${CATALOG_SCROLL} pb-3`}>
        {visibleGroups.map((group) => (
          <CatalogSection key={group.id} title={group.label}>
            {group.presets.map((preset) => (
              <PresetCard
                active={placing && brush.kind === 'preset' && brush.presetId === preset.id}
                key={preset.id}
                onDoublePick={() => placeInSlot(preset.id)}
                onPick={() => startPlacing({ kind: 'preset', presetId: preset.id })}
                preset={preset}
              />
            ))}
            {group.countertop && (
              <CatalogCard
                active={tool === 'countertop'}
                hover={{ description: '주방 하부장 위에 상판을 그립니다.' }}
                label="상판"
                meta="상판"
                onClick={() => {
                  useEditor.getState().setMode('build')
                  useEditor.getState().setTool('countertop')
                }}
                thumb={
                  <Layers2 className="size-7 text-[#555] dark:text-neutral-300" strokeWidth={1.5} />
                }
              />
            )}
          </CatalogSection>
        ))}

        <CatalogSection grid={false} title="내 모듈">
          {visibleModules.length === 0 ? (
            <p className={`${PANEL_FORM} text-xs`}>
              가구를 선택하고 오른쪽 패널 “제작 정보”에서 “내 모듈로 저장”을 누르면 여기에 모입니다.
            </p>
          ) : (
            <div className="flex flex-col gap-[5px]">
              {visibleModules.map((m) => (
                <div
                  className="flex items-center gap-2 rounded-[10px] bg-[var(--panel-card,#f3f3f3)] p-2 text-[var(--panel-card-fg,#333)]"
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
                    <div className="text-[10px] opacity-70 tabular-nums">
                      {m.spec.widthMm}×{m.spec.heightMm}×{m.spec.depthMm}
                    </div>
                  </button>
                  <button
                    className="px-1 text-[#d64545] text-xs hover:underline dark:text-[#ff9a9a]"
                    onClick={() => remove(m.id)}
                    type="button"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          )}
        </CatalogSection>

        <CatalogSection grid={false} title="자동 배치 · 도구">
          <div className="flex flex-col gap-[5px]">
            <FurnitureSlotSection selectedWall={selectedWall} />

            <section className={PANEL_FORM}>
              <h3 className="font-semibold text-sm">벽에 자동 배치</h3>
              <p className="mt-1 text-xs opacity-70">
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
                className="mt-2 h-9 w-full rounded-lg bg-[#8ec3f2] font-semibold text-sm text-white transition-colors hover:bg-[#7ab6ea] disabled:bg-neutral-300 disabled:text-neutral-500 dark:disabled:bg-white/10 dark:disabled:text-neutral-500"
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
                  className="h-9 min-w-0 flex-1 rounded-lg bg-white/80 px-2 text-xs dark:bg-white/10"
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
                  className={FORM_BUTTON}
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
              {message && (
                <p className="mt-2 text-[#3d8fd6] text-xs dark:text-sky-300">{message}</p>
              )}
            </section>

            <section className={PANEL_FORM}>
              <h3 className="font-semibold text-sm">재단목록 · 가공</h3>
              <p className="mt-1 text-xs opacity-70">
                장면의 가구 {cabinets.length}개의 판재를 CSV, 보링 MPR(가공 비활성 미리보기), DXF로
                내려받습니다.
              </p>
              <button
                className={`${FORM_BUTTON} mt-2 w-full`}
                disabled={cabinets.length === 0}
                onClick={() => downloadTextFile('재단목록.csv', cutlistCsv(labeled))}
                type="button"
              >
                전체 재단목록 CSV
              </button>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  className={`${FORM_BUTTON} flex-1`}
                  disabled={cabinets.length === 0}
                  onClick={() => downloadCabinetsMpr('전체', labeled)}
                  type="button"
                >
                  MPR 미리보기
                </button>
                <button
                  className={`${FORM_BUTTON} flex-1`}
                  disabled={cabinets.length === 0}
                  onClick={() => downloadCabinetsDxf('전체', labeled)}
                  type="button"
                >
                  보링 DXF
                </button>
              </div>
            </section>
          </div>
        </CatalogSection>
      </div>
    </div>
  )
}
