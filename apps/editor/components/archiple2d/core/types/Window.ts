// @ts-nocheck
import type { WallId } from './Wall';

/**
 * Window represents a window placed on a wall
 */
export interface Window {
  id: string;
  wallId: WallId;
  position: number; // 0-1, position along wall from start to end point
  width: number; // mm
  height: number; // mm
  sillHeight: number; // mm from floor
  type: 'sliding' | 'casement' | 'fixed';
  frameWidth: number; // mm
}

export type WindowId = string;

export interface WindowProperties {
  type: 'sliding' | 'casement' | 'fixed';
  frameWidth: number;
  sillHeight: number;
}

// Default window specifications
export const DEFAULT_WINDOW = {
  width: 1200, // 1200mm
  height: 1200, // 1200mm
  sillHeight: 900, // 900mm from floor
  frameWidth: 50, // 50mm frame width
  type: 'sliding' as const,
};
