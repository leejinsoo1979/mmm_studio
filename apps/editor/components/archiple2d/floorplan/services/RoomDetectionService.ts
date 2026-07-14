// @ts-nocheck
import type { Point } from '../../core/types/Point';
import type { Wall } from '../../core/types/Wall';
import type { Room } from '../../core/types/Room';
import { Vector2 } from '../../core/math/Vector2';
import { uuidv4 } from '../../core/utils/uuid';

/**
 * RoomDetectionService - Simple cycle-based room detection
 *
 * Algorithm:
 * 1. Build undirected graph from walls
 * 2. Find all simple cycles using DFS
 * 3. Filter by minimum area
 * 4. Remove duplicate/nested cycles
 */
export class RoomDetectionService {
  /**
   * Detect all rooms from walls and points
   */
  detectRooms(walls: Wall[], points: Point[]): Room[] {
    if (walls.length < 3) {
      console.log('[RoomDetection] Not enough walls');
      return [];
    }

    // Build point lookup map
    const pointMap = new Map<string, Point>();
    points.forEach((p) => pointMap.set(p.id, p));

    // Build adjacency list
    const graph = this.buildGraph(walls, points);

    console.log('[RoomDetection] Graph built with', graph.size, 'vertices');

    // Find all cycles
    const cycles = this.findAllCycles(graph, pointMap);

    console.log('[RoomDetection] Found', cycles.length, 'raw cycles');

    // Filter out composite rooms (rooms that contain other rooms)
    const finalRooms: Room[] = [];

    for (const cycle of cycles) {
      const cyclePoints = cycle.map(id => pointMap.get(id)!);
      const area = Math.abs(this.calculateSignedArea(cyclePoints));

      const MIN_AREA = 0.1; // 0.1 m² (lowered to support small intersections/closets)

      if (area < MIN_AREA) {
        console.log(`[RoomDetection] Cycle rejected: area ${area.toFixed(2)} m² < MIN_AREA ${MIN_AREA} m²`);
        continue;
      }

      // Check if this room contains any already accepted room
      // Since we process smallest rooms first, if this room contains an existing room,
      // it must be a composite room (e.g. the outer loop of two adjacent rooms)
      //
      // Key insight: A composite room will contain ALL points of a smaller room inside it.
      // Adjacent rooms only share SOME points (the wall endpoints), not all.
      let isComposite = false;
      const polygon = cyclePoints;
      const cyclePointIds = new Set(cycle);

      for (const existingRoom of finalRooms) {
        const existingPoints = existingRoom.points.map(id => pointMap.get(id)!);

        // Count how many points of existingRoom are inside this cycle's polygon
        let pointsInside = 0;
        let pointsShared = 0;

        for (const ep of existingPoints) {
          if (cyclePointIds.has(ep.id)) {
            pointsShared++;
          } else if (this.isPointInPolygon(ep, polygon)) {
            pointsInside++;
          }
        }

        // If ALL non-shared points are inside, this is a composite room
        const nonSharedPoints = existingRoom.points.length - pointsShared;
        if (nonSharedPoints > 0 && pointsInside === nonSharedPoints) {
          isComposite = true;
          console.log(`[RoomDetection] Cycle rejected: contains existing room ${existingRoom.id.slice(0, 8)} (${pointsInside}/${nonSharedPoints} points inside)`);
          break;
        }
      }

      if (!isComposite) {
        const room = this.createRoom(cycle, walls, area, pointMap);
        finalRooms.push(room);
      }
    }

    // Final deduplication: remove rooms with identical point sets
    const uniqueRooms: Room[] = [];
    const seenPointSets = new Set<string>();

    for (const room of finalRooms) {
      const pointSetKey = [...room.points].sort().join(',');
      if (!seenPointSets.has(pointSetKey)) {
        seenPointSets.add(pointSetKey);
        uniqueRooms.push(room);
      } else {
        console.log('[RoomDetection] Duplicate room removed:', room.id, 'points:', pointSetKey);
      }
    }

    console.log('[RoomDetection] Created', uniqueRooms.length, 'rooms (removed', finalRooms.length - uniqueRooms.length, 'duplicates)');
    return uniqueRooms;
  }

  /**
   * Build adjacency list
   * Handles T-junctions by splitting walls at connection points
   */
  private buildGraph(walls: Wall[], points: Point[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    const pointMap = new Map(points.map(p => [p.id, p]));

    // First, build a mapping of duplicate points (points at same location)
    // This ensures that points at the same location are treated as the same node
    const MERGE_TOLERANCE = 50; // 50mm tolerance for considering points as same location
    const pointIdMapping = new Map<string, string>(); // Maps duplicate point IDs to canonical ID

    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      if (pointIdMapping.has(p1.id)) continue; // Already mapped to another point

      pointIdMapping.set(p1.id, p1.id); // Map to itself initially

      for (let j = i + 1; j < points.length; j++) {
        const p2 = points[j];
        if (pointIdMapping.has(p2.id)) continue;

        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < MERGE_TOLERANCE) {
          // Map p2 to p1's canonical ID
          pointIdMapping.set(p2.id, p1.id);
          console.log(`[RoomDetection] Merging duplicate point ${p2.id.slice(0, 8)} -> ${p1.id.slice(0, 8)} (dist=${dist.toFixed(1)}mm)`);
        }
      }
    }

    // Helper to get canonical point ID
    const getCanonicalId = (id: string): string => {
      return pointIdMapping.get(id) || id;
    };

    // Helper to add edge using canonical IDs
    const addEdge = (id1: string, id2: string) => {
      const cid1 = getCanonicalId(id1);
      const cid2 = getCanonicalId(id2);
      if (cid1 === cid2) return; // Skip self-loops

      if (!graph.has(cid1)) graph.set(cid1, new Set());
      if (!graph.has(cid2)) graph.set(cid2, new Set());
      graph.get(cid1)!.add(cid2);
      graph.get(cid2)!.add(cid1);
    };

    let totalSplits = 0;

    for (const wall of walls) {
      const start = pointMap.get(wall.startPointId);
      const end = pointMap.get(wall.endPointId);
      if (!start || !end) continue;

      // Find all points that lie on this wall (including endpoints)
      const pointsOnWall: { id: string; t: number }[] = [];
      const startVec = Vector2.from(start);
      const endVec = Vector2.from(end);
      const wallVec = endVec.subtract(startVec);
      const lenSq = wallVec.lengthSquared();

      // Add start/end
      pointsOnWall.push({ id: start.id, t: 0 });
      pointsOnWall.push({ id: end.id, t: 1 });

      // Check other points
      points.forEach(p => {
        if (p.id === start.id || p.id === end.id) return;

        // Optimization: Check bounding box first with generous margin
        const margin = (wall.thickness || 200) / 2 + 100; // Wall half-thickness + extra buffer
        const minX = Math.min(start.x, end.x) - margin;
        const maxX = Math.max(start.x, end.x) + margin;
        const minY = Math.min(start.y, end.y) - margin;
        const maxY = Math.max(start.y, end.y) + margin;

        if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) return;

        const pVec = Vector2.from(p);
        const t = pVec.subtract(startVec).dot(wallVec) / lenSq;

        if (t > 0.001 && t < 0.999) {
          const projected = startVec.add(wallVec.multiply(t));
          const dist = pVec.distanceTo(projected);

          // Dynamic tolerance based on wall thickness
          // Allow points snapped to the wall FACE to be considered "on" the wall
          // Tolerance = Half Thickness + 50mm buffer
          const tolerance = (wall.thickness || 100) / 2 + 50;

          if (dist < tolerance) {
            pointsOnWall.push({ id: p.id, t });
            totalSplits++;
            console.log(`[RoomDetection] T-junction found: point ${p.id.slice(0, 8)} on wall ${wall.id.slice(0, 8)} at t=${t.toFixed(3)}, dist=${dist.toFixed(1)}mm (tol=${tolerance}mm)`);
          }
        }
      });

      // Sort points by position along wall
      pointsOnWall.sort((a, b) => a.t - b.t);

      // Add edges between consecutive points
      for (let i = 0; i < pointsOnWall.length - 1; i++) {
        addEdge(pointsOnWall[i].id, pointsOnWall[i + 1].id);
      }

      if (pointsOnWall.length > 2) {
        console.log(`[RoomDetection] Wall ${wall.id.slice(0, 8)} split into ${pointsOnWall.length - 1} segments`);
      }
    }

    console.log(`[RoomDetection] Total T-junctions detected: ${totalSplits}`);

    return graph;
  }

  private isPointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;

      const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Find all simple cycles using DFS
   */
  private findAllCycles(graph: Map<string, Set<string>>, pointMap: Map<string, Point>): string[][] {
    const allCycles: string[][] = [];
    // Iterate all nodes to find all fundamental cycles
    // We rely on the "smallest node" optimization in DFS to ensure each cycle is found exactly once
    // and to avoid infinite loops/redundant work.
    for (const startNode of graph.keys()) {
      this.dfs(startNode, startNode, [startNode], new Set([startNode]), graph, allCycles);
    }

    // Deduplicate cycles (same set of points)
    const unique = this.deduplicateCycles(allCycles);

    // Sort by area (smallest first - these are the "minimal" rooms)
    unique.sort((a, b) => {
      const areaA = Math.abs(this.calculateSignedArea(a.map(id => pointMap.get(id)!)));
      const areaB = Math.abs(this.calculateSignedArea(b.map(id => pointMap.get(id)!)));
      return areaA - areaB;
    });

    return unique;
  }

  /**
   * DFS to find cycles
   */
  private dfs(
    current: string,
    start: string,
    path: string[],
    pathSet: Set<string>,
    graph: Map<string, Set<string>>,
    allCycles: string[][]
  ): void {
    const neighbors = graph.get(current) || new Set();

    for (const neighbor of neighbors) {
      // Optimization: Only traverse to neighbors with ID >= start
      // This ensures we only find the cycle when we start from its "smallest" node (lexicographically)
      // Exception: if neighbor is start, we found a cycle!
      if (neighbor < start) continue;

      // Found a cycle back to start
      if (neighbor === start && path.length >= 3) {
        // Only add if we haven't seen this cycle yet
        allCycles.push([...path]);
        continue;
      }

      // Skip if already in path (avoid revisiting)
      if (pathSet.has(neighbor)) continue;

      // Continue DFS
      path.push(neighbor);
      pathSet.add(neighbor);
      this.dfs(neighbor, start, path, pathSet, graph, allCycles);
      path.pop();
      pathSet.delete(neighbor);
    }
  }

  /**
   * Remove duplicate cycles
   */
  private deduplicateCycles(cycles: string[][]): string[][] {
    const unique: string[][] = [];
    const seen = new Set<string>();

    for (const cycle of cycles) {
      // Create a canonical representation (sorted)
      const sorted = [...cycle].sort().join(',');

      if (!seen.has(sorted)) {
        seen.add(sorted);
        unique.push(cycle);
      }
    }

    return unique;
  }

  /**
   * Calculate signed area
   */
  private calculateSignedArea(points: Point[]): number {
    if (points.length < 3) return 0;

    let area = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }

    area = area / 2;

    // Convert from mm² to m²
    const PIXELS_PER_METER = 1000;
    area = area / (PIXELS_PER_METER * PIXELS_PER_METER);

    return area;
  }

  /**
   * Create room from cycle
   */
  private createRoom(pointIds: string[], walls: Wall[], area: number, pointMap: Map<string, Point>): Room {
    // Find walls connecting consecutive points in the cycle
    const wallIds: string[] = [];

    for (let i = 0; i < pointIds.length; i++) {
      const currId = pointIds[i];
      const nextId = pointIds[(i + 1) % pointIds.length];

      // Try direct endpoint match first
      let wall = walls.find(
        (w) =>
          (w.startPointId === currId && w.endPointId === nextId) ||
          (w.startPointId === nextId && w.endPointId === currId)
      );

      if (!wall) {
        // Try finding a wall that contains both points
        const curr = pointMap.get(currId);
        const next = pointMap.get(nextId);

        if (curr && next) {
          wall = walls.find(w => {
            // Check if both points are on this wall
            // We can reuse the logic from buildGraph or just check if points project to it
            // Simpler: check if points are roughly collinear with wall
            const start = pointMap.get(w.startPointId);
            const end = pointMap.get(w.endPointId);
            if (!start || !end) return false;

            // Check if curr is on w
            const isCurrOn = (curr.id === start.id || curr.id === end.id) || this.isPointOnWallSegment(curr, start, end);
            if (!isCurrOn) return false;

            const isNextOn = (next.id === start.id || next.id === end.id) || this.isPointOnWallSegment(next, start, end);
            return isNextOn;
          });
        }
      }

      if (wall) {
        if (!wallIds.includes(wall.id)) {
          wallIds.push(wall.id);
        }
      }
    }

    return {
      id: uuidv4(),
      name: `Room ${Math.floor(Math.random() * 1000)}`,
      points: pointIds,
      walls: wallIds,
      area: Math.abs(area),
    };
  }

  private isPointOnWallSegment(p: Point, start: Point, end: Point): boolean {
    const pVec = Vector2.from(p);
    const startVec = Vector2.from(start);
    const endVec = Vector2.from(end);
    const wallVec = endVec.subtract(startVec);
    const lenSq = wallVec.lengthSquared();

    if (lenSq < 0.0001) return false; // Zero length wall

    const t = pVec.subtract(startVec).dot(wallVec) / lenSq;

    if (t > 0.001 && t < 0.999) {
      const projected = startVec.add(wallVec.multiply(t));
      return pVec.distanceTo(projected) < 10; // 10mm tolerance
    }
    return false;
  }
}
