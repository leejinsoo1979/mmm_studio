import type { HandleDescriptor, NodeDefinition } from '@pascal-app/core'
import { buildNpcFloorplan } from './floorplan'
import { npcPatrolPointAffordance, npcRotateAffordance } from './floorplan-affordances'
import { npcFloorplanMoveTarget } from './floorplan-move'
import { npcParametrics } from './parametrics'
import { NpcNode } from './schema'

const NPC_FOOTPRINT = 0.6
const NPC_HANDLE_HEIGHT = 0.46
const MOVE_FRONT_OFFSET = 0.35
const ROTATE_CORNER_OFFSET = 0.32
const ROTATE_RING_OFFSET = 0.04

function npcRotateHandle(): HandleDescriptor<NpcNode> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: initial.rotation - delta }),
    placement: {
      position: () => [
        NPC_FOOTPRINT / 2,
        NPC_HANDLE_HEIGHT,
        NPC_FOOTPRINT / 2 + ROTATE_CORNER_OFFSET,
      ],
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: () => Math.hypot(NPC_FOOTPRINT / 2, NPC_FOOTPRINT / 2) + ROTATE_RING_OFFSET,
      y: () => NPC_HANDLE_HEIGHT,
    },
  }
}

function npcMoveHandle(): HandleDescriptor<NpcNode> {
  return {
    kind: 'translate',
    placement: { position: () => [0, 0.02, NPC_FOOTPRINT / 2 + MOVE_FRONT_OFFSET] },
    apply: (_n, pos) => ({ position: [pos[0], pos[1], pos[2]] }),
    snapExtents: () => [NPC_FOOTPRINT, NPC_FOOTPRINT],
  }
}

export const npcDefinition: NodeDefinition<typeof NpcNode> = {
  kind: 'npc',
  schemaVersion: 1,
  schema: NpcNode,
  // `site`, not `furnish`: the walkthrough collider world merges only
  // structure / furnish meshes, and the player must not collide with the
  // avatar mesh (NPCs get their own dynamic capsule colliders).
  category: 'site',
  bake: 'strip',
  snapProfile: 'item',
  facingIndicator: true,

  defaults: () => {
    const { id: _id, ...fields } = NpcNode.parse({})
    return fields
  },

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    },
    duplicable: true,
    deletable: true,
    presettable: false,
    selectable: { hitVolume: 'bbox' },
    // Slab elevation lift only; an NPC is no obstacle for placing furniture.
    floorPlaced: {
      footprint: () => ({ dimensions: [0.6, 1.8, 0.6], rotation: [0, 0, 0] }),
    },
  },

  parametrics: npcParametrics,
  handles: [npcRotateHandle(), npcMoveHandle()],

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: { module: () => import('./system'), priority: 4 },
  floorplan: buildNpcFloorplan,
  floorplanMoveTarget: npcFloorplanMoveTarget,
  floorplanAffordances: {
    'npc-rotate': npcRotateAffordance,
    'npc-patrol-point': npcPatrolPointAffordance,
  },
  tool: () => import('./tool'),
  affordanceTools: { 'npc-patrol': () => import('./patrol-tool') },
  toolHints: [
    { key: 'Left click', label: 'NPC 배치' },
    { key: 'R', label: '방향 돌리기' },
    { key: 'Esc', label: '끝내기' },
  ],

  presentation: {
    label: 'NPC',
    description: '플레이 모드에서 움직이고 말하는 인물',
    icon: { kind: 'iconify', name: 'lucide:user-round' },
    paletteSection: 'structure',
    hidden: true,
  },

  mcp: {
    description:
      'A non-player character for play mode: a Rocketbox avatar (look without a face photo), behaviour stand/wander/patrol with greetings and idle emotes, a scripted dialogue graph (lines, choices, actions, flags), an optional AI persona and a voice.',
  },
}
