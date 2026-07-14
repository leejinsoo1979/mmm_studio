// @ts-nocheck
import { Vector2 } from './Vector2';
import type { Point } from '../types/Point';

/**
 * Snap utilities for grid snapping and point alignment
 */
export class Snap {
  /**
   * Snap point to grid
   */
  static toGrid(point: Vector2, gridSize: number): Vector2 {
    return new Vector2(
      Math.round(point.x / gridSize) * gridSize,
      Math.round(point.y / gridSize) * gridSize
    );
  }

  /**
   * Snap to nearest point within threshold
   */
  static toNearestPoint(
    point: Vector2,
    points: Point[],
    threshold: number
  ): Point | null {
    let nearest: Point | null = null;
    let minDistance = threshold;

    for (const p of points) {
      const distance = point.distance(Vector2.from(p));
      if (distance < minDistance) {
        minDistance = distance;
        nearest = p;
      }
    }

    return nearest;
  }

  /**
   * Snap to angle (0°, 45°, 90°, etc.)
   */
  static toAngle(
    from: Vector2,
    to: Vector2,
    angleStep: number = 45
  ): Vector2 {
    const direction = to.subtract(from);
    const angle = direction.angle() * (180 / Math.PI);
    const snappedAngle = Math.round(angle / angleStep) * angleStep;
    const snappedRad = snappedAngle * (Math.PI / 180);
    const length = direction.length();

    return from.add(
      new Vector2(
        Math.cos(snappedRad) * length,
        Math.sin(snappedRad) * length
      )
    );
  }

  /**
   * Snap to horizontal or vertical alignment
   */
  static toAxisAlignment(
    from: Vector2,
    to: Vector2,
    threshold: number = 10
  ): Vector2 {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);

    if (dx < threshold) {
      return new Vector2(from.x, to.y);
    }

    if (dy < threshold) {
      return new Vector2(to.x, from.y);
    }

    return to;
  }

  /**
   * Check if point is snapped
   */
  static isSnapped(point: Vector2, gridSize: number, tolerance: number = 0.5): boolean {
    const snapped = this.toGrid(point, gridSize);
    return point.distance(snapped) < tolerance;
  }
}
