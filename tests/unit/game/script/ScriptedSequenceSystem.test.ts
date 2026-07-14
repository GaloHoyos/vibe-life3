import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import type { INpc } from "@game/npc/core/INpc";
import { EntityIOSystem, type ActivatorRef, type EntityHandle, type InputArgs } from "@game/script/EntityIOSystem";
import { NpcDirectory } from "@game/script/NpcDirectory";
import { ScriptedSequenceSystem } from "@game/script/ScriptedSequenceSystem";
import type { ScriptedSequenceDefinition } from "@game/script/ScriptedSequenceTypes";

function fakeNpc(id: string): INpc {
  return { id, isAlive: () => true } as unknown as INpc;
}

function sink(name: string, key?: string): EntityHandle & { inputs: string[] } {
  const inputs: string[] = [];
  return { key, name, classId: "message", inputs, acceptInput: (input) => inputs.push(input) };
}

const none: ActivatorRef = { kind: "none" };

function setup(def: Partial<ScriptedSequenceDefinition> = {}) {
  const io = new EntityIOSystem();
  const directory = new NpcDirectory();
  directory.register("alyx", fakeNpc("alyx-1"));
  const markers = new Map([["console", new Vector3(5, 0, 5)]]);
  const bus = new EventBus<GameEventMap>();
  const system = new ScriptedSequenceSystem(io, directory, markers, bus);

  const sequence: ScriptedSequenceDefinition = {
    id: "seq",
    name: "seq",
    targetNpc: "alyx",
    position: [5, 0, 5],
    moveMode: "walk",
    steps: [{ kind: "waitForCue" }],
    connections: [{ output: "OnBegin", target: "beginSink", input: "Begin" }],
    ...def,
  };
  system.register(sequence);

  return { io, system, sequence };
}

describe("ScriptedSequenceSystem", () => {
  it("Start publica la orden para el NPC y dispara OnBegin", () => {
    const { io, system } = setup();
    const begin = sink("beginSink");
    io.registerEntity(begin);

    io.registerConnections("starter", [{ output: "Go", target: "seq", input: "Start" }]);
    io.fireOutput("starter", "Go", none);

    const order = system.orderFor("alyx-1");
    expect(order).not.toBeNull();
    expect(order?.moveMode).toBe("walk");
    expect(begin.inputs).toContain("Begin");
  });

  it("Cue levanta la señal que consume waitForCue", () => {
    const { io, system } = setup();
    io.registerEntity(sink("beginSink"));
    io.registerConnections("ctrl", [
      { output: "Start", target: "seq", input: "Start" },
      { output: "Cue", target: "seq", input: "Cue" },
    ]);

    io.fireOutput("ctrl", "Start", none);
    const order = system.orderFor("alyx-1");
    expect(order?.isCuePending()).toBe(false);

    io.fireOutput("ctrl", "Cue", none);
    expect(order?.isCuePending()).toBe(true);
  });

  it("Cancel dispara OnCanceled y limpia la orden", () => {
    const { io, system } = setup({
      connections: [{ output: "OnCanceled", target: "cancelSink", input: "Cancelled" }],
    });
    const cancel = sink("cancelSink");
    io.registerEntity(cancel);
    io.registerConnections("ctrl", [
      { output: "Start", target: "seq", input: "Start" },
      { output: "Cancel", target: "seq", input: "Cancel" },
    ]);

    io.fireOutput("ctrl", "Start", none);
    io.fireOutput("ctrl", "Cancel", none);

    expect(cancel.inputs).toContain("Cancelled");
    expect(system.orderFor("alyx-1")).toBeNull();
  });

  it("una secuencia no repetible no re-arranca tras terminar", () => {
    const { io, system } = setup({ repeatable: false });
    io.registerEntity(sink("beginSink"));
    io.registerConnections("ctrl", [{ output: "Start", target: "seq", input: "Start" }]);

    io.fireOutput("ctrl", "Start", none);
    const order = system.orderFor("alyx-1");
    order?.notifyDone("completed");
    expect(system.orderFor("alyx-1")).toBeNull();

    io.fireOutput("ctrl", "Start", none);
    expect(system.orderFor("alyx-1")).toBeNull();
  });

  it("conserva el activator original hasta OnEnd", () => {
    const { io, system } = setup({
      connections: [{ output: "OnEnd", target: "!activator", input: "Done" }],
    });
    const activator = sink("activator", "activator-id");
    io.registerEntity(activator);
    io.registerConnections("ctrl", [{ output: "Start", target: "seq", input: "Start" }]);

    io.fireOutput("ctrl", "Start", { kind: "entity", key: "activator-id", name: "activator" });
    system.orderFor("alyx-1")?.notifyDone("completed");

    expect(activator.inputs).toEqual(["Done"]);
  });
});
