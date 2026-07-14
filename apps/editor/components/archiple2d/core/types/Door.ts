// @ts-nocheck
import type { WallId } from './Wall';

/**
 * Door represents a door placed on a wall
 */
export interface Door {
  id: string;
  wallId: WallId;
  position: number; // 0-1, position along wall from start to end point
  width: number; // mm
  height: number; // mm
  swing: 'left' | 'right' | 'double';
  openSide?: 'left' | 'right'; // Side of the wall the door opens to (relative to wall direction)
  thickness: number; // mm
}

export type DoorId = string;

export interface DoorProperties {
  swing: 'left' | 'right' | 'double';
  thickness: number;
}

// Default door specifications
export const DEFAULT_DOOR = {
  width: 900, // 900mm
  height: 2100, // 2100mm
  thickness: 40, // 40mm door thickness
  swing: 'right' as const,
};
