'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { ActionButton, ActionGroup } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useState } from 'react'
import {
  applicableGroups,
  CATEGORY_LABEL,
  PRESET_GROUPS,
  type PresetGroup,
  presetPatch,
  useCabinetPresets,
} from './preset-transfer'
import { type CabinetNode, resolveCabinetNode } from './schema'

const note = 'text-[11px] text-muted-foreground leading-snug'

/** mmmcraft FurniturePresetButtons: 속성 저장 / 속성 이식 for the category. */
export function PresetButtons({ node }: { node: CabinetNode }) {
  const label = CATEGORY_LABEL[node.family]
  const preset = useCabinetPresets((s) => s.presets[node.family])
  const save = useCabinetPresets((s) => s.save)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const [message, setMessage] = useState<string | null>(null)
  const [picking, setPicking] = useState<PresetGroup[] | null>(null)
  const groups = preset ? applicableGroups(node, preset) : []

  const apply = () => {
    if (!preset || !picking) return
    const nodes = useScene.getState().nodes
    // Several selected cabinets of the same category all take the preset.
    const ids = selectedIds.length > 1 && selectedIds.includes(node.id) ? selectedIds : [node.id]
    const targets = ids
      .map((id) => nodes[id as AnyNodeId] as unknown as CabinetNode | undefined)
      .filter((n): n is CabinetNode => n?.type === 'cabinet' && n.family === node.family)
      .map(resolveCabinetNode)
    const updates = targets
      .map((t) => ({ id: t.id as AnyNodeId, data: presetPatch(t, preset, picking) }))
      .filter((u) => Object.keys(u.data).length > 0)
    if (updates.length > 0) {
      useScene
        .getState()
        .updateNodes(updates.map((u) => ({ id: u.id, data: u.data as Partial<AnyNode> })))
    }
    setPicking(null)
    setMessage(updates.length > 1 ? `선택한 ${updates.length}개 가구에 속성을 이식했습니다.` : null)
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2">
      <ActionGroup>
        <ActionButton
          label="속성 저장"
          onClick={() => {
            save(node)
            setMessage(
              `속성이 저장되었습니다 (${label}). 같은 카테고리 가구에서 "속성 이식" 버튼으로 적용할 수 있어요.`,
            )
          }}
        />
        <ActionButton
          className={preset ? '' : 'pointer-events-none opacity-40'}
          label="속성 이식"
          onClick={() => preset && setPicking(groups)}
        />
      </ActionGroup>
      <p className={note}>
        {preset ? `${label} 프리셋 저장됨` : `먼저 ${label} 가구에서 속성 저장을 해주세요`}
      </p>
      {message && <p className="text-[#9a9cff] text-[11px] leading-snug">{message}</p>}
      {picking && (
        <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-[#232326] p-2 text-xs">
          <strong>속성 이식 — {label}</strong>
          <p className={note}>
            적용할 그룹을 선택하세요. 가구 폭/위치는 항상 제외됩니다. 현재 가구에 의미 없는 그룹은
            자동으로 숨김 처리됩니다.
          </p>
          {selectedIds.length > 1 && selectedIds.includes(node.id) && (
            <p className={note}>
              현재 선택된 같은 카테고리 가구 {selectedIds.length}개에 함께 적용됩니다.
            </p>
          )}
          {groups.length === 0 ? (
            <p className={note}>저장된 프리셋 중 이 가구에 적용 가능한 속성이 없습니다.</p>
          ) : (
            PRESET_GROUPS.filter((g) => groups.includes(g.key)).map((g) => (
              <label className="flex items-center gap-1.5" key={g.key}>
                <input
                  checked={picking.includes(g.key)}
                  onChange={(e) =>
                    setPicking((p) =>
                      p ? (e.target.checked ? [...p, g.key] : p.filter((k) => k !== g.key)) : p,
                    )
                  }
                  type="checkbox"
                />
                {g.label}
              </label>
            ))
          )}
          <ActionGroup>
            <ActionButton label="취소" onClick={() => setPicking(null)} />
            <ActionButton
              className={picking.length === 0 ? 'pointer-events-none opacity-40' : ''}
              label="이식"
              onClick={apply}
            />
          </ActionGroup>
        </div>
      )}
    </div>
  )
}
