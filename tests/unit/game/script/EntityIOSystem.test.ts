import { describe, expect, it, vi } from "vitest";
import { EntityIOSystem, type ActivatorRef, type EntityHandle, type InputArgs } from "@game/script/EntityIOSystem";
import type { EntityConnection } from "@game/script/EntityIOTypes";

/** Handle de prueba que registra los inputs recibidos. */
function recordingHandle(name: string, key?: string): EntityHandle & { received: Array<{ input: string; args: InputArgs }> } {
  const received: Array<{ input: string; args: InputArgs }> = [];
  return {
    key,
    name,
    classId: "message",
    received,
    acceptInput(input, args) {
      received.push({ input, args });
    },
  };
}

const player: ActivatorRef = { kind: "player" };

describe("EntityIOSystem", () => {
  it("restores delayed dispatches and maxFires without duplicating outputs", () => {
    const received: string[] = [];
    const build = (): EntityIOSystem => {
      const io = new EntityIOSystem();
      io.registerEntity({
        name: "target",
        classId: "relay",
        acceptInput: (input) => received.push(input),
      });
      io.registerConnections("source", [
        {
          output: "OnTrigger",
          target: "target",
          input: "Fire",
          delay: 1,
          maxFires: 1,
        },
      ]);
      return io;
    };
    const original = build();
    original.fireOutput("source", "OnTrigger", { kind: "player" });
    original.update(0.4);
    const snapshot = original.capture();

    const restored = build();
    restored.restore(snapshot);
    restored.fireOutput("source", "OnTrigger", { kind: "player" });
    restored.update(0.59);
    expect(received).toEqual([]);
    restored.update(0.02);
    expect(received).toEqual(["Fire"]);
  });

  it("despacha inmediatamente las conexiones con delay 0", () => {
    const io = new EntityIOSystem();
    const target = recordingHandle("msg");
    io.registerEntity(target);
    io.registerConnections("trig", [{ output: "OnStartTouch", target: "msg", input: "Show" }]);

    io.fireOutput("trig", "OnStartTouch", player);

    expect(target.received).toHaveLength(1);
    expect(target.received[0].input).toBe("Show");
    expect(target.received[0].args.caller).toBe("trig");
  });

  it("encola las conexiones con delay y las despacha al vencer", () => {
    const io = new EntityIOSystem();
    const target = recordingHandle("msg");
    io.registerEntity(target);
    io.registerConnections("trig", [{ output: "OnStartTouch", target: "msg", input: "Show", delay: 1 }]);

    io.fireOutput("trig", "OnStartTouch", player);
    expect(target.received).toHaveLength(0);

    io.update(0.6);
    expect(target.received).toHaveLength(0);
    io.update(0.6);
    expect(target.received).toHaveLength(1);
  });

  it("hace fan-out a todos los handles que comparten nombre", () => {
    const io = new EntityIOSystem();
    const a = recordingHandle("shared");
    const b = recordingHandle("shared");
    io.registerEntity(a);
    io.registerEntity(b);
    io.registerConnections("trig", [{ output: "OnStartTouch", target: "shared", input: "Show" }]);

    io.fireOutput("trig", "OnStartTouch", player);

    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(1);
  });

  it("rechaza keys duplicadas sin dejar un handle parcial en el fan-out", () => {
    const io = new EntityIOSystem();
    const first = recordingHandle("first-name", "same-key");
    const rejected = recordingHandle("ghost-name", "same-key");
    io.registerEntity(first);

    expect(() => io.registerEntity(rejected)).toThrow(/key duplicada/);
    io.registerConnections("source", [{ output: "Out", target: "ghost-name", input: "Show" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    io.fireOutput("source", "Out", player);

    expect(rejected.received).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("respeta maxFires por conexión", () => {
    const io = new EntityIOSystem();
    const target = recordingHandle("msg");
    io.registerEntity(target);
    io.registerConnections("trig", [{ output: "Out", target: "msg", input: "Show", maxFires: 2 }]);

    io.fireOutput("trig", "Out", player);
    io.fireOutput("trig", "Out", player);
    io.fireOutput("trig", "Out", player);

    expect(target.received).toHaveLength(2);
  });

  it("resuelve el keyword !self al nombre de la fuente", () => {
    const io = new EntityIOSystem();
    const self = recordingHandle("relay");
    io.registerEntity(self);
    io.registerConnections("relay", [{ output: "OnTrigger", target: "!self", input: "Ping" }]);

    io.fireOutput("relay", "OnTrigger", player);

    expect(self.received[0].input).toBe("Ping");
  });

  it("resuelve !activator a la entidad que inició la cadena", () => {
    const io = new EntityIOSystem();
    const target = recordingHandle("victim");
    io.registerEntity(target);
    io.registerConnections("trap", [{ output: "OnHit", target: "!activator", input: "Kill" }]);

    io.fireOutput("trap", "OnHit", { kind: "entity", name: "victim" });

    expect(target.received[0].input).toBe("Kill");
  });

  it("resuelve !activator del jugador al handle exacto !player", () => {
    const io = new EntityIOSystem();
    const playerHandle = recordingHandle("!player", "!player");
    io.registerEntity(playerHandle);
    io.registerConnections("trap", [{ output: "OnHit", target: "!activator", input: "Kill" }]);

    io.fireOutput("trap", "OnHit", player);

    expect(playerHandle.received.map((entry) => entry.input)).toEqual(["Kill"]);
  });

  it("no explota si el target no existe (warnOnce)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const io = new EntityIOSystem();
    io.registerConnections("trig", [{ output: "Out", target: "ghost", input: "Show" }]);

    expect(() => io.fireOutput("trig", "Out", player)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);

    io.fireOutput("trig", "Out", player);
    expect(warn).toHaveBeenCalledTimes(1); // warnOnce por key
    warn.mockRestore();
  });

  it("cancelPendingFrom cancela los inputs encolados de una fuente", () => {
    const io = new EntityIOSystem();
    const target = recordingHandle("msg");
    io.registerEntity(target);
    io.registerConnections("relay", [{ output: "OnTrigger", target: "msg", input: "Show", delay: 1 }]);

    io.fireOutput("relay", "OnTrigger", player);
    io.cancelPendingFrom("relay");
    io.update(2);

    expect(target.received).toHaveLength(0);
  });

  it("clear vacía handles, conexiones y pendientes", () => {
    const io = new EntityIOSystem();
    const target = recordingHandle("msg");
    io.registerEntity(target);
    io.registerConnections("trig", [{ output: "Out", target: "msg", input: "Show", delay: 1 }]);
    io.fireOutput("trig", "Out", player);

    io.clear();
    io.update(2);

    expect(target.received).toHaveLength(0);
  });

  it("fireOutputAfter espera la operación y clear invalida callbacks viejos", async () => {
    const io = new EntityIOSystem();
    const target = recordingHandle("sink");
    io.registerEntity(target);
    io.registerConnections("spawner", [{ output: "OnSpawned", target: "sink", input: "Ready" }]);
    let complete: () => void = () => {};
    const pending = new Promise<void>((resolve) => { complete = resolve; });

    io.fireOutputAfter(pending, "spawner", "OnSpawned", player);
    expect(target.received).toHaveLength(0);
    complete();
    await pending;
    await Promise.resolve();
    expect(target.received.map((entry) => entry.input)).toEqual(["Ready"]);

    let staleComplete: () => void = () => {};
    const stale = new Promise<void>((resolve) => { staleComplete = resolve; });
    io.fireOutputAfter(stale, "spawner", "OnSpawned", player);
    io.clear();
    staleComplete();
    await stale;
    await Promise.resolve();
    expect(target.received).toHaveLength(1);
  });

  it("fireOutputAfter emite el output de fallo al rechazar", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const io = new EntityIOSystem();
    const target = recordingHandle("sink");
    io.registerEntity(target);
    io.registerConnections("spawner", [
      { output: "OnSpawnFailed", target: "sink", input: "Recover" },
    ]);

    const failure = Promise.reject(new Error("asset missing"));
    io.fireOutputAfter(failure, "spawner", "OnSpawned", player, "OnSpawnFailed");
    await failure.catch(() => undefined);
    await Promise.resolve();

    expect(target.received.map((entry) => entry.input)).toEqual(["Recover"]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("aísla conexiones y maxFires por instancia aunque compartan targetname", () => {
    const io = new EntityIOSystem();
    const sinkA = recordingHandle("sink-a");
    const sinkB = recordingHandle("sink-b");
    io.registerEntity(sinkA);
    io.registerEntity(sinkB);
    io.registerConnections({ key: "npc-a", name: "wave" }, [
      { output: "OnDeath", target: "sink-a", input: "Add", maxFires: 1 },
    ]);
    io.registerConnections({ key: "npc-b", name: "wave" }, [
      { output: "OnDeath", target: "sink-b", input: "Add", maxFires: 2 },
    ]);

    io.fireOutput({ key: "npc-a", name: "wave" }, "OnDeath", player);
    io.fireOutput({ key: "npc-a", name: "wave" }, "OnDeath", player);
    io.fireOutput({ key: "npc-b", name: "wave" }, "OnDeath", player);
    io.fireOutput({ key: "npc-b", name: "wave" }, "OnDeath", player);

    expect(sinkA.received).toHaveLength(1);
    expect(sinkB.received).toHaveLength(2);
  });

  it("!self y !caller apuntan sólo a la instancia exacta", () => {
    const io = new EntityIOSystem();
    const a = recordingHandle("shared", "a");
    const b = recordingHandle("shared", "b");
    io.registerEntity(a);
    io.registerEntity(b);
    io.registerConnections({ key: "a", name: "shared" }, [
      { output: "Out", target: "!self", input: "Self" },
      { output: "Out", target: "!caller", input: "Caller" },
    ]);

    io.fireOutput({ key: "a", name: "shared" }, "Out", player);

    expect(a.received.map((entry) => entry.input)).toEqual(["Self", "Caller"]);
    expect(b.received).toHaveLength(0);
  });

  it("soporta comodines de targetname", () => {
    const io = new EntityIOSystem();
    const a = recordingHandle("wave-a");
    const b = recordingHandle("wave-b");
    const other = recordingHandle("civilian");
    io.registerEntity(a);
    io.registerEntity(b);
    io.registerEntity(other);
    io.registerConnections("relay", [{ output: "Out", target: "wave-*", input: "Kill" }]);

    io.fireOutput("relay", "Out", player);

    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(1);
    expect(other.received).toHaveLength(0);
  });

  it("ordena delays por vencimiento y luego por orden de conexión", () => {
    const io = new EntityIOSystem();
    const order: string[] = [];
    io.registerEntity({
      name: "sink",
      classId: "message",
      acceptInput: (input) => order.push(input),
    });
    io.registerConnections("relay", [
      { output: "Out", target: "sink", input: "late-a", delay: 1 },
      { output: "Out", target: "sink", input: "early", delay: 0.5 },
      { output: "Out", target: "sink", input: "late-b", delay: 1 },
    ]);

    io.fireOutput("relay", "Out", player);
    io.update(2);

    expect(order).toEqual(["early", "late-a", "late-b"]);
  });

  it("CancelPending aísla instancias con el mismo targetname", () => {
    const io = new EntityIOSystem();
    const sink = recordingHandle("sink");
    io.registerEntity(sink);
    const connection: EntityConnection = { output: "Out", target: "sink", input: "Go", delay: 1 };
    const a = { key: "a", name: "relay" };
    const b = { key: "b", name: "relay" };
    io.registerConnections(a, [connection]);
    io.registerConnections(b, [connection]);
    io.fireOutput(a, "Out", player);
    io.fireOutput(b, "Out", player);

    io.cancelPendingFrom(a);
    io.update(2);

    expect(sink.received).toHaveLength(1);
  });
});
