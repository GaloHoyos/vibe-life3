import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { KinematicFlyerMotor } from "@engine/physics/character/KinematicFlyerMotor";

beforeAll(async () => {
  await RAPIER.init();
});

describe("KinematicFlyerMotor", () => {
  it("flies as a kinematic body while alive and falls dynamically after disable", async () => {
    const physics = new PhysicsWorld();
    await physics.init();

    const motor = new KinematicFlyerMotor(physics, {
      id: "gunship-1",
      position: new Vector3(0, 8, 0),
      height: 2.4,
      radius: 0.95,
      mass: 900,
      maxSpeed: 8,
      acceleration: 4,
      turnSpeed: 3,
      metadata: {
        id: "gunship-1",
        kind: "npc",
        faction: "combine",
      },
    });

    expect(motor.body.isDynamic()).toBe(false);
    motor.update(1 / 60, new Vector3(0, 9, 6), true, new Vector3(0, 8, 10));
    physics.step(1 / 60);

    const position = motor.getPosition();
    const rotation = motor.getRotation();
    expect(Number.isFinite(position.x)).toBe(true);
    expect(Number.isFinite(position.y)).toBe(true);
    expect(Number.isFinite(rotation.w)).toBe(true);

    motor.disable();
    expect(motor.body.isDynamic()).toBe(true);
    const y = motor.getPosition().y;
    physics.step(1 / 60);
    expect(motor.getPosition().y).toBeLessThan(y);
  });
});
