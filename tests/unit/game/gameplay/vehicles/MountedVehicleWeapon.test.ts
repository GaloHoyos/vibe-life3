import { describe, expect, it, vi } from "vitest";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { RaycastHit, RaycastSource } from "@engine/physics/Raycast";
import type { VehicleMountedWeaponPreset } from "@game/config/vehicles.config";
import type { GameEventMap } from "@game/GameEvents";
import { MountedVehicleWeapon } from "@game/gameplay/vehicles/MountedVehicleWeapon";

const preset: VehicleMountedWeaponPreset = {
  kind: "doorGun",
  damage: 12,
  fireRate: 10,
  range: 120,
  heatPerShot: 0.3,
  coolingPerSecond: 0.5,
  yawLimit: Math.PI,
  pitchMin: -Math.PI / 4,
  pitchMax: Math.PI / 4,
};

const ORIGIN = new Vector3(0, 2, 0);
const AIM = new Vector3(0, 0, 1);

describe("MountedVehicleWeapon", () => {
  it("respeta la cadencia entre disparos", () => {
    const { weapon } = createWeapon();

    expect(weapon.tryFire(0, ORIGIN, AIM, "player")).toBe(true);
    expect(weapon.tryFire(0.05, ORIGIN, AIM, "player")).toBe(false);
    expect(weapon.tryFire(0.1, ORIGIN, AIM, "player")).toBe(true);
  });

  it("se sobrecalienta y sólo vuelve tras enfriar", () => {
    const { weapon } = createWeapon();

    let elapsed = 0;
    for (let shot = 0; shot < 4; shot += 1) {
      weapon.tryFire(elapsed, ORIGIN, AIM, "player");
      elapsed += 0.1;
    }

    expect(weapon.getHeat()).toBe(1);
    expect(weapon.tryFire(elapsed, ORIGIN, AIM, "player")).toBe(false);

    // 0.5/s de enfriado: un segundo no alcanza para bajar de 0.42.
    weapon.update(1);
    expect(weapon.tryFire(elapsed + 1, ORIGIN, AIM, "player")).toBe(false);
    weapon.update(1);
    expect(weapon.tryFire(elapsed + 2, ORIGIN, AIM, "player")).toBe(true);
  });

  it("no dispara contra un aliado y no gasta munición", () => {
    const ally = hit("resistance");
    const { weapon, events } = createWeapon(ally);
    const ammoBefore = weapon.getAmmo();

    expect(weapon.tryFire(0, ORIGIN, AIM, "player")).toBe(false);
    expect(weapon.getAmmo()).toBe(ammoBefore);
    expect(events).toHaveLength(0);
  });

  it("aplica daño y emite disparo y ruido contra un hostil", () => {
    const target = hit("combine");
    const { weapon, events } = createWeapon(target);

    expect(weapon.tryFire(0, ORIGIN, AIM, "player")).toBe(true);

    expect(target.metadata?.damageable?.applyDamage).toHaveBeenCalledWith(
      preset.damage,
      expect.any(Vector3),
      undefined,
      "player",
      target.point,
      "bullet",
    );
    expect(events.map((event) => event.name)).toEqual([
      "weapon.fired",
      "world.noise",
      "weapon.hit",
    ]);
  });

  it("se queda sin munición y deja de estar disponible", () => {
    const { weapon } = createWeapon();
    weapon.restore({ ammo: 1, heat: 0, enabled: true, overheated: false });

    expect(weapon.tryFire(0, ORIGIN, AIM, "player")).toBe(true);
    expect(weapon.getAmmo()).toBe(0);
    expect(weapon.isEnabled()).toBe(false);
    expect(weapon.tryFire(10, ORIGIN, AIM, "player")).toBe(false);
  });

  it("deshabilitada no dispara y el snapshot conserva calor y munición", () => {
    const { weapon } = createWeapon();
    weapon.tryFire(0, ORIGIN, AIM, "player");
    weapon.setEnabled(false);

    expect(weapon.tryFire(1, ORIGIN, AIM, "player")).toBe(false);

    const snapshot = weapon.capture();
    expect(snapshot).toMatchObject({ enabled: false, overheated: false });
    expect(snapshot.heat).toBeCloseTo(preset.heatPerShot, 5);

    const { weapon: restored } = createWeapon();
    restored.restore(snapshot);
    expect(restored.capture()).toEqual(snapshot);
  });
});

function createWeapon(target: RaycastHit | null = null): {
  weapon: MountedVehicleWeapon;
  events: { name: string }[];
} {
  const eventBus = new EventBus<GameEventMap>();
  const events: { name: string }[] = [];
  eventBus.on("weapon.fired", () => events.push({ name: "weapon.fired" }));
  eventBus.on("weapon.hit", () => events.push({ name: "weapon.hit" }));
  eventBus.on("world.noise", () => events.push({ name: "world.noise" }));

  const raycast: RaycastSource = { cast: vi.fn(() => target) };
  const weapon = new MountedVehicleWeapon(
    "heli-01",
    "resistance",
    {} as RAPIER.RigidBody,
    preset,
    raycast,
    eventBus,
  );
  return { weapon, events };
}

function hit(faction: "resistance" | "combine"): RaycastHit {
  return {
    collider: {} as RaycastHit["collider"],
    metadata: {
      id: `target-${faction}`,
      kind: "npc",
      faction,
      damageable: { applyDamage: vi.fn(), isAlive: () => true },
    },
    point: new Vector3(0, 2, 20),
    normal: new Vector3(0, 0, -1),
    toi: 20,
  };
}
