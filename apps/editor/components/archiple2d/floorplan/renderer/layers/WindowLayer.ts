// @ts-nocheck
import { BaseLayer } from './Layer';
import type { Window } from '../../../core/types/Window';
import type { Wall } from '../../../core/types/Wall';
import type { Point } from '../../../core/types/Point';

/**
 * WindowLayer - Renders windows on walls
 */
export class WindowLayer extends BaseLayer {
  private windows: Window[] = [];
  private walls: Wall[] = [];
  private points: Point[] = [];
  private previewWindow: {
    wall: Wall;
    position: number;
    width: number;
    height: number;
    sillHeight: number;
  } | null = null;

  constructor() {
    super(30); // Same level as doors
  }

  setWindows(windows: Window[]): void {
    this.windows = windows;
  }

  setWalls(walls: Wall[]): void {
    this.walls = walls;
  }

  setPoints(points: Point[]): void {
    this.points = points;
  }

  setPreview(preview: {
    wall: Wall;
    position: number;
    width: number;
    height: number;
    sillHeight: number;
  } | null): void {
    this.previewWindow = preview;
  }

  clearPreview(): void {
    this.previewWindow = null;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return;

    const pointMap = new Map(this.points.map(p => [p.id, p]));

    // Render placed windows
    this.windows.forEach(window => {
      const wall = this.walls.find(w => w.id === window.wallId);
      if (!wall) return;

      this.renderWindow(ctx, window, wall, pointMap, false);
    });

    // Render preview window
    if (this.previewWindow) {
      const window: Window = {
        id: 'preview',
        wallId: this.previewWindow.wall.id,
        position: this.previewWindow.position,
        width: this.previewWindow.width,
        height: this.previewWindow.height,
        sillHeight: this.previewWindow.sillHeight,
        type: 'sliding',
        frameWidth: 50,
      };
      this.renderWindow(ctx, window, this.previewWindow.wall, pointMap, true);
    }
  }

  private renderWindow(
    ctx: CanvasRenderingContext2D,
    window: Window,
    wall: Wall,
    pointMap: Map<string, Point>,
    isPreview: boolean
  ): void {
    const startPoint = pointMap.get(wall.startPointId);
    const endPoint = pointMap.get(wall.endPointId);

    if (!startPoint || !endPoint) return;

    // Calculate window position along wall
    const wallX = startPoint.x + (endPoint.x - startPoint.x) * window.position;
    const wallY = startPoint.y + (endPoint.y - startPoint.y) * window.position;

    // Calculate wall direction
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const wallAngle = Math.atan2(dy, dx);

    // Window dimensions in mm
    const windowWidth = window.width; // 1200mm default
    const halfWidth = windowWidth / 2;
    const frameWidth = window.frameWidth || 50;

    // Check current theme for color selection
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

    ctx.save();

    // Window opening endpoints
    const openingStart = {
      x: wallX - Math.cos(wallAngle) * halfWidth,
      y: wallY - Math.sin(wallAngle) * halfWidth,
    };
    const openingEnd = {
      x: wallX + Math.cos(wallAngle) * halfWidth,
      y: wallY + Math.sin(wallAngle) * halfWidth,
    };

    // Draw window opening (main line) - 다크모드 대응
    ctx.strokeStyle = isPreview
      ? (isDarkMode ? '#64B5F6' : '#2196F3')
      : (isDarkMode ? '#4DD0E1' : '#00BCD4');
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    if (isPreview) {
      ctx.globalAlpha = 0.7;
    }

    ctx.beginPath();
    ctx.moveTo(openingStart.x, openingStart.y);
    ctx.lineTo(openingEnd.x, openingEnd.y);
    ctx.stroke();

    // Draw center divider (for sliding windows) - 다크모드 대응
    if (window.type === 'sliding') {
      ctx.strokeStyle = isPreview
        ? (isDarkMode ? '#42A5F5' : '#1976D2')
        : (isDarkMode ? '#26C6DA' : '#0097A7');
      ctx.lineWidth = 8;

      ctx.beginPath();
      ctx.moveTo(wallX, wallY);
      // Perpendicular direction for center line
      const perpAngle = wallAngle + Math.PI / 2;
      const centerLineLength = wall.thickness * 0.6;
      ctx.lineTo(
        wallX + Math.cos(perpAngle) * centerLineLength / 2,
        wallY + Math.sin(perpAngle) * centerLineLength / 2
      );
      ctx.moveTo(wallX, wallY);
      ctx.lineTo(
        wallX - Math.cos(perpAngle) * centerLineLength / 2,
        wallY - Math.sin(perpAngle) * centerLineLength / 2
      );
      ctx.stroke();
    }

    // Draw opening edges (window frame markers) - 다크모드 대응
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = isPreview
      ? (isDarkMode ? '#90CAF9' : '#64B5F6')
      : (isDarkMode ? '#80DEEA' : '#4DD0E1');
    ctx.lineWidth = 10;

    // Perpendicular direction for edge markers
    const perpAngle = wallAngle + Math.PI / 2;
    const edgeLength = 100; // 100mm edge marker

    // Left edge
    ctx.beginPath();
    ctx.moveTo(openingStart.x, openingStart.y);
    ctx.lineTo(
      openingStart.x + Math.cos(perpAngle) * edgeLength,
      openingStart.y + Math.sin(perpAngle) * edgeLength
    );
    ctx.stroke();

    // Right edge
    ctx.beginPath();
    ctx.moveTo(openingEnd.x, openingEnd.y);
    ctx.lineTo(
      openingEnd.x + Math.cos(perpAngle) * edgeLength,
      openingEnd.y + Math.sin(perpAngle) * edgeLength
    );
    ctx.stroke();

    // Draw glass indicator (parallel lines) - 다크모드 대응
    ctx.strokeStyle = isPreview
      ? (isDarkMode ? 'rgba(100, 181, 246, 0.5)' : 'rgba(33, 150, 243, 0.4)')
      : (isDarkMode ? 'rgba(77, 208, 225, 0.5)' : 'rgba(0, 188, 212, 0.4)');
    ctx.lineWidth = 2;

    const glassOffset1 = frameWidth * 0.3;
    const glassOffset2 = frameWidth * 0.5;

    // First glass line
    ctx.beginPath();
    ctx.moveTo(
      openingStart.x + Math.cos(perpAngle) * glassOffset1,
      openingStart.y + Math.sin(perpAngle) * glassOffset1
    );
    ctx.lineTo(
      openingEnd.x + Math.cos(perpAngle) * glassOffset1,
      openingEnd.y + Math.sin(perpAngle) * glassOffset1
    );
    ctx.stroke();

    // Second glass line
    ctx.beginPath();
    ctx.moveTo(
      openingStart.x - Math.cos(perpAngle) * glassOffset2,
      openingStart.y - Math.sin(perpAngle) * glassOffset2
    );
    ctx.lineTo(
      openingEnd.x - Math.cos(perpAngle) * glassOffset2,
      openingEnd.y - Math.sin(perpAngle) * glassOffset2
    );
    ctx.stroke();

    ctx.restore();
  }
}
