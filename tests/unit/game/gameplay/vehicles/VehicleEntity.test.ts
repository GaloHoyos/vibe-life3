import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Scene, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { RaycastSource } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import type { EntityIOSystem } from "@game/script/EntityIOSystem";
import type { VehicleDefinition, VehicleWaypointDefinition } from "@game/levels/LevelDefinition";
import { VehicleEntity } from "@game/gameplay/vehicles/VehicleEntity";
import { WaterVolumeSystem } from "@game/gameplay/vehicles/water/WaterVolumeSystem";

beforeAll(async () => {
  await RAPIER.init();
});

describe("VehicleEntity", () => {
  it("asigna asientos por rol y respeta el preferido libre", async () => {
    const { vehicle } = await createVehicle();

    expect(vehicle.attachOccupant("!player", "driver")).toMatchObject({
      seatId: "driver",
      role: "driver",
    });
    expect(vehicle.attachOccupant("rebel-01", undefined, "gunner")).toMatchObject({
      seatId: "gunner",
    });
    // Asiento ocupado: no hay más plazas en el buggy.
    expect(vehicle.attachOccupant("rebel-02")).toBeNull();
  });

  it("no duplica a un actor ya sentado", async () => {
    const { vehicle } = await createVehicle();
    const first = vehicle.attachOccupant("!player", "driver");

    expect(vehicle.attachOccupant("!player", "gunner")).toEqual(first);
    expect(vehicle.getOccupants()).toHaveLength(1);
  });

  it("cambia de asiento saltando los ocupados y vuelve si no hay libre", async () => {
    const { vehicle } = await createVehicle();
    vehicle.attachOccupant("!player", "driver");

    expect(vehicle.moveOccupantToNextSeat("!player")?.seatId).toBe("gunner");
    expect(vehicle.moveOccupantToNextSeat("!player")?.seatId).toBe("driver");

    vehicle.attachOccupant("rebel-01", "gunner");
    // Sin asiento libre, el ocupante se queda donde estaba.
    expect(vehicle.moveOccupantToNextSeat("!player")?.seatId).toBe("driver");
  });

  it("detachOccupant libera la plaza para el siguiente actor", async () => {
    const { vehicle } = await createVehicle();
    vehicle.attachOccupant("!player", "driver");

    expect(vehicle.detachOccupant("!player")?.seatId).toBe("driver");
    expect(vehicle.detachOccupant("!player")).toBeNull();
    expect(vehicle.attachOccupant("rebel-01", "driver")?.seatId).toBe("driver");
  });

  it("selfRight endereza y detiene el chasis, salvo con el jugador a bordo", async () => {
    const { vehicle, physics } = await createVehicle();
    vehicle.body.setLinvel({ x: 4, y: -2, z: 9 }, true);
    vehicle.body.setRotation({ x: 0.7071, y: 0, z: 0, w: 0.7071 }, true);

    expect(vehicle.selfRight()).toBe(true);
    expect(vehicle.getLinearVelocity().length()).toBeCloseTo(0, 5);
    const upright = new Vector3(0, 1, 0).applyQuaternion(
      vehicle.getWorldRotation(),
    );
    expect(upright.y).toBeCloseTo(1, 4);

    vehicle.attachOccupant("!player", "driver");
    expect(vehicle.selfRight()).toBe(false);
    physics.step(1 / 60);
  });

  it("sin ruta de crash el buggy pasa directo a wreckage", async () => {
    const onCrashStarted = vi.fn();
    const onCrashFinished = vi.fn();
    const { vehicle } = await createVehicle({
      callbacks: { onCrashStarted, onCrashFinished },
    });

    vehicle.beginCrash();

    expect(onCrashStarted).toHaveBeenCalledTimes(1);
    expect(vehicle.isCrashing()).toBe(false);
    expect(vehicle.isWreckage()).toBe(true);
    expect(vehicle.isEngineOn()).toBe(false);
    // `crashPolicy` por defecto no es survivable.
    expect(onCrashFinished).toHaveBeenCalledWith(vehicle, false);
  });

  it("el helicóptero con ruta de crash cae guiado antes del wreckage", async () => {
    const onCrashFinished = vi.fn();
    const { vehicle } = await createVehicle({
      definition: {
        id: "test-heli",
        presetId: "helicopter",
        position: [0, 30, 0],
        pathStart: "wp-flight-a",
        crashPathStart: "wp-crash-a",
        crashPolicy: "survivable",
      },
      waypoints: [
        { id: "wp-flight-a", position: [0, 30, 0], next: "wp-flight-b" },
        { id: "wp-flight-b", position: [0, 30, 60] },
        { id: "wp-crash-a", position: [0, 28, 10], next: "wp-crash-b" },
        { id: "wp-crash-b", position: [0, 2, 40] },
      ],
      callbacks: { onCrashFinished },
    });

    vehicle.beginCrash();

    expect(vehicle.isCrashing()).toBe(true);
    expect(vehicle.isWreckage()).toBe(false);
    expect(onCrashFinished).not.toHaveBeenCalled();

    vehicle.finishCrash();
    expect(vehicle.isWreckage()).toBe(true);
    expect(onCrashFinished).toHaveBeenCalledWith(vehicle, true);
  });

  it("un vehículo estacionado enciende al tomar los mandos", async () => {
    const { vehicle } = await createVehicle({
      definition: { engineOn: false },
    });
    expect(vehicle.isEngineOn()).toBe(false);

    expect(vehicle.tryStartEngine()).toBe(true);
    expect(vehicle.isEngineOn()).toBe(true);
  });

  it("un chasis inutilizado o hecho pedazos no vuelve a encender", async () => {
    const { vehicle: disabled } = await createVehicle({
      definition: { engineOn: false },
    });
    // Motor a cero: `disableAtZero` deja el vehículo inutilizado.
    disabled.damage.applyDamage(1000, undefined, "engine", "combine-01");
    expect(disabled.tryStartEngine()).toBe(false);
    expect(disabled.isEngineOn()).toBe(false);

    const { vehicle: wreck } = await createVehicle({
      definition: { engineOn: false },
    });
    wreck.damage.applyDamage(10_000, undefined, "hull", "combine-01");
    expect(wreck.tryStartEngine()).toBe(false);
    expect(wreck.isEngineOn()).toBe(false);
  });

  it("un vehículo deshabilitado por el nivel sigue apagado", async () => {
    const { vehicle } = await createVehicle({
      definition: { engineOn: false, startDisabled: true },
    });

    expect(vehicle.tryStartEngine()).toBe(false);
    expect(vehicle.isEngineOn()).toBe(false);
  });

  it("el snapshot restaura pose, flags, daño y ocupantes válidos", async () => {
    const { vehicle } = await createVehicle();
    vehicle.attachOccupant("!player", "driver");
    vehicle.setLights(true);
    vehicle.setLocked(true);
    vehicle.damage.applyDamage(90, undefined, "engine", "combine-01");
    vehicle.body.setTranslation({ x: 12, y: 3, z: -4 }, true);
    const snapshot = vehicle.capture();

    const { vehicle: other } = await createVehicle();
    other.restore({
      ...snapshot,
      id: other.id,
      // Un actor que no existe de este lado no debe bloquear la plaza.
      occupants: [
        ...snapshot.occupants,
        { actor: "fantasma", seatId: "no-existe", role: "passenger" },
      ],
    });

    expect(other.getWorldPosition().x).toBeCloseTo(12, 5);
    expect(other.isLocked()).toBe(true);
    expect(other.getOccupants()).toHaveLength(1);
    expect(other.getOccupant("!player")?.seatId).toBe("driver");
    expect(other.damage.capture()).toEqual(vehicle.damage.capture());
  });

  it("dispose libera los hooks del step y no vuelve a tocar el cuerpo", async () => {
    const { vehicle, physics } = await createVehicle();

    vehicle.dispose();
    expect(() => physics.step(1 / 60)).not.toThrow();
  });
});

async function createVehicle(options?: {
  definition?: Partial<VehicleDefinition>;
  waypoints?: readonly VehicleWaypointDefinition[];
  callbacks?: Partial<{
    onCrashStarted: (entity: VehicleEntity) => void;
    onCrashFinished: (entity: VehicleEntity, survivable: boolean) => void;
  }>;
}): Promise<{ vehicle: VehicleEntity; physics: PhysicsWorld }> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.25, 0),
    size: new Vector3(120, 0.5, 120),
  });

  const definition: VehicleDefinition = {
    id: "test-buggy",
    presetId: "buggy",
    position: [0, 1, 0],
    ...options?.definition,
  };
  const waypoints = new Map<string, VehicleWaypointDefinition>(
    (options?.waypoints ?? []).map((waypoint) => [waypoint.id, waypoint]),
  );
  const io = {
    registerEntity: vi.fn(),
    registerConnections: vi.fn(),
    fireOutput: vi.fn(),
  } as unknown as EntityIOSystem;

  const vehicle = new VehicleEntity(
    physics,
    new Scene(),
    { cast: vi.fn(() => null) } as unknown as RaycastSource,
    new WaterVolumeSystem(new Scene()),
    definition,
    waypoints,
    new EventBus<GameEventMap>(),
    io,
    {
      onImpact: vi.fn(),
      onCrashStarted: options?.callbacks?.onCrashStarted ?? vi.fn(),
      onCrashFinished: options?.callbacks?.onCrashFinished ?? vi.fn(),
      onDestroyed: vi.fn(),
    },
  );
  return { vehicle, physics };
}
