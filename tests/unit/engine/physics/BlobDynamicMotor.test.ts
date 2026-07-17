import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { BlobDynamicMotor } from "@engine/physics/character/BlobDynamicMotor";

beforeAll(async () => {
  await RAPIER.init();
});

describe("BlobDynamicMotor", () => {
  it("crea un core esferico dinamico con masa, gravedad y metadata fisicas", async () => {
    const physics = await createPhysics();
    const motor = createMotor(physics);

    expect(motor.body.isDynamic()).toBe(true);
    expect(motor.collider.shape.type).toBe(RAPIER.ShapeType.Ball);
    expect((motor.collider.shape as RAPIER.Ball).radius).toBeCloseTo(0.38, 6);
    expect(motor.body.mass()).toBeCloseTo(24, 5);
    expect(motor.body.gravityScale()).toBeCloseTo(0.8, 6);
    expect(physics.getColliderMetadata(motor.collider)).toMatchObject({
      id: "blob-motor",
      kind: "npc",
      characterId: "blob",
    });
  });

  it("acelera por impulso horizontal limitado sin reemplazar la caida", async () => {
    const physics = await createPhysics();
    const motor = createMotor(physics, { acceleration: 4, maxSpeed: 2 });
    motor.body.setLinvel({ x: 0, y: -5, z: 0 }, true);

    // El control clampa frames largos a 1/20. El impulso contempla los 32.64 kg
    // del organismo, aunque Rapier lo recibe a través del core de 24 kg.
    motor.update(0.5, new Vector3(0, 3, 10), true);

    const velocity = motor.body.linvel();
    expect(velocity.z).toBeCloseTo(0.272, 5);
    expect(velocity.x).toBeCloseTo(0, 6);
    expect(velocity.y).toBeCloseTo(-5, 6);
    expect(motor.syncFromPhysics().desiredVelocity.z).toBeCloseTo(2, 5);
  });

  it("conserva momentum externo y frena gradualmente cuando no quiere moverse", async () => {
    const physics = await createPhysics();
    const motor = createMotor(physics, { acceleration: 3, maxSpeed: 2 });
    motor.body.setLinvel({ x: 8, y: 1.75, z: 0 }, true);

    motor.update(1 / 30, null, false);

    const velocity = motor.body.linvel();
    expect(velocity.x).toBeCloseTo(7.864, 5);
    expect(velocity.y).toBeCloseTo(1.75, 6);
    expect(velocity.x).toBeGreaterThan(2);
  });

  it("no pelea con la Gravity Gun ni con un body cinematico", async () => {
    const physics = await createPhysics();
    const motor = createMotor(physics);
    motor.body.setLinvel({ x: 1.25, y: -2, z: -0.5 }, true);
    physics.markHeld(motor.body, true);

    motor.update(1 / 30, new Vector3(20, 3, 0), true);

    expect(motor.isIncapacitated()).toBe(true);
    expect(motor.body.linvel()).toMatchObject({ x: 1.25, y: -2, z: -0.5 });

    physics.markHeld(motor.body, false);
    motor.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    motor.update(1 / 30, new Vector3(20, 3, 0), true);
    expect(motor.isIncapacitated()).toBe(true);
    expect(motor.body.linvel()).toMatchObject({ x: 1.25, y: -2, z: -0.5 });
  });

  it("expone un teleport coherente para el tránsito compuesto del blob", async () => {
    const physics = await createPhysics();
    const motor = createMotor(physics);
    const destination = new Vector3(8, 2, -3);
    const velocity = new Vector3(1.5, 4, -0.75);

    motor.teleport(destination, velocity);
    motor.snapYaw(Math.PI / 3);

    expect(motor.getPosition().distanceTo(destination)).toBeLessThan(1e-6);
    expect(motor.getVelocity().distanceTo(velocity)).toBeLessThan(1e-6);
    expect(motor.getYaw()).toBeCloseTo(Math.PI / 3, 6);
    expect(motor.getPortalColliderHandles()).toEqual([motor.collider.handle]);
    expect(() => motor.setPortalExclusions(new Set([42]))).not.toThrow();

    motor.dispose();
  });

  it("dispose remueve el cuerpo y es idempotente", async () => {
    const physics = await createPhysics();
    const motor = createMotor(physics);
    const collider = motor.collider;

    motor.dispose();

    expect(physics.getBodyCount()).toBe(0);
    expect(physics.getColliderMetadata(collider)).toBeUndefined();
    expect(() => motor.dispose()).not.toThrow();
  });
});

async function createPhysics(): Promise<PhysicsWorld> {
  const physics = new PhysicsWorld();
  await physics.init();
  return physics;
}

function createMotor(
  physics: PhysicsWorld,
  overrides: Partial<{
    acceleration: number;
    maxSpeed: number;
  }> = {},
): BlobDynamicMotor {
  return new BlobDynamicMotor(physics, {
    id: "blob-motor",
    position: new Vector3(0, 3, 0),
    radius: 0.38,
    mass: 24,
    drivenMass: 32.64,
    friction: 0.28,
    restitution: 0,
    maxSpeed: overrides.maxSpeed ?? 1.8,
    acceleration: overrides.acceleration ?? 3.5,
    gravityScale: 0.8,
    linearDamping: 0.45,
    angularDamping: 0.8,
    metadata: {
      id: "blob-motor",
      kind: "npc",
      characterId: "blob",
      faction: "zombies",
    },
  });
}
