import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { RaycastHit } from "@engine/physics/Raycast";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import {
  grabRayFilter,
  resolveGrabbable,
} from "@game/gameplay/weapons/core/grabFilter";

beforeAll(async () => {
  await RAPIER.init();
});

function hitFor(collider: RAPIER.Collider, metadata?: PhysicsMetadata): RaycastHit {
  return { collider, metadata, point: new Vector3(), toi: 1 };
}

async function setup() {
  const physics = new PhysicsWorld();
  await physics.init();
  return physics;
}

describe("resolveGrabbable — tabla de agarrables", () => {
  it("prop dinámico → prop; también sin metadata", async () => {
    const physics = await setup();
    const box = physics.createDynamicBox(
      { id: "crate", position: new Vector3(), size: new Vector3(0.4, 0.4, 0.4) },
      new Object3D(),
    );
    const collider = box.collider(0);
    expect(resolveGrabbable(hitFor(collider, { id: "crate", kind: "dynamic" }))).toEqual({
      body: box,
      kind: "prop",
    });
    expect(resolveGrabbable(hitFor(collider, undefined))?.kind).toBe("prop");
  });

  it("pickup dinámico (arma/munición/item) → prop", async () => {
    const physics = await setup();
    const pickup = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.2, 0.1, 0.2).setDensity(0.35),
      pickup,
    );
    expect(
      resolveGrabbable(hitFor(collider, { id: "ammo-1", kind: "weaponPickup" })),
    ).toEqual({ body: pickup, kind: "prop" });
  });

  it("parte de ragdoll muerto (no sensor, dinámica) → ragdoll", async () => {
    const physics = await setup();
    const part = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1),
      part,
    );
    expect(
      resolveGrabbable(hitFor(collider, { id: "npc-ragdoll-chest", kind: "ragdoll" })),
    ).toEqual({ body: part, kind: "ragdoll" });
  });

  it("hitbox viva (sensor kind ragdoll) → null y el filtro del rayo la saltea", async () => {
    const physics = await setup();
    const liveBody = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic(),
    );
    const sensor = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1).setSensor(true),
      liveBody,
    );
    const metadata: PhysicsMetadata = { id: "npc-live-part-chest", kind: "ragdoll" };
    expect(resolveGrabbable(hitFor(sensor, metadata))).toBeNull();
    expect(grabRayFilter(metadata, sensor)).toBe(false);
  });

  it("NPC terrestre vivo (cápsula kinemática) → null; flyer dinámico → flyer", async () => {
    const physics = await setup();
    const ground = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased(),
    );
    const groundCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.35),
      ground,
    );
    expect(
      resolveGrabbable(hitFor(groundCollider, { id: "combine", kind: "npc" })),
    ).toBeNull();

    const flyer = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
    const flyerCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.1, 0.25),
      flyer,
    );
    expect(
      resolveGrabbable(hitFor(flyerCollider, { id: "manhack", kind: "npc" })),
    ).toEqual({ body: flyer, kind: "flyer" });
  });

  it("player, puertas y estáticos → null", async () => {
    const physics = await setup();
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.2, 0.2, 0.2),
      body,
    );
    for (const kind of ["player", "door", "static"] as const) {
      expect(resolveGrabbable(hitFor(collider, { id: kind, kind }))).toBeNull();
    }
  });
});
