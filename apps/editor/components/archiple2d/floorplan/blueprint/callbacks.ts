// @ts-nocheck
export class CallbackList<T extends any[] = []> {
  private callbacks = new Set<(...args: T) => void>();

  add(cb: (...args: T) => void): void {
    this.callbacks.add(cb);
  }

  remove(cb: (...args: T) => void): void {
    this.callbacks.delete(cb);
  }

  fire(...args: T): void {
    for (const cb of this.callbacks) {
      try {
        cb(...args);
      } catch (error) {
        console.error('[CallbackList] listener failed', error);
      }
    }
  }

  clear(): void {
    this.callbacks.clear();
  }
}
