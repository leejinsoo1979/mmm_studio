import type { HandleDescriptor, LightNode as LightNodeType, NodeDefinition } from '@pascal-app/core'
import { buildLightFloorplan } from './floorplan'
import { lightParametrics } from './parametrics'
import { LightNode } from './schema'

function moveHandle(): HandleDescriptor<LightNodeType> {
  return {
    kind: 'translate',
    placement: { position: () => [0, -0.2, 0.45] },
    apply: (_node, position) => ({ position: [position[0], position[1], position[2]] }),
    snapExtents: () => [0.3, 0.3],
  }
}

export const lightDefinition: NodeDefinition<typeof LightNode> = {
  kind: 'light',
  snapProfile: 'item',
  schemaVersion: 1,
  schema: LightNode,
  category: 'furnish',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    kind: 'point',
    position: [0, 2.4, 0],
    rotation: [0, 0, 0],
    color: '#fff1d6',
    intensity: 10,
    distance: 12,
    decay: 2,
    angle: Math.PI / 5,
    penumbra: 0.35,
    width: 1.2,
    height: 0.6,
    castShadow: true,
    enabled: true,
  }),
  capabilities: {
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['x', 'y', 'z'] },
    duplicable: true,
    deletable: true,
    selectable: { hitVolume: 'bbox' },
    presettable: false,
  },
  parametrics: lightParametrics,
  handles: [moveHandle()],
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  floorplan: buildLightFloorplan,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place light' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Light',
    description: 'A real-time point, spot, or area light.',
    icon: { kind: 'url', src: '/icons/light.webp' },
    paletteSection: 'furnish',
    paletteOrder: 95,
  },
  mcp: { description: 'A user-placeable real-time light source.' },
}
