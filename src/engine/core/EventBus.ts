type Handler<TPayload> = (payload: TPayload) => void;

/**
 * Pub/sub tipado por un mapa de eventos.
 *
 * `TEvents` es un objeto `{ "event.name": PayloadType }`. Tanto `on` como
 * `emit` están tipados respecto a esa shape, de forma que el callback
 * recibe el payload correcto sin casts.
 *
 * El bus es agnóstico al dominio: el motor lo provee como clase y la
 * capa de juego instancia uno tipado por `GameEventMap`.
 */
export class EventBus<TEvents extends object> {
  private readonly handlers = new Map<keyof TEvents, Set<Handler<TEvents[keyof TEvents]>>>();
  private suspensionDepth = 0;

  /** Suscribe `handler` a `eventName`. Devuelve un disposer idempotente. */
  on<TKey extends keyof TEvents>(eventName: TKey, handler: Handler<TEvents[TKey]>): () => void {
    const handlers = this.getHandlers(eventName);
    handlers.add(handler as Handler<TEvents[keyof TEvents]>);

    return () => {
      handlers.delete(handler as Handler<TEvents[keyof TEvents]>);
    };
  }

  /** Notifica sincrónicamente a todos los handlers registrados para `eventName`. */
  emit<TKey extends keyof TEvents>(eventName: TKey, payload: TEvents[TKey]): void {
    if (this.suspensionDepth > 0) {
      return;
    }
    const handlers = this.handlers.get(eventName);

    if (!handlers) {
      return;
    }

    handlers.forEach((handler) => {
      (handler as Handler<TEvents[TKey]>)(payload);
    });
  }

  /** Borra todas las suscripciones. Usar al destruir la instancia del bus. */
  clear(): void {
    this.handlers.clear();
    this.suspensionDepth = 0;
  }

  /**
   * Silencia emisiones mientras un consumidor reconstruye estado de forma
   * atómica. El disposer es idempotente y admite suspensiones anidadas.
   */
  suspend(): () => void {
    this.suspensionDepth += 1;
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      this.suspensionDepth = Math.max(0, this.suspensionDepth - 1);
    };
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
