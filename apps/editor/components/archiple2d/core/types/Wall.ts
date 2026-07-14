// @ts-nocheck
import type { PointId } from './Point';

/**
 * Wall connects two points and represents a physical wall in the floorplan
 *
 * Units: mm (millimeters)
 * - thickness: wall thickness in mm (e.g., 200mm = 20cm)
 * - height: wall height in mm for 3D (e.g., 2800mm = 2.8m)
 * - Points (startPointId, endPointId) contain mm coordinates
 */
export interface Wall {
  id: string;
  startPointId: PointId;
  endPointId: PointId;
  thickness: number; // mm (e.g., 200mm = 20cm)
  height: number; // mm (e.g., 2800mm = 2.8m)
  material?: string;
  isLoadBearing?: boolean;
}

export type WallId = string;

export interface WallProperties {
  thickness: number; // mm
  height: number; // mm
  material?: string;
  isLoadBearing?: boolean;
}
