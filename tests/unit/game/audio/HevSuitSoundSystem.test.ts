import { describe, expect, it } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import { HevSuitSoundSystem } from "@game/audio/HevSuitSoundSystem";
import type { HevVoice, HevVoiceRequest } from "@game/audio/HevVoiceQueue";
import type { GameEventMap } from "@game/GameEvents";
import { fakeSoundManager } from "@tests/support/fakes/audio";

function fakeVoice(): HevVoice & { readonly requests: HevVoiceRequest[] } {
  const requests: HevVoiceRequest[] = [];
  return {
    requests,
    request: (req) => {
      requests.push(req);
    },
    warm: () => undefined,
    dispose: () => undefined,
  };
}

describe("HevSuitSoundSystem", () => {
  it("plays device beeps immediately and manages charger loops", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager([
      "hev.items.suitCharge",
      "hev.items.suitChargeOk",
    ]);
    const voice = fakeVoice();

    new HevSuitSoundSystem(bus, sounds, voice);

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
    // Los beeps de dispositivo no pasan por la cola de voz.
    expect(voice.requests).toEqual([]);
  });

  it("routes vital warnings to the voice queue with priority and dedup keys", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager();
    const voice = fakeVoice();

    new HevSuitSoundSystem(bus, sounds, voice);

    bus.emit("player.health.changed", { current: 100, max: 100 });
    bus.emit("player.health.changed", { current: 24, max: 100 });
    bus.emit("player.health.changed", { current: 9, max: 100 });
    bus.emit("player.armor.changed", { current: 10, max: 100 });
    bus.emit("player.armor.changed", { current: 0, max: 100 });
    bus.emit("player.armor.changed", { current: 5, max: 100 });

    expect(voice.requests.map((req) => req.key)).toEqual([
      "healthCritical",
      "nearDeath",
      "armorGone",
      "powerRestored",
    ]);
    // nearDeath supera en prioridad a healthCritical.
    const nearDeath = voice.requests.find((req) => req.key === "nearDeath");
    const healthCritical = voice.requests.find((req) => req.key === "healthCritical");
    expect(nearDeath?.priority).toBeGreaterThan(healthCritical?.priority ?? 0);
  });

  it("routes hazards, stamina and death; death interrupts the queue", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager();
    const voice = fakeVoice();

    new HevSuitSoundSystem(bus, sounds, voice);

    bus.emit("player.stamina.changed", { current: 100, max: 100, depleted: false });
    bus.emit("player.stamina.changed", { current: 0, max: 100, depleted: true });
    bus.emit("player.hazard", { amount: 4, kind: "fire", instant: false });
    bus.emit("player.hazard", { amount: 3, kind: "toxic", instant: false });
    bus.emit("player.dead", { reason: "damage" });

    expect(voice.requests.map((req) => req.key)).toEqual([
      "aux",
      "hazard:fire",
      "hazard:toxic",
      "death",
    ]);
    const death = voice.requests.find((req) => req.key === "death");
    expect(death?.interrupt).toBe(true);
  });

  it("stays silent about damage while healthy or on trivial hits (Half-Life gating)", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager();
    const voice = fakeVoice();

    new HevSuitSoundSystem(bus, sounds, voice);

    // Vida alta: el traje no comenta el daño.
    bus.emit("player.health.changed", { current: 100, max: 100 });
    bus.emit("player.damaged", { amount: 20, damageType: "bullet" });
    expect(voice.requests).toEqual([]);

    // Herido: ahora sí diagnostica, salvo golpes triviales (< 5).
    bus.emit("player.health.changed", { current: 50, max: 100 });
    bus.emit("player.damaged", { amount: 3, damageType: "bullet" });
    expect(voice.requests).toEqual([]);
  });

  it("picks the diagnosis line by damage type, with a major variant and 30s no-repeat", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager();
    const voice = fakeVoice();

    new HevSuitSoundSystem(bus, sounds, voice);

    bus.emit("player.health.changed", { current: 50, max: 100 });
    bus.emit("player.damaged", { amount: 10, damageType: "bullet" });
    bus.emit("player.damaged", { amount: 40, damageType: "melee" });
    bus.emit("player.damaged", { amount: 10, damageType: "physics" });

    expect(voice.requests.map((req) => req.ids)).toEqual([
      "hev.fvox.bloodLoss",
      "hev.fvox.majorLacerations",
      "hev.fvox.minorFracture",
    ]);
    expect(voice.requests.every((req) => req.noRepeatSeconds === 30)).toBe(true);
    // Cada línea lleva su propia key para no pisar la ventana de otra.
    expect(voice.requests[0]?.key).toBe("hev.fvox.bloodLoss");
  });
});
