import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { WeaponSoundSystem } from "@game/audio/WeaponSoundSystem";
import { fakeSoundManager } from "@tests/support/fakes/audio";

describe("WeaponSoundSystem", () => {
  it("plays mapped weapon sounds on weapon events", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager([
      "weapons.pistol.hl2.shot1",
      "weapons.smg.hl2.altFire",
      "weapons.shotgun.hl2.cock",
      "weapons.crowbar.hl2.hit1",
    ]);
    const origin = new Vector3();
    const direction = new Vector3(0, 0, -1);

    new WeaponSoundSystem(bus, sounds);

    bus.emit("weapon.fired", {
      weaponName: "9mm Pistol",
      weaponType: "hitscan",
      ammo: 17,
      origin,
      direction,
      range: 85,
    });
    bus.emit("weapon.alternate.fired", {
      weaponName: "SMG",
      origin,
      direction,
    });
    bus.emit("weapon.cocked", { weaponName: "Shotgun" });
    bus.emit("weapon.hit", {
      weaponName: "Crowbar",
      surfaceKind: "npc",
      point: origin,
      damage: 25,
    });

    expect(sounds.played).toEqual([
      { id: "weapons.pistol.hl2.shot1", options: { bus: "weapons" } },
      { id: "weapons.smg.hl2.altFire", options: { bus: "weapons" } },
      { id: "weapons.shotgun.hl2.cock", options: { bus: "weapons" } },
      { id: "weapons.crowbar.hl2.hit1", options: { bus: "weapons" } },
    ]);
  });

  it("does not play when an event has no mapped available clip", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager(["weapons.pistol.hl2.shot1"]);

    new WeaponSoundSystem(bus, sounds);

    bus.emit("weapon.reloaded", {
      weaponName: "9mm Pistol",
      ammo: 18,
      reserve: 72,
    });
    bus.emit("weapon.hit", {
      weaponName: "9mm Pistol",
      point: new Vector3(),
      damage: 18,
    });

    expect(sounds.played).toEqual([]);
  });

  it("chooses an available variant from mapped sound arrays", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager(["weapons.revolver.hl2.shot2"]);

    new WeaponSoundSystem(bus, sounds);

    bus.emit("weapon.fired", {
      weaponName: ".357 Magnum",
      weaponType: "hitscan",
      ammo: 5,
      origin: new Vector3(),
      direction: new Vector3(0, 0, -1),
      range: 100,
    });

    expect(sounds.played).toEqual([
      { id: "weapons.revolver.hl2.shot2", options: { bus: "weapons" } },
    ]);
  });
});
