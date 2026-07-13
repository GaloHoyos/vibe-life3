import RAPIER from "@dimforge/rapier3d-compat";
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  BLOB_FIXED_STEP_SECONDS,
  BLOB_INITIAL_PARTICLE_COUNT,
  BlobOrganismRuntime,
} from "@engine/blob/BlobOrganismRuntime";
import type { BlobResolvedMotion } from "@engine/blob/BlobTypes";
import { BlobMotor } from "@engine/physics/character/BlobMotor";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Vec3 } from "@shared/math/Vec3";

beforeAll(async () => {
  await RAPIER.init();
});

async function createMotor(center = new Vector3(0, 1, 0)): Promise<{
  physics: PhysicsWorld;
  runtime: BlobOrganismRuntime;
  motor: BlobMotor;
}> {
  const physics = new PhysicsWorld();
  await physics.init();
  const runtime = new BlobOrganismRuntime({ center, seed: 41 });
  const motor = new BlobMotor(physics, runtime, {
    id: "blob-test",
    maxSpeed: 3.6,
    acceleration: 12,
    turnSpeed: 8,
    metadata: { id: "blob-test", kind: "npc", characterId: "blob" },
  });
  return { physics, runtime, motor };
}

function resolvedPosition(result: BlobResolvedMotion | Vec3 | void): Vector3 {
  if (!result) throw new Error("BlobMotor did not resolve particle motion");
  const value = "position" in result ? result.position : result;
  return new Vector3(value.x, value.y, value.z);
}

describe("BlobMotor swept particle motion", () => {
  it("stops a particle before a solid wall instead of tunnelling through it", async () => {
    const { physics, runtime, motor } = await createMotor();
    physics.createStaticBox({
      id: "wall",
      position: new Vector3(0, 1, 0),
      size: new Vector3(0.2, 4, 4),
    });
    physics.updateQueryPipeline();

    const particle = runtime.particles[81];
    const result = resolvedPosition(
      motor.resolveParticleMotion(
        particle,
        new Vector3(-1, 1, 0),
        new Vector3(1, 1, 0),
      ),
    );

    expect(result.x).toBeLessThan(-0.2);
    expect(result.x).toBeGreaterThan(-1);
    expect(result.y).toBeCloseTo(1);
  });

  it("ignores a collider explicitly marked blobPermeable", async () => {
    const { physics, runtime, motor } = await createMotor();
    physics.createStaticBox({
      id: "grate",
      position: new Vector3(0, 1, 0),
      size: new Vector3(0.2, 4, 4),
      metadata: { blobPermeable: true },
    });
    physics.updateQueryPipeline();

    const desired = new Vector3(1, 1, 0);
    const result = resolvedPosition(
      motor.resolveParticleMotion(
        runtime.particles[81],
        new Vector3(-1, 1, 0),
        desired,
      ),
    );

    expect(result.distanceToSquared(desired)).toBeLessThan(1e-10);
  });

  it("uses a bounded dt-squared support probe instead of a fixed downward jump", async () => {
    const { runtime, motor } = await createMotor();
    const from = new Vector3(0, 1, 0);
    const result = resolvedPosition(
      motor.resolveParticleMotion(runtime.particles[25], from, from.clone()),
    );
    const expectedDrop = 0.5 * 18 * BLOB_FIXED_STEP_SECONDS * BLOB_FIXED_STEP_SECONDS;

    expect(from.y - result.y).toBeCloseTo(expectedDrop);
    expect(from.y - result.y).toBeLessThan(0.0251);
  });

  it("depenetrates a floor overlap and preserves horizontal motion", async () => {
    const { physics, runtime, motor } = await createMotor();
    physics.createStaticBox({
      id: "floor",
      position: new Vector3(0, -0.2, 0),
      size: new Vector3(20, 0.4, 20),
    });
    physics.updateQueryPipeline();

    const particle = runtime.particles[111];
    const from = new Vector3(0, particle.radius - 0.03, 0);
    const desired = from.clone().add(new Vector3(0, 0, 1));
    const result = resolvedPosition(motor.resolveParticleMotion(particle, from, desired));

    expect(result.z).toBeGreaterThan(0.98);
    expect(result.y - particle.radius).toBeGreaterThanOrEqual(0.014);
  });

  it("advances the tangent left after the two impact responses", async () => {
    const { physics, runtime, motor } = await createMotor();
    const collider = motor.body.collider(0)!;
    const makeHit = (time_of_impact: number, normal1: Vector3) => ({
      collider,
      time_of_impact,
      normal1,
      normal2: normal1.clone().negate(),
      witness1: new Vector3(),
      witness2: new Vector3(),
    }) as NonNullable<ReturnType<typeof physics.world.castShape>>;
    vi.spyOn(physics.world, "castShape")
      .mockReturnValueOnce(makeHit(0.25, new Vector3(1, 0, 0)))
      .mockReturnValueOnce(makeHit(0.25, new Vector3(0, 1, 0)))
      .mockReturnValueOnce(null);

    const result = resolvedPosition(
      motor.resolveParticleMotion(
        runtime.particles[81],
        new Vector3(),
        new Vector3(-1, -1, 1),
      ),
    );

    expect(result.z).toBeGreaterThan(0.98);
    expect(physics.world.castShape).toHaveBeenCalledTimes(3);
  });

  it("flows through lightweight dynamic props handled by tickDynamicProps", async () => {
    const { physics, runtime, motor } = await createMotor();
    const prop = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0),
    );
    const propCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 1, 1),
      prop,
    );
    physics.registerCollider(propCollider, { id: "light-prop", kind: "dynamic" });
    physics.updateQueryPipeline();
    expect(prop.mass()).toBeLessThanOrEqual(25);

    const desired = new Vector3(1, 1, 0);
    const result = resolvedPosition(
      motor.resolveParticleMotion(
        runtime.particles[81],
        new Vector3(-1, 1, 0),
        desired,
      ),
    );

    expect(result.distanceToSquared(desired)).toBeLessThan(1e-10);
  });

  it("still treats heavyweight dynamic props as solid", async () => {
    const { physics, runtime, motor } = await createMotor();
    const prop = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0),
    );
    const propCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 1, 1).setDensity(40),
      prop,
    );
    physics.registerCollider(propCollider, { id: "heavy-prop", kind: "dynamic" });
    physics.updateQueryPipeline();
    expect(prop.mass()).toBeGreaterThan(25);

    const result = resolvedPosition(
      motor.resolveParticleMotion(
        runtime.particles[81],
        new Vector3(-1, 1, 0),
        new Vector3(1, 1, 0),
      ),
    );

    expect(result.x).toBeLessThan(-0.2);
  });

  it("keeps the complete organism moving across an unobstructed floor", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    physics.createStaticBox({
      id: "floor",
      position: new Vector3(0, -0.2, 0),
      size: new Vector3(30, 0.4, 30),
    });
    physics.updateQueryPipeline();
    const runtime = new BlobOrganismRuntime({
      center: new Vector3(0, 1, -5),
      initialParticleCount: BLOB_INITIAL_PARTICLE_COUNT,
      particleRadius: 0.28,
      bodyRadius: 1.6,
      separationDistance: 0.28 * 0.58,
      seed: 41,
    });
    const motor = new BlobMotor(physics, runtime, {
      id: "blob-open-floor",
      maxSpeed: 3.4,
      acceleration: 14,
      turnSpeed: 12,
      metadata: { id: "blob-open-floor", kind: "npc", characterId: "blob" },
    });
    const target = new Vector3(0, 0, 10);

    for (let frame = 0; frame < 240; frame++) {
      motor.update(1 / 60, target, true);
      physics.step(1 / 60);
    }

    // Regression: two particles spawned a few centimetres inside the floor,
    // stayed anchored at z=-5 and stopped the brain around z=3.
    expect(runtime.center.z).toBeGreaterThan(6.5);
    expect(motor.getVelocity().length()).toBeGreaterThan(0.25);
  });
});

describe("BlobMotor teleportPose", () => {
  it("rebases every particle position and relative velocity atomically", async () => {
    const { runtime, motor } = await createMotor(new Vector3(2, 1, -3));
    runtime.step(BLOB_FIXED_STEP_SECONDS, {
      desiredVelocity: new Vector3(0.8, 0.15, -0.4),
    });
    const sourceCenter = runtime.center.clone();
    const sourceVelocity = runtime.velocity.clone();
    const snapshots = runtime.particles.map((particle) => ({
      relativePosition: particle.position.clone().sub(sourceCenter),
      relativeVelocity: particle.velocity.clone().sub(sourceVelocity),
    }));
    const destination = new Vector3(12, 4, 7);
    const destinationVelocity = new Vector3(-2, 1.5, 3);
    const yaw = Math.PI / 2;
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);

    motor.teleportPose(destination, destinationVelocity, yaw);

    expect(runtime.center.distanceToSquared(destination)).toBe(0);
    expect(runtime.velocity.distanceToSquared(destinationVelocity)).toBe(0);
    runtime.particles.forEach((particle, index) => {
      const expectedPosition = snapshots[index].relativePosition
        .clone()
        .applyQuaternion(rotation)
        .add(destination);
      const expectedVelocity = snapshots[index].relativeVelocity
        .clone()
        .applyQuaternion(rotation)
        .add(destinationVelocity);
      expect(particle.position.distanceTo(expectedPosition)).toBeLessThan(1e-6);
      expect(particle.previousPosition.distanceTo(expectedPosition)).toBeLessThan(1e-6);
      expect(particle.renderPosition.distanceTo(expectedPosition)).toBeLessThan(1e-6);
      expect(particle.velocity.distanceTo(expectedVelocity)).toBeLessThan(1e-6);
    });
    expect(motor.getPosition().distanceToSquared(destination)).toBe(0);
    expect(motor.getVelocity().distanceToSquared(destinationVelocity)).toBe(0);
    const bodyPosition = motor.body.translation();
    expect(new Vector3(bodyPosition.x, bodyPosition.y, bodyPosition.z).distanceToSquared(destination)).toBe(0);
  });
});

describe("BlobMotor consumable props", () => {
  it("counts residence time and consumes/grows once even when several components overlap", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const runtime = new BlobOrganismRuntime({ center: new Vector3(0, 1, 0), seed: 9 });
    runtime.split(3, 0);
    const consumed = vi.fn();
    const motor = new BlobMotor(physics, runtime, {
      id: "blob-test",
      maxSpeed: 3.6,
      acceleration: 12,
      turnSpeed: 8,
      metadata: { id: "blob-test", kind: "npc", characterId: "blob" },
      onConsumeProp: consumed,
    });
    const scene = new Scene();
    const geometry = new BoxGeometry(3, 3, 3);
    const material = new MeshBasicMaterial();
    const disposeGeometry = vi.spyOn(geometry, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");
    const visual = new Mesh(geometry, material);
    scene.add(visual);
    const prop = physics.createDynamicBox(
      {
        id: "blob-food",
        position: runtime.center.clone(),
        size: new Vector3(3, 3, 3),
        mass: 2,
        metadata: {
          blobConsumable: { consumeSeconds: 0.02, biomass: 4 },
        },
      },
      visual,
    );
    expect(prop.isDynamic()).toBe(true);
    expect(physics.getColliderMetadata(prop.collider(0))).toMatchObject({
      kind: "dynamic",
      blobConsumable: { consumeSeconds: 0.02, biomass: 4 },
    });
    const propCollider = prop.collider(0);
    vi.spyOn(physics.world, "intersectionsWithShape").mockImplementation(
      (_position, _rotation, _shape, callback) => {
        if (physics.getBodyCount() > 1) callback(propCollider);
      },
    );

    motor.update(0.011, null, false);
    expect(physics.getBodyCount()).toBe(2);
    expect(runtime.particleCount).toBe(BLOB_INITIAL_PARTICLE_COUNT);
    expect(consumed).not.toHaveBeenCalled();

    motor.update(0.011, null, false);
    expect(physics.getBodyCount()).toBe(1);
    expect(runtime.particleCount).toBe(BLOB_INITIAL_PARTICLE_COUNT + 4);
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(consumed).toHaveBeenCalledWith(4, expect.any(Vector3));
    expect(visual.parent).toBeNull();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);

    motor.update(1, null, false);
    expect(runtime.particleCount).toBe(BLOB_INITIAL_PARTICLE_COUNT + 4);
    expect(consumed).toHaveBeenCalledTimes(1);
  });
});
