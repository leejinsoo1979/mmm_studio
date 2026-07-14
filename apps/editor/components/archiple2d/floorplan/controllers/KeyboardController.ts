// @ts-nocheck
import { ToolManager } from '../tools/ToolManager';
import { SceneManager } from '../../core/engine/SceneManager';
import { ToolType } from '../../core/types/EditorState';

/**
 * KeyboardController - Handles keyboard input
 *
 * Features:
 * - Tool switching shortcuts
 * - Undo/Redo (Ctrl+Z / Ctrl+Shift+Z)
 * - ESC to cancel
 * - Grid toggle (G)
 * - Snap toggle (S)
 */
export class KeyboardController {
  private toolManager: ToolManager;
  private sceneManager: SceneManager;

  constructor(toolManager: ToolManager, sceneManager: SceneManager) {
    this.toolManager = toolManager;
    this.sceneManager = sceneManager;

    this.setupEventListeners();
  }

  /**
   * Setup keyboard event listeners
   */
  private setupEventListeners(): void {
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));
  }

  /**
   * Remove event listeners (cleanup)
   */
  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown.bind(this));
    window.removeEventListener('keyup', this.handleKeyUp.bind(this));
  }

  /**
   * Handle key down
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Undo/Redo
    if (event.ctrlKey || event.metaKey) {
      if (event.shiftKey && event.key === 'z') {
        // Ctrl+Shift+Z: Redo
        console.log('[KeyboardController] Redo triggered (Cmd/Ctrl+Shift+Z)');
        event.preventDefault();
        this.sceneManager.historyManager.redo();
        return;
      } else if (event.key === 'z') {
        // Ctrl+Z: Undo
        console.log('[KeyboardController] Undo triggered (Cmd/Ctrl+Z)');
        event.preventDefault();
        this.sceneManager.historyManager.undo();
        return;
      }
    }

    // Tool shortcuts (without modifiers)
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      switch (event.key.toLowerCase()) {
        case 'w':
          // W: Wall tool
          this.sceneManager.setTool(ToolType.WALL);
          break;

        case 'v':
          // V: Select tool
          this.sceneManager.setTool(ToolType.SELECT);
          break;

        case 'm':
          // M: Move tool
          this.sceneManager.setTool(ToolType.MOVE);
          break;

        case 'e':
          // E: Erase tool
          this.sceneManager.setTool(ToolType.ERASE);
          break;

        case 'g':
          // G: Toggle grid
          event.preventDefault();
          this.sceneManager.toggleGrid();
          break;

        case 's':
          // S: Toggle snap
          event.preventDefault();
          this.sceneManager.toggleSnap();
          break;

        case 'escape':
          // ESC: Cancel current tool operation and return to SELECT tool
          event.preventDefault();
          this.toolManager.getActiveTool()?.cancel();
          this.toolManager.setActiveTool(ToolType.SELECT);
          this.sceneManager.setTool(ToolType.SELECT);
          // Notify EditorPage to update UI
          window.dispatchEvent(new CustomEvent('tool-changed', { detail: { tool: ToolType.SELECT } }));
          break;

        case ' ':
          // Space: Reset camera to center
          event.preventDefault();
          this.sceneManager.resetCamera();
          console.log('[KeyboardController] Camera reset to center');
          break;
      }
    }

    // Route to active tool
    this.toolManager.handleKeyDown(event);
  }

  /**
   * Handle key up
   */
  private handleKeyUp(event: KeyboardEvent): void {
    // Route to active tool
    this.toolManager.handleKeyUp(event);
  }
}
