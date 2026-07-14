// @ts-nocheck
import { BaseLayer } from './Layer';
import type { Point } from '../../../core/types/Point';
import type { Camera2D } from '../Camera2D';

export interface PointLayerConfig {
  pointRadius?: number;
  pointColor?: string;
  selectedColor?: string;
  hoveredColor?: string;
  snapIndicatorColor?: string;
  snapIndicatorRadius?: number;
}

/**
 * PointLayer - Renders points (vertices)
 *
 * Features:
 * - Normal points
 * - Selected points (highlighted)
 * - Hovered points (highlight)
 * - Snap indicators (magnet effect)
 * - Points rendered in screen space for consistent size
 */
export class PointLayer extends BaseLayer {
  private points: Point[] = [];
  private selectedPointIds: Set<string> = new Set();
  private hoveredPointId: string | null = null;
  private snapPoint: Point | null = null;
  private camera: Camera2D | null = null;

  private config: Required<PointLayerConfig>;

  constructor(config?: PointLayerConfig) {
    super(3); // z-index: 3

    this.config = {
      pointRadius: config?.pointRadius || 4, // Smaller size - Screen space pixels
      pointColor: config?.pointColor || '#ffffff', // White color
      selectedColor: config?.selectedColor || '#3498db',
      hoveredColor: config?.hoveredColor || '#f39c12',
      snapIndicatorColor: config?.snapIndicatorColor || '#2ecc71',
      snapIndicatorRadius: config?.snapIndicatorRadius || 12, // Screen space pixels
    };
  }

  setCamera(camera: Camera2D): void {
    this.camera = camera;
  }

  setPoints(points: Point[]): void {
    this.points = points;
  }

  setSelectedPoints(pointIds: string[]): void {
    this.selectedPointIds = new Set(pointIds);
  }

  setHoveredPoint(pointId: string | null): void {
    this.hoveredPointId = pointId;
  }

  setSnapPoint(point: Point | null): void {
    this.snapPoint = point;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible || !this.camera) return;

    this.applyOpacity(ctx);

    // Render snap indicator first (background) - in screen space
    if (this.snapPoint) {
      this.renderSnapIndicator(ctx, this.snapPoint);
    }

    // Render only selected or hovered points (not all points)
    this.points.forEach((point) => {
      const isSelected = this.selectedPointIds.has(point.id);
      const isHovered = point.id === this.hoveredPointId;
      // Only render if selected or hovered
      if (isSelected || isHovered) {
        this.renderPoint(ctx, point, isSelected, isHovered);
      }
    });

    this.resetOpacity(ctx);
  }

  private renderPoint(
    ctx: CanvasRenderingContext2D,
    point: Point,
    isSelected: boolean,
    isHovered: boolean
  ): void {
    if (!this.camera) return;

    // Convert world coordinates to screen coordinates
    const screenPos = this.camera.worldToScreen(point.x, point.y);

    let color = this.config.pointColor;
    let radius = this.config.pointRadius;

    if (isHovered) {
      color = this.config.hoveredColor;
      radius = this.config.pointRadius * 1.5;
    } else if (isSelected) {
      color = this.config.selectedColor;
      radius = this.config.pointRadius * 1.3;
    }

    ctx.save();
    // Reset transform to screen space (with DPI scaling)
    this.camera.applyScreenTransform(ctx);

    // Draw point
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Draw outline - 다크모드 대응
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.strokeStyle = isDarkMode ? '#333333' : '#cccccc';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  private renderSnapIndicator(ctx: CanvasRenderingContext2D, point: Point): void {
    if (!this.camera) return;

    // Convert world coordinates to screen coordinates
    const screenPos = this.camera.worldToScreen(point.x, point.y);

    ctx.save();
    // Reset transform to screen space (with DPI scaling)
    this.camera.applyScreenTransform(ctx);

    // Outer ring (pulsing effect)
    ctx.strokeStyle = this.config.snapIndicatorColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, this.config.snapIndicatorRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, this.config.snapIndicatorRadius * 0.6, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair
    const crossSize = 6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screenPos.x - crossSize, screenPos.y);
    ctx.lineTo(screenPos.x + crossSize, screenPos.y);
    ctx.moveTo(screenPos.x, screenPos.y - crossSize);
    ctx.lineTo(screenPos.x, screenPos.y + crossSize);
    ctx.stroke();

    ctx.restore();
  }
}
