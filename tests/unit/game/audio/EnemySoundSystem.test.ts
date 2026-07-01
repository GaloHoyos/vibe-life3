import { describe, expect, it } from "vitest";
import { Object3D } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { EnemySoundSystem } from "@game/audio/EnemySoundSystem";
import { fakePositionalSounds, fakeSoundManager } from "@tests/support/fakes/audio";

describe("EnemySoundSystem", () => {
  it("plays mapped enemy sounds on npc events", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager([
      "enemies.zombie.alert",
      "enemies.zombie.damaged",
    ]);

    new EnemySoundSystem(bus, sounds, fakePositionalSounds());

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

    new EnemySoundSystem(bus, sounds, fakePositionalSounds());

    bus.emit("npc.damaged", {
      id: "z-1",
      characterId: "zombie",
      amount: 5,
      health: 95,
    });
    bus.emit("npc.killed", { id: "z-1", characterId: "unknown-enemy" });

    expect(sounds.played).toEqual([]);
  });

  it("plays turret clips without falling back to zombie vocals", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager([
      "enemies.zombie.alert",
      "enemies.turret.hl2.alert",
    ]);

    new EnemySoundSystem(bus, sounds, fakePositionalSounds());

    bus.emit("npc.alert", { id: "turret-1", characterId: "floorTurret" });

    expect(sounds.played).toEqual([
      { id: "enemies.turret.hl2.alert", options: { bus: "enemies" } },
    ]);
  });

  it("chooses an available variant from mapped sound arrays", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager(["enemies.combine.hl2.alert2"]);

    new EnemySoundSystem(bus, sounds, fakePositionalSounds());

    bus.emit("npc.alert", { id: "combine-1", characterId: "combine" });

    expect(sounds.played).toEqual([
      { id: "enemies.combine.hl2.alert2", options: { bus: "enemies" } },
    ]);
  });

  it("plays mapped npc footstep variants", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager(["enemies.strider.hl2.step4"]);

    new EnemySoundSystem(bus, sounds, fakePositionalSounds());

    bus.emit("npc.footstep", { id: "strider-1", characterId: "strider" });

    expect(sounds.played).toEqual([
      { id: "enemies.strider.hl2.step4", options: { bus: "enemies" } },
    ]);
  });

  it("plays registered actor events following the actor object", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager(["enemies.gunship.hl2.fire"]);
    const positional = fakePositionalSounds();
    const actor = new Object3D();

    const system = new EnemySoundSystem(bus, sounds, positional);
    system.registerActor("gunship-1", actor, "gunship");

    bus.emit("npc.attack", { id: "gunship-1", characterId: "gunship" });

    expect(positional.followed).toEqual([
      {
        id: "enemies.gunship.hl2.fire",
        object: actor,
        options: {
          bus: "enemies",
          refDistance: 4,
          maxDistance: 45,
          rolloffFactor: 1.1,
        },
      },
    ]);
    expect(positional.playedAt).toEqual([]);
    expect(sounds.played).toEqual([]);
  });

  it("attaches and stops flight loops for registered flying enemies", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager(["enemies.gunship.hl2.engine"]);
    const positional = fakePositionalSounds();
    const actor = new Object3D();

    const system = new EnemySoundSystem(bus, sounds, positional);
    system.registerActor("gunship-1", actor, "gunship");

    expect(positional.attachedCalls).toEqual([
      {
        id: "enemies.gunship.hl2.engine",
        object: actor,
        options: {
          bus: "enemies",
          loop: true,
          refDistance: 6,
          maxDistance: 60,
          rolloffFactor: 1,
        },
      },
    ]);

    system.unregisterActor("gunship-1");

    expect(positional.stopped).toEqual([actor]);
  });
});
