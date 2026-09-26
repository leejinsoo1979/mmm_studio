'use client'

import { PanelSection, SegmentedControl, ToggleControl } from '@pascal-app/editor'
import { MmField } from './panel-fields'
import { floatPatch, topMouldingPatch } from './placement-updates'
import type { CabinetNode } from './schema'

type Update = (patch: Partial<CabinetNode>) => void
type WidthAdjust = CabinetNode['toeKick']['widthAdjust']

/** mmmcraft 폭확장: a checkbox, then 좌 / 우 (−500 … 500, + widens). */
function WidthAdjustFields({
  value,
  onChange,
}: {
  value: WidthAdjust
  onChange: (next: WidthAdjust) => void
}) {
  return (
    <>
      <ToggleControl
        checked={value.enabled}
        label="폭확장"
        onChange={(enabled) => onChange({ ...value, enabled })}
      />
      {value.enabled && (
        <div className="grid grid-cols-2 gap-1.5">
          <MmField
            label="좌"
            max={500}
            min={-500}
            onCommit={(leftMm) => onChange({ ...value, leftMm })}
            value={value.leftMm}
          />
          <MmField
            label="우"
            max={500}
            min={-500}
            onCommit={(rightMm) => onChange({ ...value, rightMm })}
            value={value.rightMm}
          />
        </div>
      )}
    </>
  )
}

/** mmmcraft 뒤고정 / 앞고정 buttons (which face stays when the depth changes). */
export function DepthAnchorControl({ node, update }: { node: CabinetNode; update: Update }) {
  return (
    <SegmentedControl
      onChange={(depthAnchor) => update({ depthAnchor })}
      options={[
        { label: '뒤고정', value: 'back' },
        { label: '앞고정', value: 'front' },
      ]}
      value={node.depthAnchor}
    />
  )
}

/** 상단몰딩 — tall and upper cabinets (mmmcraft hides it for lower ones). */
export function TopMouldingSection({ node, update }: { node: CabinetNode; update: Update }) {
  if (node.family === 'base') return null
  const m = node.topMoulding
  const set = (next: Partial<CabinetNode['topMoulding']>) =>
    update(topMouldingPatch(node, { ...m, ...next }))
  return (
    <PanelSection defaultExpanded={false} title="상단몰딩">
      <ToggleControl
        checked={m.enabled}
        label="상단몰딩"
        onChange={(enabled) => set({ enabled })}
      />
      {m.enabled && (
        <>
          <MmField
            label="높이"
            max={9999}
            min={0}
            onCommit={(heightMm) => set({ heightMm })}
            value={m.heightMm}
          />
          <MmField
            label="옵셋"
            max={200}
            min={-200}
            onCommit={(offsetMm) => set({ offsetMm })}
            value={m.offsetMm}
          />
          <MmField
            label="갭"
            max={2000}
            min={0}
            onCommit={(gapMm) => set({ gapMm })}
            value={m.gapMm}
          />
          <WidthAdjustFields
            onChange={(widthAdjust) => set({ widthAdjust })}
            value={m.widthAdjust}
          />
          <p className="text-[11px] text-muted-foreground leading-snug">
            옵셋은 + 일수록 뒤로 들어갑니다. 갭은 위(천장 쪽)에서 뺍니다.
          </p>
        </>
      )}
    </PanelSection>
  )
}

/** 걸레받이 — base and tall cabinets: 높이 / 옵셋 / 갭 when on, 띄움 when off. */
export function ToeKickSection({ node, update }: { node: CabinetNode; update: Update }) {
  if (node.family === 'upper' || node.variant === 'dishwasher') return null
  const k = node.toeKick
  const set = (next: Partial<CabinetNode['toeKick']>) => update({ toeKick: { ...k, ...next } })
  // mmmcraft limits: lower 60 … 150, others 40 … 100, within the schema's 30 … 200.
  const [minH, maxH] = node.family === 'base' ? [60, 150] : [40, 100]
  return (
    <PanelSection defaultExpanded={false} title="걸레받이">
      <ToggleControl
        checked={k.enabled}
        label="걸레받이"
        onChange={(enabled) =>
          // Switching off starts from 띄움 0, as in mmmcraft.
          update({
            toeKick: { ...k, enabled },
            ...(enabled ? {} : floatPatch(node, 0)),
          })
        }
      />
      {k.enabled ? (
        <>
          <MmField
            label="높이"
            max={maxH}
            min={minH}
            onCommit={(heightMm) =>
              set({ heightMm, gapMm: Math.min(k.gapMm, Math.max(0, heightMm - 1)) })
            }
            value={k.heightMm}
          />
          <MmField
            label="옵셋"
            max={200}
            min={-200}
            onCommit={(offsetMm) => set({ offsetMm })}
            value={k.offsetMm}
          />
          <MmField
            label="갭"
            max={Math.max(0, k.heightMm - 1)}
            min={0}
            onCommit={(gapMm) => set({ gapMm })}
            value={k.gapMm}
          />
          <WidthAdjustFields
            onChange={(widthAdjust) => set({ widthAdjust })}
            value={k.widthAdjust}
          />
          <p className="text-[11px] text-muted-foreground leading-snug">
            옵셋은 + 일수록 뒤로 들어갑니다. 갭은 아래(바닥 쪽)에서 뺍니다.
          </p>
        </>
      ) : (
        <MmField
          label="띄움"
          max={500}
          min={0}
          onCommit={(floatMm) => update(floatPatch(node, floatMm))}
          value={Math.round(node.position[1] * 1000)}
        />
      )}
    </PanelSection>
  )
}
