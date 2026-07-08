import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import { StriderWalkerMotor } from "@engine/physics/character/StriderWalkerMotor";

beforeAll(async () => {
  await RAPIER.init();
});

describe("StriderWalkerMotor", () => {
  it("plants tripod legs, creates part followers, and becomes dynamic on death", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    physics.createStaticBox({
      id: "ground",
      position: new Vector3(0, -0.1, 0),
      size: new Vector3(80, 0.2, 80),
    });
    physics.updateQueryPipeline();

    const motor = new StriderWalkerMotor(physics, {
      id: "strider-1",
      position: new Vector3(0, 6.8, 0),
      height: 9.5,
      radius: 1.35,
      mass: 3200,
      maxSpeed: 4.6,
      acceleration: 4,
      turnSpeed: 2,
      raycast: new Raycast(physics),
      metadata: {
        id: "strider-1",
        kind: "npc",
        faction: "combine",
      },
    });

    expect(motor.body.isDynamic()).toBe(false);
    expect(physics.getBodyCount()).toBeGreaterThan(8);
    motor.update(1 / 60, new Vector3(0, 0, 8), true, new Vector3(0, 0, 10));
    physics.step(1 / 60);

    const legs = motor.getLegSnapshots();
    expect(legs).toHaveLength(3);
    expect(legs.filter((leg) => leg.phase === "planted").length).toBeGreaterThanOrEqual(2);
    for (const leg of legs) {
      expect(Number.isFinite(leg.foot.x)).toBe(true);
      expect(leg.foot.y).toBeGreaterThanOrEqual(-0.1);
    }

    motor.disable();
    expect(motor.body.isDynamic()).toBe(true);
    const bodyCountAfterDisable = physics.getBodyCount();
    expect(bodyCountAfterDisable).toBeLessThan(8);
    const y = motor.getPosition().y;
    physics.step(1 / 60);
    expect(motor.getPosition().y).toBeLessThan(y);
  });
});
