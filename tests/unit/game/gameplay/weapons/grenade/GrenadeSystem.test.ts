import { describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Scene, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { GameEventMap } from "@game/GameEvents";
import { fakeAssets, fakePositionalSounds, fakeRaycast, fakeVfx } from "@tests/support/fakes";
import { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import { recordEvents } from '@tests/support/events';

describe("GrenadeSystem", () => {
  it('deduplica hitboxes por explosionGroupId y usa explosionDamageable', async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const bus = new EventBus<GameEventMap>();
    const hits = recordEvents(bus, 'weapon.hit');
    const canonical = { applyDamage: vi.fn(), isAlive: () => true };
    const skinA = { applyDamage: vi.fn(), isAlive: () => true };
    const skinB = { applyDamage: vi.fn(), isAlive: () => true };
    for (const [index, skin] of [skinA, skinB].entries()) {
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(index * 0.3, 0, 0),
      );
      const collider = physics.world.createCollider(
        RAPIER.ColliderDesc.ball(0.4).setSensor(true),
        body,
      );
      physics.registerCollider(collider, {
        id: `boss-part-${index}`,
        ownerId: 'boss-1',
        kind: 'npc',
        damageable: skin,
        explosionGroupId: 'boss-1',
        explosionDamageable: canonical,
      });
    }
    physics.updateQueryPipeline();
    const system = new GrenadeSystem(
      physics,
      new Scene(),
      fakeAssets(),
      fakeRaycast(),
      bus,
      fakePositionalSounds(),
      fakeVfx(),
    );

    system.detonate(new Vector3(), {
      damage: 100,
      radius: 4,
      impulse: 0,
      ownerKind: 'player',
      sourceId: 'player',
      sourceFaction: 'player',
      weaponName: 'Grenade',
    });

    expect(canonical.applyDamage).toHaveBeenCalledTimes(1);
    expect(skinA.applyDamage).not.toHaveBeenCalled();
    expect(skinB.applyDamage).not.toHaveBeenCalled();
    expect(hits).toHaveLength(1);
    expect(hits[0].targetId).toBe('boss-1');
  });

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
    expect(physics.getColliderMetadata(collider)?.impactDamageOverride).toBe(0.1);

    const removeSpy = vi.spyOn(physics, "removeDynamicBody");
    system.update(0.016, 0);

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(physics.getColliderMetadata(collider)).toBeUndefined();
    expect(physics.getBodyCount()).toBe(0);
    expect(() => physics.step(1 / 60)).not.toThrow();
  });
});
