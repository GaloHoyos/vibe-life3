import { describe, expect, it, vi } from "vitest";
import { Scene, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { AmmoPickup } from "@game/gameplay/items/AmmoPickup";
import type { WeaponController } from "@game/gameplay/weapons/core/WeaponController";
import { fakeAssets } from "@tests/support/fakes";

describe("AmmoPickup", () => {
  it("se consume cuando el inventario acepta la municion", async () => {
    const scene = new Scene();
    const physics = new PhysicsWorld();
    await physics.init();
    const weapons = {
      pickupAmmo: vi.fn(() => true),
    } as unknown as WeaponController;

    const pickup = await AmmoPickup.create(scene, physics, fakeAssets(), {
      id: "ammo-pistol-test",
      ammoId: "pistol",
      position: new Vector3(0, 0, 0),
    });

    expect(scene.children).toContain(pickup.object);
    pickup.update(1 / 60, new Vector3(0, 0.6, 0), weapons);

    expect(weapons.pickupAmmo).toHaveBeenCalledWith("pistol");
    expect(scene.children).not.toContain(pickup.object);
  });

  it("no se consume si el pool esta lleno", async () => {
    const scene = new Scene();
    const physics = new PhysicsWorld();
    await physics.init();
    const weapons = {
      pickupAmmo: vi.fn(() => false),
    } as unknown as WeaponController;

    const pickup = await AmmoPickup.create(scene, physics, fakeAssets(), {
      id: "ammo-smg-test",
      ammoId: "smg",
      position: new Vector3(0, 0, 0),
    });

    pickup.update(1 / 60, new Vector3(0, 0.6, 0), weapons);

    expect(weapons.pickupAmmo).toHaveBeenCalledWith("smg");
    expect(scene.children).toContain(pickup.object);
    pickup.dispose();
  });
});
