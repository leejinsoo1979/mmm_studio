// @ts-nocheck
import { BaseLayer } from './Layer';
import type { Door } from '../../../core/types/Door';
import type { Wall } from '../../../core/types/Wall';
import type { Point } from '../../../core/types/Point';

/**
 * DoorLayer - Renders doors on walls
 */
export class DoorLayer extends BaseLayer {
  private doors: Door[] = [];
  private walls: Wall[] = [];
  private points: Point[] = [];
  private selectedDoorId: string | null = null;
  private previewDoor: {
    wall: Wall;
    position: number;
    width: number;
    height: number;
  } | null = null;

  constructor() {
    super(30); // Above walls
  }

  setDoors(doors: Door[]): void {
    this.doors = doors;
  }

  setWalls(walls: Wall[]): void {
    this.walls = walls;
  }

  setPoints(points: Point[]): void {
    this.points = points;
  }

  setSelectedDoor(doorId: string | null): void {
    this.selectedDoorId = doorId;
  }

  setPreview(preview: {
    wall: Wall;
    position: number;
    width: number;
    height: number;
  } | null): void {
    this.previewDoor = preview;
  }

  clearPreview(): void {
    this.previewDoor = null;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return;

    const pointMap = new Map(this.points.map(p => [p.id, p]));

    // Render placed doors
    this.doors.forEach(door => {
      const wall = this.walls.find(w => w.id === door.wallId);
      if (!wall) return;

      this.renderDoor(ctx, door, wall, pointMap, false);
    });

    // Render preview door
    if (this.previewDoor) {
      const door: Door = {
        id: 'preview',
        wallId: this.previewDoor.wall.id,
        position: this.previewDoor.position,
        width: this.previewDoor.width,
        height: this.previewDoor.height,
        swing: 'right',
        thickness: 40,
      };
      this.renderDoor(ctx, door, this.previewDoor.wall, pointMap, true);
    }
  }

  private renderDoor(
    ctx: CanvasRenderingContext2D,
    door: Door,
    wall: Wall,
    pointMap: Map<string, Point>,
    _isPreview: boolean
  ): void {
    const isSelected = door.id === this.selectedDoorId;
    const startPoint = pointMap.get(wall.startPointId);
    const endPoint = pointMap.get(wall.endPointId);

    if (!startPoint || !endPoint) return;

    // Calculate door position along wall
    const wallX = startPoint.x + (endPoint.x - startPoint.x) * door.position;
    const wallY = startPoint.y + (endPoint.y - startPoint.y) * door.position;

    // Calculate wall direction
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const wallAngle = Math.atan2(dy, dx);

    // Door dimensions in mm
    const doorWidth = door.width; // 900mm
    const halfWidth = doorWidth / 2;

    // Check current theme for color selection
    // const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

    ctx.save();

    // Door opening endpoints
    const openingStart = {
      x: wallX - Math.cos(wallAngle) * halfWidth,
      y: wallY - Math.sin(wallAngle) * halfWidth,
    };
    const openingEnd = {
      x: wallX + Math.cos(wallAngle) * halfWidth,
      y: wallY + Math.sin(wallAngle) * halfWidth,
    };

    // Determine swing direction
    // Determine swing direction
    const swingDirection = door.swing === 'left' ? -1 : 1;

    // Determine open side (default to 'right' if undefined)
    // 'right' means opening to the "positive" side of the wall vector (down/right usually)
    const openSide = door.openSide || 'right';
    const sideMultiplier = openSide === 'left' ? -1 : 1;

    // Hinge point (where door rotates)
    const hingePoint = swingDirection === 1 ? openingStart : openingEnd;

    // Arc angles
    const arcStartAngle = swingDirection === 1 ? wallAngle : wallAngle + Math.PI;
    // Calculate end angle based on swing and side
    // If side is flipped (-1), we rotate in the opposite direction relative to the wall
    const arcEndAngle = arcStartAngle + (Math.PI / 2) * swingDirection * sideMultiplier;

    // Determine arc direction (CW/CCW)
    // R(1), R(1) -> CW (false)
    // R(1), L(-1) -> CCW (true)
    // L(-1), R(1) -> CCW (true)
    // L(-1), L(-1) -> CW (false)
    const anticlockwise = (swingDirection * sideMultiplier) < 0;

    // 1. Draw Threshold (Moon-teul/Sill) - White rectangle at the bottom
    // Coohom style: Distinct white rectangle for the threshold
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#333333'; // Dark grey border
    ctx.lineWidth = 1;

    ctx.beginPath();
    // Draw rectangle rotated to wall angle
    // We need 4 points for the threshold rectangle
    // It spans from openingStart to openingEnd, with some thickness (e.g. wall thickness or slightly less)
    // Let's match wall thickness for now
    const thickness = 100; // Should ideally come from wall.thickness or door.thickness
    const halfThick = thickness / 2;

    const t1 = {
      x: openingStart.x + Math.sin(wallAngle) * halfThick,
      y: openingStart.y - Math.cos(wallAngle) * halfThick
    };
    const t2 = {
      x: openingEnd.x + Math.sin(wallAngle) * halfThick,
      y: openingEnd.y - Math.cos(wallAngle) * halfThick
    };
    const t3 = {
      x: openingEnd.x - Math.sin(wallAngle) * halfThick,
      y: openingEnd.y + Math.cos(wallAngle) * halfThick
    };
    const t4 = {
      x: openingStart.x - Math.sin(wallAngle) * halfThick,
      y: openingStart.y + Math.cos(wallAngle) * halfThick
    };

    ctx.moveTo(t1.x, t1.y);
    ctx.lineTo(t2.x, t2.y);
    ctx.lineTo(t3.x, t3.y);
    ctx.lineTo(t4.x, t4.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();


    // 2. Draw Door Swing Arc (Filled Sector)
    // Coohom style: Light grey fill, thin dark arc line
    ctx.beginPath();
    ctx.moveTo(hingePoint.x, hingePoint.y);
    ctx.arc(
      hingePoint.x,
      hingePoint.y,
      doorWidth,
      arcStartAngle,
      arcEndAngle,
      anticlockwise
    );
    ctx.closePath();

    // Fill style
    ctx.fillStyle = 'rgba(200, 200, 200, 0.3)'; // Light grey transparent
    ctx.fill();

    // Stroke style (Arc only, not the radii)
    ctx.beginPath();
    ctx.arc(
      hingePoint.x,
      hingePoint.y,
      doorWidth,
      arcStartAngle,
      arcEndAngle,
      anticlockwise
    );
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]); // Dashed line for swing path? Coohom seems solid or dashed. Let's use solid thin.
    ctx.setLineDash([]);
    ctx.stroke();


    // 3. Draw Door Leaf (Rectangular)
    // Coohom style: White rectangle with dark border
    const leafThickness = 40; // 40mm standard door leaf

    ctx.save();
    ctx.translate(hingePoint.x, hingePoint.y);
    ctx.rotate(arcStartAngle + (swingDirection === 1 ? 0 : 0)); // Start angle matches wall
    // If swing is left (-1), we rotate -90 deg? No, open position is 90 deg from closed.
    // Wait, Coohom shows door in OPEN position (90 degrees).

    // Rotate to open position
    // If swing is right (1): Rotate +90 deg (PI/2)
    // If swing is left (-1): Rotate -90 deg (-PI/2)
    // Apply side multiplier
    ctx.rotate(swingDirection * sideMultiplier * Math.PI / 2);

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;

    // Draw rectangle
    // Origin is hinge.
    // Width is doorWidth.
    // Height is leafThickness.
    // We need to align it correctly relative to hinge.
    // If swing right: Hinge is at (0,0). Door extends along X axis. Thickness is centered or offset?
    // Usually flush with the frame.

    if (swingDirection === 1) {
      // Right swing
      ctx.fillRect(0, -leafThickness, doorWidth, leafThickness);
      ctx.strokeRect(0, -leafThickness, doorWidth, leafThickness);
    } else {
      // Left swing
      ctx.fillRect(0, 0, doorWidth, leafThickness);
      ctx.strokeRect(0, 0, doorWidth, leafThickness);
    }

    ctx.restore();

    ctx.restore();

    // 4. Draw Selection Handles (if selected)
    if (isSelected && !_isPreview) {
      const handleRadiusMm = 100; // 100mm = 10cm

      // Left handle (at openingStart)
      ctx.beginPath();
      ctx.arc(openingStart.x, openingStart.y, handleRadiusMm, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#007AFF'; // Blue color
      ctx.lineWidth = 20; // Thicker border for visibility
      ctx.stroke();

      // Right handle (at openingEnd)
      ctx.beginPath();
      ctx.arc(openingEnd.x, openingEnd.y, handleRadiusMm, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#007AFF';
      ctx.lineWidth = 20;
      ctx.stroke();
    }
  }
}
