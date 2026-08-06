import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import {
  HoverVehicleMotor,
  type HoverVehicleMotorConfig,
} from "@engine/physics/vehicle/HoverVehicleMotor";
import type {
  VehicleSurfaceProvider,
  VehicleSurfaceSample,
} from "@engine/physics/vehicle/VehicleMotor";

beforeAll(async () => {
  await RAPIER.init();
});

describe("HoverVehicleMotor", () => {
  it("aplica flotación por probe y expone inmersión", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const body = physics.createDynamicBox(
      {
        id: "airboat",
        position: new Vector3(0, 0.3, 0),
        size: new Vector3(2, 0.6, 4),
        mass: 350,
      },
      new Object3D(),
    );
    const motor = new HoverVehicleMotor(body, hoverConfig(waterAt(0)));

    motor.prePhysicsStep(1 / 60);
    motor.postPhysicsStep(1 / 60);

    expect(body.userForce().y).toBeGreaterThan(0);
    expect(motor.getTelemetry().contactCount).toBe(4);
    expect(motor.getTelemetry().submergedRatio).toBeGreaterThan(0);
    expect(motor.getTelemetry().grounded).toBe(true);
  });

  it("usa propulsión terrestre reducida cuando no encuentra agua", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const body = physics.createDynamicBox(
      {
        id: "beached-airboat",
        position: new Vector3(0, 1, 0),
        size: new Vector3(2, 0.6, 4),
        mass: 350,
      },
      new Object3D(),
    );
    const provider: VehicleSurfaceProvider = {
      sampleSurface: () => null,
    };
    const motor = new HoverVehicleMotor(body, hoverConfig(provider));
    motor.setControl({
      throttle: 1,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });

    motor.prePhysicsStep(1 / 60);

    expect(body.userForce().z).toBeGreaterThan(0);
    expect(body.userForce().z).toBeLessThan(
      hoverConfig(provider).maxForwardThrust,
    );
    expect(motor.getTelemetry().contactCount).toBe(0);
  });

  it("mantiene una sonda antigravitatoria sobre una superficie sólida", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const body = physics.createDynamicBox(
      {
        id: "combine-glider",
        position: new Vector3(0, 0.85, 0),
        size: new Vector3(2, 0.6, 3.4),
        mass: 350,
      },
      new Object3D(),
    );
    const solid: VehicleSurfaceProvider = {
      sampleSurface: (probePosition) => ({
        point: new Vector3(probePosition.x, 0, probePosition.z),
        normal: new Vector3(0, 1, 0),
        velocity: new Vector3(),
        kind: "solid",
        density: 1,
      }),
    };
    const config = hoverConfig(solid);
    config.probes.forEach((probe) => {
      probe.hoverHeight = 0.7;
    });
    const motor = new HoverVehicleMotor(body, config);

    motor.prePhysicsStep(1 / 60);
    motor.postPhysicsStep(1 / 60);

    expect(body.userForce().y).toBeGreaterThan(0);
    expect(motor.getTelemetry().contactCount).toBe(4);
    expect(motor.getTelemetry().submergedRatio).toBe(0);
  });
});

function waterAt(height: number): VehicleSurfaceProvider {
  const sample: VehicleSurfaceSample = {
    point: new Vector3(),
    normal: new Vector3(0, 1, 0),
    velocity: new Vector3(),
    kind: "fluid",
    density: 1,
  };
  return {
    sampleSurface: (probePosition) => {
      sample.point.set(probePosition.x, height, probePosition.z);
      return sample;
    },
  };
}

function hoverConfig(
  surfaceProvider: VehicleSurfaceProvider,
): HoverVehicleMotorConfig {
  const probe = (x: number, z: number) => ({
    position: new Vector3(x, -0.5, z),
    buoyancyStiffness: 6500,
    buoyancyDamping: 900,
    maxBuoyancyForce: 5000,
  });
  return {
    surfaceProvider,
    probes: [
      probe(-0.75, 1.4),
      probe(0.75, 1.4),
      probe(-0.75, -1.4),
      probe(0.75, -1.4),
    ],
    maxSubmersionDepth: 1,
    maxForwardThrust: 6000,
    maxReverseThrust: 3500,
    maxSteeringTorque: 2600,
    maxForwardSpeed: 28,
    maxReverseSpeed: 10,
    forwardDrag: 90,
    lateralDrag: 600,
    verticalDrag: 800,
    angularDrag: 250,
    planingLift: 7,
    maxPlaningLift: 3000,
    landThrustFactor: 0.12,
    throttleResponse: 8,
    boostMultiplier: 1.25,
  };
}
