// @ts-nocheck
import { BlueprintObjectManager } from './BlueprintObjectManager';
import { SelectionManager } from './SelectionManager';
import { HistoryManager } from './HistoryManager';
import type { EditorConfig } from '../types/EditorState';
import { ToolType } from '../types/EditorState';
import { eventBus } from '../events/EventBus';
import { EditorEvents } from '../events/EditorEvents';

/**
 * SceneManager - Central manager coordinating all editor systems
 * NOW USES blueprint Floorplan internally via BlueprintObjectManager
 */
export class SceneManager {
  private static instance: SceneManager;

  public objectManager: BlueprintObjectManager;
  public selectionManager: SelectionManager;
  public historyManager: HistoryManager;

  private currentTool: ToolType = ToolType.SELECT;
  private config: EditorConfig;
  private _isWallDragging: boolean = false; // Flag to prevent cleanup during wall drag

  private constructor(config: EditorConfig) {
    this.config = config;
    this.objectManager = new BlueprintObjectManager();
    this.selectionManager = new SelectionManager();
    this.historyManager = new HistoryManager();
  }

  static getInstance(config?: EditorConfig): SceneManager {
    if (!SceneManager.instance) {
      if (!config) {
        throw new Error('SceneManager requires config for first initialization');
      }
      SceneManager.instance = new SceneManager(config);
    }
    return SceneManager.instance;
  }

  static resetInstance(): void {
    SceneManager.instance = null as any;
  }

  /**
   * Tool management
   */
  setTool(tool: ToolType): void {
    if (this.currentTool !== tool) {
      const previousTool = this.currentTool;
      this.currentTool = tool;

      eventBus.emit(EditorEvents.TOOL_DEACTIVATED, { tool: previousTool });
      eventBus.emit(EditorEvents.TOOL_ACTIVATED, { tool });
      eventBus.emit(EditorEvents.TOOL_CHANGED, { from: previousTool, to: tool });
    }
  }

  getTool(): ToolType {
    return this.currentTool;
  }

  /**
   * Config management
   */
  getConfig(): EditorConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<EditorConfig>): void {
    this.config = { ...this.config, ...updates };
    eventBus.emit(EditorEvents.STATE_CHANGED, { config: this.config });
  }

  /**
   * Grid & Snap
   */
  toggleGrid(): void {
    // Grid toggle logic will be handled by renderer
    eventBus.emit(EditorEvents.GRID_TOGGLED, {});
  }

  toggleSnap(): void {
    this.config.snapEnabled = !this.config.snapEnabled;
    eventBus.emit(EditorEvents.SNAP_TOGGLED, { enabled: this.config.snapEnabled });
  }

  isSnapEnabled(): boolean {
    return this.config.snapEnabled;
  }

  /**
   * Wall dragging state - prevents cleanup during drag
   */
  setWallDragging(isDragging: boolean): void {
    this._isWallDragging = isDragging;
  }

  isWallDragging(): boolean {
    return this._isWallDragging;
  }

  /**
   * Canvas management
   */
  resizeCanvas(width: number, height: number): void {
    this.config.canvasWidth = width;
    this.config.canvasHeight = height;
    eventBus.emit(EditorEvents.CANVAS_RESIZED, { width, height });
  }

  /**
   * Camera management
   */
  resetCamera(): void {
    eventBus.emit(EditorEvents.CAMERA_RESET, {});
  }

  /**
   * Export/Import
   */
  exportState(): string {
    const state = {
      points: Array.from(this.objectManager.getAllPoints()),
      walls: Array.from(this.objectManager.getAllWalls()),
      rooms: Array.from(this.objectManager.getAllRooms()),
      config: this.config,
    };
    return JSON.stringify(state, null, 2);
  }

  importState(jsonState: string): void {
    try {
      const state = JSON.parse(jsonState);

      this.objectManager.clear();
      this.selectionManager.clearSelection();
      this.historyManager.clear();

      // Import points
      state.points?.forEach((point: any) => {
        this.objectManager.addPoint(point);
      });

      // Import walls
      state.walls?.forEach((wall: any) => {
        this.objectManager.addWall(wall);
      });

      // Import rooms
      state.rooms?.forEach((room: any) => {
        this.objectManager.addRoom(room);
      });

      // Update config
      if (state.config) {
        this.config = { ...this.config, ...state.config };
      }

      eventBus.emit(EditorEvents.STATE_CHANGED, {});
    } catch (error) {
      console.error('Failed to import state:', error);
      throw error;
    }
  }

  /**
   * Reset editor
   */
  reset(): void {
    this.objectManager.clear();
    this.selectionManager.clearSelection();
    this.historyManager.clear();
    this.currentTool = ToolType.SELECT;
    eventBus.emit(EditorEvents.STATE_CHANGED, {});
  }

  /**
   * Get editor statistics
   */
  getStats(): {
    objects: { points: number; walls: number; rooms: number };
    history: { undo: number; redo: number };
    selection: number;
  } {
    return {
      objects: this.objectManager.getCounts(),
      history: {
        undo: this.historyManager.getUndoCount(),
        redo: this.historyManager.getRedoCount(),
      },
      selection: this.selectionManager.getSelectionCount(),
    };
  }
}
