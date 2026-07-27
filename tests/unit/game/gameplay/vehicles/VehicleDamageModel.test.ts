import { describe, expect, it, vi } from "vitest";
import type { VehicleDamageZonePreset } from "@game/config/vehicles.config";
import {
  VehicleDamageModel,
  type VehicleDamageCallbacks,
} from "@game/gameplay/vehicles/VehicleDamageModel";

const zones: readonly VehicleDamageZonePreset[] = [
  { id: "hull", health: 400, damageMultiplier: 1 },
  { id: "engine", health: 100, damageMultiplier: 1, disableAtZero: true },
  { id: "rotor", health: 120, damageMultiplier: 1, disableAtZero: true },
  { id: "fuel", health: 80, damageMultiplier: 1 },
];

describe("VehicleDamageModel", () => {
  it("exige una zona de hull", () => {
    expect(
      () =>
        new VehicleDamageModel(
          "buggy",
          [{ id: "engine", health: 10, damageMultiplier: 1 }],
          callbacks(),
        ),
    ).toThrow(/hull/);
  });

  it("escala el daño por tipo y multiplicador de zona", () => {
    const model = new VehicleDamageModel(
      "buggy",
      [{ id: "hull", health: 400, damageMultiplier: 2 }],
      callbacks(),
    );

    model.applyDamage(50, undefined, "hull", "player", undefined, "melee");

    // 50 * 2 (zona) * 0.22 (melee) = 22
    expect(model.getHull().current).toBeCloseTo(378, 5);
  });

  it("sangra daño de componente al hull, más fuerte si es explosivo", () => {
    const bullet = new VehicleDamageModel("buggy", zones, callbacks());
    const explosive = new VehicleDamageModel("buggy", zones, callbacks());

    bullet.applyDamage(40, undefined, "engine", "player", undefined, "bullet");
    explosive.applyDamage(
      40,
      undefined,
      "engine",
      "player",
      undefined,
      "explosive",
    );

    expect(bullet.getHull().current).toBeCloseTo(400 - 40 * 0.28, 5);
    expect(explosive.getHull().current).toBeCloseTo(400 - 50 * 0.65, 5);
    expect(explosive.getHull().current).toBeLessThan(bullet.getHull().current);
  });

  it("un impacto sin zona conocida cae al hull sin perder atribución", () => {
    const events = callbacks();
    const model = new VehicleDamageModel("buggy", zones, events);

    model.applyDamage(30, undefined, "parabrisas", "combine-01");

    expect(events.onDamaged).toHaveBeenCalledWith(
      30,
      "hull",
      "combine-01",
      undefined,
    );
    expect(model.getHull().current).toBeCloseTo(370, 5);
  });

  it("el buggy se deshabilita al perder el motor y el helicóptero crashea", () => {
    const buggyEvents = callbacks();
    const buggy = new VehicleDamageModel("buggy", zones, buggyEvents);
    const heliEvents = callbacks();
    const helicopter = new VehicleDamageModel("helicopter", zones, heliEvents);

    buggy.applyDamage(999, undefined, "engine");
    helicopter.applyDamage(999, undefined, "rotor");

    expect(buggy.getState()).toBe("disabled");
    expect(buggyEvents.onDisabled).toHaveBeenCalledTimes(1);
    expect(buggyEvents.onCrashRequested).not.toHaveBeenCalled();

    expect(helicopter.getState()).toBe("crashing");
    expect(heliEvents.onCrashRequested).toHaveBeenCalledTimes(1);
    expect(heliEvents.onDisabled).not.toHaveBeenCalled();
  });

  it("arde al quedarse sin combustible y deja de arder al reparar", () => {
    const model = new VehicleDamageModel("buggy", zones, callbacks());

    model.applyDamage(999, undefined, "fuel");
    expect(model.isBurning()).toBe(true);

    model.repair(1000);
    expect(model.isBurning()).toBe(false);
    expect(model.getState()).toBe("operational");
    expect(model.getZoneFraction("fuel")).toBeCloseTo(1, 5);
  });

  it("destruido ignora daño posterior y no revive con repair", () => {
    const events = callbacks();
    const model = new VehicleDamageModel("buggy", zones, events);

    model.applyDamage(9999, undefined, "hull");
    expect(model.getState()).toBe("destroyed");
    expect(model.isAlive()).toBe(false);

    model.applyDamage(50, undefined, "hull");
    model.repair(500);

    expect(events.onDestroyed).toHaveBeenCalledTimes(1);
    expect(model.getState()).toBe("destroyed");
  });

  it("el snapshot restaura estado, zonas e incendio", () => {
    const model = new VehicleDamageModel("buggy", zones, callbacks());
    model.applyDamage(120, undefined, "hull");
    model.applyDamage(60, undefined, "engine");
    const snapshot = model.capture();

    const restored = new VehicleDamageModel("buggy", zones, callbacks());
    restored.restore(snapshot);

    expect(restored.capture()).toEqual(snapshot);
    expect(restored.getComponents()).toEqual(model.getComponents());
  });

  it("requestCrash sólo dispara una vez y enciende el fuego", () => {
    const events = callbacks();
    const model = new VehicleDamageModel("helicopter", zones, events);

    model.requestCrash();
    model.requestCrash();

    expect(events.onCrashRequested).toHaveBeenCalledTimes(1);
    expect(model.isBurning()).toBe(true);
    expect(model.getState()).toBe("crashing");

    model.finishCrash();
    expect(events.onDestroyed).toHaveBeenCalledTimes(1);
    expect(model.isAlive()).toBe(false);
  });
});

function callbacks() {
  return {
    onDamaged: vi.fn<VehicleDamageCallbacks["onDamaged"]>(),
    onDisabled: vi.fn<VehicleDamageCallbacks["onDisabled"]>(),
    onCrashRequested: vi.fn<VehicleDamageCallbacks["onCrashRequested"]>(),
    onDestroyed: vi.fn<VehicleDamageCallbacks["onDestroyed"]>(),
  };
}
