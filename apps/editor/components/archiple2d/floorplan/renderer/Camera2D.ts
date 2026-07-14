// @ts-nocheck
import { Vector2 } from '../../core/math/Vector2';
import type { ViewportState, PointMM, PointPX } from '../../editor/core/units';
import {
  createViewport,
  worldToScreen,
  screenToWorld,
  applyZoom,
  applyPan,
} from '../../editor/core/units';

/**
 * Camera2D - mm 기반 뷰포트 카메라
 *
 * 핵심 원칙:
 * 1. 내부 좌표는 항상 mm 단위
 * 2. ViewportState로 줌/팬 상태 관리
 * 3. 화면 렌더링 시에만 mm → px 변환
 * 4. 줌/팬은 world 좌표에 영향 없음
 *
 * Features:
 * - Zoom in/out (mouse wheel)
 * - Pan (middle mouse drag or space + drag)
 * - Screen to world coordinate conversion (px → mm)
 * - World to screen coordinate conversion (mm → px)
 */
export class Camera2D {
  private viewport: ViewportState;
  private dpr: number = 1;

  constructor(canvasWidth: number, canvasHeight: number, initialScale: number = 0.1) {
    // ViewportState 생성 (scalePxPerMm = 0.1 means 1mm = 0.1px, so 4800mm = 480px)
    this.viewport = createViewport(canvasWidth, canvasHeight, initialScale);
  }

  /**
   * Set canvas size and Device Pixel Ratio
   */
  setSize(width: number, height: number, dpr: number = 1): void {
    this.dpr = dpr;
    // Store logical pixels in viewport (Physical / DPR)
    // Canvas2DRenderer passes logical pixels, so we store them directly
    this.viewport.canvasWidth = width;
    this.viewport.canvasHeight = height;
  }

  /**
   * Get viewport state (for direct access)
   */
  getViewport(): ViewportState {
    return this.viewport;
  }

  /**
   * Get current zoom level (scalePxPerMm)
   */
  getZoom(): number {
    return this.viewport.scalePxPerMm;
  }

  /**
   * Set zoom level directly (centered on canvas)
   * @param scale - New scale value (px/mm)
   */
  setZoom(scale: number): void {
    const minScale = 0.05;
    const maxScale = 2.0;
    this.viewport.scalePxPerMm = Math.max(minScale, Math.min(maxScale, scale));
  }

  /**
   * Get current scale in legacy format (zoom * 10 for compatibility)
   * Legacy code expects zoom where 1.0 = normal
   */
  getLegacyZoom(): number {
    // Convert scalePxPerMm to legacy zoom format
    // scalePxPerMm = 0.1 should map to legacy zoom = 1.0
    return this.viewport.scalePxPerMm * 10;
  }

  /**
   * Zoom in/out at a specific screen point (for mouse wheel zoom)
   * @param screenX - Screen X coordinate (px)
   * @param screenY - Screen Y coordinate (px)
   * @param zoomDelta - Zoom change amount (-0.1 to 0.1)
   */
  zoomAt(screenX: number, screenY: number, zoomDelta: number): void {
    const centerPx: PointPX = { x: screenX, y: screenY };
    this.viewport = applyZoom(this.viewport, zoomDelta, centerPx);
  }

  /**
   * Pan camera by screen space delta
   * @param screenDx - Screen X delta (px)
   * @param screenDy - Screen Y delta (px)
   */
  pan(screenDx: number, screenDy: number): void {
    this.viewport = applyPan(this.viewport, screenDx, screenDy);
  }

  /**
   * Set camera position (mm units)
   */
  setPosition(x: number, y: number): void {
    // Convert mm position to offset in px
    // Note: This is a simplified mapping, adjust if needed
    this.viewport.offsetX = -x * this.viewport.scalePxPerMm;
    this.viewport.offsetY = -y * this.viewport.scalePxPerMm;
  }

  /**
   * Get camera position (mm units)
   */
  getPosition(): Vector2 {
    // Convert offset back to mm position
    const x = -this.viewport.offsetX / this.viewport.scalePxPerMm;
    const y = -this.viewport.offsetY / this.viewport.scalePxPerMm;
    return new Vector2(x, y);
  }

  /**
   * Convert screen coordinates (px) to world coordinates (mm)
   * @param screenX - Logical screen X (CSS pixels)
   * @param screenY - Logical screen Y (CSS pixels)
   */
  screenToWorld(screenX: number, screenY: number): Vector2 {
    const pointPx: PointPX = { x: screenX, y: screenY };
    const pointMm = screenToWorld(pointPx, this.viewport);
    return new Vector2(pointMm.x, pointMm.y);
  }

  /**
   * Convert world coordinates (mm) to screen coordinates (px)
   * @returns Logical screen coordinates (CSS pixels)
   */
  worldToScreen(worldX: number, worldY: number): Vector2 {
    const pointMm: PointMM = { x: worldX, y: worldY };
    const pointPx = worldToScreen(pointMm, this.viewport);
    return new Vector2(pointPx.x, pointPx.y);
  }

  /**
   * Apply camera transform to canvas context
   * Transforms canvas so that drawing in mm units renders correctly on screen
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    const { scalePxPerMm, offsetX, offsetY, canvasWidth, canvasHeight } = this.viewport;

    // Reset transform to DPI scale
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 1. Translate to canvas center
    ctx.translate(canvasWidth / 2, canvasHeight / 2);

    // 2. Apply offset (pan)
    ctx.translate(offsetX, offsetY);

    // 3. Apply scale (zoom) - converts mm to px
    ctx.scale(scalePxPerMm, scalePxPerMm);
  }

  /**
   * Apply screen transform (reset to pixel space with DPI scaling)
   * Useful for drawing UI elements that shouldn't zoom/pan
   */
  applyScreenTransform(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * Get visible world bounds (mm units)
   */
  getVisibleBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(
      this.viewport.canvasWidth,
      this.viewport.canvasHeight
    );

    return {
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: bottomRight.x,
      maxY: bottomRight.y,
    };
  }

  /**
   * Reset camera to default state
   */
  reset(): void {
    this.viewport.scalePxPerMm = 0.12; // Default scale
    this.viewport.offsetX = 0;
    this.viewport.offsetY = 0;
  }
}
