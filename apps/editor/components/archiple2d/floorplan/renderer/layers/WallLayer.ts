// @ts-nocheck
import { BaseLayer } from './Layer';
import type { Wall } from '../../../core/types/Wall';
import type { Point } from '../../../core/types/Point';
import type { Door } from '../../../core/types/Door';
import type { Room } from '../../../core/types/Room';
import type { Camera2D } from '../Camera2D';
import { Vector2 } from '../../../core/math/Vector2';

export interface WallLayerConfig {
  wallColor?: string;
  wallThickness?: number;
  previewColor?: string;
  previewStyle?: 'solid' | 'dashed';
}

/**
 * WallLayer - Renders walls
 *
 * Features:
 * - Solid walls (confirmed)
 * - Preview walls (dashed, while drawing)
 * - Thickness visualization
 * - Hover highlight
 * - Mitered corners (45 degrees)
 *
 * Units:
 * - Point coordinates are in mm (world space)
 * - Wall thickness: mm (200mm = 20cm)
 * - Camera transforms mm coordinates to screen px
 */
interface DimensionHitbox {
  wallId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RenderSegment {
  wallId: string;
  start: Point;
  end: Point;
  thickness: number;
  isHole?: boolean;
}

export class WallLayer extends BaseLayer {
  private walls: Wall[] = [];
  private points: Map<string, Point> = new Map();
  private doors: Door[] = [];
  private previewWall: { start: Point; end: Point } | null = null;
  private multiPreviewWalls: Array<{ start: Point; end: Point }> = [];
  private hoveredWallId: string | null = null;
  private selectedWallId: string | null = null;
  private camera: Camera2D | null = null;
  private dimensionHitboxes: DimensionHitbox[] = [];
  private renderStyle: 'wireframe' | 'hidden-line' | 'solid' | 'realistic' = 'solid';

  // Angle guide state
  private angleGuide: { from: Point; angle: number } | null = null;

  private config: Required<WallLayerConfig>;

  // Connectivity map for corner calculations
  // pointId -> list of connected wall IDs
  private connectivityMap: Map<string, string[]> = new Map();

  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;

  constructor(config?: WallLayerConfig) {
    super(2); // z-index: 2

    this.config = {
      wallColor: config?.wallColor || '#505050',
      wallThickness: config?.wallThickness || 100, // 100mm = 10cm
      previewColor: config?.previewColor || '#3498db',
      previewStyle: config?.previewStyle || 'dashed',
    };
  }

  setSize(width: number, height: number): void {
    // Initialize or resize offscreen canvas
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }

    if (this.offscreenCanvas) {
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;
    }
  }

  setWalls(walls: Wall[]): void {
    this.walls = walls;
    this.updateConnectivity();
  }

  setPoints(points: Point[]): void {
    this.points.clear();
    points.forEach((p) => this.points.set(p.id, p));
  }

  setRooms(_rooms: Room[]): void {
    // Rooms stored by RoomLayer, this is for potential future wall-room relationship
  }

  setDoors(doors: Door[]): void {
    this.doors = doors;
  }

  setPreviewWall(start: Point | null, end: Point | null): void {
    if (start && end) {
      this.previewWall = { start, end };
    } else {
      this.previewWall = null;
    }
  }

  setMultiPreviewWalls(walls: Array<{ start: Point; end: Point }> | null): void {
    this.multiPreviewWalls = walls || [];
  }

  setHoveredWall(wallId: string | null): void {
    this.hoveredWallId = wallId;
  }

  setSelectedWall(wallId: string | null): void {
    this.selectedWallId = wallId;
  }

  setCamera(camera: Camera2D): void {
    this.camera = camera;
  }

  setRenderStyle(style: 'wireframe' | 'hidden-line' | 'solid' | 'realistic'): void {
    this.renderStyle = style;
  }

  setWallThickness(thickness: number): void {
    this.config.wallThickness = thickness;
  }

  setAngleGuide(from: Point | null, angle: number | null): void {
    if (from && angle !== null) {
      this.angleGuide = { from, angle };
    } else {
      this.angleGuide = null;
    }
  }

  private updateConnectivity(): void {
    this.connectivityMap.clear();
    this.walls.forEach(wall => {
      // Add to start point
      if (!this.connectivityMap.has(wall.startPointId)) {
        this.connectivityMap.set(wall.startPointId, []);
      }
      this.connectivityMap.get(wall.startPointId)?.push(wall.id);

      // Add to end point
      if (!this.connectivityMap.has(wall.endPointId)) {
        this.connectivityMap.set(wall.endPointId, []);
      }
      this.connectivityMap.get(wall.endPointId)?.push(wall.id);
    });
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return;

    // Update connectivity map before rendering
    this.updateConnectivity();

    // Clear hitboxes for this frame
    this.dimensionHitboxes = [];

    // Generate segments for all walls
    const segments = this.generateRenderSegments();

    // Build connectivity map for segments
    // Map<PointID, RenderSegment[]>
    const segmentMap = new Map<string, RenderSegment[]>();

    segments.forEach(seg => {
      if (seg.isHole) return;

      const add = (pid: string) => {
        if (!segmentMap.has(pid)) segmentMap.set(pid, []);
        segmentMap.get(pid)!.push(seg);
      };
      add(seg.start.id);
      add(seg.end.id);
    });

    // Render all segments - Pass 1: Fills
    // This creates a unified wall body
    this.applyOpacity(ctx);
    ctx.globalAlpha = 1.0; // Force opaque

    segments.forEach((segment) => {
      if (segment.isHole) return;
      const isSelected = segment.wallId === this.selectedWallId;
      const isHovered = this.hoveredWallId === segment.wallId;
      this.renderSegmentFill(ctx, segment, segmentMap, isSelected, isHovered);
    });

    // Render all segments - Pass 2: Strokes (Merged)
    // This draws the outlines, skipping internal joints to look merged
    segments.forEach((segment) => {
      if (segment.isHole) return;
      const isSelected = segment.wallId === this.selectedWallId;
      const isHovered = this.hoveredWallId === segment.wallId;
      this.renderSegmentStroke(ctx, segment, segmentMap, isSelected, isHovered);
    });

    this.resetOpacity(ctx);

    // Render aligned exterior dimensions
    this.renderAlignedExteriorDimensions(ctx);

    // Render preview wall
    if (this.previewWall) {
      this.renderPreviewWall(ctx, this.previewWall.start, this.previewWall.end);
    }

    // Render multi-preview walls (for L/U shape wall dragging)
    if (this.multiPreviewWalls.length > 0) {
      this.multiPreviewWalls.forEach(wall => {
        this.renderPreviewWall(ctx, wall.start, wall.end);
      });
    }

    // Render angle guide
    if (this.angleGuide) {
      this.renderAngleGuide(ctx, this.angleGuide.from, this.angleGuide.angle);
    }

    // If offscreen canvas was not used, reset opacity here
    if (!this.offscreenCtx) {
      this.resetOpacity(ctx);
    }
  }

  /**
   * Represents a portion of a wall to be rendered.
   * A single wall might be split into multiple segments by T-junctions.
   */
  private generateRenderSegments(): RenderSegment[] {
    const segments: RenderSegment[] = [];

    // Helper to find points on a wall (only for door splitting, T-junction splitting is done by WallSplitService)
    const getPointsOnWall = (wall: Wall): { point: Point, t: number, isEndpoint: boolean }[] => {
      const points: { point: Point, t: number, isEndpoint: boolean }[] = [];
      const start = this.points.get(wall.startPointId)!;
      const end = this.points.get(wall.endPointId)!;
      const startVec = Vector2.from(start);
      const endVec = Vector2.from(end);
      const wallVec = endVec.subtract(startVec);
      const wallLengthSq = wallVec.lengthSquared();

      // Add endpoints
      points.push({ point: start, t: 0, isEndpoint: true });
      points.push({ point: end, t: 1, isEndpoint: true });

      // NOTE: T-junction and X-junction splitting is now handled by WallSplitService
      // This function only handles door openings

      // Add door endpoints
      this.doors.forEach(door => {
        if (door.wallId !== wall.id) return;

        // Door position is 0-1 along the wall
        // We assume position is the CENTER of the door
        const wallLength = Math.sqrt(wallLengthSq);
        const halfWidthT = (door.width / 2) / wallLength;

        const startT = Math.max(0, door.position - halfWidthT);
        const endT = Math.min(1, door.position + halfWidthT);

        // Create points for door start/end
        // We need unique IDs for these temporary points
        const startP = startVec.add(wallVec.multiply(startT));
        const endP = startVec.add(wallVec.multiply(endT));

        points.push({
          point: { id: `door-${door.id}-start`, x: startP.x, y: startP.y },
          t: startT,
          isEndpoint: false
        });
        points.push({
          point: { id: `door-${door.id}-end`, x: endP.x, y: endP.y },
          t: endT,
          isEndpoint: false
        });
      });

      return points.sort((a, b) => a.t - b.t);
    };

    this.walls.forEach(wall => {
      const pointsOnWall = getPointsOnWall(wall);

      // Create segments between consecutive points
      for (let i = 0; i < pointsOnWall.length - 1; i++) {
        const p1 = pointsOnWall[i];
        const p2 = pointsOnWall[i + 1];

        // Check if this segment is a hole (inside a door)
        const midT = (p1.t + p2.t) / 2;
        const isHole = this.doors.some(door => {
          if (door.wallId !== wall.id) return false;
          const wallLength = Vector2.from(this.points.get(wall.endPointId)!).distance(Vector2.from(this.points.get(wall.startPointId)!));
          const halfWidthT = (door.width / 2) / wallLength;
          const startT = door.position - halfWidthT;
          const endT = door.position + halfWidthT;
          return midT >= startT && midT <= endT;
        });

        segments.push({
          wallId: wall.id,
          start: p1.point,
          end: p2.point,
          thickness: this.config.wallThickness,
          isHole
        });
      }
    });

    return segments;
  }

  private renderSegmentFill(
    ctx: CanvasRenderingContext2D,
    segment: RenderSegment,
    segmentMap: Map<string, RenderSegment[]>,
    isSelected: boolean,
    isHovered: boolean
  ): void {
    const start = Vector2.from(segment.start);
    const end = Vector2.from(segment.end);

    // Calculate corners at start and end using segment connectivity
    const startCorners = this.calculateJointCorners(segment.start, start, end, segment, segmentMap);
    const endCorners = this.calculateJointCorners(segment.end, end, start, segment, segmentMap);

    const poly = [
      startCorners.left,
      endCorners.right,
      end, // Include center point to fill T-junction gaps (Y-shape)
      endCorners.left,
      startCorners.right,
      start // Include center point
    ];

    // Determine color
    let color: string;
    const themeColorRaw = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
    const themeColor = themeColorRaw || '#3FAEA7';

    // Determine wall color based on dark mode
    const isDarkModeWall = document.documentElement.getAttribute('data-theme') === 'dark';
    const defaultWallColor = isDarkModeWall ? '#AAAAAA' : this.config.wallColor;

    if (isSelected) {
      color = themeColor;
    } else if (isHovered) {
      color = themeColor;
    } else {
      color = defaultWallColor;
    }

    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i].x, poly[i].y);
    }
    ctx.closePath();

    // Render based on style
    switch (this.renderStyle) {
      case 'wireframe':
        // Opaque gray fill for wireframe/CAD style
        ctx.fillStyle = '#888888';
        ctx.fill();
        break;

      case 'hidden-line':
        // Fill with light color
        const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
        ctx.fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
        ctx.fill();
        break;

      case 'realistic':
        // Gradient fill
        ctx.globalAlpha = 1.0;
        const centerX = (poly[0].x + poly[1].x + poly[2].x + poly[3].x) / 4;
        const centerY = (poly[0].y + poly[1].y + poly[2].y + poly[3].y) / 4;
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, this.config.wallThickness / 2);
        const baseColor = isSelected ? themeColor : (isHovered ? themeColor : defaultWallColor);
        gradient.addColorStop(0, baseColor);
        gradient.addColorStop(1, this.darkenColor(baseColor, 0.3));
        ctx.fillStyle = gradient;
        ctx.fill();
        break;

      case 'solid':
      default:
        // Standard solid fill
        ctx.fillStyle = color;
        ctx.fill();
        break;
    }
  }

  private renderSegmentStroke(
    ctx: CanvasRenderingContext2D,
    segment: RenderSegment,
    segmentMap: Map<string, RenderSegment[]>,
    isSelected: boolean,
    isHovered: boolean
  ): void {
    const start = Vector2.from(segment.start);
    const end = Vector2.from(segment.end);

    // Calculate corners
    const startCorners = this.calculateJointCorners(segment.start, start, end, segment, segmentMap);
    const endCorners = this.calculateJointCorners(segment.end, end, start, segment, segmentMap);

    // Determine stroke color and width
    let strokeColor: string;
    let lineWidth: number;

    const themeColorRaw = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
    const themeColor = themeColorRaw || '#3FAEA7';
    const isDarkModeStroke = document.documentElement.getAttribute('data-theme') === 'dark';
    const defaultWallColorStroke = isDarkModeStroke ? '#AAAAAA' : this.config.wallColor;

    if (isSelected || isHovered) {
      strokeColor = themeColor;
      lineWidth = 3.5;
    } else {
      // Default stroke color - white in dark mode
      strokeColor = isDarkModeStroke ? '#FFFFFF' : this.darkenColor(defaultWallColorStroke, 0.5);
      lineWidth = 2.5;
    }

    // Override for specific styles
    if (this.renderStyle === 'wireframe') {
      // Use high contrast colors for wireframe mode
      strokeColor = isSelected || isHovered ? themeColor : (isDarkModeStroke ? '#FFFFFF' : '#000000');
      lineWidth = 3; // Thicker lines for wireframe
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round'; // Smooth joints
    ctx.lineJoin = 'round';

    // Draw "Left" side (Start.Left -> End.Right)
    ctx.beginPath();
    ctx.moveTo(startCorners.left.x, startCorners.left.y);
    ctx.lineTo(endCorners.right.x, endCorners.right.y);
    ctx.stroke();

    // Draw "Right" side (Start.Right -> End.Left)
    ctx.beginPath();
    ctx.moveTo(startCorners.right.x, startCorners.right.y);
    ctx.lineTo(endCorners.left.x, endCorners.left.y);
    ctx.stroke();

    // Draw Caps if dead end
    // Check connectivity count
    const startCount = segmentMap.get(segment.start.id)?.length || 0;
    const endCount = segmentMap.get(segment.end.id)?.length || 0;

    // Start Cap
    if (startCount <= 1) {
      ctx.beginPath();
      ctx.moveTo(startCorners.left.x, startCorners.left.y);
      ctx.lineTo(startCorners.right.x, startCorners.right.y);
      ctx.stroke();
    }

    // End Cap
    if (endCount <= 1) {
      ctx.beginPath();
      ctx.moveTo(endCorners.left.x, endCorners.left.y);
      ctx.lineTo(endCorners.right.x, endCorners.right.y);
      ctx.stroke();
    }
  }

  private darkenColor(color: string, amount: number): string {
    // Simple color darkening - works with hex colors
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    const newR = Math.max(0, Math.floor(r * (1 - amount)));
    const newG = Math.max(0, Math.floor(g * (1 - amount)));
    const newB = Math.max(0, Math.floor(b * (1 - amount)));

    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }

  private calculateJointCorners(
    junctionPoint: Point,
    currentStart: Vector2,
    currentEnd: Vector2,
    currentSegment: RenderSegment,
    segmentMap: Map<string, RenderSegment[]>
  ): { left: Vector2, right: Vector2 } {
    const halfThickness = this.config.wallThickness / 2;
    const currentDir = currentEnd.subtract(currentStart).normalize();

    // Get all connected segments at this junction
    const connected = segmentMap.get(junctionPoint.id) || [];

    // Filter and map to vectors
    const connectedSegments: { vec: Vector2, angle: number, segment: RenderSegment, isCurrent: boolean }[] = [];

    connected.forEach(seg => {
      // Determine vector pointing AWAY from junction
      let dir: Vector2;
      if (seg.start.id === junctionPoint.id) {
        dir = Vector2.from(seg.end).subtract(Vector2.from(seg.start)).normalize();
      } else if (seg.end.id === junctionPoint.id) {
        dir = Vector2.from(seg.start).subtract(Vector2.from(seg.end)).normalize();
      } else {
        // Should not happen if map is built correctly
        return;
      }

      // Check if this is the current segment (same object reference)
      const isCurrent = seg === currentSegment;

      connectedSegments.push({
        vec: dir,
        angle: Math.atan2(dir.y, dir.x),
        segment: seg,
        isCurrent
      });
    });

    // Sort segments by angle
    connectedSegments.sort((a, b) => a.angle - b.angle);

    // Find current segment index
    const currentIndex = connectedSegments.findIndex(s => s.isCurrent);

    if (currentIndex === -1) {
      // Should not happen
      const normal = new Vector2(-currentDir.y, currentDir.x);
      return {
        left: currentStart.add(normal.multiply(halfThickness)),
        right: currentStart.subtract(normal.multiply(halfThickness))
      };
    }

    // If Current is the ONLY segment (endpoint), corners are just perpendicular.
    if (connectedSegments.length === 1) {
      const normal = new Vector2(-currentDir.y, currentDir.x);
      return {
        left: currentStart.add(normal.multiply(halfThickness)),
        right: currentStart.subtract(normal.multiply(halfThickness))
      };
    }

    // Filter out duplicate/overlapping segments (same angle)
    // We want to keep the 'current' segment if it exists in a group of duplicates
    const uniqueSegments: typeof connectedSegments = [];

    // Group by angle (tolerance 10 degrees ~ 0.175 rad)
    const ANGLE_TOLERANCE = 0.175;

    for (let i = 0; i < connectedSegments.length; i++) {
      const seg = connectedSegments[i];

      // Check if we already have a segment with this angle
      const existingIdx = uniqueSegments.findIndex(s => {
        let diff = Math.abs(s.angle - seg.angle);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        return diff < ANGLE_TOLERANCE;
      });

      if (existingIdx !== -1) {
        // If we found a duplicate, prefer the one that is 'current'
        if (seg.isCurrent) {
          uniqueSegments[existingIdx] = seg;
        }
        // Otherwise keep the existing one
      } else {
        uniqueSegments.push(seg);
      }
    }

    // Replace connectedSegments with filtered list
    // We need to re-sort and re-find current index
    uniqueSegments.sort((a, b) => a.angle - b.angle);

    // Re-find current segment index in the filtered list
    const newCurrentIndex = uniqueSegments.findIndex(s => s.isCurrent);

    if (newCurrentIndex === -1) {
      // This shouldn't happen if we preserved isCurrent correctly,
      // but as a fallback if current was somehow filtered out (unlikely with logic above)
      // or if it wasn't in the original list:
      const normal = new Vector2(-currentDir.y, currentDir.x);
      return {
        left: currentStart.add(normal.multiply(halfThickness)),
        right: currentStart.subtract(normal.multiply(halfThickness))
      };
    }

    const filteredSegments = uniqueSegments;
    const numSegments = filteredSegments.length;

    // Find neighbors (cyclic)
    const prevIndex = (newCurrentIndex - 1 + numSegments) % numSegments;
    const nextIndex = (newCurrentIndex + 1) % numSegments;

    const prevSeg = filteredSegments[prevIndex];
    const nextSeg = filteredSegments[nextIndex];

    // If Current is the ONLY segment (endpoint), corners are just perpendicular.
    if (numSegments === 1) {
      const normal = new Vector2(-currentDir.y, currentDir.x);
      return {
        left: currentStart.add(normal.multiply(halfThickness)),
        right: currentStart.subtract(normal.multiply(halfThickness))
      };
    }

    // X-junction detection removed to allow mitered joints (X shape)
    // We rely on miter calculation and clamping to handle 4-way intersections safely.

    // Calculate miter vectors
    const leftMiter = this.calculateMiterVector(currentDir, nextSeg.vec, halfThickness);
    const rightMiter = this.calculateMiterVector(prevSeg.vec, currentDir, halfThickness);

    return {
      left: currentStart.add(leftMiter),
      right: currentStart.add(rightMiter)
    };
  }

  private calculateMiterVector(dir1: Vector2, dir2: Vector2, offset: number): Vector2 {
    // Returns the vector from the junction point to the intersection of the two offset lines.

    const normal1 = new Vector2(-dir1.y, dir1.x); // Left of Dir1
    const normal2 = new Vector2(dir2.y, -dir2.x); // Right of Dir2 (CW rotation)

    // Check angle between walls
    const dot = dir1.dot(dir2);

    // Parallel or nearly parallel (same direction)
    if (dot > 0.99) {
      // Should have been filtered, but if not, return normal
      return normal1.multiply(offset);
    }

    // Collinear, opposite directions (End of one, Start of another) -> Straight joint
    if (dot < -0.99) {
      return normal1.multiply(offset);
    }

    const det = dir2.x * dir1.y - dir2.y * dir1.x; // Cross product (z component)

    if (Math.abs(det) < 0.01) {
      // Nearly parallel, fallback to normal
      return normal1.multiply(offset);
    }

    // Solve system for intersection
    const nDiff = normal2.subtract(normal1).multiply(offset);
    const num = nDiff.x * dir2.y - nDiff.y * dir2.x;
    const den = dir1.x * dir2.y - dir1.y * dir2.x;
    const t = num / den;

    // Result vector is normal1*offset + dir1*t
    const result = normal1.multiply(offset).add(dir1.multiply(t));

    // CLAMP: If miter is too long, it means the angle is very sharp.
    // Cap it to avoid spikes.
    const maxLen = offset * 6; // Allow some extension but not infinite
    if (result.lengthSquared() > maxLen * maxLen) {
      // Fallback: just use the normal (flat end) or a capped miter.
      // For now, let's return the normal to be safe and avoid the spike entirely.
      return normal1.multiply(offset);
    }

    return result;
  }


  private renderPreviewWall(ctx: CanvasRenderingContext2D, start: Point, end: Point): void {
    ctx.save();

    const thickness = this.config.wallThickness;

    // Draw preview as a simple rectangle (no miter)
    const s = Vector2.from(start);
    const e = Vector2.from(end);
    const dir = e.subtract(s).normalize();
    const normal = new Vector2(-dir.y, dir.x);
    const halfThickness = thickness / 2;

    const p1 = s.add(normal.multiply(halfThickness));
    const p2 = e.add(normal.multiply(halfThickness));
    const p3 = e.subtract(normal.multiply(halfThickness));
    const p4 = s.subtract(normal.multiply(halfThickness));

    // Use dark gray with full opacity to match existing walls
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = this.config.wallColor;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Render angle guide line
   */
  private renderAngleGuide(ctx: CanvasRenderingContext2D, from: Point, angleDeg: number): void {
    ctx.save();

    // Convert angle to radians
    const angleRad = (angleDeg * Math.PI) / 180;

    // Draw a long line in that direction (10000mm = 10m)
    const length = 10000;
    const toX = from.x + Math.cos(angleRad) * length;
    const toY = from.y + Math.sin(angleRad) * length;

    // Check current theme for color selection
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

    // Dashed line style - 다크모드 대응
    ctx.strokeStyle = isDarkMode ? '#64B5F6' : '#3498db';
    ctx.lineWidth = 2; // Thin guide line
    ctx.setLineDash([20, 10]); // Dashed pattern
    ctx.globalAlpha = 0.6;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Render aligned exterior dimensions
   * Groups exterior walls by direction and aligns all dimension lines on the same axis
   */
  private renderAlignedExteriorDimensions(ctx: CanvasRenderingContext2D): void {
    if (!this.camera) return;

    // Get bounding box of all points
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    this.points.forEach(point => {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    });

    if (minX === Infinity) return;

    // Configuration
    const wallHalfThickness = this.config.wallThickness / 2;
    const baseOffset = wallHalfThickness + 150;
    const extensionLength = 400;
    const textOffset = 200;

    // Collect exterior walls with their dimension direction
    interface ExteriorWallInfo {
      wall: Wall;
      startPoint: Point;
      endPoint: Point;
      dimDirection: 'up' | 'down' | 'left' | 'right';
    }

    const exteriorWalls: ExteriorWallInfo[] = [];

    // Helper for ray casting to check if a wall is exposed
    const rayIntersectsWall = (
      start: { x: number; y: number },
      dir: { x: number; y: number },
      ignoreWallId: string
    ): boolean => {
      // Check against all walls
      for (const wall of this.walls) {
        if (wall.id === ignoreWallId) continue;

        const p1 = this.points.get(wall.startPointId);
        const p2 = this.points.get(wall.endPointId);
        if (!p1 || !p2) continue;

        // Wall segment
        const x1 = p1.x, y1 = p1.y;
        const x2 = p2.x, y2 = p2.y;

        // Ray: start + t * dir
        // Segment: p1 + u * (p2 - p1)

        const dx = x2 - x1;
        const dy = y2 - y1;

        // Cross product of ray dir and segment dir
        const det = dir.x * dy - dir.y * dx;

        if (Math.abs(det) < 0.0001) continue; // Parallel

        const t = ((x1 - start.x) * dy - (y1 - start.y) * dx) / det;
        const u = ((x1 - start.x) * dir.y - (y1 - start.y) * dir.x) / det;

        // Check intersection
        // t > 0.1 (ignore start point overlap and very close walls)
        // 0 <= u <= 1 (segment intersection)
        if (t > 0.1 && u >= -0.001 && u <= 1.001) {
          return true; // Hit a wall
        }
      }
      return false;
    };

    this.walls.forEach(wall => {
      const startPoint = this.points.get(wall.startPointId);
      const endPoint = this.points.get(wall.endPointId);
      if (!startPoint || !endPoint) return;

      const wallMid = {
        x: (startPoint.x + endPoint.x) / 2,
        y: (startPoint.y + endPoint.y) / 2
      };

      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;
      // Check Horizontal (X) projection
      if (Math.abs(dx) > 50) {
        // Horizontal wall → check Up and Down
        const isExposedUp = !rayIntersectsWall(wallMid, { x: 0, y: -1 }, wall.id);
        const isExposedDown = !rayIntersectsWall(wallMid, { x: 0, y: 1 }, wall.id);

        let dimDirection: 'up' | 'down' | null = null;

        if (isExposedUp && isExposedDown) {
          // Exposed on both sides, pick based on position relative to center
          dimDirection = wallMid.y < (minY + maxY) / 2 ? 'up' : 'down';
        } else if (isExposedUp) {
          dimDirection = 'up';
        } else if (isExposedDown) {
          dimDirection = 'down';
        }

        if (dimDirection) {
          exteriorWalls.push({ wall, startPoint, endPoint, dimDirection });
        }
      }

      // Check Vertical (Y) projection
      if (Math.abs(dy) > 50) {
        // Vertical wall → check Left and Right
        const isExposedLeft = !rayIntersectsWall(wallMid, { x: -1, y: 0 }, wall.id);
        const isExposedRight = !rayIntersectsWall(wallMid, { x: 1, y: 0 }, wall.id);

        let dimDirection: 'left' | 'right' | null = null;

        if (isExposedLeft && isExposedRight) {
          // Exposed on both sides, pick based on position relative to center
          dimDirection = wallMid.x < (minX + maxX) / 2 ? 'left' : 'right';
        } else if (isExposedLeft) {
          dimDirection = 'left';
        } else if (isExposedRight) {
          dimDirection = 'right';
        }

        if (dimDirection) {
          exteriorWalls.push({ wall, startPoint, endPoint, dimDirection });
        }
      }
    });

    // Calculate aligned dimension line positions (furthest from center)
    const dimLinePositions = {
      up: minY - baseOffset - extensionLength,
      down: maxY + baseOffset + extensionLength,
      left: minX - baseOffset - extensionLength,
      right: maxX + baseOffset + extensionLength,
    };

    // Calculate extension line start positions (outermost wall position for each direction)
    // All extension lines in the same direction should start from the same position
    const extLineStarts = {
      up: minY - wallHalfThickness - 50,      // Start from the topmost wall
      down: maxY + wallHalfThickness + 50,    // Start from the bottommost wall
      left: minX - wallHalfThickness - 50,    // Start from the leftmost wall
      right: maxX + wallHalfThickness + 50,   // Start from the rightmost wall
    };

    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    const dimColor = isDarkMode ? '#FFFFFF' : '#000000';
    const textColor = isDarkMode ? '#FFFFFF' : '#000000';

    ctx.save();
    this.camera.applyScreenTransform(ctx);

    // Render each exterior wall dimension
    exteriorWalls.forEach(({ startPoint, endPoint, dimDirection }) => {
      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;

      // Calculate projected distance for the dimension
      const distanceMm = (dimDirection === 'up' || dimDirection === 'down')
        ? Math.abs(dx)
        : Math.abs(dy);

      let ext1Start, ext1End, ext2Start, ext2End, dim1, dim2, textPos;

      if (dimDirection === 'up') {
        const dimY = dimLinePositions.up;
        const extStartY = extLineStarts.up; // All 'up' extensions start from same Y
        ext1Start = this.camera!.worldToScreen(startPoint.x, extStartY);
        ext1End = this.camera!.worldToScreen(startPoint.x, dimY);
        ext2Start = this.camera!.worldToScreen(endPoint.x, extStartY);
        ext2End = this.camera!.worldToScreen(endPoint.x, dimY);
        dim1 = this.camera!.worldToScreen(startPoint.x, dimY);
        dim2 = this.camera!.worldToScreen(endPoint.x, dimY);
        textPos = this.camera!.worldToScreen((startPoint.x + endPoint.x) / 2, dimY - textOffset);
      } else if (dimDirection === 'down') {
        const dimY = dimLinePositions.down;
        const extStartY = extLineStarts.down; // All 'down' extensions start from same Y
        ext1Start = this.camera!.worldToScreen(startPoint.x, extStartY);
        ext1End = this.camera!.worldToScreen(startPoint.x, dimY);
        ext2Start = this.camera!.worldToScreen(endPoint.x, extStartY);
        ext2End = this.camera!.worldToScreen(endPoint.x, dimY);
        dim1 = this.camera!.worldToScreen(startPoint.x, dimY);
        dim2 = this.camera!.worldToScreen(endPoint.x, dimY);
        textPos = this.camera!.worldToScreen((startPoint.x + endPoint.x) / 2, dimY + textOffset);
      } else if (dimDirection === 'left') {
        const dimX = dimLinePositions.left;
        const extStartX = extLineStarts.left; // All 'left' extensions start from same X
        ext1Start = this.camera!.worldToScreen(extStartX, startPoint.y);
        ext1End = this.camera!.worldToScreen(dimX, startPoint.y);
        ext2Start = this.camera!.worldToScreen(extStartX, endPoint.y);
        ext2End = this.camera!.worldToScreen(dimX, endPoint.y);
        dim1 = this.camera!.worldToScreen(dimX, startPoint.y);
        dim2 = this.camera!.worldToScreen(dimX, endPoint.y);
        textPos = this.camera!.worldToScreen(dimX - textOffset, (startPoint.y + endPoint.y) / 2);
      } else {
        const dimX = dimLinePositions.right;
        const extStartX = extLineStarts.right; // All 'right' extensions start from same X
        ext1Start = this.camera!.worldToScreen(extStartX, startPoint.y);
        ext1End = this.camera!.worldToScreen(dimX, startPoint.y);
        ext2Start = this.camera!.worldToScreen(extStartX, endPoint.y);
        ext2End = this.camera!.worldToScreen(dimX, endPoint.y);
        dim1 = this.camera!.worldToScreen(dimX, startPoint.y);
        dim2 = this.camera!.worldToScreen(dimX, endPoint.y);
        textPos = this.camera!.worldToScreen(dimX + textOffset, (startPoint.y + endPoint.y) / 2);
      }

      // Draw extension lines
      ctx.strokeStyle = dimColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;

      ctx.beginPath();
      ctx.moveTo(ext1Start.x, ext1Start.y);
      ctx.lineTo(ext1End.x, ext1End.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(ext2Start.x, ext2Start.y);
      ctx.lineTo(ext2End.x, ext2End.y);
      ctx.stroke();

      // Draw dimension line
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dim1.x, dim1.y);
      ctx.lineTo(dim2.x, dim2.y);
      ctx.stroke();

      // Draw slashes
      const slashSize = 8;
      const dimLineAngle = Math.atan2(dim2.y - dim1.y, dim2.x - dim1.x);
      const slashAngle = Math.PI / 4;

      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.moveTo(
        dim1.x - slashSize * Math.cos(dimLineAngle + slashAngle) / 2,
        dim1.y - slashSize * Math.sin(dimLineAngle + slashAngle) / 2
      );
      ctx.lineTo(
        dim1.x + slashSize * Math.cos(dimLineAngle + slashAngle) / 2,
        dim1.y + slashSize * Math.sin(dimLineAngle + slashAngle) / 2
      );
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(
        dim2.x - slashSize * Math.cos(dimLineAngle + slashAngle) / 2,
        dim2.y - slashSize * Math.sin(dimLineAngle + slashAngle) / 2
      );
      ctx.lineTo(
        dim2.x + slashSize * Math.cos(dimLineAngle + slashAngle) / 2,
        dim2.y + slashSize * Math.sin(dimLineAngle + slashAngle) / 2
      );
      ctx.stroke();

      // Draw text - ensure valid distance
      if (!Number.isFinite(distanceMm) || distanceMm < 1) return;

      const label = `${Math.round(distanceMm)}mm`;

      // Reset context state for text rendering
      ctx.globalAlpha = 1.0;
      ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.save();
      ctx.translate(textPos.x, textPos.y);

      if (dimDirection === 'left' || dimDirection === 'right') {
        ctx.rotate(-Math.PI / 2);
      }

      // Draw background for better visibility
      const textMetrics = ctx.measureText(label);
      const padding = 4;

      // Only draw background in light mode
      // In dark mode, we want the text to float on the grid without a box (mask)
      if (!isDarkMode) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(
          -textMetrics.width / 2 - padding,
          -8,
          textMetrics.width + padding * 2,
          16
        );
      }

      // Draw text
      ctx.fillStyle = textColor;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });

    ctx.restore();
  }

  /**
   * Check if screen coordinates are clicking a dimension label
   * Returns wall ID if clicked, null otherwise
   */
  getDimensionAtPoint(screenX: number, screenY: number): string | null {
    for (const hitbox of this.dimensionHitboxes) {
      if (
        screenX >= hitbox.x &&
        screenX <= hitbox.x + hitbox.width &&
        screenY >= hitbox.y &&
        screenY <= hitbox.y + hitbox.height
      ) {
        return hitbox.wallId;
      }
    }
    return null;
  }
}
