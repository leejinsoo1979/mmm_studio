import type { ParametricDescriptor } from '@pascal-app/core'
import { type NpcNode, NpcRole } from './schema'

/**
 * Inspector / MCP descriptor for NPCs. The Korean inspector (avatar gallery,
 * behaviour, dialogue graph, AI) is the custom panel; the fields here keep the
 * MCP surface to what the auto-inspector can express.
 */
export const npcParametrics: ParametricDescriptor<NpcNode> = {
  groups: [
    {
      label: 'NPC',
      fields: [
        { key: 'role', kind: 'enum', options: NpcRole.options },
        { key: 'showNameTag', kind: 'boolean' },
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'number', unit: 'rad', step: Math.PI / 12 },
      ],
    },
  ],
  customPanel: () => import('./panel'),
}
