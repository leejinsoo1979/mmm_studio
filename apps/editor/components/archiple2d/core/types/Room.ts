// @ts-nocheck
import type { PointId } from './Point';
import type { WallId } from './Wall';

/**
 * Room represents a closed polygon space in the floorplan
 */
export interface Room {
  id: string;
  name: string;
  points: PointId[];
  walls: WallId[];
  area: number;
  floorMaterial?: string;
  ceilingMaterial?: string;
  wallMaterial?: string;
}

export type RoomId = string;

export interface RoomProperties {
  name: string;
  floorMaterial?: string;
  ceilingMaterial?: string;
  wallMaterial?: string;
}
