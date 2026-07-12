import { describe, expect, it } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { EntityEventBridge } from "@game/script/EntityEventBridge";
import { EntityIOSystem, type EntityHandle } from "@game/script/EntityIOSystem";

function handle(key: string, name: string): EntityHandle & { inputs: string[] } {
  const inputs: string[] = [];
  return {
    key,
    name,
    classId: name === "!player" ? "player" : "npc",
    inputs,
    acceptInput: (input) => inputs.push(input),
  };
}

describe("EntityEventBridge", () => {
  it("propaga al jugador como activator exacto de un trigger", () => {
    const bus = new EventBus<GameEventMap>();
    const io = new EntityIOSystem();
    const player = handle("!player", "!player");
    io.registerEntity(player);
    io.registerConnections({ key: "trigger-id", name: "trigger-name" }, [
      { output: "OnStartTouch", target: "!activator", input: "Kill" },
    ]);
    new EntityEventBridge(bus, io, {
      triggerSource: () => ({ key: "trigger-id", name: "trigger-name" }),
      doorSource: () => null,
      npcSource: () => null,
    });

    bus.emit("trigger.entered", { id: "trigger-id" });

    expect(player.inputs).toEqual(["Kill"]);
  });

  it("OnDeath conserva al killer exacto entre NPCs con targetname compartido", () => {
    const bus = new EventBus<GameEventMap>();
    const io = new EntityIOSystem();
    const victim = handle("victim-id", "wave");
    const killer = handle("killer-id", "wave");
    io.registerEntity(victim);
    io.registerEntity(killer);
    io.registerConnections({ key: "victim-id", name: "wave" }, [
      { output: "OnDeath", target: "!activator", input: "Celebrate" },
    ]);
    const sources = new Map([
      ["victim-id", { key: "victim-id", name: "wave" }],
      ["killer-id", { key: "killer-id", name: "wave" }],
    ]);
    new EntityEventBridge(bus, io, {
      triggerSource: () => null,
      doorSource: () => null,
      npcSource: (id) => sources.get(id) ?? null,
    });

    bus.emit("npc.killed", {
      id: "victim-id",
      characterId: "combine",
      attackerId: "killer-id",
    });

    expect(victim.inputs).toHaveLength(0);
    expect(killer.inputs).toEqual(["Celebrate"]);
  });

  it("la puerta es activator de sus propios outputs de transición", () => {
    const bus = new EventBus<GameEventMap>();
    const io = new EntityIOSystem();
    const door = handle("door-id", "door-name");
    io.registerEntity(door);
    io.registerConnections({ key: "door-id", name: "door-name" }, [
      { output: "OnOpen", target: "!activator", input: "Opened" },
    ]);
    new EntityEventBridge(bus, io, {
      triggerSource: () => null,
      doorSource: () => ({ key: "door-id", name: "door-name" }),
      npcSource: () => null,
    });

    bus.emit("door.opened", { id: "door-id", open: true });

    expect(door.inputs).toEqual(["Opened"]);
  });

  it("OnOpen preserva al jugador que activó la puerta", () => {
    const bus = new EventBus<GameEventMap>();
    const io = new EntityIOSystem();
    const player = handle("!player", "!player");
    io.registerEntity(player);
    io.registerConnections({ key: "door-id", name: "door-name" }, [
      { output: "OnOpen", target: "!activator", input: "Continue" },
    ]);
    new EntityEventBridge(bus, io, {
      triggerSource: () => null,
      doorSource: () => ({ key: "door-id", name: "door-name" }),
      npcSource: () => null,
    });

    bus.emit("door.opened", {
      id: "door-id",
      open: true,
      activator: { kind: "player" },
    });

    expect(player.inputs).toEqual(["Continue"]);
  });
});
