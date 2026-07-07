import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import type { PropImpactSystem } from "@game/gameplay/combat/PropImpactSystem";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";
import type { BoltSystem } from "@game/gameplay/weapons/bolt/BoltSystem";
import type { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";
import type { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";
import type { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";
import { recordEvents } from "@tests/support/events";
import { createWeapon } from "@game/gameplay/weapons/core/WeaponFactory";
import { AmmoInventory } from "@game/gameplay/weapons/core/AmmoInventory";
import { WeaponInventory } from "@game/gameplay/weapons/core/WeaponInventory";
import type { WeaponContext } from "@game/gameplay/weapons/core/Weapon";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";

function setup() {
  const bus = new EventBus<GameEventMap>();
  const ammo = new AmmoInventory();
  const inventory = new WeaponInventory(bus, ammo);
  const context: WeaponContext = {
    eventBus: bus,
    physics: {} as PhysicsWorld,
    raycast: {} as Raycast,
    propImpacts: { registerLaunch: () => undefined } as unknown as PropImpactSystem,
    grenades: { spawn: () => undefined } as unknown as GrenadeSystem,
    rockets: {
      spawn: () => "rocket-test",
      hasRocket: () => false,
      updateLaser: () => undefined,
      hideLaser: () => undefined,
    } as unknown as RocketSystem,
    bolts: { spawn: () => undefined } as unknown as BoltSystem,
    energyBalls: { spawn: () => undefined } as unknown as EnergyBallSystem,
    iceGun: { fire: () => false, surf: () => false, stopSurf: () => undefined } as unknown as IceGunSystem,
    portals: {
      fire: () => true,
      throughRaycast: {
        cast: () => null,
        castSegments: () => ({ hit: null, segments: [] }),
      },
    } as unknown as PortalGunSystem,
    ammo,
    getInventory: () => inventory,
  };
  return {
    inventory,
    weapon: (id: WeaponId) => {
      const created = createWeapon(id, context);
      if (created.definition.hasAmmo) {
        ammo.addForWeapon(id, created.definition.ammoPerPickup);
      }
      return created;
    },
    changed: recordEvents(bus, "weapon.changed"),
    ammoChanged: recordEvents(bus, "weapon.ammo.changed"),
  };
}

describe("WeaponInventory", () => {
  it("ordena armas por slot y cicla dentro del slot canonico", () => {
    const { inventory, weapon } = setup();
    inventory.addWeapon(weapon("smg"));
    inventory.addWeapon(weapon("ar3"));

    expect(inventory.getWeaponsInSlot(3).map((w) => w.definition.id)).toEqual([
      "smg",
      "ar3",
    ]);
    expect(inventory.getActiveWeaponId()).toBe("smg");

    inventory.equipSlot(3);
    expect(inventory.getActiveWeaponId()).toBe("ar3");

    inventory.equipSlot(3);
    expect(inventory.getActiveWeaponId()).toBe("smg");
  });

  it("no equipa armas no seleccionables", () => {
    const { inventory, weapon } = setup();
    const pistol = weapon("pistol");
    const grenade = weapon("grenade");
    inventory.addWeapon(pistol);
    inventory.addWeapon(grenade);

    grenade.tryFire({
      origin: new Vector3(0, 1, 0),
      direction: new Vector3(0, 0, -1),
      cameraQuaternion: new Quaternion(),
      now: 0,
    });

    expect(inventory.isWeaponSelectable("grenade")).toBe(false);
    expect(inventory.equipWeapon("grenade")).toBeNull();
    expect(inventory.getActiveWeaponId()).toBe("pistol");
  });

  it("emite eventos al equipar y publicar municion", () => {
    const { inventory, weapon, changed, ammoChanged } = setup();
    inventory.addWeapon(weapon("pistol"));
    inventory.addWeapon(weapon("smg"));

    expect(changed[0]).toMatchObject({
      weaponId: "pistol",
      weaponName: "9mm Pistol",
      ammo: 18,
      reserve: 18,
    });
    expect(ammoChanged[0]).toMatchObject({
      weaponId: "pistol",
      current: 18,
      reserve: 18,
    });

    inventory.equipWeapon("smg");

    expect(changed.at(-1)).toMatchObject({
      weaponId: "smg",
      weaponName: "SMG",
      ammo: 45,
      reserve: 45,
    });
  });
});
