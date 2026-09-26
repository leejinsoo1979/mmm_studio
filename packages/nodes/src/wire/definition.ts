import { type NodeDefinition, solveElectrical } from '@pascal-app/core'
import { buildWireFloorplan } from './floorplan'
import { WireNode } from './schema'

export const wireDefinition: NodeDefinition<typeof WireNode> = {
  kind: 'wire',
  schemaVersion: 1,
  schema: WireNode,
  category: 'utility',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    path: [
      [0, 0],
      [1, 0],
    ],
    height: 2.4,
    from: { nodeId: '', terminal: 'in' },
    to: { nodeId: '', terminal: 'in' },
  }),
  capabilities: {
    duplicable: false,
    deletable: true,
    selectable: { hitVolume: 'bbox' },
    presettable: false,
  },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  floorplan: buildWireFloorplan,
  // Ends follow the devices, colour follows the whole circuit.
  floorplanDependsOnSiblings: true,
  computeFloorplanLevelData: ({ nodes }) => solveElectrical(nodes),
  parametrics: { groups: [], customPanel: () => import('./panel') },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: '단자 선택 → 연결할 단자 선택' },
    { key: 'Esc', label: '첫 단자 취소' },
  ],
  presentation: {
    label: '배선',
    description: '분전반 · 스위치 · 조명 단자를 잇는 배선',
    icon: { kind: 'url', src: '/icons/light.webp' },
    paletteSection: 'furnish',
    paletteOrder: 98,
  },
  mcp: {
    description: 'A wire between electrical terminals (panel circuit, switch line/gang, light).',
  },
}
