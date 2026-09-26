'use client'

import {
  type AnyNode,
  type FaceTakeoff,
  levelWallTakeoff,
  summarizeTakeoff,
  takeoffCsv,
  useScene,
  WALL_FRAMING,
  WALL_SHEETS,
  type WallNode,
} from '@pascal-app/core'
import { useMemo } from 'react'

const row = 'flex justify-between gap-2 text-xs tabular-nums'
const muted = 'text-muted-foreground'

function useLevelTakeoff(levelId: string | null | undefined): FaceTakeoff[] {
  const nodes = useScene((s) => s.nodes)
  return useMemo(() => {
    if (!levelId) return []
    const walls = Object.values(nodes).filter(
      (n): n is WallNode => n?.type === 'wall' && n.parentId === levelId,
    )
    return levelWallTakeoff(walls, nodes as Record<string, AnyNode>)
  }, [nodes, levelId])
}

function FaceRows({ face }: { face: FaceTakeoff }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className={row}>
        <span className={muted}>{face.face === 'front' ? '앞면' : '뒷면'} 마감 면적</span>
        <span>
          {face.netM2} m²{' '}
          <span className={muted}>
            (전체 {face.grossM2} − 개구부 {face.openingM2})
          </span>
        </span>
      </div>
      {face.boards.map((b) => {
        const s = WALL_SHEETS[b.sheet]
        return (
          <div className={row} key={b.layer}>
            <span className={muted}>
              {b.layer} {s.label} {s.widthMm}×{s.heightMm}
            </span>
            <span>{b.sheets}장</span>
          </div>
        )
      })}
      {face.framing && (
        <>
          <div className={row}>
            <span className={muted}>
              {WALL_FRAMING[face.framing.kind].label} @{face.framing.spacingMm}
            </span>
            <span>
              {face.framing.studs}개 · {face.framing.studM} m
            </span>
          </div>
          <div className={row}>
            <span className={muted}>
              {face.framing.kind === 'steel' ? '런너 (상하)' : '상하 가로재'}
            </span>
            <span>{face.framing.plateM} m</span>
          </div>
          <div className={row}>
            <span className={muted}>개구부 보강</span>
            <span>{face.framing.openingM} m</span>
          </div>
        </>
      )}
    </div>
  )
}

/** 자재 산출 for one constructed wall (its finished faces). */
export function WallTakeoffSection({ wall }: { wall: WallNode }) {
  const faces = useLevelTakeoff(wall.construction ? wall.parentId : null).filter(
    (f) => f.wallId === wall.id,
  )
  if (faces.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {faces.map((f) => (
        <FaceRows face={f} key={f.face} />
      ))}
      <p className="text-[11px] text-muted-foreground leading-snug">
        마감면 길이 {faces[0]?.lengthMm}mm × 높이 {faces[0]?.heightMm}mm. 판재는 벽 시작점부터 세워
        붙이고 자투리는 같은 폭끼리 재사용한 수량입니다.
      </p>
    </div>
  )
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Level-wide 자재 산출: totals by sheet and framing, plus the CSV. */
export function LevelTakeoffSummary({ levelId }: { levelId: string | null }) {
  const faces = useLevelTakeoff(levelId)
  const nodes = useScene((s) => s.nodes)
  if (faces.length === 0) {
    return <p className="text-muted-foreground text-xs">목상 · 경량 · 떡가베 벽이 없습니다.</p>
  }
  const sum = summarizeTakeoff(faces)
  const wallNumbers = new Map<string, number>()
  for (const f of faces)
    if (!wallNumbers.has(f.wallId)) wallNumbers.set(f.wallId, wallNumbers.size + 1)
  const label = (id: string) =>
    (nodes[id as keyof typeof nodes] as WallNode | undefined)?.name || `벽 ${wallNumbers.get(id)}`
  return (
    <div className="flex flex-col gap-1.5">
      <div className={row}>
        <span className={muted}>마감 면적 합계</span>
        <span>{sum.netM2} m²</span>
      </div>
      {sum.sheets.map((s) => (
        <div className={row} key={s.sheet}>
          <span className={muted}>
            {s.label} {WALL_SHEETS[s.sheet].widthMm}×{WALL_SHEETS[s.sheet].heightMm}
          </span>
          <span>{s.count}장</span>
        </div>
      ))}
      {sum.framing.map((g) => (
        <div className={row} key={g.kind}>
          <span className={muted}>{g.label}</span>
          <span>{Math.round((g.studM + g.plateM + g.openingM) * 100) / 100} m</span>
        </div>
      ))}
      <button
        className="mt-1 h-8 rounded-lg border border-border/50 bg-[#2C2C2E] text-xs hover:bg-[#3e3e3e]"
        onClick={() => download('벽마감-자재산출.csv', takeoffCsv(faces, label))}
        type="button"
      >
        자재 산출 CSV
      </button>
    </div>
  )
}
