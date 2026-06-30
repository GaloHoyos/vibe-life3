import type { EventBus } from "@engine/core/EventBus";

export function recordEvents<TEvents extends object, TKey extends keyof TEvents>(
  bus: EventBus<TEvents>,
  eventName: TKey,
): TEvents[TKey][] {
  const events: TEvents[TKey][] = [];
  bus.on(eventName, (event) => events.push(event));
  return events;
}
