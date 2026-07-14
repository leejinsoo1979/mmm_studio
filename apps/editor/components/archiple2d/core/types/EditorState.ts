// @ts-nocheck
import type { Point } from './Point';
import type { Wall } from './Wall';
import type { Room } from './Room';
import type { Door } from './Door';
import type { Window } from './Window';

/**
 * EditorState represents the complete state of the editor
 */
export interface EditorState {
  points: Map<string, Point>;
  walls: Map<string, Wall>;
  rooms: Map<string, Room>;
  doors: Map<string, Door>;
  windows: Map<string, Window>;
  selectedObjects: Set<string>;
  hoveredObject: string | null;
  currentTool: ToolType;
  gridSize: number;
  snapEnabled: boolean;
}

export const ToolType = {
  SELECT: 'select',
  WALL: 'wall',
  RECTANGLE: 'rectangle',
  DRAW_WALL: 'draw_wall',
  DOOR: 'door',
  WINDOW: 'window',
  MOVE: 'move',
  ERASE: 'erase',
} as const;

export type ToolType = typeof ToolType[keyof typeof ToolType];

export interface EditorConfig {
  gridSize: number;
  snapEnabled: boolean;
  snapThreshold: number;
  wallThickness: number;
  wallHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}
