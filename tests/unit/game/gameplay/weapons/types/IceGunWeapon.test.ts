import { describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { Raycast } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";
import type { BoltSystem } from "@game/gameplay/weapons/bolt/BoltSystem";
import type { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";
import type { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";
import type { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";
import { createWeapon } from "@game/gameplay/weapons/core/WeaponFactory";
import { AmmoInventory } from "@game/gameplay/weapons/core/AmmoInventory";
import { WeaponInventory } from "@game/gameplay/weapons/core/WeaponInventory";
import type { WeaponContext } from "@game/gameplay/weapons/core/Weapon";
import { recordEvents } from "@tests/support/events";

function setup() {
  const bus = new EventBus<GameEventMap>();
  const ammo = new AmmoInventory();
  const inventory = new WeaponInventory(bus, ammo);
  const iceGun = {
    fire: vi.fn(() => true),
    surf: vi.fn(() => true),
    stopSurf: vi.fn(),
  };
  const context: WeaponContext = {
    eventBus: bus,
    raycast: { cast: () => null } as unknown as Raycast,
    grenades: { spawn: vi.fn() } as unknown as GrenadeSystem,
    rockets: {
      spawn: vi.fn(() => "rocket-test"),
      hasRocket: vi.fn(() => false),
      updateLaser: vi.fn(),
      hideLaser: vi.fn(),
    } as unknown as RocketSystem,
    bolts: { spawn: vi.fn() } as unknown as BoltSystem,
    energyBalls: { spawn: vi.fn() } as unknown as EnergyBallSystem,
    iceGun: iceGun as unknown as IceGunSystem,
    portals: {
      fire: vi.fn(() => true),
      throughRaycast: {
        cast: () => null,
        castSegments: () => ({ hit: null, segments: [] }),
      },
    } as unknown as PortalGunSystem,
    ammo,
    getInventory: () => inventory,
  };

  return {
    iceGun,
    weapon: createWeapon("iceGun", context),
    fired: recordEvents(bus, "weapon.fired"),
    alternate: recordEvents(bus, "weapon.alternate.fired"),
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

function updateContext(alternateHeld: boolean, elapsed: number) {
  return {
    delta: 1 / 60,
    elapsed,
    origin: new Vector3(0, 1.6, 0),
    direction: new Vector3(0, 0, -1),
    cameraQuaternion: new Quaternion(),
    alternateHeld,
    ownerGrounded: true,
  };
}

describe("IceGunWeapon", () => {
  it("delegates primary fire to IceGunSystem and emits an iceGun weapon event", () => {
    const { weapon, iceGun, fired } = setup();

    expect(weapon.tryFire(fireContext(0))).toBe(true);

    expect(iceGun.fire).toHaveBeenCalledWith(
      expect.objectContaining({
        range: 18,
        sourceId: "player",
        weaponName: "Ice Gun",
      }),
    );
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      weaponName: "Ice Gun",
      weaponType: "iceGun",
    });
  });

  it("uses held alternate input to spawn surf ice and stops when released", () => {
    const { weapon, iceGun } = setup();

    weapon.update(1 / 60, updateContext(true, 0.1));
    weapon.update(1 / 60, updateContext(false, 0.2));

    expect(iceGun.surf).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "player",
        now: 0.1,
      }),
    );
    expect(iceGun.stopSurf).toHaveBeenCalledWith("player");
  });

  it("emits one alternate fire event when RMB is pressed", () => {
    const { weapon, alternate } = setup();

    weapon.tryAlternateFire({
      ...fireContext(0),
      pressed: true,
      held: true,
    });

    expect(alternate).toHaveLength(1);
    expect(alternate[0]).toMatchObject({
      weaponName: "Ice Gun",
      sourceId: "player",
    });
  });
});
