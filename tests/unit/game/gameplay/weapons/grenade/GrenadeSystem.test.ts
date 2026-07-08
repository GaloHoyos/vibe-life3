import { describe, expect, it, vi } from "vitest";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Scene, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { GameEventMap } from "@game/GameEvents";
import { fakeAssets, fakePositionalSounds, fakeRaycast, fakeVfx } from "@tests/support/fakes";
import { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";

describe("GrenadeSystem", () => {
  it("remueve granadas usando PhysicsWorld.removeDynamicBody y limpia metadata", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const system = new GrenadeSystem(
      physics,
      new Scene(),
      fakeAssets(),
      fakeRaycast(),
      new EventBus<GameEventMap>(),
      fakePositionalSounds(),
      fakeVfx(),
    );

    system.spawn({
      mode: "fuse",
      origin: new Vector3(0, 0, 0),
      velocity: new Vector3(0, 0, 0),
      damage: 10,
      radius: 1,
      impulse: 1,
      ownerKind: "player",
      sourceId: "player",
      sourceFaction: "player",
      weaponName: "Grenade",
      now: 0,
      fuseSeconds: 0,
    });

    let collider: RAPIER.Collider | null = null;
    physics.world.forEachCollider((candidate) => {
      collider ??= candidate;
    });
    if (!collider) {
      throw new Error("Expected grenade collider to be registered");
    }
    expect(physics.getColliderMetadata(collider)?.id).toBe("grenade-0");

    const removeSpy = vi.spyOn(physics, "removeDynamicBody");
    system.update(0.016, 0);

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(physics.getColliderMetadata(collider)).toBeUndefined();
    expect(physics.getBodyCount()).toBe(0);
    expect(() => physics.step(1 / 60)).not.toThrow();
  });
});
