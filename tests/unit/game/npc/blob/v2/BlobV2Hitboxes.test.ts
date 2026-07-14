import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { BlobOrganismController } from "@engine/blob/v2/BlobOrganismController";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import {
  BlobV2Hitboxes,
  type BlobV2CoreDamageEvent,
  type BlobV2PhysicsImpactEvent,
} from "@game/npc/blob/v2/BlobV2Hitboxes";

beforeAll(async () => {
  await RAPIER.init();
});

describe("BlobV2Hitboxes", () => {
  it("creates twelve aggregate shell sensors, fragment capacity and one unmultiplied core", async () => {
    const { physics, hitboxes } = await setup();
    const metadata = collectMetadata(physics);

    expect(metadata.filter((item) => item.bodyPart?.name === "blob-mass")).toHaveLength(12);
    const core = metadata.filter((item) => item.bodyPart?.name === "blob-core");
    expect(core).toHaveLength(1);
    expect(core[0]?.bodyPart?.damageMultiplier).toBe(1);
    expect(new Set(metadata.map((item) => item.explosionGroupId))).toEqual(
      new Set(["blob-v2-test"]),
    );
    expect(new Set(metadata.map((item) => item.explosionDamageable)).size).toBe(1);
    expect(hitboxes.activeSensorCount).toBe(13);
    hitboxes.dispose();
  });

  it("routes intact shell and even a direct core-collider hit to skin only", async () => {
    const { physics, controller, onMassImpact, onCoreDamage, hitboxes } = await setup();
    const raycast = new Raycast(physics);
    const corePosition = vector(controller.snapshot().core.position);
    const origin = corePosition.clone().add(new Vector3(0, 0, -5));
    const direction = new Vector3(0, 0, 1);
    const hit = raycast.cast(origin, direction, 10);

    expect(hit?.metadata?.bodyPart?.name).toBe("blob-mass");
    hit?.metadata?.damageable?.applyDamage(
      5,
      direction,
      "blob-mass",
      "player",
      hit.point,
      "bullet",
    );
    expect(controller.core.health).toBe(150);
    expect(onCoreDamage).not.toHaveBeenCalled();
    expect(onMassImpact).toHaveBeenCalledWith(
      expect.objectContaining({
        sensorKind: "shell",
        damage: 5,
        result: expect.objectContaining({ target: "skin", coreDamage: 0 }),
      }),
    );

    const core = collectMetadata(physics).find(
      (item) => item.bodyPart?.name === "blob-core",
    );
    core?.damageable?.applyDamage(
      10,
      direction,
      "blob-core",
      "player",
      corePosition,
      "bullet",
    );
    expect(controller.core.health).toBe(150);
    expect(onCoreDamage).not.toHaveBeenCalled();
    hitboxes.dispose();
  });

  it("opens only the wound corridor and lets the next physical ray damage the core", async () => {
    const { physics, controller, onCoreDamage, hitboxes } = await setup();
    const raycast = new Raycast(physics);
    const corePosition = vector(controller.snapshot().core.position);
    const origin = corePosition.clone().add(new Vector3(0, 0, -5));
    const direction = new Vector3(0, 0, 1);
    const protectedHit = raycast.cast(origin, direction, 10);
    expect(protectedHit?.metadata?.bodyPart?.name).toBe("blob-mass");

    protectedHit?.metadata?.damageable?.applyDamage(
      40,
      direction,
      "blob-mass",
      "player",
      protectedHit.point,
      "bullet",
    );
    expect(controller.core.health).toBe(150);
    expect(onCoreDamage).not.toHaveBeenCalled();
    const opened = controller.snapshot().wounds.find(
      (wound) => wound.state === "Breached" || wound.state === "Exposed",
    );
    expect(opened).toBeDefined();

    // The chunk is a separate physical target. Move it clear as its ballistic
    // phase would do before checking the exact wound-to-core corridor.
    const fragment = controller.snapshot().fragments[0];
    if (fragment) {
      controller.transformIsland(fragment.islandId, {
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        translation: { x: 3, y: 0, z: 0 },
      });
      hitboxes.sync(controller.snapshot());
    }
    physics.updateQueryPipeline();

    const exposedHit = raycast.cast(origin, direction, 10);
    expect(exposedHit?.metadata?.bodyPart?.name).toBe("blob-core");
    exposedHit?.metadata?.damageable?.applyDamage(
      5,
      direction,
      "blob-core",
      "player",
      exposedHit.point,
      "bullet",
    );
    expect(controller.core.health).toBeCloseTo(137.5);
    expect(onCoreDamage).toHaveBeenCalledOnce();
    expect(onCoreDamage).toHaveBeenCalledWith(
      expect.objectContaining({
        sensorKind: "core",
        coreDamage: 12.5,
        result: expect.objectContaining({ target: "core" }),
      }),
    );
    hitboxes.dispose();
  });

  it("rejects a core hit whose real projectile line misses the open aperture", async () => {
    const { physics, controller, onCoreDamage, hitboxes } = await setup({ coreRadius: 0.8 });
    controller.applyImpact({
      point: { x: 0, y: 1, z: -1 },
      direction: { x: 0, y: 0, z: 1 },
      normal: { x: 0, y: 0, z: -1 },
      damage: 40,
      cohesionEnergy: 40,
      detachBiomass: 8,
      impulse: { x: 0, y: 0, z: 0 },
    });
    hitboxes.sync(controller.snapshot());

    const core = collectMetadata(physics).find(
      (item) => item.bodyPart?.name === "blob-core",
    );
    core?.damageable?.applyDamage(
      5,
      new Vector3(0, 0, 1),
      "blob-core",
      "player",
      new Vector3(0.6, 1, 0),
      "bullet",
    );

    expect(controller.core.health).toBe(150);
    expect(onCoreDamage).not.toHaveBeenCalled();
    hitboxes.dispose();
  });

  it("passes a live fragment ID instead of subdividing it again", async () => {
    const { physics, controller, hitboxes } = await setup();
    const mass = collectMetadata(physics).find(
      (item) => item.bodyPart?.name === "blob-mass",
    )!;
    const point = vector(controller.snapshot().core.position).add(
      new Vector3(0, 0, -0.8),
    );
    mass.damageable?.applyDamage(
      40,
      new Vector3(0, 0, 1),
      "blob-mass",
      "player",
      point,
      "bullet",
    );
    physics.updateQueryPipeline();
    const fragment = controller.snapshot().fragments[0];
    expect(fragment).toBeDefined();
    const fragmentMetadata = collectMetadata(physics).find(
      (item) => item.bodyPart?.name === "blob-fragment",
    );
    expect(fragmentMetadata).toBeDefined();

    const route = vi.spyOn(controller, "applyImpact");
    fragmentMetadata?.damageable?.applyDamage(
      6,
      new Vector3(1, 0, 0),
      "blob-fragment",
      "player",
      vector(fragment!.position),
      "bullet",
    );

    expect(route).toHaveBeenCalledOnce();
    expect(route.mock.calls[0]?.[0].fragmentId).toBe(fragment?.id);
    expect(route.mock.results[0]?.value).toMatchObject({
      target: "fragment",
      coreDamage: 0,
    });
    hitboxes.dispose();
  });

  it("deduplicates explosions through one canonical routed impact with no same-hit core damage", async () => {
    const { physics, controller, onCoreDamage, hitboxes } = await setup();
    const metadata = collectMetadata(physics);
    const mass = metadata.find((item) => item.bodyPart?.name === "blob-mass")!;
    const explosionTarget = mass.explosionDamageable!;
    const route = vi.spyOn(controller, "applyImpact");

    explosionTarget.applyDamage(
      60,
      new Vector3(0, 0, 1),
      "blob-mass",
      "player",
      vector(controller.snapshot().core.position).add(new Vector3(0, 0, -0.8)),
      "explosive",
    );

    expect(route).toHaveBeenCalledOnce();
    expect(route.mock.calls[0]?.[0]).toMatchObject({
      explosive: true,
      damage: 60,
    });
    expect(route.mock.results[0]?.value).toMatchObject({
      target: "skin",
      openedBreach: true,
      coreDamage: 0,
    });
    expect(controller.core.health).toBe(150);
    expect(onCoreDamage).not.toHaveBeenCalled();
    hitboxes.dispose();
  });

  it("remove/dispose are idempotent and remove every collider", async () => {
    const { physics, hitboxes } = await setup();
    const bodiesBefore = physics.getBodyCount();
    expect(bodiesBefore).toBe(19);

    hitboxes.remove();
    hitboxes.remove();
    hitboxes.dispose();
    physics.updateQueryPipeline();

    expect(physics.getBodyCount()).toBe(0);
    expect(collectMetadata(physics)).toHaveLength(0);
  });
});

async function setup(options: { coreRadius?: number } = {}) {
  const physics = new PhysicsWorld();
  await physics.init();
  const controller = new BlobOrganismController({
    center: { x: 0, y: 1, z: 0 },
    initialBiomass: 64,
    maximumBiomass: 64,
    seed: 1234,
    coreRadius: options.coreRadius,
  });
  const onMassImpact = vi.fn<(event: BlobV2PhysicsImpactEvent) => void>();
  const onCoreDamage = vi.fn<(event: BlobV2CoreDamageEvent) => void>();
  const hitboxes = new BlobV2Hitboxes({
    physics,
    ownerId: "blob-v2-test",
    controller,
    onMassImpact,
    onCoreDamage,
  });
  hitboxes.sync(controller.snapshot());
  physics.updateQueryPipeline();
  return { physics, controller, hitboxes, onMassImpact, onCoreDamage };
}

function collectMetadata(physics: PhysicsWorld): PhysicsMetadata[] {
  const metadata: PhysicsMetadata[] = [];
  physics.world.intersectionsWithShape(
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 0, w: 1 },
    new RAPIER.Ball(10),
    (collider) => {
      const value = physics.getColliderMetadata(collider);
      if (value?.ownerId === "blob-v2-test") metadata.push(value);
      return true;
    },
  );
  return metadata;
}

function vector(value: { readonly x: number; readonly y: number; readonly z: number }): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}
