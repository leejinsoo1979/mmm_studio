import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Lighting circuits: a 분전반 (panel) feeds circuits, a wire runs from a
 * circuit to a switch's line terminal, from a switch gang to a light, and
 * from light to light. Switch and breaker positions are part of the scene,
 * so the plan, the 3D lights and saved scenes all show the same state.
 */

/** A wall light switch (스위치), 1–3 gangs (구). Level-local position; its
 *  front (+Z local) faces the room. */
export const LightSwitchNode = BaseNode.extend({
  id: objectId('light-switch'),
  type: nodeType('light-switch'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 1.2, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  gangs: z.number().int().min(1).max(3).default(1),
  /** Each gang's position (on = closed), one per gang. */
  on: z.array(z.boolean()).default([false]),
}).describe('A wall light switch with 1–3 gangs; each gang switches its own wires')

export type LightSwitchNode = z.infer<typeof LightSwitchNode>
export type LightSwitchNodeId = LightSwitchNode['id']

export const ElectricCircuit = z.object({
  id: z.string(),
  name: z.string().default('전등'),
  /** Breaker position. */
  on: z.boolean().default(true),
})
export type ElectricCircuit = z.infer<typeof ElectricCircuit>

/** A distribution board (분전반) with one breaker per circuit (회로). */
export const ElectricPanelNode = BaseNode.extend({
  id: objectId('electric-panel'),
  type: nodeType('electric-panel'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 1.5, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  circuits: z.array(ElectricCircuit).default([{ id: 'c1', name: '전등 1', on: true }]),
}).describe('A distribution board; each circuit has its own breaker')

export type ElectricPanelNode = z.infer<typeof ElectricPanelNode>
export type ElectricPanelNodeId = ElectricPanelNode['id']

/** One end of a wire: a node and one of its terminals — `circuit:<id>` on a
 *  panel, `line` or `gang:<n>` (0-based) on a switch, `in` on a light. */
export const WireEnd = z.object({ nodeId: z.string(), terminal: z.string() })
export type WireEnd = z.infer<typeof WireEnd>

/** A wiring run (배선) drawn on the plan between two terminals. */
export const WireNode = BaseNode.extend({
  id: objectId('wire'),
  type: nodeType('wire'),
  /** Plan polyline, level-local metres, from `from` to `to`. */
  path: z.array(z.tuple([z.number(), z.number()])).min(2),
  /** Height the run is drawn at in 3D (in the ceiling void), metres. */
  height: z.number().default(2.4),
  from: WireEnd,
  to: WireEnd,
}).describe('A wire between two electrical terminals, drawn as a plan polyline')

export type WireNode = z.infer<typeof WireNode>
export type WireNodeId = WireNode['id']
