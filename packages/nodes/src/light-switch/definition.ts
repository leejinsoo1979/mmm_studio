import type { NodeDefinition } from '@pascal-app/core'
import { buildLightSwitchFloorplan } from './floorplan'
import { buildLightSwitchGeometry } from './geometry'
import { LightSwitchNode } from './schema'

export const lightSwitchDefinition: NodeDefinition<typeof LightSwitchNode> = {
  kind: 'light-switch',
  snapProfile: 'item',
  schemaVersion: 1,
  schema: LightSwitchNode,
  category: 'furnish',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 1.2, 0],
    rotation: [0, 0, 0],
    gangs: 1,
    on: [false],
  }),
  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'] },
    duplicable: true,
    deletable: true,
    selectable: { hitVolume: 'bbox' },
    presettable: false,
  },
  geometry: buildLightSwitchGeometry,
  floorplan: buildLightSwitchFloorplan,
  parametrics: { groups: [], customPanel: () => import('./panel') },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: '벽에 스위치 설치' },
    { key: 'Esc', label: '취소' },
  ],
  presentation: {
    label: '스위치',
    description: '벽 조명 스위치 (1~3구)',
    icon: { kind: 'url', src: '/icons/light.webp' },
    paletteSection: 'furnish',
    paletteOrder: 96,
  },
  mcp: { description: 'A wall light switch with 1–3 gangs wired to lights.' },
}
