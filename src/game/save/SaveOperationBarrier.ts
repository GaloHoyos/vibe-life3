export type SaveOperationKind = "capture" | "restore";

type MaybePromise<T> = Promise<T> | T;

export interface SaveOperationBarrierHooks {
  enter(operation: SaveOperationKind): MaybePromise<void>;
  leave(operation: SaveOperationKind, error: unknown | null): MaybePromise<void>;
}

const NOOP_HOOKS: SaveOperationBarrierHooks = {
  enter: () => undefined,
  leave: () => undefined,
};

/**
 * Mutex FIFO que mantiene simulación/eventos suspendidos mientras se captura o
 * restaura. Los hooks pertenecen al bootstrap y pueden pausar el loop sin que
 * persistencia conozca `Game`.
 */
export class SaveOperationBarrier {
  private tail: Promise<void> = Promise.resolve();
  private activeOperation: SaveOperationKind | null = null;

  constructor(private readonly hooks: SaveOperationBarrierHooks = NOOP_HOOKS) {}

  get currentOperation(): SaveOperationKind | null {
    return this.activeOperation;
  }

  run<T>(
    operation: SaveOperationKind,
    action: () => Promise<T>,
  ): Promise<T> {
    const result = this.tail.then(
      () => this.execute(operation, action),
      () => this.execute(operation, action),
    );
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async execute<T>(
    operation: SaveOperationKind,
    action: () => Promise<T>,
  ): Promise<T> {
    await this.hooks.enter(operation);
    this.activeOperation = operation;
    let failure: unknown = null;
    try {
      return await action();
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        await this.hooks.leave(operation, failure);
      } catch (leaveError) {
        if (failure === null) throw leaveError;
      } finally {
        this.activeOperation = null;
      }
    }
  }
}
