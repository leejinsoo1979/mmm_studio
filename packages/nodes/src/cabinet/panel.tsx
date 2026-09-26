'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  ToggleControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { downloadCabinetsDxf, downloadCabinetsMpr, downloadTextFile } from './download'
import { cabinetHardwareRows, cutlistCsv } from './engine/cutlist'
import { buildCabinetParts, type CabinetBuild } from './engine/parts'
import {
  findCell,
  findParent,
  frontOwnerOf,
  isStackedRoot,
  mergeCell,
  removeCell,
  setCellContent,
  setCellFront,
  setCellHasBack,
  setCellSize,
  setSplitJoint,
  splitCell,
} from './engine/tree'
import { useMyCabinetModules } from './my-modules'
import { DoorSettingsSection, DoorSizeSection, HingeEditor } from './panel-doors'
import { ColorField, HeightsField, MmField } from './panel-fields'
import { EndPanelSection, StoneTopSection, TopNotchSection } from './panel-finish'
import { DepthAnchorControl, ToeKickSection, TopMouldingSection } from './panel-frames'
import { PanelListTab } from './panel-list'
import { PresetButtons } from './panel-presets'
import { RodShelfSettings, ShelfSettings } from './panel-shelves'
import { backWallGapPatch, depthPatch } from './placement-updates'
import {
  type CabinetCell,
  type CabinetNode,
  type CellContent,
  type CellFront,
  resolveCabinetNode,
} from './schema'

const FAMILY_LABEL = { tall: '키큰장', base: '하부장', upper: '상부장' } as const
const VARIANT_LABEL = {
  standard: '일반',
  sink: '싱크',
  dishwasher: '식세기',
  cooktop: '인덕션',
  appliance: '가전',
} as const

/**
 * Front elevation of the cabinet (drawn from the part list) with clickable
 * compartments. The selected compartment is highlighted; the front that
 * covers it is outlined.
 */
function Elevation({
  node,
  build,
  selectedId,
  onSelect,
}: {
  node: CabinetNode
  build: CabinetBuild
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const W = node.widthMm
  const H = node.heightMm
  const top = node.family === 'upper' ? Math.min(0, ...build.parts.map((p) => p.box.y)) : 0
  // Parts above the carcass (상단몰딩) extend the drawing upwards.
  const above = Math.max(0, ...build.parts.map((p) => p.box.y + p.box.h - H))
  const pad = 40
  const vb = `${-pad} ${-pad - above} ${W + pad * 2} ${H - top + above + pad * 2}`
  const fy = (y: number, h: number) => H - (y + h)
  const owner = selectedId ? frontOwnerOf(node.interior, selectedId) : null
  const ownerRect = owner ? build.frontRects.find((f) => f.id === owner.id)?.rect : undefined
  const selectedRect = selectedId ? build.cellRects.get(selectedId) : undefined
  return (
    <svg className="w-full rounded-lg border border-border/50 bg-[#1f1f22]" role="img" viewBox={vb}>
      <title>정면도</title>
      {build.parts
        .filter((p) =>
          [
            'side',
            'bottom',
            'top',
            'top-band',
            'divider',
            'fixed-shelf',
            'toe-kick',
            'top-moulding',
            'end-panel',
            'front-rail',
          ].includes(p.role),
        )
        .map((p) => (
          <rect
            fill={
              p.role === 'toe-kick' || p.role === 'end-panel' || p.role === 'top-moulding'
                ? '#6b6258'
                : '#8b8175'
            }
            height={p.box.h}
            key={p.id}
            width={p.box.w}
            x={p.box.x}
            y={fy(p.box.y, p.box.h)}
          />
        ))}
      {build.parts
        .filter((p) => p.role === 'shelf')
        .map((p) => (
          <rect
            fill="#a89e91"
            height={p.box.h}
            key={p.id}
            width={p.box.w}
            x={p.box.x}
            y={fy(p.box.y, p.box.h)}
          />
        ))}
      {build.parts
        .filter((p) => p.role === 'rod')
        .map((p) => (
          <line
            key={p.id}
            stroke="#c9c9c9"
            strokeWidth={20}
            x1={p.box.x}
            x2={p.box.x + p.box.w}
            y1={fy(p.box.y, p.box.h) + p.box.h / 2}
            y2={fy(p.box.y, p.box.h) + p.box.h / 2}
          />
        ))}
      {build.parts
        .filter(
          (p) => p.role === 'pants-hanger' || p.role === 'drawer-front' || p.role === 'appliance',
        )
        .map((p) => (
          <rect
            fill="none"
            height={p.box.h}
            key={p.id}
            stroke={p.role === 'drawer-front' ? '#d8cbb8' : '#9aa3ad'}
            strokeWidth={8}
            width={p.box.w}
            x={p.box.x}
            y={fy(p.box.y, p.box.h)}
          />
        ))}
      {build.frontRects.map((f) => (
        <rect
          fill="none"
          height={f.rect.y1 - f.rect.y0}
          key={`front-${f.id}`}
          stroke={ownerRect === f.rect ? '#7779ff' : '#5b5b66'}
          strokeDasharray="30 18"
          strokeWidth={ownerRect === f.rect ? 10 : 6}
          width={f.rect.x1 - f.rect.x0}
          x={f.rect.x0}
          y={fy(f.rect.y0, f.rect.y1 - f.rect.y0)}
        />
      ))}
      {build.leaves.map((leaf) => {
        const r = leaf.rect
        const selected = selectedId === leaf.id
        return (
          <g key={leaf.id} onClick={() => onSelect(leaf.id)} style={{ cursor: 'pointer' }}>
            <rect
              fill={selected ? 'rgba(119,121,255,0.28)' : 'rgba(255,255,255,0.02)'}
              height={r.y1 - r.y0}
              stroke={selected ? '#7779ff' : 'transparent'}
              strokeWidth={10}
              width={r.x1 - r.x0}
              x={r.x0}
              y={fy(r.y0, r.y1 - r.y0)}
            />
            <text
              fill="#e5e5e5"
              fontSize={Math.max(40, Math.min(70, (r.x1 - r.x0) / 6))}
              pointerEvents="none"
              textAnchor="middle"
              x={(r.x0 + r.x1) / 2}
              y={fy(r.y0, r.y1 - r.y0) + (r.y1 - r.y0) / 2}
            >
              {Math.round(r.x1 - r.x0)}×{Math.round(r.y1 - r.y0)}
            </text>
          </g>
        )
      })}
      {selectedRect && !build.leaves.some((l) => l.id === selectedId) && (
        <rect
          fill="rgba(119,121,255,0.12)"
          height={selectedRect.y1 - selectedRect.y0}
          pointerEvents="none"
          stroke="#7779ff"
          strokeWidth={12}
          width={selectedRect.x1 - selectedRect.x0}
          x={selectedRect.x0}
          y={fy(selectedRect.y0, selectedRect.y1 - selectedRect.y0)}
        />
      )}
    </svg>
  )
}

function contentLabel(c: CellContent): string {
  if (c.type === 'empty') return '비움'
  if (c.type === 'shelves') return `선반 ${c.count}`
  if (c.type === 'hanging') return c.rod === 'rod' ? '옷봉' : '바지걸이'
  return `${c.style === 'inner' ? '속서랍' : '겉서랍'} ${c.count}`
}

function CellEditor({
  node,
  build,
  cellId,
  onTree,
  onSelect,
}: {
  node: CabinetNode
  build: CabinetBuild
  cellId: string
  onTree: (tree: CabinetCell) => void
  onSelect: (id: string | null) => void
}) {
  const root = node.interior
  const cell = findCell(root, cellId)
  const parent = findParent(root, cellId)
  if (!cell) return null
  const owner = frontOwnerOf(root, cellId)
  const inheritedFront = owner && owner.id !== cell.id ? owner : null
  const front = cell.front
  const sizeIndex =
    parent?.kind === 'split' ? parent.children.findIndex((c) => c.id === cellId) : -1
  const fixedSize = parent?.kind === 'split' ? (parent.sizesMm[sizeIndex] ?? null) : null
  const setContent = (content: CellContent) => onTree(setCellContent(root, cellId, content))
  const setFront = (next: CellFront | null) => onTree(setCellFront(root, cellId, next))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>
          {cell.kind === 'leaf'
            ? `칸 · ${contentLabel(cell.content)}`
            : `묶음 · ${cell.axis === 'x' ? '세로 칸' : '가로 단'} ${cell.children.length}개`}
        </span>
        {parent && (
          <button
            className="text-[#9a9cff] hover:underline"
            onClick={() => onSelect(parent.id)}
            type="button"
          >
            상위 선택
          </button>
        )}
      </div>

      <ActionGroup>
        <ActionButton
          label="세로로 나누기"
          onClick={() => onTree(splitCell(root, cellId, 'x', 2))}
        />
        <ActionButton
          label="가로로 나누기"
          onClick={() => onTree(splitCell(root, cellId, 'y', 2))}
        />
      </ActionGroup>
      <ActionGroup>
        {cell.kind === 'split' && (
          <ActionButton label="합치기" onClick={() => onTree(mergeCell(root, cellId))} />
        )}
        {parent && (
          <ActionButton
            label="이 칸 삭제"
            onClick={() => {
              onTree(removeCell(root, cellId))
              onSelect(parent.id)
            }}
          />
        )}
      </ActionGroup>

      {cell.kind === 'split' && cell.axis === 'y' && cell.id === root.id && (
        <ToggleControl
          checked={cell.joint === 'stack'}
          label="단마다 몸통 분리 (하·상 몸통)"
          onChange={(on) => onTree(setSplitJoint(root, cellId, on ? 'stack' : 'shelf'))}
        />
      )}
      {parent?.id === root.id && isStackedRoot(root) && (
        <ToggleControl
          checked={cell.hasBack !== false}
          label="이 단 뒷판"
          onChange={(on) => onTree(setCellHasBack(root, cellId, on))}
        />
      )}
      {parent && (
        <div className="flex items-center gap-1.5">
          <div className="flex-1">
            <MmField
              label={parent.kind === 'split' && parent.axis === 'x' ? '폭 고정' : '높이 고정'}
              min={50}
              onCommit={(v) => onTree(setCellSize(root, cellId, v))}
              value={
                fixedSize ??
                Math.round(sizeOf(node, cellId, parent.kind === 'split' ? parent.axis : 'x'))
              }
            />
          </div>
          <button
            className="h-9 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-xs hover:bg-[#3e3e3e] disabled:opacity-40"
            disabled={fixedSize == null}
            onClick={() => onTree(setCellSize(root, cellId, null))}
            type="button"
          >
            자동
          </button>
        </div>
      )}

      {cell.kind === 'leaf' && (
        <>
          <SegmentedControl
            onChange={(type) => {
              if (type === 'empty') setContent({ type: 'empty' })
              if (type === 'shelves') setContent({ type: 'shelves', count: 2, kind: 'dowel' })
              if (type === 'hanging') setContent({ type: 'hanging', rod: 'rod' })
              if (type === 'drawers')
                setContent({ type: 'drawers', count: 3, style: 'inner', stepMm: 200 })
            }}
            options={[
              { label: '비움', value: 'empty' },
              { label: '선반', value: 'shelves' },
              { label: '옷봉', value: 'hanging' },
              { label: '서랍', value: 'drawers' },
            ]}
            value={cell.content.type}
          />
          {cell.content.type === 'shelves' && (
            <>
              <SegmentedControl
                onChange={(kind) =>
                  cell.content.type === 'shelves' && setContent({ ...cell.content, kind })
                }
                options={[
                  { label: '이동선반', value: 'dowel' },
                  { label: '고정선반', value: 'fixed' },
                ]}
                value={cell.content.kind}
              />
              <ShelfSettings
                build={build}
                content={cell.content}
                leafId={cell.id}
                node={node}
                onContent={setContent}
              />
            </>
          )}
          {cell.content.type === 'hanging' && (
            <>
              <SegmentedControl
                onChange={(rod) =>
                  cell.content.type === 'hanging' && setContent({ ...cell.content, rod })
                }
                options={[
                  { label: '옷봉', value: 'rod' },
                  { label: '바지걸이', value: 'pants' },
                ]}
                value={cell.content.rod}
              />
              <RodShelfSettings
                build={build}
                content={cell.content}
                leafId={cell.id}
                node={node}
                onContent={setContent}
              />
            </>
          )}
          {cell.content.type === 'drawers' && (
            <>
              <SegmentedControl
                onChange={(style) =>
                  cell.content.type === 'drawers' && setContent({ ...cell.content, style })
                }
                options={[
                  { label: '속서랍', value: 'inner' },
                  { label: '겉서랍', value: 'external' },
                ]}
                value={cell.content.style}
              />
              <MmField
                label="서랍 수"
                max={8}
                min={1}
                onCommit={(v) =>
                  cell.content.type === 'drawers' &&
                  setContent({ ...cell.content, count: Math.round(v), heightsMm: undefined })
                }
                value={cell.content.count}
              />
              {cell.content.style === 'inner' && (
                <HeightsField
                  label="앞판 높이 (아래→위)"
                  onCommit={(heightsMm) =>
                    cell.content.type === 'drawers' &&
                    setContent({
                      ...cell.content,
                      count: heightsMm.length,
                      stepMm: heightsMm[0] ?? 250,
                      heightsMm,
                    })
                  }
                  value={
                    cell.content.heightsMm ??
                    Array.from({ length: cell.content.count }, () =>
                      cell.content.type === 'drawers' ? cell.content.stepMm : 0,
                    )
                  }
                />
              )}
            </>
          )}
        </>
      )}

      <div className="mt-1 text-muted-foreground text-xs">
        앞판{inheritedFront ? ' — 상위 묶음의 앞판이 덮고 있습니다' : ''}
      </div>
      <SegmentedControl
        onChange={(type) => {
          if (type === 'inherit') setFront(null)
          else setFront({ type, leaves: front?.leaves ?? 'auto', hinge: front?.hinge ?? 'auto' })
        }}
        options={[
          { label: '없음', value: 'inherit' },
          { label: '여닫이', value: 'door' },
          { label: '플랩', value: 'flap' },
          { label: '전판', value: 'panel' },
        ]}
        value={front ? (front.type === 'none' ? 'inherit' : front.type) : 'inherit'}
      />
      {front?.type === 'door' && (
        <>
          <SegmentedControl
            onChange={(leaves) => setFront({ ...front, leaves })}
            options={[
              { label: '자동', value: 'auto' },
              { label: '외문', value: '1' },
              { label: '양문', value: '2' },
            ]}
            value={front.leaves}
          />
          {front.leaves !== '2' && (
            <>
              <div className="mt-1 text-muted-foreground text-xs">경첩 방향</div>
              <SegmentedControl
                onChange={(hinge) => setFront({ ...front, hinge })}
                options={[
                  { label: '자동', value: 'auto' },
                  { label: '좌측 · 오른쪽으로 열림', value: 'left' },
                  { label: '우측 · 왼쪽으로 열림', value: 'right' },
                ]}
                value={front.hinge}
              />
            </>
          )}
          <div className="mt-1 text-muted-foreground text-xs">경첩 위치</div>
          <HingeEditor
            build={build}
            front={front}
            node={node}
            onFront={(next) => setFront(next)}
            ownerId={cell.id}
          />
        </>
      )}
    </div>
  )
}

function sizeOf(node: CabinetNode, cellId: string, axis: 'x' | 'y'): number {
  const rect = buildCabinetParts(node).cellRects.get(cellId)
  if (!rect) return 0
  return axis === 'x' ? rect.x1 - rect.x0 : rect.y1 - rect.y0
}

export default function CabinetPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const raw = useScene((s) =>
    selectedId
      ? (s.nodes[selectedId as AnyNodeId] as unknown as CabinetNode | undefined)
      : undefined,
  )
  const node = raw?.type === 'cabinet' ? resolveCabinetNode(raw) : raw
  const [cellId, setCellId] = useState<string | null>(null)
  const [tab, setTab] = useState<'edit' | 'list'>('edit')
  const [moduleName, setModuleName] = useState('')
  const saveModule = useMyCabinetModules((s) => s.save)
  const build = useMemo(() => (node?.type === 'cabinet' ? buildCabinetParts(node) : null), [node])

  // Keep the selected compartment valid across edits / selection changes.
  useEffect(() => {
    if (node?.type !== 'cabinet') return
    if (!cellId || !findCell(node.interior, cellId)) setCellId(node.interior.id)
  }, [node, cellId])

  const update = useCallback(
    (patch: Partial<CabinetNode>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId as AnyNodeId, patch as Partial<AnyNode>)
    },
    [selectedId],
  )

  if (node?.type !== 'cabinet' || !build) return null
  const hardware = cabinetHardwareRows(node)
  const label = node.name || FAMILY_LABEL[node.family]

  return (
    <PanelWrapper
      icon="/icons/shelf.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title={label}
      width={320}
    >
      <div className="px-3 pt-2">
        <SegmentedControl
          onChange={setTab}
          options={[
            { label: '가구 편집', value: 'edit' },
            { label: '패널 목록', value: 'list' },
          ]}
          value={tab}
        />
      </div>
      {tab === 'list' ? (
        <>
          <PanelListTab build={build} node={node} update={update} />
          <PanelSection title="제작 출력">
            {build.issues.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-lg border border-[#6b4b2a] bg-[#2a2118] p-2 text-[#f5c48a] text-xs">
                {build.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <div className="text-muted-foreground text-xs">
              철물: {hardware.map((h) => `${h.name} ${h.quantity}`).join(' · ') || '없음'}
            </div>
            <ActionGroup>
              <ActionButton
                label="재단목록 CSV"
                onClick={() =>
                  downloadTextFile(`${label}-재단목록.csv`, cutlistCsv([{ node, label }]))
                }
              />
              <ActionButton
                label="MPR 미리보기"
                onClick={() => downloadCabinetsMpr(label, [{ node, label }])}
              />
              <ActionButton
                label="보링 DXF"
                onClick={() => downloadCabinetsDxf(label, [{ node, label }])}
              />
            </ActionGroup>
          </PanelSection>
        </>
      ) : (
        <>
          <PresetButtons node={node} />
          <PanelSection title="종류">
            <SegmentedControl
              onChange={(family) =>
                update({
                  family,
                  toeKick: { ...node.toeKick, enabled: family !== 'upper' },
                  position: [
                    node.position[0],
                    family === 'upper' ? Math.max(node.position[1], 1.4) : 0,
                    node.position[2],
                  ],
                })
              }
              options={(['tall', 'base', 'upper'] as const).map((f) => ({
                label: FAMILY_LABEL[f],
                value: f,
              }))}
              value={node.family}
            />
            <SegmentedControl
              onChange={(variant) => update({ variant })}
              options={(Object.keys(VARIANT_LABEL) as (keyof typeof VARIANT_LABEL)[]).map((v) => ({
                label: VARIANT_LABEL[v],
                value: v,
              }))}
              value={node.variant}
            />
          </PanelSection>

          <PanelSection title="치수">
            <MmField
              label="폭"
              max={2400}
              min={150}
              onCommit={(widthMm) => update({ widthMm })}
              value={node.widthMm}
            />
            <MmField
              label="높이"
              max={2800}
              min={200}
              onCommit={(heightMm) => update({ heightMm })}
              value={node.heightMm}
            />
            <MmField
              label="깊이"
              max={900}
              min={250}
              onCommit={(depthMm) => update(depthPatch(node, depthMm))}
              value={node.depthMm}
            />
            <DepthAnchorControl node={node} update={update} />
            {node.family === 'upper' ? (
              <MmField
                label="설치 높이"
                max={2600}
                min={0}
                onCommit={(mm) =>
                  update({ position: [node.position[0], mm / 1000, node.position[2]] })
                }
                value={Math.round(node.position[1] * 1000)}
              />
            ) : (
              <MmField
                label="뒷벽 이격"
                max={500}
                min={-500}
                onCommit={(gapMm) => update(backWallGapPatch(node, gapMm))}
                value={node.backWallGapMm}
              />
            )}
            <SegmentedControl
              onChange={(t) =>
                update({ panelThicknessMm: Number(t) as CabinetNode['panelThicknessMm'] })
              }
              options={['15', '15.5', '18', '18.5'].map((t) => ({ label: `${t}T`, value: t }))}
              value={String(node.panelThicknessMm)}
            />
          </PanelSection>

          <TopMouldingSection node={node} update={update} />
          <ToeKickSection node={node} update={update} />

          <DoorSettingsSection node={node} update={update} />
          <DoorSizeSection build={build} node={node} update={update} />

          <PanelSection title="내부 구성">
            <Elevation build={build} node={node} onSelect={setCellId} selectedId={cellId} />
            {cellId && (
              <CellEditor
                build={build}
                cellId={cellId}
                node={node}
                onSelect={(id) => setCellId(id ?? node.interior.id)}
                onTree={(interior) => update({ interior })}
              />
            )}
          </PanelSection>

          <EndPanelSection node={node} update={update} />
          <StoneTopSection node={node} update={update} />
          <TopNotchSection node={node} update={update} />

          <PanelSection defaultExpanded={false} title="색상">
            <ColorField
              label="몸통 색"
              onCommit={(bodyColor) => update({ bodyColor })}
              value={node.bodyColor}
            />
            <ColorField
              label="도어 색"
              onCommit={(frontColor) => update({ frontColor })}
              value={node.frontColor}
            />
          </PanelSection>

          <PanelSection defaultExpanded={false} title="내 모듈">
            <div className="flex gap-1.5">
              <input
                className="h-9 min-w-0 flex-1 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm outline-none"
                onChange={(e) => setModuleName(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="모듈 이름"
                value={moduleName}
              />
              <ActionButton
                className="flex-none"
                label="내 모듈로 저장"
                onClick={() => {
                  saveModule(moduleName || label, node)
                  setModuleName('')
                }}
              />
            </div>
          </PanelSection>
        </>
      )}
    </PanelWrapper>
  )
}
