import type { NpcNameResolvers } from '../types'

/**
 * Scene facts for NPCs: rooms, areas, materials, furniture, and their Korean
 * text for the AI prompt. Server-safe (no React, no three.js); the app's
 * server imports it through `@pascal-app/nodes/npc/knowledge`.
 */

export type {
  LevelFact,
  NpcNameResolvers,
  RoomFact,
  SceneFacts,
  SceneFactsScope,
} from '../types'
export { formatSceneFactsKo } from './format-ko'
export { collectSceneFacts } from './scene-facts'

let nameResolvers: NpcNameResolvers | null = null

/** The app's Korean item and material names, for facts collected on the client. */
export function setNpcNameResolvers(resolvers: NpcNameResolvers | null): void {
  nameResolvers = resolvers
}

export function getNpcNameResolvers(): NpcNameResolvers | null {
  return nameResolvers
}
