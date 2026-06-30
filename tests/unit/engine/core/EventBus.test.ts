import { describe, expect, it } from "vitest";
import { EventBus } from "@engine/core/EventBus";

interface TestEvents {
  ping: { value: number };
  pong: { label: string };
}

describe("EventBus", () => {
  it("emite eventos sincronicamente a los handlers registrados", () => {
    const bus = new EventBus<TestEvents>();
    const received: number[] = [];

    bus.on("ping", (event) => {
      received.push(event.value);
    });
    bus.emit("ping", { value: 1 });
    bus.emit("ping", { value: 2 });

    expect(received).toEqual([1, 2]);
  });

  it("devuelve un disposer idempotente", () => {
    const bus = new EventBus<TestEvents>();
    const received: string[] = [];
    const dispose = bus.on("pong", (event) => {
      received.push(event.label);
    });

    dispose();
    dispose();
    bus.emit("pong", { label: "ignored" });

    expect(received).toEqual([]);
  });

  it("clear remueve todas las suscripciones", () => {
    const bus = new EventBus<TestEvents>();
    const received: number[] = [];
    bus.on("ping", (event) => received.push(event.value));

    bus.clear();
    bus.emit("ping", { value: 3 });

    expect(received).toEqual([]);
  });
});
