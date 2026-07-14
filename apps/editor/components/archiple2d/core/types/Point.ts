// @ts-nocheck
/**
 * Point represents a 2D coordinate in the floorplan
 *
 * Units: mm (millimeters)
 * - Internal coordinates ALWAYS in mm
 * - Rendering converts mm → px using worldToScreen()
 * - Example: x=4800, y=3000 means 4.8m x 3.0m in real world
 */
export interface Point {
  id: string;
  x: number; // mm coordinate
  y: number; // mm coordinate
  isSnapped?: boolean;
  connectedWalls?: string[]; // Wall IDs
}

export type PointId = string;
