import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { Raycast } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import { recordEvents } from "@tests/support/events";
import { createWeapon } from "@game/gameplay/weapons/core/WeaponFactory";
import { WeaponInventory } from "@game/gameplay/weapons/core/WeaponInventory";
import type { WeaponContext } from "@game/gameplay/weapons/core/Weapon";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";

function setup() {
  const bus = new EventBus<GameEventMap>();
  const inventory = new WeaponInventory(bus);
  const context: WeaponContext = {
    eventBus: bus,
    raycast: {} as Raycast,
    grenades: { spawn: () => undefined } as unknown as GrenadeSystem,
    getInventory: () => inventory,
  };
  return {
    inventory,
    weapon: (id: WeaponId) => createWeapon(id, context),
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
