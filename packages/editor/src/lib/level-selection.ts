import { type AnyNodeId, type BuildingNode, LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

function getAdjacentLevelIdForDeletion(levelId: AnyNodeId): LevelNode['id'] | null {
  const { nodes } = useScene.getState()
  const level = nodes[levelId]
  if (level?.type !== 'level' || !level.parentId) return null

  const building = nodes[level.parentId as AnyNodeId]
  if (building?.type !== 'building') return null

  const siblingLevelIds = (building as BuildingNode).children.filter(
    (childId): childId is LevelNode['id'] => nodes[childId as AnyNodeId]?.type === 'level',
  )
  const currentIndex = siblingLevelIds.indexOf(level.id)
  if (currentIndex === -1) return null

  return siblingLevelIds[currentIndex - 1] ?? siblingLevelIds[currentIndex + 1] ?? null
}

export function deleteLevelWithFallbackSelection(levelId: AnyNodeId) {
  const isSelectedLevel = useViewer.getState().selection.levelId === levelId
  const nextLevelId = getAdjacentLevelIdForDeletion(levelId)

  useScene.getState().deleteNode(levelId)

  if (isSelectedLevel) {
    useViewer.getState().setSelection({ levelId: nextLevelId })
  }
}

/** Adds a level on top of the building's highest one and selects it. */
export function addLevelAbove(buildingId: BuildingNode['id']): LevelNode['id'] | null {
  const { nodes, createNode } = useScene.getState()
  const building = nodes[buildingId]
  if (building?.type !== 'building') return null
  const levels = building.children
    .map((id) => nodes[id as AnyNodeId])
    .filter((node): node is LevelNode => node?.type === 'level')
  const maxLevel = levels.length > 0 ? Math.max(...levels.map((l) => l.level)) : -1
  const newLevel = LevelNode.parse({ level: maxLevel + 1, children: [], parentId: buildingId })
  createNode(newLevel, buildingId)
  useViewer.getState().setSelection({ buildingId, levelId: newLevel.id })
  return newLevel.id
}
