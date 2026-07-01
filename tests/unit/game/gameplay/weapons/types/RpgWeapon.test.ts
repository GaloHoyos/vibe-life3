import { describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { Raycast } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";
import type { BoltSystem } from "@game/gameplay/weapons/bolt/BoltSystem";
import type { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";
import { createWeapon } from "@game/gameplay/weapons/core/WeaponFactory";
import { AmmoInventory } from "@game/gameplay/weapons/core/AmmoInventory";
import { WeaponInventory } from "@game/gameplay/weapons/core/WeaponInventory";
import type { WeaponContext } from "@game/gameplay/weapons/core/Weapon";
import { recordEvents } from "@tests/support/events";

function setup() {
  const bus = new EventBus<GameEventMap>();
  const ammo = new AmmoInventory();
  const inventory = new WeaponInventory(bus, ammo);
  ammo.addForWeapon("rpg", 1);
  const activeRockets = new Set<string>();
  let nextRocket = 0;
  const rockets = {
    spawn: vi.fn(() => {
      const id = `rocket-${nextRocket++}`;
      activeRockets.add(id);
      return id;
    }),
    hasRocket: vi.fn((id: string) => activeRockets.has(id)),
    updateLaser: vi.fn(),
    hideLaser: vi.fn(),
    finish: (id: string) => {
      activeRockets.delete(id);
    },
  };
  const context: WeaponContext = {
    eventBus: bus,
    raycast: {} as Raycast,
    grenades: { spawn: () => undefined } as unknown as GrenadeSystem,
    rockets: rockets as unknown as RocketSystem,
    bolts: { spawn: vi.fn() } as unknown as BoltSystem,
    energyBalls: { spawn: vi.fn() } as unknown as EnergyBallSystem,
    ammo,
    getInventory: () => inventory,
  };
  return {
    bus,
    rockets,
    weapon: createWeapon("rpg", context),
    fired: recordEvents(bus, "weapon.fired"),
    empty: recordEvents(bus, "weapon.empty"),
    reloaded: recordEvents(bus, "weapon.reloaded"),
    ammoChanged: recordEvents(bus, "weapon.ammo.changed"),
  };
}

function fireContext(now: number) {
  return {
    origin: new Vector3(0, 1.6, 0),
    direction: new Vector3(0, 0, -1),
    cameraQuaternion: new Quaternion(),
    now,
  };
}

function updateContext(elapsed: number) {
  return {
    delta: 1 / 60,
    elapsed,
    origin: new Vector3(0, 1.6, 0),
    direction: new Vector3(0, 0, -1),
    cameraQuaternion: new Quaternion(),
    alternateHeld: false,
    ownerGrounded: true,
  };
}

describe("RpgWeapon", () => {
  it("dispara un solo cohete activo y bloquea disparos extra sin empty click", () => {
    const { weapon, rockets, fired, empty } = setup();

    expect(weapon.tryFire(fireContext(0))).toBe(true);
    expect(rockets.spawn).toHaveBeenCalledTimes(1);
    expect(weapon.getAmmo()).toBe(0);
    expect(weapon.getReserveAmmo()).toBe(1);

    expect(weapon.tryFire(fireContext(0.6))).toBe(false);
    expect(rockets.spawn).toHaveBeenCalledTimes(1);
    expect(fired).toHaveLength(1);
    expect(empty).toHaveLength(0);
  });

  it("recarga automaticamente cuando el cohete termina", () => {
    const { weapon, rockets, reloaded, ammoChanged } = setup();

    expect(weapon.tryFire(fireContext(0))).toBe(true);
    const rocketId = rockets.spawn.mock.results[0].value;
    rockets.finish(rocketId);

    weapon.update(1 / 60, updateContext(0.7));

    expect(reloaded).toHaveLength(1);
    expect(weapon.getAmmo()).toBe(1);
    expect(weapon.getReserveAmmo()).toBe(0);
    expect(ammoChanged.at(-1)).toMatchObject({
      weaponId: "rpg",
      current: 1,
      reserve: 0,
    });
  });

  it("bloquea reload manual mientras hay un cohete activo", () => {
    const { weapon } = setup();

    expect(weapon.tryFire(fireContext(0))).toBe(true);

    expect(weapon.tryReload(0.8)).toBe(false);
    expect(weapon.getAmmo()).toBe(0);
    expect(weapon.getReserveAmmo()).toBe(1);
  });

  it("emite empty cuando no quedan cohetes", () => {
    const { weapon, empty } = setup();
    weapon.restoreAmmo(0, 0);

    expect(weapon.tryFire(fireContext(0))).toBe(false);

    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({ weaponName: "RPG" });
  });
});
