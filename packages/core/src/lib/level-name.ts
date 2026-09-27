import type { LevelNode } from '../schema'

export function getDefaultLevelName(level: number): string {
  // Korean floor numbering: the ground floor is 1층.
  if (level >= 0) return `${level + 1}층`
  return `지하 ${-level}층`
}

export function getLevelDisplayName(level: Pick<LevelNode, 'name' | 'level'>): string {
  return level.name || getDefaultLevelName(level.level)
}
