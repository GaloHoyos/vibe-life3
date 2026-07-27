import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { OnRailsVehicleMotor } from "@engine/physics/vehicle/OnRailsVehicleMotor";

beforeAll(async () => {
  await RAPIER.init();
});

describe("OnRailsVehicleMotor", () => {
  it("recorre la spline en metros, emite waypoints y termina una sola vez", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased(),
    );
    const onWaypoint = vi.fn();
    const onComplete = vi.fn();
    const motor = new OnRailsVehicleMotor(body, {
      waypoints: [
        { id: "start", position: new Vector3(0, 3, 0) },
        { id: "middle", position: new Vector3(0, 3, 5), speed: 10 },
        { id: "end", position: new Vector3(0, 3, 10) },
      ],
      autoStart: true,
      initialSpeed: 5,
      acceleration: 100,
      deceleration: 100,
      orientationSmoothing: 0,
      onWaypoint,
      onComplete,
    });
    physics.addPreStepHook((delta) => motor.prePhysicsStep(delta));
    physics.addPostStepHook((delta) => motor.postPhysicsStep(delta));

    for (let frame = 0; frame < 180; frame += 1) {
      physics.step(1 / 60);
    }

    expect(body.translation().z).toBeCloseTo(10, 3);
    expect(onWaypoint).toHaveBeenCalledWith(
      expect.objectContaining({ id: "middle" }),
    );
    expect(onWaypoint).toHaveBeenCalledWith(
      expect.objectContaining({ id: "end" }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(motor.isRunning()).toBe(false);
  });

  it("respeta Start, Stop, SetSpeed, espera y seek de distancia", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased(),
    );
    const motor = new OnRailsVehicleMotor(body, {
      waypoints: [
        { id: "a", position: new Vector3(0, 0, 0) },
        { id: "wait", position: new Vector3(0, 0, 2), wait: 0.25 },
        { id: "b", position: new Vector3(0, 0, 4) },
      ],
      autoStart: false,
      initialSpeed: 2,
      acceleration: 100,
      deceleration: 100,
      orientationSmoothing: 0,
    });
    physics.addPreStepHook((delta) => motor.prePhysicsStep(delta));
    physics.addPostStepHook((delta) => motor.postPhysicsStep(delta));

    physics.step(1 / 60);
    expect(body.translation().z).toBeCloseTo(0, 4);

    motor.setTargetSpeed(4);
    motor.start();
    for (let frame = 0; frame < 35; frame += 1) {
      physics.step(1 / 60);
    }
    expect(motor.getDistance()).toBeGreaterThanOrEqual(2);
    expect(motor.getDistance()).toBeLessThan(4);

    motor.stop();
    for (let frame = 0; frame < 10; frame += 1) {
      physics.step(1 / 60);
    }
    const stoppedDistance = motor.getDistance();
    physics.step(1 / 60);
    expect(motor.getDistance()).toBeCloseTo(stoppedDistance, 5);

    motor.setDistance(1);
    expect(body.translation().z).toBeCloseTo(1, 2);
    const saved = motor.captureState();
    motor.setDistance(3.5);
    motor.restoreState(saved);
    expect(motor.getDistance()).toBeCloseTo(1, 1);
  });
});
