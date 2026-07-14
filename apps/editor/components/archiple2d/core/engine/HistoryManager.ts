// @ts-nocheck
import type { ICommand } from '../commands/Command';
import { eventBus } from '../events/EventBus';
import { EditorEvents } from '../events/EditorEvents';

/**
 * HistoryManager - Manages undo/redo stack
 */
export class HistoryManager {
  private undoStack: ICommand[] = [];
  private redoStack: ICommand[] = [];
  private maxHistorySize: number = 100;

  constructor(maxSize?: number) {
    if (maxSize) {
      this.maxHistorySize = maxSize;
    }
  }

  /**
   * Execute a command and add it to history
   */
  execute(command: ICommand): void {
    if (!command.canExecute()) {
      console.warn('[HistoryManager] Command cannot be executed:', command.getDescription());
      return;
    }

    console.log('[HistoryManager] Executing command:', command.getDescription());
    command.execute();
    this.undoStack.push(command);
    this.redoStack = []; // Clear redo stack when new command is executed

    // Trim undo stack if it exceeds max size
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }

    console.log('[HistoryManager] Execute complete. Stack sizes - undo:', this.undoStack.length, 'redo:', this.redoStack.length);

    eventBus.emit(EditorEvents.STATE_CHANGED, {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
  }

  /**
   * Undo last command
   */
  undo(): void {
    if (!this.canUndo()) {
      console.warn('[HistoryManager] Nothing to undo');
      return;
    }

    const command = this.undoStack.pop()!;
    console.log('[HistoryManager] Undoing command:', command.getDescription());
    command.undo();
    this.redoStack.push(command);

    eventBus.emit(EditorEvents.UNDO, { command: command.getDescription() });
    eventBus.emit(EditorEvents.STATE_CHANGED, {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
    console.log('[HistoryManager] Undo complete. Stack sizes - undo:', this.undoStack.length, 'redo:', this.redoStack.length);
  }

  /**
   * Redo last undone command
   */
  redo(): void {
    if (!this.canRedo()) {
      console.warn('Nothing to redo');
      return;
    }

    const command = this.redoStack.pop()!;
    command.execute();
    this.undoStack.push(command);

    eventBus.emit(EditorEvents.REDO, { command: command.getDescription() });
    eventBus.emit(EditorEvents.STATE_CHANGED, {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];

    eventBus.emit(EditorEvents.STATE_CHANGED, {
      canUndo: false,
      canRedo: false,
    });
  }

  /**
   * Get undo stack size
   */
  getUndoCount(): number {
    return this.undoStack.length;
  }

  /**
   * Get redo stack size
   */
  getRedoCount(): number {
    return this.redoStack.length;
  }

  /**
   * Get history summary
   */
  getHistory(): { undo: string[]; redo: string[] } {
    return {
      undo: this.undoStack.map(cmd => cmd.getDescription()),
      redo: this.redoStack.map(cmd => cmd.getDescription()),
    };
  }
}
