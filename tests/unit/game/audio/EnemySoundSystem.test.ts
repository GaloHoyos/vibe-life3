import { describe, expect, it } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { EnemySoundSystem } from "@game/audio/EnemySoundSystem";
import { fakeSoundManager } from "@tests/support/fakes/audio";

describe("EnemySoundSystem", () => {
  it("plays mapped enemy sounds on npc events", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager([
      "enemies.zombie.alert",
      "enemies.zombie.damaged",
    ]);

    new EnemySoundSystem(bus, sounds);

    bus.emit("npc.alert", { id: "z-1", characterId: "zombie" });
    bus.emit("npc.damaged", {
      id: "z-1",
      characterId: "zombie",
      amount: 12,
      health: 40,
    });

    expect(sounds.played).toEqual([
      { id: "enemies.zombie.alert", options: { bus: "enemies" } },
      { id: "enemies.zombie.damaged", options: { bus: "enemies" } },
    ]);
  });

  it("ignores unmapped or unavailable sounds", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager(["enemies.zombie.alert"]);

    new EnemySoundSystem(bus, sounds);

    bus.emit("npc.damaged", {
      id: "z-1",
      characterId: "zombie",
      amount: 5,
      health: 95,
    });
    bus.emit("npc.killed", { id: "z-1", characterId: "unknown-enemy" });

    expect(sounds.played).toEqual([]);
  });
});
