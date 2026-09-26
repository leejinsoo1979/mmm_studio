import type { NodeDefinition } from '@pascal-app/core'
import { buildElectricPanelFloorplan } from './floorplan'
import { buildElectricPanelGeometry } from './geometry'
import { ElectricPanelNode } from './schema'

export const electricPanelDefinition: NodeDefinition<typeof ElectricPanelNode> = {
  kind: 'electric-panel',
  snapProfile: 'item',
  schemaVersion: 1,
  schema: ElectricPanelNode,
  category: 'furnish',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 1.5, 0],
    rotation: [0, 0, 0],
    circuits: [{ id: 'c1', name: '전등 1', on: true }],
  }),
  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'] },
    duplicable: true,
    deletable: true,
    selectable: { hitVolume: 'bbox' },
    presettable: false,
  },
  geometry: buildElectricPanelGeometry,
  floorplan: buildElectricPanelFloorplan,
  parametrics: { groups: [], customPanel: () => import('./panel') },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: '벽에 분전반 설치' },
    { key: 'Esc', label: '취소' },
  ],
  presentation: {
    label: '분전반',
    description: '회로별 차단기가 있는 분전반',
    icon: { kind: 'url', src: '/icons/light.webp' },
    paletteSection: 'furnish',
    paletteOrder: 97,
  },
  mcp: { description: 'A distribution board with one breaker per lighting circuit.' },
}
