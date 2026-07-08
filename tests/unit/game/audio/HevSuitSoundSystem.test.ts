import { describe, expect, it } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import { HevSuitSoundSystem } from "@game/audio/HevSuitSoundSystem";
import type { GameEventMap } from "@game/GameEvents";
import { fakeSoundManager } from "@tests/support/fakes/audio";

describe("HevSuitSoundSystem", () => {
  it("plays pickup cues and manages charger loops", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager([
      "hev.items.suitCharge",
      "hev.items.suitChargeOk",
    ]);

    new HevSuitSoundSystem(bus, sounds);

    bus.emit("player.pickup.armor", { amount: 15 });
    bus.emit("charger.started", { id: "charger-1", kind: "armor" });
    bus.emit("charger.started", { id: "charger-1", kind: "armor" });
    bus.emit("charger.stopped", { id: "charger-1", kind: "armor", depleted: true });

    expect(sounds.played).toEqual([
      { id: "hev.items.suitChargeOk", options: {} },
      { id: "hev.items.suitCharge", options: { bus: "ui", fadeIn: 0.08, loop: true } },
      { id: "hev.items.suitChargeOk", options: {} },
    ]);
    expect(sounds.fadedOut).toEqual([{ id: "hev.items.suitCharge", duration: 0.12 }]);
  });

  it("plays critical suit warnings from player vitals", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager([
      "hev.fvox.healthCritical",
      "hev.fvox.nearDeath",
      "hev.fvox.armorGone",
      "hev.fvox.powerRestored",
    ]);

    new HevSuitSoundSystem(bus, sounds);

    bus.emit("player.health.changed", { current: 100, max: 100 });
    bus.emit("player.health.changed", { current: 24, max: 100 });
    bus.emit("player.health.changed", { current: 9, max: 100 });
    bus.emit("player.armor.changed", { current: 10, max: 100 });
    bus.emit("player.armor.changed", { current: 0, max: 100 });
    bus.emit("player.armor.changed", { current: 5, max: 100 });

    expect(sounds.played).toEqual([
      { id: "hev.fvox.healthCritical", options: {} },
      { id: "hev.fvox.nearDeath", options: {} },
      { id: "hev.fvox.armorGone", options: {} },
      { id: "hev.fvox.powerRestored", options: {} },
    ]);
  });

  it("plays hazard, stamina and death cues", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager([
      "hev.player.sprint",
      "hev.fvox.heatDamage",
      "hev.fvox.biohazard",
      "hev.fvox.criticalFail",
    ]);

    new HevSuitSoundSystem(bus, sounds);

    bus.emit("player.stamina.changed", { current: 100, max: 100, depleted: false });
    bus.emit("player.stamina.changed", { current: 0, max: 100, depleted: true });
    bus.emit("player.hazard", { amount: 4, kind: "fire", instant: false });
    bus.emit("player.hazard", { amount: 3, kind: "toxic", instant: false });
    bus.emit("player.dead", { reason: "damage" });

    expect(sounds.played).toEqual([
      { id: "hev.player.sprint", options: {} },
      { id: "hev.fvox.heatDamage", options: {} },
      { id: "hev.fvox.biohazard", options: {} },
      { id: "hev.fvox.criticalFail", options: {} },
    ]);
  });
});
