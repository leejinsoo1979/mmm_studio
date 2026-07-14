// @ts-nocheck
/**
 * Command - Base interface for Command pattern
 * Enables undo/redo functionality
 */
export interface ICommand {
  execute(): void;
  undo(): void;
  canExecute(): boolean;
  canUndo(): boolean;
  getDescription(): string;
}

export abstract class Command implements ICommand {
  protected executed: boolean = false;

  abstract execute(): void;
  abstract undo(): void;

  canExecute(): boolean {
    return !this.executed;
  }

  canUndo(): boolean {
    return this.executed;
  }

  abstract getDescription(): string;

  protected markExecuted(): void {
    this.executed = true;
  }

  protected markUndone(): void {
    this.executed = false;
  }
}
