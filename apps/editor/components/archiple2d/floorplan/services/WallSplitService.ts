// @ts-nocheck
import type { Point } from '../../core/types/Point';
import type { Wall } from '../../core/types/Wall';
import { Vector2 } from '../../core/math/Vector2';
import { uuidv4 } from '../../core/utils/uuid';

/**
 * WallSplitService - Split walls at T-junctions
 *
 * When a point lies on a wall (not at endpoints), split the wall into two segments.
 * This allows proper room detection and individual wall selection.
 */
export class WallSplitService {
  /**
   * Split walls at T-junctions where points lie on wall midpoints
   * Returns new walls array with split segments and new points that were created
   */
  splitWallsAtTJunctions(
    walls: Wall[],
    points: Point[]
  ): { walls: Wall[]; newPoints: Point[]; removedWallIds: string[] } {
    const pointMap = new Map(points.map(p => [p.id, p]));
    let currentPoints = [...points];
    const newPoints: Point[] = [];

    console.log('[WallSplit] Starting wall split analysis for', walls.length, 'walls and', points.length, 'points');

    // STEP 1: Find wall-wall intersections and create new points
    console.log('[WallSplit] Step 1: Checking for wall-wall intersections...');
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const wall1 = walls[i];
        const wall2 = walls[j];

        const start1 = pointMap.get(wall1.startPointId);
        const end1 = pointMap.get(wall1.endPointId);
        const start2 = pointMap.get(wall2.startPointId);
        const end2 = pointMap.get(wall2.endPointId);

        if (!start1 || !end1 || !start2 || !end2) continue;

        // Check if walls share an endpoint (skip if they do)
        if (wall1.startPointId === wall2.startPointId || wall1.startPointId === wall2.endPointId ||
            wall1.endPointId === wall2.startPointId || wall1.endPointId === wall2.endPointId) {
          continue;
        }

        // Find intersection point
        const intersection = this.getLineIntersection(start1, end1, start2, end2);
        if (intersection) {
          // Check if a point already exists at this location (within 1mm tolerance)
          let existingPoint: Point | undefined;
          for (const p of currentPoints) {
            const dx = p.x - intersection.x;
            const dy = p.y - intersection.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < 1) { // 1mm tolerance
              existingPoint = p;
              break;
            }
          }

          if (existingPoint) {
            console.log(`[WallSplit] Found wall-wall intersection between ${wall1.id.slice(0, 8)} and ${wall2.id.slice(0, 8)} at existing point ${existingPoint.id.slice(0, 8)}`);
          } else {
            console.log(`[WallSplit] Found wall-wall intersection between ${wall1.id.slice(0, 8)} and ${wall2.id.slice(0, 8)} at (${intersection.x.toFixed(1)}, ${intersection.y.toFixed(1)})`);

            // Create new point at intersection
            const newPoint: Point = {
              id: uuidv4(),
              x: intersection.x,
              y: intersection.y,
            };

            currentPoints.push(newPoint);
            pointMap.set(newPoint.id, newPoint);
            newPoints.push(newPoint);
          }
        }
      }
    }

    // STEP 2: Split walls at T-junctions and intersections
    console.log('[WallSplit] Step 2: Splitting walls at T-junctions and intersections...');
    const newWalls: Wall[] = [];
    const removedWallIds: string[] = [];
    const processedWalls = new Set<string>();

    for (const wall of walls) {
      if (processedWalls.has(wall.id)) continue;

      const start = pointMap.get(wall.startPointId);
      const end = pointMap.get(wall.endPointId);
      if (!start || !end) {
        newWalls.push(wall);
        continue;
      }

      // Find all points that lie on this wall (excluding endpoints)
      const pointsOnWall: { point: Point; t: number }[] = [];
      const startVec = Vector2.from(start);
      const endVec = Vector2.from(end);
      const wallVec = endVec.subtract(startVec);
      const lenSq = wallVec.lengthSquared();

      if (lenSq < 0.0001) {
        // Zero-length wall, skip
        newWalls.push(wall);
        continue;
      }

      // Check all points to see if they lie on this wall
      for (const p of currentPoints) {
        if (p.id === start.id || p.id === end.id) continue;

        // Optimization: Check bounding box first
        const minX = Math.min(start.x, end.x) - 50;
        const maxX = Math.max(start.x, end.x) + 50;
        const minY = Math.min(start.y, end.y) - 50;
        const maxY = Math.max(start.y, end.y) + 50;

        if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;

        const pVec = Vector2.from(p);
        const t = pVec.subtract(startVec).dot(wallVec) / lenSq;

        if (t > 0.001 && t < 0.999) {
          const projected = startVec.add(wallVec.multiply(t));
          const dist = pVec.distanceTo(projected);
          if (dist < 50) {
            // 50mm tolerance (increased from 10mm for better intersection detection)
            pointsOnWall.push({ point: p, t });
            console.log(`[WallSplit] Point ${p.id.slice(0, 8)} lies on wall ${wall.id.slice(0, 8)} at t=${t.toFixed(3)}, dist=${dist.toFixed(1)}mm`);
          }
        }
      }

      if (pointsOnWall.length === 0) {
        // No T-junctions on this wall, keep as-is
        newWalls.push(wall);
      } else {
        // Sort points by position along wall
        pointsOnWall.sort((a, b) => a.t - b.t);

        console.log(
          `[WallSplit] Splitting wall ${wall.id.slice(0, 8)} at ${pointsOnWall.length} T-junction(s)`
        );

        // Split wall into segments
        const allPointsOnWall = [
          { point: start, t: 0 },
          ...pointsOnWall,
          { point: end, t: 1 },
        ];

        for (let i = 0; i < allPointsOnWall.length - 1; i++) {
          const segmentStart = allPointsOnWall[i].point;
          const segmentEnd = allPointsOnWall[i + 1].point;

          // Create new wall segment
          const newWall: Wall = {
            id: uuidv4(),
            startPointId: segmentStart.id,
            endPointId: segmentEnd.id,
            thickness: wall.thickness,
            height: wall.height,
          };

          newWalls.push(newWall);

          console.log(
            `[WallSplit] Created segment ${newWall.id.slice(0, 8)}: ${segmentStart.id.slice(0, 8)} -> ${segmentEnd.id.slice(0, 8)}`
          );
        }

        // Mark original wall for removal
        removedWallIds.push(wall.id);
        processedWalls.add(wall.id);
      }
    }

    console.log(
      `[WallSplit] Split complete: ${walls.length} walls -> ${newWalls.length} walls (${removedWallIds.length} removed, ${newWalls.length - walls.length + removedWallIds.length} added)`
    );

    return { walls: newWalls, newPoints, removedWallIds };
  }

  /**
   * Find intersection point between two line segments
   * Returns null if lines don't intersect or are parallel
   * IMPORTANT: Only detects true X-junctions (both walls cross in the middle)
   * T-junctions (where one wall's endpoint is on another wall) are handled separately
   */
  private getLineIntersection(
    p1: Point,
    p2: Point,
    p3: Point,
    p4: Point
  ): { x: number; y: number } | null {
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;
    const x4 = p4.x, y4 = p4.y;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

    // Lines are parallel
    if (Math.abs(denom) < 0.0001) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    // STRICT CHECK: Only accept intersections well inside BOTH segments
    // This prevents detecting T-junctions as X-junctions
    // Use 0.1 (10%) instead of 0.01 to avoid near-endpoint intersections
    if (t > 0.1 && t < 0.9 && u > 0.1 && u < 0.9) {
      return {
        x: x1 + t * (x2 - x1),
        y: y1 + t * (y2 - y1)
      };
    }

    return null;
  }
}
