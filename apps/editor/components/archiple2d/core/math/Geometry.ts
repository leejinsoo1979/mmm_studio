// @ts-nocheck
import { Vector2 } from './Vector2';
import type { Point } from '../types/Point';

/**
 * Geometry utilities for intersection, distance, and collision detection
 */
export class Geometry {
  /**
   * Check if two line segments intersect
   */
  static lineSegmentsIntersect(
    p1: Vector2,
    p2: Vector2,
    p3: Vector2,
    p4: Vector2
  ): boolean {
    const d1 = this.direction(p3, p4, p1);
    const d2 = this.direction(p3, p4, p2);
    const d3 = this.direction(p1, p2, p3);
    const d4 = this.direction(p1, p2, p4);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
      return true;
    }

    if (d1 === 0 && this.onSegment(p3, p4, p1)) return true;
    if (d2 === 0 && this.onSegment(p3, p4, p2)) return true;
    if (d3 === 0 && this.onSegment(p1, p2, p3)) return true;
    if (d4 === 0 && this.onSegment(p1, p2, p4)) return true;

    return false;
  }

  /**
   * Get intersection point of two line segments
   */
  static getIntersectionPoint(
    p1: Vector2,
    p2: Vector2,
    p3: Vector2,
    p4: Vector2
  ): Vector2 | null {
    const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);

    if (Math.abs(d) < 0.0001) return null;

    const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / d;
    const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / d;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return new Vector2(
        p1.x + t * (p2.x - p1.x),
        p1.y + t * (p2.y - p1.y)
      );
    }

    return null;
  }

  /**
   * Calculate distance from point to line segment
   */
  static pointToSegmentDistance(point: Vector2, segStart: Vector2, segEnd: Vector2): number {
    const segVec = segEnd.subtract(segStart);
    const pointVec = point.subtract(segStart);
    const segLength = segVec.length();

    if (segLength === 0) {
      return point.distance(segStart);
    }

    const t = Math.max(0, Math.min(1, pointVec.dot(segVec) / (segLength * segLength)));
    const projection = segStart.add(segVec.multiply(t));
    return point.distance(projection);
  }

  /**
   * Check if a polygon is closed (first and last points are close)
   */
  static isPolygonClosed(points: Point[], threshold: number = 5): boolean {
    if (points.length < 3) return false;
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    if (!(firstPoint && lastPoint)) return false;
    const first = Vector2.from(firstPoint);
    const last = Vector2.from(lastPoint);
    return first.distance(last) < threshold;
  }

  /**
   * Calculate area of a polygon using shoelace formula
   */
  static calculatePolygonArea(points: Point[]): number {
    if (points.length < 3) return 0;

    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const point = points[i];
      const nextPoint = points[j];
      if (!(point && nextPoint)) continue;
      area += point.x * nextPoint.y;
      area -= nextPoint.x * point.y;
    }

    return Math.abs(area / 2);
  }

  /**
   * Check if point is inside polygon
   */
  static pointInPolygon(point: Vector2, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const pointI = polygon[i];
      const pointJ = polygon[j];
      if (!(pointI && pointJ)) continue;
      const xi = pointI.x, yi = pointI.y;
      const xj = pointJ.x, yj = pointJ.y;

      const intersect = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Get centroid of polygon
   */
  static getPolygonCentroid(points: Point[]): Vector2 {
    if (points.length === 0) return Vector2.zero();

    let x = 0, y = 0;
    for (const point of points) {
      x += point.x;
      y += point.y;
    }

    return new Vector2(x / points.length, y / points.length);
  }

  private static direction(p1: Vector2, p2: Vector2, p3: Vector2): number {
    return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
  }

  private static onSegment(p1: Vector2, p2: Vector2, p3: Vector2): boolean {
    return p3.x <= Math.max(p1.x, p2.x) && p3.x >= Math.min(p1.x, p2.x) &&
           p3.y <= Math.max(p1.y, p2.y) && p3.y >= Math.min(p1.y, p2.y);
  }
}
