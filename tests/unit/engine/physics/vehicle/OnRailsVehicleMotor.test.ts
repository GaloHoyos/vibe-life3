import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { OnRailsVehicleMotor } from "@engine/physics/vehicle/OnRailsVehicleMotor";

beforeAll(async () => {
  await RAPIER.init();
});

describe("OnRailsVehicleMotor bajo control del piloto", () => {
  it("el acelerador cambia la velocidad de crucero en ambos sentidos", async () => {
    const cruise = await fly({ throttle: 0, steering: 0 }, 2);
    const full = await fly({ throttle: 1, steering: 0 }, 2);
    const easing = await fly({ throttle: -1, steering: 0 }, 2);

    expect(full.distance).toBeGreaterThan(cruise.distance * 1.3);
    // Con acelerador negativo frena y termina retrocediendo por el trazado.
    expect(easing.distance).toBeLessThan(cruise.distance);
    expect(easing.speed).toBeLessThan(0);
  });

  it("el timón corre el vehículo dentro del corredor, y a cada lado por igual", async () => {
    const straight = await fly({ throttle: 0, steering: 0 }, 3);
    const right = await fly({ throttle: 0, steering: 1 }, 3);
    const left = await fly({ throttle: 0, steering: -1 }, 3);

    expect(straight.lateral).toBeCloseTo(0, 2);
    expect(Math.abs(right.lateral)).toBeGreaterThan(3);
    expect(right.lateral).toBeCloseTo(-left.lateral, 5);
    // Hacia qué lado va cada signo lo fija VehicleSteering.test.ts, que lo mide
    // contra el vector derecha real en vez de contra un eje escrito a mano.
  });

  it("sin piloto se comporta igual que antes", async () => {
    const idle = await fly({ throttle: 0, steering: 0 }, 2);

    expect(idle.lateral).toBeCloseTo(0, 5);
    expect(idle.speed).toBeCloseTo(12, 1);
  });

  it("el corredor lateral no sobrevive a un seek de distancia", async () => {
    const rig = await rail();
    for (let frame = 0; frame < 180; frame += 1) {
      rig.motor.setControl({
        throttle: 0,
        steering: 1,
        brake: 0,
        handbrake: 0,
        boost: false,
      });
      rig.physics.step(1 / 60);
    }
    expect(Math.abs(rig.body.translation().x)).toBeGreaterThan(3);

    rig.motor.setDistance(20);

    expect(rig.body.translation().x).toBeCloseTo(0, 5);
  });
});

async function rail(): Promise<{
  physics: PhysicsWorld;
  body: RAPIER.RigidBody;
  motor: OnRailsVehicleMotor;
}> {
  const physics = new PhysicsWorld();
  await physics.init();
  const body = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased(),
  );
  const motor = new OnRailsVehicleMotor(body, {
    waypoints: [
      { id: "a", position: new Vector3(0, 20, 0) },
      { id: "b", position: new Vector3(0, 20, 200) },
      { id: "c", position: new Vector3(0, 20, 400) },
    ],
    autoStart: true,
    initialSpeed: 12,
    acceleration: 60,
    deceleration: 60,
    orientationSmoothing: 0,
    throttleBoostFactor: 1.7,
    reverseFactor: 0.4,
    lateralRange: 7,
    lateralResponse: 2.6,
    maxControlBank: 0.38,
  });
  physics.addPreStepHook((delta) => motor.prePhysicsStep(delta));
  physics.addPostStepHook((delta) => motor.postPhysicsStep(delta));
  return { physics, body, motor };
}

async function fly(
  control: { throttle: number; steering: number },
  seconds: number,
): Promise<{ distance: number; lateral: number; speed: number }> {
  const rig = await rail();
  for (let frame = 0; frame < Math.round(seconds * 60); frame += 1) {
    rig.motor.setControl({ ...control, brake: 0, handbrake: 0, boost: false });
    rig.physics.step(1 / 60);
  }
  return {
    distance: rig.motor.getDistance(),
    lateral: rig.body.translation().x,
    speed: rig.motor.getTelemetry().forwardSpeed,
  };
}

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
