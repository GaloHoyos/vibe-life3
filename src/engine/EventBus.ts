type Handler<TPayload> = (payload: TPayload) => void;

export class EventBus<TEvents extends object> {
  private readonly handlers = new Map<keyof TEvents, Set<Handler<TEvents[keyof TEvents]>>>();

  on<TKey extends keyof TEvents>(eventName: TKey, handler: Handler<TEvents[TKey]>): () => void {
    const handlers = this.getHandlers(eventName);
    handlers.add(handler as Handler<TEvents[keyof TEvents]>);

    return () => {
      handlers.delete(handler as Handler<TEvents[keyof TEvents]>);
    };
  }

  emit<TKey extends keyof TEvents>(eventName: TKey, payload: TEvents[TKey]): void {
    const handlers = this.handlers.get(eventName);

    if (!handlers) {
      return;
    }

    handlers.forEach((handler) => {
      (handler as Handler<TEvents[TKey]>)(payload);
    });
  }

  clear(): void {
    this.handlers.clear();
  }

  private getHandlers<TKey extends keyof TEvents>(eventName: TKey): Set<Handler<TEvents[keyof TEvents]>> {
    let handlers = this.handlers.get(eventName);

    if (!handlers) {
      handlers = new Set<Handler<TEvents[keyof TEvents]>>();
      this.handlers.set(eventName, handlers);
    }

    return handlers;
  }
}
