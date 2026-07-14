// @ts-nocheck
import { BaseLayer } from './Layer';
import type { Room } from '../../../core/types/Room';
import type { Point } from '../../../core/types/Point';

export interface CeilingLayerConfig {
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  selectedFillColor?: string;
  hoveredFillColor?: string;
  showLabels?: boolean;
  labelFont?: string;
  labelColor?: string;
  wallThickness?: number;
}

/**
 * CeilingLayer - Renders ceiling view in 2D
 *
 * Shows room ceilings from above, with potential light fixtures
 * and ceiling elements in the future.
 */
export class CeilingLayer extends BaseLayer {
  private rooms: Room[] = [];
  private points: Map<string, Point> = new Map();
  private selectedRoomIds: Set<string> = new Set();
  private hoveredRoomId: string | null = null;
  private renderStyle: 'wireframe' | 'hidden-line' | 'solid' | 'realistic' = 'solid';

  private config: Required<CeilingLayerConfig>;

  constructor(config?: CeilingLayerConfig) {
    super(1); // z-index: 1 (same level as room layer)

    this.config = {
      fillColor: config?.fillColor || '#f5f5f5', // Light gray for ceiling
      fillOpacity: config?.fillOpacity || 0.8,
      strokeColor: config?.strokeColor || '#bdbdbd',
      strokeWidth: config?.strokeWidth || 1,
      selectedFillColor: config?.selectedFillColor || '#3498db',
      hoveredFillColor: config?.hoveredFillColor || '#e0e0e0',
      showLabels: config?.showLabels ?? true,
      labelFont: config?.labelFont || 'bold 180px Arial',
      labelColor: config?.labelColor || '#666666',
      wallThickness: config?.wallThickness || 100,
    };
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

    this.applyOpacity(ctx);

    // Render all ceiling fills
    this.rooms.forEach((room) => {
      const isSelected = this.selectedRoomIds.has(room.id);
      const isHovered = room.id === this.hoveredRoomId;
      this.renderCeilingFill(ctx, room, isSelected, isHovered);
    });

    // Render ceiling labels
    this.rooms.forEach((room) => {
      this.renderCeilingLabel(ctx, room);
    });

    this.resetOpacity(ctx);
  }

  private renderCeilingFill(
    ctx: CanvasRenderingContext2D,
    room: Room,
    isSelected: boolean,
    isHovered: boolean
  ): void {
    const roomPoints = room.points
      .map((pointId) => this.points.get(pointId))
      .filter((p): p is Point => p !== undefined);

    if (roomPoints.length < 3) return;

    // Inset by wall thickness for ceiling polygon
    const insetDistance = this.config.wallThickness / 2;
    const ceilingPoints = this.insetPolygon(roomPoints, insetDistance);

    if (ceilingPoints.length < 3) return;

    // Get theme color for selection
    const themeColorRaw = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
    const themeColor = themeColorRaw || '#3FAEA7';

    // Determine fill style
    let fillStyle: string = this.config.fillColor;
    let fillOpacity = this.config.fillOpacity;

    if (isHovered) {
      fillStyle = this.config.hoveredFillColor;
      fillOpacity = 0.7;
    } else if (isSelected) {
      fillStyle = this.config.fillColor;
      fillOpacity = this.config.fillOpacity;
    } else {
      switch (this.renderStyle) {
        case 'wireframe':
          const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
          fillStyle = isDarkMode ? '#2A2A2A' : '#FFFFFF';
          fillOpacity = 1.0;
          break;
        case 'hidden-line':
          const isDarkModeHL = document.documentElement.getAttribute('data-theme') === 'dark';
          fillStyle = isDarkModeHL ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)';
          fillOpacity = 1.0;
          break;
        default:
          fillStyle = this.config.fillColor;
          fillOpacity = this.config.fillOpacity;
      }
    }

    // Draw ceiling polygon
    ctx.save();

    const firstPoint = ceilingPoints[0];
    if (!firstPoint) {
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(firstPoint.x, firstPoint.y);
    for (let i = 1; i < ceilingPoints.length; i++) {
      const point = ceilingPoints[i];
      if (!point) continue;
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();

    // Fill ceiling
    ctx.fillStyle = fillStyle;
    ctx.globalAlpha = fillOpacity;
    ctx.fill();

    // Selection overlay
    if (isSelected && this.renderStyle !== 'wireframe') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.globalAlpha = 1.0;
      ctx.fill();
    }

    if (isSelected && this.renderStyle === 'wireframe') {
      ctx.fillStyle = themeColor;
      ctx.globalAlpha = 0.3;
      ctx.fill();
    }

    // Stroke
    ctx.globalAlpha = 1.0;
    const isDarkModeStroke = document.documentElement.getAttribute('data-theme') === 'dark';

    if (isSelected && this.renderStyle !== 'wireframe') {
      ctx.strokeStyle = themeColor;
      ctx.shadowColor = themeColor;
      ctx.shadowBlur = 40;
      ctx.lineWidth = 24;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.shadowBlur = 20;
      ctx.lineWidth = 16;
      ctx.globalAlpha = 1.0;
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (isSelected && this.renderStyle === 'wireframe') {
      ctx.strokeStyle = themeColor;
      ctx.lineWidth = 4;
      ctx.shadowColor = themeColor;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      const strokeColor = (this.renderStyle === 'wireframe' && isDarkModeStroke)
        ? '#FFFFFF'
        : this.config.strokeColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = this.renderStyle === 'wireframe' ? 1.5 : this.config.strokeWidth;
      ctx.stroke();
    }

    ctx.restore();
  }

  private renderCeilingLabel(ctx: CanvasRenderingContext2D, room: Room): void {
    if (!this.config.showLabels) return;

    const roomPoints = room.points
      .map((pointId) => this.points.get(pointId))
      .filter((p): p is Point => p !== undefined);

    if (roomPoints.length < 3) return;

    const insetDistance = this.config.wallThickness / 2;
    const ceilingPoints = this.insetPolygon(roomPoints, insetDistance);

    if (ceilingPoints.length < 3) return;

    const center = this.calculatePolygonCentroid(ceilingPoints);
    const roomSize = this.calculateRoomMinDimension(ceilingPoints);
    const fontSize = this.getResponsiveFontSize(roomSize);
    const strokeWidth = Math.max(2, fontSize * 0.1);
    const lineSpacing = fontSize * 1.2;

    ctx.save();
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Room name with "Ceiling" suffix
    const displayName = room.name ? `${room.name}` : 'Ceiling';

    ctx.strokeStyle = 'white';
    ctx.lineWidth = strokeWidth;
    ctx.strokeText(displayName, center.x, center.y);
    ctx.fillStyle = this.config.labelColor;
    ctx.fillText(displayName, center.x, center.y);

    // Area calculation
    const areaMm2 = Math.abs(this.calculatePolygonArea(ceilingPoints));
    const areaM2 = areaMm2 / 1000000;
    const areaText = `${areaM2.toFixed(2)} m²`;

    ctx.strokeStyle = 'white';
    ctx.lineWidth = strokeWidth;
    ctx.strokeText(areaText, center.x, center.y + lineSpacing);
    ctx.fillStyle = this.config.labelColor;
    ctx.fillText(areaText, center.x, center.y + lineSpacing);

    ctx.restore();
  }

  private insetPolygon(points: Point[], insetDistance: number): Point[] {
    if (points.length < 3) return [];

    let signedArea = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const point = points[i];
      const nextPoint = points[j];
      if (!(point && nextPoint)) continue;
      signedArea += point.x * nextPoint.y - nextPoint.x * point.y;
    }
    signedArea = signedArea / 2;

    const insetSign = signedArea > 0 ? 1 : -1;
    const insetPoints: Point[] = [];

    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const curr = points[i];
      const next = points[(i + 1) % n];
      if (!(prev && curr && next)) continue;

      const edge1X = curr.x - prev.x;
      const edge1Y = curr.y - prev.y;
      const edge2X = next.x - curr.x;
      const edge2Y = next.y - curr.y;

      const len1 = Math.sqrt(edge1X * edge1X + edge1Y * edge1Y);
      const len2 = Math.sqrt(edge2X * edge2X + edge2Y * edge2Y);

      if (len1 === 0 || len2 === 0) {
        insetPoints.push({ ...curr });
        continue;
      }

      const norm1X = edge1X / len1;
      const norm1Y = edge1Y / len1;
      const norm2X = edge2X / len2;
      const norm2Y = edge2Y / len2;

      const perp1X = -norm1Y * insetSign;
      const perp1Y = norm1X * insetSign;
      const perp2X = -norm2Y * insetSign;
      const perp2Y = norm2X * insetSign;

      const bisectorX = perp1X + perp2X;
      const bisectorY = perp1Y + perp2Y;
      const bisectorLen = Math.sqrt(bisectorX * bisectorX + bisectorY * bisectorY);

      if (bisectorLen < 0.001) {
        insetPoints.push({
          id: curr.id,
          x: curr.x + perp1X * insetDistance,
          y: curr.y + perp1Y * insetDistance,
        });
        continue;
      }

      const normBisectorX = bisectorX / bisectorLen;
      const normBisectorY = bisectorY / bisectorLen;

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

  private calculatePolygonArea(points: Point[]): number {
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
    return area / 2;
  }

  private calculatePolygonCentroid(points: Point[]): { x: number; y: number } {
    if (points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return points[0] ? { x: points[0].x, y: points[0].y } : { x: 0, y: 0 };
    if (points.length === 2) {
      const firstPoint = points[0];
      const secondPoint = points[1];
      if (!(firstPoint && secondPoint)) return { x: 0, y: 0 };
      return {
        x: (firstPoint.x + secondPoint.x) / 2,
        y: (firstPoint.y + secondPoint.y) / 2
      };
    }

    let signedArea = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const point = points[i];
      const nextPoint = points[j];
      if (!(point && nextPoint)) continue;
      const cross = point.x * nextPoint.y - nextPoint.x * point.y;
      signedArea += cross;
      cx += (point.x + nextPoint.x) * cross;
      cy += (point.y + nextPoint.y) * cross;
    }

    signedArea /= 2;

    if (Math.abs(signedArea) < 0.001) {
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

  private calculateRoomMinDimension(points: Point[]): number {
    if (points.length < 3) return 1000;

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

  private getResponsiveFontSize(roomMinDimension: number): number {
    const ratio = 0.05;
    const minSize = 50;
    const maxSize = 150;
    const calculatedSize = roomMinDimension * ratio;
    return Math.max(minSize, Math.min(maxSize, calculatedSize));
  }

  /**
   * Check if a point is inside a room (for ceiling interaction)
   */
  getRoomAtPoint(worldX: number, worldY: number): { room: Room; area: number } | null {
    for (const room of this.rooms) {
      const roomPoints = room.points
        .map((pointId) => this.points.get(pointId))
        .filter((p): p is Point => p !== undefined);

      if (roomPoints.length < 3) continue;

      if (this.isPointInPolygon(worldX, worldY, roomPoints)) {
        const insetDistance = this.config.wallThickness / 2;
        const ceilingPoints = this.insetPolygon(roomPoints, insetDistance);
        const areaMm2 = Math.abs(this.calculatePolygonArea(ceilingPoints));
        const areaM2 = areaMm2 / 1000000;

        return { room, area: areaM2 };
      }
    }
    return null;
  }

  private isPointInPolygon(x: number, y: number, polygon: Point[]): boolean {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const point = polygon[i];
      const previousPoint = polygon[j];
      if (!(point && previousPoint)) continue;
      const xi = point.x;
      const yi = point.y;
      const xj = previousPoint.x;
      const yj = previousPoint.y;

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }
}
