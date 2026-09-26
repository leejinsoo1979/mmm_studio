'use client'

import { panelFace, panelGrain } from './engine/cutlist'
import type { CabinetBuild, CabinetPart, PartRole } from './engine/parts'
import type { CabinetNode } from './schema'

type Update = (patch: Partial<CabinetNode>) => void

const MATERIAL_LABEL: Record<string, string> = { stone: '인조대리석' }

/** mmmcraft panel-list groups, in its order. */
function groupOf(node: CabinetNode, part: CabinetPart): string {
  const body: PartRole[] = [
    'side',
    'bottom',
    'top',
    'top-band',
    'back',
    'rear-rail',
    'front-rail',
    'divider',
    'fixed-shelf',
    'shelf',
    'channel-frame',
    'drawer-filler',
  ]
  if (body.includes(part.role)) return '몸통'
  if (part.role === 'stone-top') return '인조대리석'
  if (part.name.startsWith('상부 EP')) return '상부 EP'
  if (part.role === 'toe-kick' || part.role === 'top-moulding' || part.name === '하부 EP')
    return '프레임'
  if (part.role === 'end-panel') return '엔드패널'
  return node.family === 'base' ? '서랍 및 도어' : '도어'
}
const ORDER = ['몸통', '서랍 및 도어', '도어', '엔드패널', '프레임', '인조대리석', '상부 EP']

function toggle(list: string[], name: string, on: boolean): string[] {
  return on ? Array.from(new Set([...list, name])) : list.filter((n) => n !== name)
}

/**
 * mmmcraft 패널 목록: every sheet panel with its size, thickness and
 * material. Unticked panels stay out of the cut list, MPR and DXF; doors can
 * drop their hinge borings (보링숨김); the grain can be flipped.
 */
export function PanelListTab({
  node,
  build,
  update,
}: {
  node: CabinetNode
  build: CabinetBuild
  update: Update
}) {
  const panels = build.parts.filter((p) => p.isPanel)
  const names = Array.from(new Set(panels.map((p) => p.name)))
  const allIncluded = node.panelExclusions.length === 0
  const groups = ORDER.map((g) => ({
    g,
    parts: panels.filter((p) => groupOf(node, p) === g),
  })).filter((x) => x.parts.length > 0)
  return (
    <div className="flex flex-col gap-2 px-3 pb-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">패널 상세 정보 (총 {panels.length}장)</span>
        <label className="flex items-center gap-1 text-muted-foreground">
          <input
            checked={allIncluded}
            onChange={(e) => update({ panelExclusions: e.target.checked ? [] : names })}
            type="checkbox"
          />
          전체
        </label>
      </div>
      {groups.map(({ g, parts }) => (
        <div className="flex flex-col gap-0.5" key={g}>
          <strong className="mt-1 text-[11px]">
            {g} (총 {parts.length}장)
          </strong>
          {parts.map((p) => {
            const face = panelFace(p)
            const included = !node.panelExclusions.includes(p.name)
            const grain = panelGrain(node, p.name)
            const hidden = node.hingeBoringExclusions.includes(p.name)
            return (
              <div
                className={`flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-white/5 ${included ? '' : 'opacity-50'}`}
                key={p.id}
              >
                <input
                  checked={included}
                  onChange={(e) =>
                    update({
                      panelExclusions: toggle(node.panelExclusions, p.name, !e.target.checked),
                    })
                  }
                  title="재단목록 · MPR · DXF 포함"
                  type="checkbox"
                />
                <span className="min-w-0 flex-1 truncate">
                  {p.name}: W {face.width} × L {face.length}{' '}
                  <span className="text-muted-foreground">
                    (T: {face.thickness}) [{MATERIAL_LABEL[p.material] ?? p.material}]
                  </span>
                </span>
                {p.role === 'door' && p.hinge && p.hinge !== 'top' && (
                  <button
                    className={`rounded border border-border/50 px-1 ${hidden ? 'bg-[#7779ff]/30' : ''}`}
                    onClick={() =>
                      update({
                        hingeBoringExclusions: toggle(node.hingeBoringExclusions, p.name, !hidden),
                      })
                    }
                    title={`${p.name} 힌지보링 ${hidden ? '복원' : '숨김'} (MPR·DXF 힌지 보링)`}
                    type="button"
                  >
                    보링숨김
                  </button>
                )}
                <button
                  className="rounded border border-border/50 px-1"
                  onClick={() =>
                    update({
                      panelGrain: {
                        ...node.panelGrain,
                        [p.name]: grain === 'vertical' ? 'horizontal' : 'vertical',
                      },
                    })
                  }
                  title={`${p.name} 나무결 방향 전환 (W ↔ L)`}
                  type="button"
                >
                  결 {grain === 'vertical' ? '세로' : '가로'}
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
