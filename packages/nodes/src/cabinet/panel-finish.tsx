'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { PanelSection, SegmentedControl, ToggleControl } from '@pascal-app/editor'
import { cabinetFrame } from './engine/parts'
import {
  endPanelTogglePatch,
  petThicknessMm,
  type StoneThickness,
  stoneHeightWarning,
  stoneThicknessPatch,
  topEndPanelPatch,
} from './finish-updates'
import { MmField } from './panel-fields'
import { type CabinetNode, resolveCabinetNode } from './schema'

type Update = (patch: Partial<CabinetNode>) => void
type EpOptions = CabinetNode['endPanelOptions']

const note = 'text-[11px] text-muted-foreground leading-snug'

/** An EP gap that follows the frames until typed over; 자동 goes back. */
function AutoGapField({
  label,
  value,
  auto,
  onCommit,
}: {
  label: string
  value: number
  auto: boolean
  onCommit: (v: number | null) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1">
        <MmField label={label} max={500} min={-500} onCommit={onCommit} value={value} />
      </div>
      <button
        className="h-9 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-xs hover:bg-[#3e3e3e] disabled:opacity-40"
        disabled={auto}
        onClick={() => onCommit(null)}
        type="button"
      >
        자동
      </button>
    </div>
  )
}

/** mmmcraft 엔드패널: 내/외치, sides, gaps, thickness, depth and offsets,
 *  plus 하부 EP (upper) / 상부 EP (base). */
export function EndPanelSection({ node, update }: { node: CabinetNode; update: Update }) {
  const ep = node.endPanelOptions
  const f = cabinetFrame(node)
  const setEp = (next: Partial<EpOptions>) => update({ endPanelOptions: { ...ep, ...next } })
  const hasSide = node.endPanels.left || node.endPanels.right
  const baseDepth = node.depthMm + 19
  return (
    <PanelSection defaultExpanded={false} title="엔드패널">
      <div className="text-muted-foreground text-xs">내/외치</div>
      <SegmentedControl
        onChange={(mode) => setEp({ mode })}
        options={[
          { label: '내치', value: 'inside' },
          { label: '외치', value: 'outside' },
        ]}
        value={ep.mode}
      />
      <ToggleControl
        checked={node.endPanels.left}
        label="좌측 EP"
        onChange={(on) => update(endPanelTogglePatch(node, 'left', on))}
      />
      <ToggleControl
        checked={node.endPanels.right}
        label="우측 EP"
        onChange={(on) => update(endPanelTogglePatch(node, 'right', on))}
      />
      {node.family === 'upper' && (
        <ToggleControl
          checked={node.bottomEndPanel.enabled}
          label="하부 EP"
          onChange={(enabled) => update({ bottomEndPanel: { ...node.bottomEndPanel, enabled } })}
        />
      )}
      {node.family === 'base' && (
        <ToggleControl
          checked={node.topEndPanel.enabled}
          label="상부 EP"
          onChange={(enabled) => {
            if (
              enabled &&
              node.stoneTop.thicknessMm > 0 &&
              !window.confirm('상판을 상부 EP로 교체하시겠습니까?')
            )
              return
            update(topEndPanelPatch(node, enabled))
          }}
        />
      )}
      {hasSide && (
        <>
          <AutoGapField
            auto={ep.topGapMm == null}
            label="상단 갭 (몸통↑)"
            onCommit={(topGapMm) => setEp({ topGapMm })}
            value={f.epTopGap}
          />
          <AutoGapField
            auto={ep.bottomGapMm == null}
            label="하단 갭 (몸통↓)"
            onCommit={(bottomGapMm) => setEp({ bottomGapMm })}
            value={f.epBottomGap}
          />
        </>
      )}
      <MmField
        label="EP 두께"
        max={200}
        min={10}
        onCommit={(t) => setEp({ thicknessMm: petThicknessMm(t) })}
        value={ep.thicknessMm}
      />
      {node.endPanels.left && (
        <>
          <div className="flex justify-between px-1 text-xs">
            <span className="text-muted-foreground">좌EP깊이</span>
            <span className="tabular-nums">{baseDepth + ep.leftFrontMm + ep.leftBackMm} mm</span>
          </div>
          <MmField
            label="좌EP 옵셋 (앞 →)"
            max={1180}
            min={-580}
            onCommit={(leftFrontMm) => setEp({ leftFrontMm })}
            value={ep.leftFrontMm}
          />
          <MmField
            label="좌EP 옵셋 (뒤 ←)"
            max={1180}
            min={-580}
            onCommit={(leftBackMm) => setEp({ leftBackMm })}
            value={ep.leftBackMm}
          />
        </>
      )}
      {node.endPanels.right && (
        <>
          <div className="flex justify-between px-1 text-xs">
            <span className="text-muted-foreground">우EP깊이</span>
            <span className="tabular-nums">{baseDepth + ep.rightFrontMm + ep.rightBackMm} mm</span>
          </div>
          <MmField
            label="우EP 옵셋 (앞 →)"
            max={1180}
            min={-580}
            onCommit={(rightFrontMm) => setEp({ rightFrontMm })}
            value={ep.rightFrontMm}
          />
          <MmField
            label="우EP 옵셋 (뒤 ←)"
            max={1180}
            min={-580}
            onCommit={(rightBackMm) => setEp({ rightBackMm })}
            value={ep.rightBackMm}
          />
        </>
      )}
      {node.family === 'upper' && node.bottomEndPanel.enabled && (
        <>
          <MmField
            label="하부 EP 전면갭"
            max={200}
            min={-580}
            onCommit={(frontGapMm) =>
              update({ bottomEndPanel: { ...node.bottomEndPanel, frontGapMm } })
            }
            value={node.bottomEndPanel.frontGapMm}
          />
          <MmField
            label="하부 EP 후면갭"
            max={580}
            min={0}
            onCommit={(v) =>
              update({ bottomEndPanel: { ...node.bottomEndPanel, backGapMm: -Math.abs(v) } })
            }
            value={Math.abs(node.bottomEndPanel.backGapMm)}
          />
        </>
      )}
      {node.family === 'base' && node.topEndPanel.enabled && (
        <TopEndPanelFields node={node} update={update} />
      )}
      <p className={note}>
        옵셋은 + 일수록 EP가 앞(→) / 뒤(←)로 늘어납니다. 갭은 몸통 위·아래로 EP가 더 내려가거나
        올라가는 길이입니다.
      </p>
    </PanelSection>
  )
}

function TopEndPanelFields({ node, update }: { node: CabinetNode; update: Update }) {
  const top = node.topEndPanel
  const set = (next: Partial<CabinetNode['topEndPanel']>) =>
    update({ topEndPanel: { ...top, ...next } })
  return (
    <>
      <MmField
        label="상부 EP 전면옵셋"
        max={200}
        min={-580}
        onCommit={(frontOffsetMm) => set({ frontOffsetMm })}
        value={top.frontOffsetMm}
      />
      <MmField
        label="상부 EP 후면옵셋"
        max={200}
        min={-580}
        onCommit={(backOffsetMm) => set({ backOffsetMm })}
        value={top.backOffsetMm}
      />
      <div className="text-muted-foreground text-xs">뒷턱</div>
      <SegmentedControl
        onChange={(v) =>
          set({
            backLip:
              v === 'on' ? { heightMm: 100, thicknessMm: node.endPanelOptions.thicknessMm } : null,
          })
        }
        options={[
          { label: '없음', value: 'off' },
          { label: '사용', value: 'on' },
        ]}
        value={top.backLip ? 'on' : 'off'}
      />
      {top.backLip && (
        <>
          <MmField
            label="뒷턱 높이"
            max={2000}
            min={1}
            onCommit={(heightMm) => top.backLip && set({ backLip: { ...top.backLip, heightMm } })}
            value={top.backLip.heightMm}
          />
          <MmField
            label="뒷턱 두께"
            max={100}
            min={1}
            onCommit={(t) =>
              top.backLip && set({ backLip: { ...top.backLip, thicknessMm: petThicknessMm(t) } })
            }
            value={top.backLip.thicknessMm}
          />
        </>
      )}
    </>
  )
}

/**
 * mmmcraft 상판설치 (base cabinets): the 인조대리석 thickness goes to every
 * base cabinet on the level, each keeping its total height.
 */
export function StoneTopSection({ node, update }: { node: CabinetNode; update: Update }) {
  if (node.family !== 'base') return null
  const stone = node.stoneTop
  const set = (next: Partial<CabinetNode['stoneTop']>) =>
    update({ stoneTop: { ...stone, ...next } })
  const setThickness = (t: StoneThickness) => {
    if (
      t > 0 &&
      node.topEndPanel.enabled &&
      !window.confirm('상판을 인조대리석으로 교체하시겠습니까?')
    )
      return
    const scene = useScene.getState()
    const targets = Object.values(scene.nodes).filter((n) => {
      const c = n as unknown as CabinetNode
      return c?.type === 'cabinet' && c.family === 'base' && c.parentId === node.parentId
    }) as unknown as CabinetNode[]
    scene.updateNodes(
      targets.map(resolveCabinetNode).map((c) => ({
        id: c.id as AnyNodeId,
        data: stoneThicknessPatch(c, t) as Partial<AnyNode>,
      })),
    )
  }
  const warning = stoneHeightWarning(node)
  const lip = stone.backLip
  return (
    <PanelSection defaultExpanded={false} title="상판설치">
      <SegmentedControl
        onChange={(v) => setThickness(Number(v) as StoneThickness)}
        options={[
          { label: '없음', value: '0' },
          { label: '10mm', value: '10' },
          { label: '20mm', value: '20' },
          { label: '30mm', value: '30' },
        ]}
        value={String(stone.thicknessMm)}
      />
      {warning && <p className="text-[#f5c48a] text-[11px]">{warning}</p>}
      {stone.thicknessMm > 0 && (
        <>
          <MmField
            label="앞"
            max={200}
            min={-200}
            onCommit={(frontMm) => set({ frontMm })}
            value={stone.frontMm}
          />
          <MmField
            label="뒤"
            max={200}
            min={-200}
            onCommit={(backMm) => set({ backMm })}
            value={stone.backMm}
          />
          <div className="text-muted-foreground text-xs">뒷턱</div>
          <SegmentedControl
            onChange={(v) =>
              set({
                backLip:
                  v === '0'
                    ? null
                    : {
                        thicknessMm: Number(v) as 10 | 20 | 30,
                        heightMm: lip?.heightMm ?? 100,
                      },
              })
            }
            options={[
              { label: '없음', value: '0' },
              { label: '10mm', value: '10' },
              { label: '20mm', value: '20' },
              { label: '30mm', value: '30' },
            ]}
            value={String(lip?.thicknessMm ?? 0)}
          />
          {lip && (
            <MmField
              label="뒷턱 높이"
              max={2000}
              min={1}
              onCommit={(heightMm) => set({ backLip: { ...lip, heightMm } })}
              value={lip.heightMm}
            />
          )}
          <p className={note}>
            두께는 같은 층의 하부장 전체에 적용되고, 상판 두께만큼 본체 높이가 조정되어 총 높이가
            유지됩니다.
          </p>
        </>
      )}
    </PanelSection>
  )
}

/** mmmcraft 상판 따내기 (upper cabinets): 340×140 / 680×140 at a back corner. */
export function TopNotchSection({ node, update }: { node: CabinetNode; update: Update }) {
  if (node.family !== 'upper') return null
  const notch = node.topNotch
  const f = cabinetFrame(node)
  // 680 only fits a top wider than 680 (mmmcraft offers it on two-slot cabinets).
  const topWidth = f.carcassX1 - f.carcassX0 - 2 * f.T
  const sizes = [
    { label: '없음', value: 'none' },
    ...(topWidth > 680 ? [{ label: '680×140', value: '680' }] : []),
    { label: '340×140', value: '340' },
  ]
  return (
    <PanelSection defaultExpanded={false} title="상판 따내기">
      <SegmentedControl
        onChange={(v) =>
          update({
            topNotch:
              v === 'none'
                ? null
                : { widthMm: Number(v) as 340 | 680, side: notch?.side ?? 'right' },
          })
        }
        options={sizes}
        value={notch ? String(notch.widthMm) : 'none'}
      />
      {notch && (
        <SegmentedControl
          onChange={(side) => update({ topNotch: { ...notch, side } })}
          options={[
            { label: '좌', value: 'left' },
            { label: '우', value: 'right' },
          ]}
          value={notch.side}
        />
      )}
    </PanelSection>
  )
}
