import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import {
  RaycastVehicleMotor,
  type RaycastVehicleMotorConfig,
} from "@engine/physics/vehicle/RaycastVehicleMotor";

beforeAll(async () => {
  await RAPIER.init();
});

describe("RaycastVehicleMotor", () => {
  it("aplica tracción, suspensión y telemetría mediante los hooks fijos", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    // Piso amplio: con la tracción sana el buggy alcanza su tope de 30 m/s y
    // recorre ~60 m en los 3 s de la prueba.
    physics.createStaticBox({
      id: "floor",
      position: new Vector3(0, -0.5, 0),
      size: new Vector3(400, 1, 400),
    });
    const body = physics.createDynamicBox(
      {
        id: "chassis",
        position: new Vector3(0, 0.8, 0),
        size: new Vector3(2, 0.5, 3),
        mass: 450,
      },
      new Object3D(),
    );
    const motor = new RaycastVehicleMotor(physics, body, buggyConfig());
    const disposePre = physics.addPreStepHook((delta) =>
      motor.prePhysicsStep(delta),
    );
    const disposePost = physics.addPostStepHook((delta) =>
      motor.postPhysicsStep(delta),
    );
    motor.setControl({
      throttle: 1,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });

    for (let frame = 0; frame < 180; frame += 1) {
      physics.step(1 / 60);
    }

    const telemetry = motor.getTelemetry();
    expect(telemetry.wheels).toHaveLength(4);
    expect(telemetry.contactCount).toBeGreaterThan(0);
    expect(Math.abs(telemetry.forwardSpeed)).toBeGreaterThan(0.25);
    expect(telemetry.engineRpm).toBeGreaterThan(700);
    expect(Math.hypot(body.translation().x, body.translation().z)).toBeGreaterThan(
      0.5,
    );

    disposePre();
    disposePost();
    motor.dispose();
    expect(motor.isEnabled()).toBe(false);
  });

  it("captura y restaura pose y velocidades sin apropiarse del body", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const body = physics.createDynamicBox(
      {
        id: "save-chassis",
        position: new Vector3(1, 2, 3),
        size: new Vector3(2, 0.5, 3),
        mass: 450,
      },
      new Object3D(),
    );
    const motor = new RaycastVehicleMotor(physics, body, buggyConfig());
    body.setLinvel({ x: 2, y: 3, z: 4 }, true);
    const state = motor.captureState();

    body.setTranslation({ x: 20, y: 20, z: 20 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    motor.restoreState(state);

    expect(body.translation()).toEqual({ x: 1, y: 2, z: 3 });
    expect(body.linvel()).toEqual({ x: 2, y: 3, z: 4 });
    motor.dispose();
    expect(body.isValid()).toBe(true);
  });
});

function buggyConfig(): RaycastVehicleMotorConfig {
  const wheel = (
    x: number,
    z: number,
    steering: boolean,
    handbrake: boolean,
  ) => ({
    connection: new Vector3(x, -0.15, z),
    radius: 0.38,
    suspensionRestLength: 0.38,
    maxSuspensionTravel: 0.3,
    suspensionStiffness: 42,
    suspensionCompression: 4.4,
    suspensionRelaxation: 5.2,
    maxSuspensionForce: 12000,
    frictionSlip: 3,
    sideFrictionStiffness: 1.5,
    steering,
    driven: true,
    braking: true,
    handbrake,
  });
  return {
    wheels: [
      wheel(-0.82, 1.05, true, false),
      wheel(0.82, 1.05, true, false),
      wheel(-0.82, -1.05, false, true),
      wheel(0.82, -1.05, false, true),
    ],
    maxEngineForce: 3200,
    maxReverseForce: 2200,
    maxBrakeForce: 140,
    maxHandbrakeForce: 220,
    maxSteeringAngle: 0.55,
    maxForwardSpeed: 30,
    maxReverseSpeed: 12,
    throttleResponse: 8,
    steeringResponse: 10,
    highSpeedSteeringFactor: 0.25,
    directionChangeBrakeSpeed: 1.5,
    boostMultiplier: 1.4,
    antiRollStiffness: 1800,
    antiRollPairs: [
      [0, 1],
      [2, 3],
    ],
  };
}
