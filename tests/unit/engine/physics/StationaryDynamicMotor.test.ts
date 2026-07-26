import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { StationaryDynamicMotor } from "@engine/physics/character/StationaryDynamicMotor";

beforeAll(async () => {
  await RAPIER.init();
});

describe("StationaryDynamicMotor", () => {
  it("conserva la configuracion box legacy usada por la torreta", async () => {
    const physics = new PhysicsWorld();
    await physics.init();

    const motor = new StationaryDynamicMotor(physics, {
      id: "turret-1",
      position: new Vector3(0, 2, 0),
      size: new Vector3(0.8, 1.2, 0.8),
      mass: 18,
      mountYaw: Math.PI / 3,
      metadata: { id: "turret-1", kind: "npc", faction: "combine" },
    });

    expect(motor.collider.shape.type).toBe(RAPIER.ShapeType.Cuboid);
    expect(motor.body.mass()).toBeCloseTo(18, 5);
    expect(motor.getYaw()).toBeCloseTo(Math.PI / 3, 5);
    expect(physics.getColliderMetadata(motor.collider)).toMatchObject({
      id: "turret-1",
      kind: "npc",
    });
  });

  it("acepta un collider box discriminado", async () => {
    const physics = new PhysicsWorld();
    await physics.init();

    const motor = new StationaryDynamicMotor(physics, {
      id: "box-npc-1",
      position: new Vector3(0, 2, 0),
      collider: { shape: "box", size: new Vector3(1, 2, 3) },
      mass: 12,
      mountYaw: 0,
      metadata: { id: "box-npc-1", kind: "npc", faction: "combine" },
    });

    expect(motor.collider.shape.type).toBe(RAPIER.ShapeType.Cuboid);
    expect((motor.collider.shape as RAPIER.Cuboid).halfExtents).toEqual({
      x: 0.5,
      y: 1,
      z: 1.5,
    });
    expect(motor.body.mass()).toBeCloseTo(12, 5);
  });

  it("acepta un collider sphere discriminado y dispose remueve el body una sola vez", async () => {
    const physics = new PhysicsWorld();
    await physics.init();

    const motor = new StationaryDynamicMotor(physics, {
      id: "blob-core-1",
      position: new Vector3(0, 3, 0),
      collider: { shape: "sphere", radius: 0.38 },
      mass: 24,
      mountYaw: 0,
      metadata: { id: "blob-core-1", kind: "npc", faction: "combine" },
    });
    const collider = motor.collider;

    expect(collider.shape.type).toBe(RAPIER.ShapeType.Ball);
    expect((collider.shape as RAPIER.Ball).radius).toBeCloseTo(0.38, 6);
    expect(motor.body.mass()).toBeCloseTo(24, 5);
    expect(physics.getBodyCount()).toBe(1);

    motor.dispose();
    expect(physics.getBodyCount()).toBe(0);
    expect(physics.getColliderMetadata(collider)).toBeUndefined();
    expect(() => motor.dispose()).not.toThrow();
    expect(physics.getBodyCount()).toBe(0);
  });
});
