import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const LightKind = z.enum(['point', 'spot', 'area'])

export const LightNode = BaseNode.extend({
  id: objectId('light'),
  type: nodeType('light'),
  kind: LightKind.default('point'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 2.4, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  color: z.string().default('#fff1d6'),
  intensity: z.number().min(0).max(100).default(4),
  distance: z.number().min(0).max(100).default(8),
  decay: z.number().min(0).max(4).default(2),
  angle: z
    .number()
    .min(0.05)
    .max(Math.PI / 2)
    .default(Math.PI / 5),
  penumbra: z.number().min(0).max(1).default(0.35),
  width: z.number().min(0.05).max(20).default(1.2),
  height: z.number().min(0.05).max(20).default(0.6),
  castShadow: z.boolean().default(false),
  enabled: z.boolean().default(true),
}).describe('A user-placeable point, spot, or area light')

export type LightNode = z.infer<typeof LightNode>
export type LightNodeId = LightNode['id']
