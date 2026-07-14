// @ts-nocheck
import { BaseLayer } from './Layer';
import type { Room } from '../../../core/types/Room';
import type { Point } from '../../../core/types/Point';

export interface RoomLayerConfig {
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  selectedFillColor?: string;
  hoveredFillColor?: string;
  showLabels?: boolean;
  labelFont?: string;
  labelColor?: string;
  showAngles?: boolean;
  wallThickness?: number; // Wall thickness for floor inset calculation
}

/**
 * RoomLayer - Renders room fills
 *
 * Features:
 * - Polygon fill for closed rooms
 * - Room labels (name, area)
 * - Selection highlight
 * - Hover highlight
 */
export class RoomLayer extends BaseLayer {
  private rooms: Room[] = [];
  private points: Map<string, Point> = new Map();
  private selectedRoomIds: Set<string> = new Set();
  private hoveredRoomId: string | null = null;
  private renderStyle: 'wireframe' | 'hidden-line' | 'solid' | 'realistic' = 'solid';

  // Track rendered corners to prevent duplicates
  private renderedCorners: { x: number; y: number }[] = [];

  private config: Required<RoomLayerConfig>;
  private woodPattern: CanvasPattern | null = null;

  constructor(config?: RoomLayerConfig) {
    super(1); // z-index: 1 (below walls)

    this.config = {
      fillColor: config?.fillColor || '#d4a574',
      fillOpacity: config?.fillOpacity || 0.6,
      strokeColor: config?.strokeColor || '#95a5a6',
      strokeWidth: config?.strokeWidth || 1,
      selectedFillColor: config?.selectedFillColor || '#3498db',
      hoveredFillColor: config?.hoveredFillColor || '#e67e22',
      showLabels: config?.showLabels ?? true,
      labelFont: config?.labelFont || 'bold 180px Arial',
      labelColor: config?.labelColor || '#444444',
      showAngles: config?.showAngles ?? true,
      wallThickness: config?.wallThickness || 100, // 100mm default wall thickness
    };

    // Load wood texture pattern
    this.loadWoodPattern();
  }

  private loadWoodPattern(): void {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Scale texture to match real-world size
        // At initialScale 0.2 (1mm = 0.2px), texture should be scaled to match
        // Assuming texture represents ~1000mm x 1000mm real wood planks
        const scale = 1.0; // Use full texture size for realistic scale

        // Rotate 90 degrees for horizontal grain
        // Swap width/height for rotated canvas
        canvas.width = img.height * scale;
        canvas.height = img.width * scale;

        // Rotate around center
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(-Math.PI / 2); // -90 degrees
        ctx.drawImage(img, -img.width * scale / 2, -img.height * scale / 2, img.width * scale, img.height * scale);

        this.woodPattern = ctx.createPattern(canvas, 'repeat');
      }
    };
    img.onerror = (e) => {
      console.error('[RoomLayer] Failed to load texture:', img.src, e);
    };
    img.src = '/texture/floor/f2%20diffuse.JPG';
  }

  setRooms(rooms: Room[]): void {
    this.rooms = rooms;
  }

  setPoints(points: Point[]): void {
    this.points.clear();
    points.forEach((p) => this.points.set(p.id, p));
  }

  setSelectedRooms(roomIds: string[]): void {
    this.selectedRoomIds = new Set(roomIds);
  }

  setHoveredRoom(roomId: string | null): void {
    this.hoveredRoomId = roomId;
  }

  setRenderStyle(style: 'wireframe' | 'hidden-line' | 'solid' | 'realistic'): void {
    this.renderStyle = style;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return;

    // Clear dimension labels and room label hitboxes before rendering
    this.dimensionLabels = [];
    this.labelHitboxes = [];

    // Clear rendered corners set for this frame
    this.renderedCorners = [];

    this.applyOpacity(ctx);

    // First pass: Render all room fills
    this.rooms.forEach((room) => {
      const isSelected = this.selectedRoomIds.has(room.id);
      const isHovered = room.id === this.hoveredRoomId;
      this.renderRoomFill(ctx, room, isSelected, isHovered);
    });

    // Second pass: Render all room annotations (labels, angles, dimensions)
    // This ensures text is always on top of fills
    this.rooms.forEach((room) => {
      const isSelected = this.selectedRoomIds.has(room.id);
      const isHovered = room.id === this.hoveredRoomId;
      this.renderRoomAnnotations(ctx, room, isSelected, isHovered);
    });

    this.resetOpacity(ctx);
  }

  private renderRoomFill(
    ctx: CanvasRenderingContext2D,
    room: Room,
    isSelected: boolean,
    isHovered: boolean
  ): void {
    const roomPoints = room.points
      .map((pointId) => this.points.get(pointId))
      .filter((p): p is Point => p !== undefined);

    if (roomPoints.length < 3) return;

    // Room points are at wall centerline - inset by half wall thickness to get inner edge
    const insetDistance = this.config.wallThickness / 2;
    const floorPoints = this.insetPolygon(roomPoints, insetDistance);

    if (floorPoints.length < 3) return;

    // Get theme color for selection
    const themeColorRaw = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
    const themeColor = themeColorRaw || '#3FAEA7';

    // Determine fill style based on render mode
    let fillStyle: string | CanvasPattern = this.config.fillColor;
    let fillOpacity = this.config.fillOpacity;

    if (isHovered) {
      fillStyle = this.config.hoveredFillColor;
      fillOpacity = 0.5;
    } else if (isSelected) {
      // Keep original floor style - dark overlay will be added separately
      switch (this.renderStyle) {
        case 'realistic':
          if (this.woodPattern) {
            fillStyle = this.woodPattern;
            fillOpacity = 1.0;
          }
          break;
        case 'solid':
          fillStyle = this.config.fillColor;
          fillOpacity = this.config.fillOpacity;
          break;
        default:
          fillStyle = this.config.fillColor;
          fillOpacity = this.config.fillOpacity;
      }
    } else {
      // Apply render style for normal rooms
      switch (this.renderStyle) {
        case 'realistic':
          if (this.woodPattern) {
            fillStyle = this.woodPattern;
            fillOpacity = 1.0;
          }
          break;
        case 'solid':
          fillStyle = this.config.fillColor;
          fillOpacity = this.config.fillOpacity;
          break;
        case 'hidden-line':
          const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
          fillStyle = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)';
          fillOpacity = 1.0;
          break;
        case 'wireframe':
          // CAD mode: white in light mode, dark in dark mode
          const isDarkModeWireframe = document.documentElement.getAttribute('data-theme') === 'dark';
          fillStyle = isDarkModeWireframe ? '#2A2A2A' : '#FFFFFF';
          fillOpacity = 1.0;
          break;
      }
    }

    // Draw floor polygon
    ctx.save();

    ctx.beginPath();
    ctx.moveTo(floorPoints[0].x, floorPoints[0].y);
    for (let i = 1; i < floorPoints.length; i++) {
      ctx.lineTo(floorPoints[i].x, floorPoints[i].y);
    }
    ctx.closePath();

    // Fill room
    ctx.fillStyle = fillStyle;
    ctx.globalAlpha = fillOpacity;
    ctx.fill();

    // Add dark overlay for selected room (Archisketch style) - not in wireframe
    if (isSelected && this.renderStyle !== 'wireframe') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.globalAlpha = 1.0;
      ctx.fill();
    }

    // Wireframe mode: fill with theme color when selected
    if (isSelected && this.renderStyle === 'wireframe') {
      ctx.fillStyle = themeColor;
      ctx.globalAlpha = 0.3;
      ctx.fill();
    }

    // Stroke
    ctx.globalAlpha = 1.0;
    const isDarkModeRoom = document.documentElement.getAttribute('data-theme') === 'dark';

    if (isSelected && this.renderStyle !== 'wireframe') {
      // Archisketch-style illumination border effect (not in wireframe mode)
      ctx.strokeStyle = themeColor;

      // Layer 1: Outer glow (soft, wide)
      ctx.shadowColor = themeColor;
      ctx.shadowBlur = 60;
      ctx.lineWidth = 54;
      ctx.globalAlpha = 0.3;
      ctx.stroke();

      // Layer 2: Middle glow
      ctx.shadowBlur = 40;
      ctx.lineWidth = 36;
      ctx.globalAlpha = 0.6;
      ctx.stroke();

      // Layer 3: Core line (bright)
      ctx.shadowBlur = 20;
      ctx.lineWidth = 22;
      ctx.globalAlpha = 1.0;
      ctx.stroke();

      // Reset
      ctx.shadowBlur = 0;
    } else if (isSelected && this.renderStyle === 'wireframe') {
      // Wireframe mode: only highlight the border with theme color
      ctx.strokeStyle = themeColor;
      ctx.lineWidth = 4;
      ctx.shadowColor = themeColor;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      // Normal room stroke - white in dark mode for wireframe
      const strokeColor = (this.renderStyle === 'wireframe' && isDarkModeRoom)
        ? '#FFFFFF'
        : this.config.strokeColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = this.renderStyle === 'wireframe' ? 1.5 : this.config.strokeWidth;
      ctx.stroke();
    }

    ctx.restore();
  }

  private renderRoomAnnotations(
    ctx: CanvasRenderingContext2D,
    room: Room,
    _isSelected: boolean,
    _isHovered: boolean
  ): void {
    const roomPoints = room.points
      .map((pointId) => this.points.get(pointId))
      .filter((p): p is Point => p !== undefined);

    if (roomPoints.length < 3) return;

    // Room points are at wall centerline - inset by half wall thickness to get inner edge
    const insetDistance = this.config.wallThickness / 2;
    const floorPoints = this.insetPolygon(roomPoints, insetDistance);

    if (floorPoints.length < 3) return;

    // Draw label
    if (this.config.showLabels) {
      this.renderLabel(ctx, room, roomPoints, floorPoints);
      this.renderWallDimensions(ctx, floorPoints, room.id);
    }

    // Draw corner angles
    if (this.config.showAngles) {
      this.renderCornerAngles(ctx, floorPoints, roomPoints);
    }
  }

  // Store dimension label positions for click detection
  private dimensionLabels: Array<{
    roomId: string;
    wallIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
    p1: Point;
    p2: Point;
    isCW: boolean;
  }> = [];

  // Store room label hitboxes for click detection
  private labelHitboxes: Array<{
    roomId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
  }> = [];

  private renderWallDimensions(ctx: CanvasRenderingContext2D, points: Point[], roomId: string): void {
    if (points.length < 3) return;

    // Calculate room bounding box for responsive sizing
    const roomSize = this.calculateRoomMinDimension(points);
    const fontSize = this.getResponsiveFontSize(roomSize, 'dimension');
    const strokeWidth = Math.max(2, fontSize * 0.12);
    const textOffset = fontSize * 1.0;

    // Calculate signed area to determine winding order
    let signedArea = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      signedArea += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    const isCW = signedArea > 0; // In Canvas coords (Y-down), Positive area = CW

    ctx.save();
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle'; // Center vertically on the offset line

    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];

      // Calculate distance (mm)
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Skip very short segments (responsive threshold)
      if (dist < fontSize * 2) continue;

      // Midpoint
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      // Calculate Unit Normal Vector pointing INWARD
      // Vector p1->p2 is (dx, dy)
      // If CW: Inside is Right. Normal (-dy, dx)
      // If CCW: Inside is Left. Normal (dy, -dx)
      let nx, ny;
      if (isCW) {
        nx = -dy;
        ny = dx;
      } else {
        nx = dy;
        ny = -dx;
      }
      // Normalize
      const len = Math.sqrt(nx * nx + ny * ny);
      nx /= len;
      ny /= len;

      // Text Position: Midpoint + Normal * Offset (responsive)
      const textX = midX + nx * textOffset;
      const textY = midY + ny * textOffset;

      // Calculate Angle
      let angle = Math.atan2(dy, dx);

      // Normalize Angle to [-PI/2, PI/2) for consistent readability (Bottom or Right)
      if (angle >= Math.PI / 2) {
        angle -= Math.PI;
      } else if (angle < -Math.PI / 2) {
        angle += Math.PI;
      }

      ctx.save();
      ctx.translate(textX, textY);
      ctx.rotate(angle);

      const text = `${Math.round(dist)}`;

      // Measure text for click detection
      const metrics = ctx.measureText(text);
      const textWidth = metrics.width;
      const textHeight = fontSize;

      // Store label position for click detection (in rotated coordinates)
      this.dimensionLabels.push({
        roomId,
        wallIndex: i,
        x: textX,
        y: textY,
        width: textWidth,
        height: textHeight,
        p1,
        p2,
        isCW
      });

      // Outline
      ctx.strokeStyle = 'white';
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(text, 0, 0);

      // Fill
      ctx.fillStyle = '#000000';
      ctx.fillText(text, 0, 0);

      ctx.restore();
    }

    ctx.restore();
  }

  private renderLabel(ctx: CanvasRenderingContext2D, room: Room, _roomPoints: Point[], floorPoints: Point[]): void {
    // Use polygon centroid for accurate center positioning in any shape
    const center = this.calculatePolygonCentroid(floorPoints);

    // Calculate responsive font size based on room size
    const roomSize = this.calculateRoomMinDimension(floorPoints);
    const fontSize = this.getResponsiveFontSize(roomSize, 'label');
    const strokeWidth = Math.max(2, fontSize * 0.1);
    const lineSpacing = fontSize * 1.2;

    ctx.save();
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Room name - exactly at center (bounding box center)
    if (room.name) {
      // Draw text with white outline for better visibility
      ctx.strokeStyle = 'white';
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(room.name, center.x, center.y);

      ctx.fillStyle = this.config.labelColor;
      ctx.fillText(room.name, center.x, center.y);

      // Store hitbox for room name
      const metrics = ctx.measureText(room.name);
      // Height approximation
      const textHeight = fontSize;

      this.labelHitboxes.push({
        roomId: room.id,
        x: center.x,
        y: center.y,
        width: metrics.width,
        height: textHeight,
        text: room.name
      });
    }

    // Calculate actual floor area from inset polygon (floorPoints)
    // Convert from mm² to m²
    const areaMm2 = Math.abs(this.calculatePolygonArea(floorPoints));
    const areaM2 = areaMm2 / 1000000;

    // Room area with better visibility - below room name
    const areaText = `${areaM2.toFixed(2)} m²`;

    // Draw white outline
    ctx.strokeStyle = 'white';
    ctx.lineWidth = strokeWidth;
    ctx.strokeText(areaText, center.x, center.y + lineSpacing);

    // Draw main text
    ctx.fillStyle = this.config.labelColor;
    ctx.fillText(areaText, center.x, center.y + lineSpacing);

    ctx.restore();
  }

  /**
   * Render corner angles at each vertex of the room (inside the room)
   */
  private renderCornerAngles(ctx: CanvasRenderingContext2D, points: Point[], originalPoints: Point[]): void {
    if (points.length < 3 || points.length !== originalPoints.length) return;

    // Calculate responsive sizes
    const roomSize = this.calculateRoomMinDimension(points);
    const fontSize = Math.max(30, Math.min(80, roomSize * 0.025));
    const textDistance = Math.max(80, Math.min(200, roomSize * 0.06));
    const strokeWidth = Math.max(1.5, fontSize * 0.06);

    ctx.save();

    for (let i = 0; i < points.length; i++) {
      const curr = points[i];
      const original = originalPoints[i];

      // Skip if point is at centerline (inside wall)
      // This happens if insetPolygon failed or wall thickness is 0
      // We only want to draw angles at the actual floor corners
      const distToOriginal = Math.sqrt(Math.pow(curr.x - original.x, 2) + Math.pow(curr.y - original.y, 2));
      if (distToOriginal < 10) continue;

      const prev = points[(i - 1 + points.length) % points.length];
      const next = points[(i + 1) % points.length];

      // Deduplicate corners based on position (distance check)
      // Use 200mm threshold to handle rooms sharing corners
      const isDuplicate = this.renderedCorners.some(p => {
        const dx = p.x - curr.x;
        const dy = p.y - curr.y;
        return dx * dx + dy * dy < 40000; // 200^2
      });

      if (isDuplicate) continue;
      this.renderedCorners.push({ x: curr.x, y: curr.y });

      // Calculate vectors from current point to neighbors (outward direction)
      const v1x = prev.x - curr.x;
      const v1y = prev.y - curr.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;

      // Calculate angle using dot product
      const dot = v1x * v2x + v1y * v2y;
      const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

      if (len1 === 0 || len2 === 0) continue;

      const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
      const angleRad = Math.acos(cosAngle);
      const angleDeg = Math.round(angleRad * (180 / Math.PI));

      // Draw angle indicator inside the corner
      const arcRadius = textDistance * 0.6;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = strokeWidth;

      if (angleDeg === 90) {
        // Draw right angle symbol (small square)
        const squareSize = arcRadius;
        const dir1X = v1x / len1;
        const dir1Y = v1y / len1;
        const dir2X = v2x / len2;
        const dir2Y = v2y / len2;

        // Corner points for the right angle square
        const p1X = curr.x + dir1X * squareSize;
        const p1Y = curr.y + dir1Y * squareSize;
        const p2X = curr.x + dir1X * squareSize + dir2X * squareSize;
        const p2Y = curr.y + dir1Y * squareSize + dir2Y * squareSize;
        const p3X = curr.x + dir2X * squareSize;
        const p3Y = curr.y + dir2Y * squareSize;

        ctx.beginPath();
        ctx.moveTo(p1X, p1Y);
        ctx.lineTo(p2X, p2Y);
        ctx.lineTo(p3X, p3Y);
        ctx.stroke();
      } else {
        // Draw arc for non-right angles
        const angle1 = Math.atan2(v1y, v1x);
        const angle2 = Math.atan2(v2y, v2x);

        // Always draw the shortest arc (matching the dot product angle <= 180)
        // Calculate difference and normalize to -PI to PI
        let diff = angle2 - angle1;
        while (diff <= -Math.PI) diff += 2 * Math.PI;
        while (diff > Math.PI) diff -= 2 * Math.PI;

        // If diff is positive, we want to go CW (increasing) to get there in shortest path
        // If diff is negative, we want to go CCW (decreasing)
        // ctx.arc anticlockwise param: true = CCW, false = CW
        const anticlockwise = diff < 0;

        ctx.beginPath();
        ctx.arc(curr.x, curr.y, arcRadius, angle1, angle2, anticlockwise);
        ctx.stroke();
      }

      // Skip straight lines (180 degrees)
      if (angleDeg > 179) continue;

      // Calculate position for angle text (inside the room, along bisector)
      const bisectorX = (v1x / len1 + v2x / len2);
      const bisectorY = (v1y / len1 + v2y / len2);
      const bisectorLen = Math.sqrt(bisectorX * bisectorX + bisectorY * bisectorY);

      if (bisectorLen < 0.001) continue;

      // Position text inside the room along the bisector
      const dist = textDistance + fontSize * 0.6;
      const textX = curr.x + (bisectorX / bisectorLen) * dist;
      const textY = curr.y + (bisectorY / bisectorLen) * dist;

      // Draw angle text (no background, just text with outline)
      const text = `${angleDeg}°`;
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Draw white outline for visibility
      ctx.strokeStyle = 'white';
      ctx.lineWidth = strokeWidth * 3;
      ctx.strokeText(text, textX, textY);

      // Draw text
      ctx.fillStyle = '#000000';
      ctx.fillText(text, textX, textY);
    }

    ctx.restore();
  }

  private calculatePolygonArea(points: Point[]): number {
    if (points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return area / 2;
  }

  /**
   * Calculate the centroid (geometric center) of a polygon
   * This is the true center point where the polygon would balance
   */
  private calculatePolygonCentroid(points: Point[]): { x: number; y: number } {
    if (points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return { x: points[0].x, y: points[0].y };
    if (points.length === 2) {
      return {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2
      };
    }

    // Calculate signed area
    let signedArea = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const cross = points[i].x * points[j].y - points[j].x * points[i].y;
      signedArea += cross;
      cx += (points[i].x + points[j].x) * cross;
      cy += (points[i].y + points[j].y) * cross;
    }

    signedArea /= 2;

    // Avoid division by zero for degenerate polygons
    if (Math.abs(signedArea) < 0.001) {
      // Fallback to average of points
      let sumX = 0, sumY = 0;
      for (const p of points) {
        sumX += p.x;
        sumY += p.y;
      }
      return { x: sumX / points.length, y: sumY / points.length };
    }

    cx /= (6 * signedArea);
    cy /= (6 * signedArea);

    return { x: cx, y: cy };
  }

  /**
   * Calculate the minimum dimension of a room (smallest of width or height)
   * Used for responsive font sizing
   */
  private calculateRoomMinDimension(points: Point[]): number {
    if (points.length < 3) return 1000; // Default 1m

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }

    const width = maxX - minX;
    const height = maxY - minY;

    return Math.min(width, height);
  }

  /**
   * Get responsive font size based on room dimension
   * @param roomMinDimension - Minimum dimension of the room in mm
   * @param type - 'label' for room name/area, 'dimension' for wall dimensions
   */
  private getResponsiveFontSize(roomMinDimension: number, type: 'label' | 'dimension'): number {
    // Base ratio: font should be about 4-5% of room's minimum dimension
    // Clamp between reasonable min/max values

    const ratio = type === 'label' ? 0.05 : 0.04;
    const minSize = type === 'label' ? 50 : 40;
    const maxSize = type === 'label' ? 150 : 120;

    const calculatedSize = roomMinDimension * ratio;
    return Math.max(minSize, Math.min(maxSize, calculatedSize));
  }

  /**
   * Inset a polygon by moving each edge perpendicular inward by the specified distance
   */
  private insetPolygon(points: Point[], insetDistance: number): Point[] {
    if (points.length < 3) return [];

    // Calculate signed area to determine winding order
    let signedArea = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      signedArea += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    signedArea = signedArea / 2;

    // Determine inset direction based on winding order
    // Positive area = CCW, negative area = CW
    // We want to inset inward (shrink the polygon)
    const insetSign = signedArea > 0 ? 1 : -1;

    const insetPoints: Point[] = [];

    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const curr = points[i];
      const next = points[(i + 1) % n];

      // Edge vectors
      const edge1X = curr.x - prev.x;
      const edge1Y = curr.y - prev.y;
      const edge2X = next.x - curr.x;
      const edge2Y = next.y - curr.y;

      // Edge lengths
      const len1 = Math.sqrt(edge1X * edge1X + edge1Y * edge1Y);
      const len2 = Math.sqrt(edge2X * edge2X + edge2Y * edge2Y);

      if (len1 === 0 || len2 === 0) {
        insetPoints.push({ ...curr });
        continue;
      }

      // Normalized edge vectors
      const norm1X = edge1X / len1;
      const norm1Y = edge1Y / len1;
      const norm2X = edge2X / len2;
      const norm2Y = edge2Y / len2;

      // Perpendicular vectors (90° rotation)
      // Use insetSign to ensure inward direction
      const perp1X = -norm1Y * insetSign;
      const perp1Y = norm1X * insetSign;
      const perp2X = -norm2Y * insetSign;
      const perp2Y = norm2X * insetSign;

      // Bisector
      const bisectorX = perp1X + perp2X;
      const bisectorY = perp1Y + perp2Y;
      const bisectorLen = Math.sqrt(bisectorX * bisectorX + bisectorY * bisectorY);

      if (bisectorLen < 0.001) {
        // Parallel edges
        insetPoints.push({
          id: curr.id,
          x: curr.x + perp1X * insetDistance,
          y: curr.y + perp1Y * insetDistance,
        });
        continue;
      }

      // Normalize and scale bisector
      const normBisectorX = bisectorX / bisectorLen;
      const normBisectorY = bisectorY / bisectorLen;

      // Calculate offset distance
      const sinHalfAngle = bisectorLen / 2;
      const offsetDist = sinHalfAngle > 0.001 ? insetDistance / sinHalfAngle : insetDistance;
      const clampedOffset = Math.min(offsetDist, insetDistance * 10);

      insetPoints.push({
        id: curr.id,
        x: curr.x + normBisectorX * clampedOffset,
        y: curr.y + normBisectorY * clampedOffset,
      });
    }

    return insetPoints;
  }

  /**
   * Check if a point (world coordinates) is on a dimension label
   * Returns {roomId, wallIndex, p1, p2} if clicked, null otherwise
   */
  getDimensionAtPoint(worldX: number, worldY: number): { roomId: string; wallIndex: number; p1: Point; p2: Point; isCW: boolean } | null {
    // Increased hitbox for easier clicking
    const hitboxPadding = 100; // 100mm padding around text

    for (const label of this.dimensionLabels) {
      // Calculate distance from click point to label center
      const dx = worldX - label.x;
      const dy = worldY - label.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Simple circular hitbox for easier clicking
      const hitboxRadius = Math.max(label.width, label.height) / 2 + hitboxPadding;

      if (distance < hitboxRadius) {
        return {
          roomId: label.roomId,
          wallIndex: label.wallIndex,
          p1: label.p1,
          p2: label.p2,
          isCW: label.isCW
        };
      }
    }

    return null;
  }

  /**
   * Check if a point (world coordinates) is inside a room
   * Returns room info if found, null otherwise
   */
  getRoomAtPoint(worldX: number, worldY: number): { room: Room; area: number } | null {
    for (const room of this.rooms) {
      const roomPoints = room.points
        .map((pointId) => this.points.get(pointId))
        .filter((p): p is Point => p !== undefined);

      if (roomPoints.length < 3) continue;

      // Check if point is inside the room polygon
      if (this.isPointInPolygon(worldX, worldY, roomPoints)) {
        // Calculate area
        const insetDistance = this.config.wallThickness / 2;
        const floorPoints = this.insetPolygon(roomPoints, insetDistance);
        const areaMm2 = Math.abs(this.calculatePolygonArea(floorPoints));
        const areaM2 = areaMm2 / 1000000;

        return { room, area: areaM2 };
      }
    }
    return null;
  }

  /**
   * Check if a point is inside a polygon using ray casting
   */
  private isPointInPolygon(x: number, y: number, polygon: Point[]): boolean {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Check if a point (world coordinates) is on a room label
   */
  getLabelAtPoint(worldX: number, worldY: number): { roomId: string; text: string; x: number; y: number } | null {
    const padding = 50; // 50mm padding

    for (const label of this.labelHitboxes) {
      // Hitbox is centered at label.x, label.y
      const halfWidth = label.width / 2 + padding;
      const halfHeight = label.height / 2 + padding;

      if (
        worldX >= label.x - halfWidth &&
        worldX <= label.x + halfWidth &&
        worldY >= label.y - halfHeight &&
        worldY <= label.y + halfHeight
      ) {
        return {
          roomId: label.roomId,
          text: label.text,
          x: label.x,
          y: label.y
        };
      }
    }
    return null;
  }
}
