import { describe, expect, it } from "vitest";
import { EntityIOSystem, type ActivatorRef, type EntityHandle, type InputArgs } from "@game/script/EntityIOSystem";
import {
  createAutoHandle,
  createCounterHandle,
  createRelayHandle,
  createTimerHandle,
} from "@game/script/logicEntities";

function recordingHandle(name: string): EntityHandle & { count: () => number } {
  const received: InputArgs[] = [];
  return {
    name,
    classId: "message",
    acceptInput: (_input, args) => received.push(args),
    count: () => received.length,
  };
}

const none: ActivatorRef = { kind: "none" };

describe("logicEntities", () => {
  it("relay reenvía Trigger→OnTrigger solo si está habilitado", () => {
    const io = new EntityIOSystem();
    const sink = recordingHandle("sink");
    io.registerEntity(sink);
    const relay = createRelayHandle({ kind: "relay", id: "r", name: "r" }, io);
    io.registerEntity(relay);
    io.registerConnections("r", [{ output: "OnTrigger", target: "sink", input: "Go" }]);

    relay.acceptInput("Trigger", { activator: none, caller: "test" });
    expect(sink.count()).toBe(1);

    relay.acceptInput("Disable", { activator: none, caller: "test" });
    relay.acceptInput("Trigger", { activator: none, caller: "test" });
    expect(sink.count()).toBe(1);

    relay.acceptInput("Enable", { activator: none, caller: "test" });
    relay.update?.(0.01);
    relay.acceptInput("Trigger", { activator: none, caller: "test" });
    expect(sink.count()).toBe(2);
  });

  it("relay bloquea retrigger hasta vencer su mayor delay, salvo fast retrigger", () => {
    const io = new EntityIOSystem();
    const sink = recordingHandle("sink");
    io.registerEntity(sink);
    const relay = createRelayHandle({
      kind: "relay",
      id: "r",
      name: "r",
      connections: [{ output: "OnTrigger", target: "sink", input: "Go", delay: 1 }],
    }, io);
    io.registerEntity(relay);
    io.registerConnections({ key: "r", name: "r" }, [
      { output: "OnTrigger", target: "sink", input: "Go", delay: 1 },
    ]);

    relay.acceptInput("Trigger", { activator: none, caller: "test" });
    relay.acceptInput("Trigger", { activator: none, caller: "test" });
    io.update(1.1);
    expect(sink.count()).toBe(1);

    relay.update?.(1.1);
    relay.acceptInput("Trigger", { activator: none, caller: "test" });
    io.update(1.1);
    expect(sink.count()).toBe(2);
  });

  it("relay CancelPending cancela la cola y libera el lock", () => {
    const io = new EntityIOSystem();
    const sink = recordingHandle("sink");
    io.registerEntity(sink);
    const def = {
      kind: "relay" as const,
      id: "r",
      name: "r",
      connections: [{ output: "OnTrigger", target: "sink", input: "Go", delay: 1 }],
    };
    const relay = createRelayHandle(def, io);
    io.registerEntity(relay);
    io.registerConnections({ key: "r", name: "r" }, def.connections);

    relay.acceptInput("Trigger", { activator: none, caller: "test" });
    relay.acceptInput("CancelPending", { activator: none, caller: "test" });
    relay.acceptInput("Trigger", { activator: none, caller: "test" });
    io.update(1.1);

    expect(sink.count()).toBe(1);
  });

  it("counter dispara OnHitMax exactamente una vez hasta Reset", () => {
    const io = new EntityIOSystem();
    const sink = recordingHandle("sink");
    io.registerEntity(sink);
    const counter = createCounterHandle({ kind: "counter", id: "c", name: "c", max: 3 }, io);
    io.registerEntity(counter);
    io.registerConnections("c", [{ output: "OnHitMax", target: "sink", input: "Open" }]);

    for (let i = 0; i < 5; i += 1) {
      counter.acceptInput("Add", { activator: none, caller: "test" });
    }
    expect(sink.count()).toBe(1);

    counter.acceptInput("Reset", { activator: none, caller: "test" });
    for (let i = 0; i < 3; i += 1) {
      counter.acceptInput("Add", { activator: none, caller: "test" });
    }
    expect(sink.count()).toBe(2);
  });

  it("auto dispara OnMapSpawn una sola vez en el primer update", () => {
    const io = new EntityIOSystem();
    const sink = recordingHandle("sink");
    io.registerEntity(sink);
    io.registerEntity(createAutoHandle({ kind: "auto", id: "a", name: "a" }, io));
    io.registerConnections("a", [{ output: "OnMapSpawn", target: "sink", input: "Go" }]);

    io.update(0.016);
    io.update(0.016);
    expect(sink.count()).toBe(1);
  });

  it("timer dispara OnTimer periódicamente y se detiene con Disable", () => {
    const io = new EntityIOSystem();
    const sink = recordingHandle("sink");
    io.registerEntity(sink);
    const timer = createTimerHandle({ kind: "timer", id: "t", name: "t", interval: 1 }, io);
    io.registerEntity(timer);
    io.registerConnections("t", [{ output: "OnTimer", target: "sink", input: "Go" }]);

    io.update(1);
    io.update(1);
    expect(sink.count()).toBe(2);

    timer.acceptInput("Disable", { activator: none, caller: "test" });
    io.update(1);
    expect(sink.count()).toBe(2);
  });

  it("timer reinicia el intervalo al volver a habilitarse", () => {
    const io = new EntityIOSystem();
    const sink = recordingHandle("sink");
    io.registerEntity(sink);
    const timer = createTimerHandle({ kind: "timer", id: "t", name: "t", interval: 1 }, io);
    io.registerEntity(timer);
    io.registerConnections({ key: "t", name: "t" }, [
      { output: "OnTimer", target: "sink", input: "Go" },
    ]);

    timer.update?.(0.8);
    timer.acceptInput("Disable", { activator: none, caller: "test" });
    timer.acceptInput("Enable", { activator: none, caller: "test" });
    timer.update?.(0.3);
    expect(sink.count()).toBe(0);
    timer.update?.(0.7);
    expect(sink.count()).toBe(1);
  });
});
