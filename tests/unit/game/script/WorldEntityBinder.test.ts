import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { EntityIOSystem } from "@game/script/EntityIOSystem";
import { bindWorldEntities, type WorldEntityHooks } from "@game/script/WorldEntityBinder";

function hooks(overrides: Partial<WorldEntityHooks> = {}): WorldEntityHooks {
  return {
    showDialogue: () => {},
    spawnNpcs: () => {},
    setDoorOpen: () => {},
    toggleDoor: () => {},
    runLevelAction: () => {},
    updateObjective: () => {},
    activateSoundscape: () => {},
    playAmbientSound: () => {},
    stopAmbientSound: () => {},
    toggleAmbientSound: () => {},
    endLevel: () => {},
    setTriggerEnabled: () => {},
    toggleTrigger: () => {},
    killPlayer: () => {},
    teleportPlayer: () => {},
    ...overrides,
  };
}

describe("WorldEntityBinder", () => {
  it("OnSpawned espera a que el spawn asíncrono termine", async () => {
    const io = new EntityIOSystem();
    const shown: string[] = [];
    let finish: () => void = () => {};
    const spawn = new Promise<void>((resolve) => { finish = resolve; });
    bindWorldEntities(io, {
      doors: [],
      triggers: [],
      logic: [
        {
          kind: "npcSpawner",
          id: "spawner-id",
          name: "spawner",
          npcs: [],
          connections: [{ output: "OnSpawned", target: "ready", input: "Show" }],
        },
        { kind: "message", id: "ready", name: "ready", text: "ready", duration: 1 },
      ],
    }, hooks({
      spawnNpcs: () => spawn,
      showDialogue: (text) => shown.push(text),
    }));
    io.registerConnections("starter", [{ output: "Go", target: "spawner", input: "Spawn" }]);

    io.fireOutput("starter", "Go", { kind: "player" });
    expect(shown).toEqual([]);
    finish();
    await spawn;
    await Promise.resolve();

    expect(shown).toEqual(["ready"]);
  });

  it("OnSpawnFailed permite una rama de recuperación", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const io = new EntityIOSystem();
    const shown: string[] = [];
    bindWorldEntities(io, {
      doors: [],
      triggers: [],
      logic: [
        {
          kind: "npcSpawner",
          id: "spawner-id",
          name: "spawner",
          npcs: [],
          connections: [{ output: "OnSpawnFailed", target: "failed", input: "Show" }],
        },
        { kind: "message", id: "failed", name: "failed", text: "failed", duration: 1 },
      ],
    }, hooks({
      spawnNpcs: () => Promise.reject(new Error("missing asset")),
      showDialogue: (text) => shown.push(text),
    }));
    io.registerConnections("starter", [{ output: "Go", target: "spawner", input: "Spawn" }]);

    io.fireOutput("starter", "Go", { kind: "player" });
    await Promise.resolve();
    await Promise.resolve();

    expect(shown).toEqual(["failed"]);
    warn.mockRestore();
  });

  it("OnSpawnFailed tambien captura excepciones sincronicas del spawner", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const io = new EntityIOSystem();
    const shown: string[] = [];
    bindWorldEntities(io, {
      doors: [],
      triggers: [],
      logic: [
        {
          kind: "npcSpawner",
          id: "spawner-id",
          name: "spawner",
          npcs: [],
          connections: [{ output: "OnSpawnFailed", target: "failed", input: "Show" }],
        },
        { kind: "message", id: "failed", name: "failed", text: "failed", duration: 1 },
      ],
    }, hooks({
      spawnNpcs: () => { throw new Error("factory unavailable"); },
      showDialogue: (text) => shown.push(text),
    }));
    io.registerConnections("starter", [{ output: "Go", target: "spawner", input: "Spawn" }]);

    expect(() => io.fireOutput("starter", "Go", { kind: "player" })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(shown).toEqual(["failed"]);
    warn.mockRestore();
  });

  it("!player recibe Kill y Teleport a markers", () => {
    const io = new EntityIOSystem();
    const killPlayer = vi.fn();
    const teleportPlayer = vi.fn();
    bindWorldEntities(io, {
      doors: [],
      triggers: [],
      logic: [{ kind: "marker", id: "destination", name: "destination", position: [4, 2, 8] }],
    }, hooks({ killPlayer, teleportPlayer }));
    io.registerConnections("controller", [
      { output: "Kill", target: "!player", input: "Kill" },
      { output: "Teleport", target: "!player", input: "Teleport", param: "destination" },
    ]);

    io.fireOutput("controller", "Kill", { kind: "none" });
    io.fireOutput("controller", "Teleport", { kind: "none" });

    expect(killPlayer).toHaveBeenCalledOnce();
    expect(teleportPlayer).toHaveBeenCalledWith(new Vector3(4, 2, 8));
  });
});
