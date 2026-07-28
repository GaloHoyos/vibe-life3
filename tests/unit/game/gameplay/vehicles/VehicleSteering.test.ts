import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Scene, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { RaycastSource } from "@engine/physics/Raycast";
import { OnRailsVehicleMotor } from "@engine/physics/vehicle/OnRailsVehicleMotor";
import type { GameEventMap } from "@game/GameEvents";
import type { EntityIOSystem } from "@game/script/EntityIOSystem";
import type {
  VehicleDefinition,
  WaterVolumeDefinition,
} from "@game/levels/LevelDefinition";
import { VehicleEntity } from "@game/gameplay/vehicles/VehicleEntity";
import { WaterVolumeSystem } from "@game/gameplay/vehicles/water/WaterVolumeSystem";

const DT = 1 / 60;
const WORLD_UP = new Vector3(0, 1, 0);

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * La derecha del proyecto es `forward × up`, tal como la define
 * `CameraSystem.getPlanarRight`, que es la que siente el jugador al pulsar D.
 * Con +Z adelante y +Y arriba eso da **-X**, no +X.
 *
 * Cada vehículo traducía ese signo por su cuenta y los tres lo tenían
 * distinto, así que las pruebas de acá miden contra el vector derecha en vez
 * de contra un eje escrito a mano: si alguien vuelve a invertir uno, falla.
 */
describe("convención de dirección de los vehículos", () => {
  it("el buggy dobla hacia la derecha del conductor", async () => {
    const turn = await steer("buggy", 1);

    expect(turn.rightwardTravel).toBeGreaterThan(1);
    expect(turn.noseTurnedRight).toBeGreaterThan(0.3);
  });

  it("el buggy dobla hacia la izquierda con el volante al otro lado", async () => {
    const turn = await steer("buggy", -1);

    expect(turn.rightwardTravel).toBeLessThan(-1);
    expect(turn.noseTurnedRight).toBeLessThan(-0.3);
  });

  it("el hidrodeslizador dobla hacia la derecha del piloto", async () => {
    const turn = await steer("airboat", 1, { water: true });

    expect(turn.rightwardTravel).toBeGreaterThan(1);
    expect(turn.noseTurnedRight).toBeGreaterThan(0.2);
  });

  it("el hidrodeslizador dobla hacia la izquierda con el timón al otro lado", async () => {
    const turn = await steer("airboat", -1, { water: true });

    expect(turn.rightwardTravel).toBeLessThan(-1);
    expect(turn.noseTurnedRight).toBeLessThan(-0.2);
  });

  it("el vehículo sobre riel se corre hacia la derecha del piloto", async () => {
    const right = await slide(1);
    const left = await slide(-1);

    expect(right.rightwardOffset).toBeGreaterThan(3);
    expect(left.rightwardOffset).toBeLessThan(-3);
    // Y alabea hacia adentro: al ir a la derecha baja el ala derecha.
    expect(right.rightWingHeight).toBeLessThan(-0.1);
    expect(left.rightWingHeight).toBeGreaterThan(0.1);
  });
});

/** La derecha PLANAR del proyecto, igual que `CameraSystem.getPlanarRight`. */
function rightOf(rotation: Quaternion): Vector3 {
  return new Vector3(0, 0, 1)
    .applyQuaternion(rotation)
    .cross(WORLD_UP)
    .normalize();
}

/** Rumbo en el sentido de `headingBetween`: crece girando hacia +X. */
function headingOf(rotation: Quaternion): number {
  const forward = new Vector3(0, 0, 1).applyQuaternion(rotation);
  return Math.atan2(forward.x, forward.z);
}

async function steer(
  presetId: "buggy" | "airboat",
  steering: number,
  options: { water?: boolean } = {},
): Promise<{ rightwardTravel: number; noseTurnedRight: number }> {
  const rig = await spawn(presetId, options.water ?? false);
  settle(rig, options.water ? 3 : 2);

  drive(rig, { throttle: 1, steering: 0 }, options.water ? 5 : 4);
  const startRight = rightOf(rig.vehicle.getWorldRotation());
  const startPosition = rig.vehicle.getWorldPosition().clone();

  // Guiñada acumulada con signo: el rumbo suelto se solapa en cuanto el buggy
  // pasa media vuelta, y ahí un giro a la derecha se lee como uno a izquierda.
  // La ventana va por vehículo: el hidrodeslizador vira mucho más lento y
  // además derrapa, así que tarda en desplazarse de verdad hacia el costado.
  const seconds = presetId === "airboat" ? 3.5 : 1.5;
  let yaw = 0;
  let previous = headingOf(rig.vehicle.getWorldRotation());
  for (let frame = 0; frame < Math.round(seconds / DT); frame += 1) {
    rig.vehicle.setControl({
      throttle: 1,
      steering,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    rig.physics.step(DT);
    const current = headingOf(rig.vehicle.getWorldRotation());
    let step = current - previous;
    while (step > Math.PI) step -= Math.PI * 2;
    while (step < -Math.PI) step += Math.PI * 2;
    yaw += step;
    previous = current;
  }

  const travel = rig.vehicle.getWorldPosition().sub(startPosition);
  return {
    rightwardTravel: travel.dot(startRight),
    // El rumbo crece hacia +X, que es la izquierda: doblar a la derecha lo baja.
    noseTurnedRight: -yaw,
  };
}

interface Rig {
  physics: PhysicsWorld;
  vehicle: VehicleEntity;
}

function settle(rig: Rig, seconds: number): void {
  drive(rig, { throttle: 0, steering: 0 }, seconds);
}

function drive(
  rig: Rig,
  control: { throttle: number; steering: number },
  seconds: number,
): void {
  for (let frame = 0; frame < Math.round(seconds / DT); frame += 1) {
    rig.vehicle.setControl({ ...control, brake: 0, handbrake: 0, boost: false });
    rig.physics.step(DT);
  }
}

async function spawn(
  presetId: "buggy" | "airboat",
  flooded: boolean,
): Promise<Rig> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(1200, 1, 1200),
  });
  const water = new WaterVolumeSystem(new Scene());
  if (flooded) {
    const volume: WaterVolumeDefinition = {
      id: "canal",
      position: [0, -0.5, 0],
      size: [1000, 3, 1000],
      surface: "canal",
    };
    water.load([volume]);
  }
  const definition: VehicleDefinition = {
    id: "test",
    presetId,
    position: [0, 1.2, 0],
  };
  const vehicle = new VehicleEntity(
    physics,
    new Scene(),
    { cast: vi.fn(() => null) } as unknown as RaycastSource,
    water,
    definition,
    new Map(),
    new EventBus<GameEventMap>(),
    {
      registerEntity: vi.fn(),
      registerConnections: vi.fn(),
      fireOutput: vi.fn(),
    } as unknown as EntityIOSystem,
    {
      onImpact: vi.fn(),
      onCrashStarted: vi.fn(),
      onCrashFinished: vi.fn(),
      onDestroyed: vi.fn(),
    },
  );
  physics.updateQueryPipeline();
  return { physics, vehicle };
}

async function slide(steering: number): Promise<{
  rightwardOffset: number;
  rightWingHeight: number;
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
    lateralRange: 7,
    lateralResponse: 2.6,
    maxControlBank: 0.38,
  });
  physics.addPreStepHook((delta) => motor.prePhysicsStep(delta));
  physics.addPostStepHook((delta) => motor.postPhysicsStep(delta));

  for (let frame = 0; frame < 180; frame += 1) {
    motor.setControl({
      throttle: 0,
      steering,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    physics.step(DT);
  }

  const rotation = body.rotation();
  const quaternion = new Quaternion(
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
  );
  const translation = body.translation();
  return {
    rightwardOffset: new Vector3(
      translation.x,
      translation.y,
      translation.z,
    ).dot(rightOf(quaternion)),
    // El ala derecha es el -X local; su altura delata para dónde alabea.
    rightWingHeight: new Vector3(-1, 0, 0).applyQuaternion(quaternion).y,
  };
}
