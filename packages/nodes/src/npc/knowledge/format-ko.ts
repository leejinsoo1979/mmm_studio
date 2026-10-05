import type { RoomFact, SceneFacts, SceneFactsScope } from '../types'

type Line = { text: string; detail: boolean }

const CABINET_VARIANTS: Record<string, string> = {
  sink: '싱크',
  cooktop: '쿡탑',
  dishwasher: '식기세척기',
  appliance: '가전장',
}
const OMITTED = '- …(이하 생략)'

/**
 * The scene facts as the `[집 정보]` block of an NPC's AI prompt. `rooms`
 * leaves out furniture; past `maxChars` furniture lines go first, then whole
 * rooms from the end.
 */
export function formatSceneFactsKo(
  facts: SceneFacts,
  scope: SceneFactsScope,
  maxChars = 12_000,
): string {
  if (scope === 'none') return ''
  const lines = factLines(facts, scope === 'rooms-furniture')
  let total = lines.reduce((sum, line) => sum + line.text.length + 1, -1)
  // Rooms are listed largest first on each level, so this drops the small rooms' details first.
  for (let i = lines.length - 1; i >= 0 && total > maxChars; i--) {
    const line = lines[i]!
    if (!line.detail) continue
    total -= line.text.length + 1
    lines.splice(i, 1)
  }
  if (total <= maxChars) return lines.map((line) => line.text).join('\n')

  const kept: string[] = []
  let used = OMITTED.length
  for (const line of lines) {
    if (used + line.text.length + 1 > maxChars) break
    kept.push(line.text)
    used += line.text.length + 1
  }
  kept.push(OMITTED)
  return kept.join('\n').slice(0, maxChars)
}

function factLines(facts: SceneFacts, furniture: boolean): Line[] {
  const lines: Line[] = [{ text: '[집 정보]', detail: false }]
  if (facts.rooms.length === 0) {
    lines.push({ text: '- 등록된 방 정보가 없습니다.', detail: false })
    return lines
  }
  const summary = [
    facts.buildings > 0 ? `건물 ${facts.buildings}동` : null,
    `${facts.levels.length}개 층`,
    `전체 바닥면적 약 ${decimal(facts.totalArea, 1)}㎡`,
    `방 ${facts.rooms.length}개`,
  ]
  lines.push({ text: `- ${summary.filter(Boolean).join(', ')}`, detail: false })

  const names = new Map(facts.rooms.map((room) => [room.id, room.name]))
  for (const level of facts.levels) {
    if (level.rooms.length === 0) continue
    lines.push({ text: `## ${level.name}`, detail: false })
    for (const room of level.rooms) {
      lines.push({ text: `- ${roomLine(room, names)}`, detail: false })
      const detail = furniture ? detailLine(room) : ''
      if (detail) lines.push({ text: `  ${detail}`, detail: true })
    }
  }
  return lines
}

function roomLine(room: RoomFact, names: Map<string, string>): string {
  const parts = [`${room.name} 약 ${decimal(room.area, 1)}㎡`]
  if (room.ceilingHeight) parts.push(`천장 ${decimal(room.ceilingHeight, 2)}m`)
  if (room.floorMaterial) parts.push(`바닥 ${room.floorMaterial}`)
  if (room.wallMaterial) parts.push(`벽 ${room.wallMaterial}`)
  if (room.windows > 0) parts.push(`창 ${room.windows}`)
  const linked = room.doorsTo.flatMap((id) => names.get(id) ?? [])
  if (linked.length > 0) parts.push(`연결: ${linked.join(', ')}`)
  return parts.join(' · ')
}

function detailLine(room: RoomFact): string {
  const parts: string[] = []
  if (room.furniture.length > 0) {
    parts.push(`가구: ${room.furniture.map((item) => `${item.name} ${item.count}`).join(', ')}`)
  }
  const tall = room.cabinets.filter((cabinet) => cabinet.family === 'tall')
  if (tall.length > 0) parts.push(`붙박이장 ${cabinetRun(tall)}`)
  const kitchen = [
    ['하부장', room.cabinets.filter((cabinet) => cabinet.family === 'base')],
    ['상부장', room.cabinets.filter((cabinet) => cabinet.family === 'upper')],
  ] as const
  const runs = kitchen.flatMap(([label, run]) =>
    run.length > 0 ? `${label} ${cabinetRun(run)}` : [],
  )
  if (runs.length > 0) parts.push(`주방가구: ${runs.join(', ')}`)
  if (room.lights > 0) parts.push(`조명 ${room.lights}`)
  return parts.join(' · ')
}

/** "2.4m(화이트)", "3.0m(아이보리, 싱크·쿡탑 포함)". */
function cabinetRun(cabinets: RoomFact['cabinets']): string {
  const width = cabinets.reduce((sum, cabinet) => sum + cabinet.widthMm, 0) / 1000
  const finishes = new Map<string, number>()
  for (const cabinet of cabinets)
    finishes.set(cabinet.finish, (finishes.get(cabinet.finish) ?? 0) + 1)
  const finish = [...finishes].sort((a, b) => b[1] - a[1])[0]?.[0]
  const extras = Object.entries(CABINET_VARIANTS).flatMap(([variant, label]) =>
    cabinets.some((cabinet) => cabinet.variant === variant) ? label : [],
  )
  const notes = [finish, extras.length > 0 ? `${extras.join('·')} 포함` : null].filter(Boolean)
  return `${width.toFixed(1)}m${notes.length > 0 ? `(${notes.join(', ')})` : ''}`
}

/** At most `digits` decimals, none when whole ("32.1", "2.45", "12"). */
function decimal(value: number, digits: number): string {
  const scale = 10 ** digits
  return String(Math.round(value * scale) / scale)
}
