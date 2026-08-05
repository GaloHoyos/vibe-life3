import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import type {
  VehicleCrewRole,
  VehicleSeatPreset,
} from "@game/config/vehicles.config";
import {
  VehicleNpcCrewCoordinator,
  type VehicleNpcCrewAction,
} from "@game/gameplay/vehicles/VehicleNpcCrewCoordinator";
import type {
  VehicleEntity,
  VehicleOccupant,
} from "@game/gameplay/vehicles/VehicleEntity";
import type {
  INpc,
  NpcVehicleApproachOrder,
  NpcVehicleApproachStatus,
} from "@game/npc/core/INpc";

describe("VehicleNpcCrewCoordinator", () => {
  it("reserva plazas únicas y aplica la política de acceso por rol", () => {
    const harness = createVehicle([
      seat("driver", "driver"),
      seat("gunner", "gunner"),
      seat("passenger", "passenger"),
    ]);
    const coordinator = new VehicleNpcCrewCoordinator();
    const alyx = createNpc("alyx");
    const rebel = createNpc("rebel-01");
    const extra = createNpc("rebel-02");

    expect(
      coordinator.requestBoarding(alyx.npc, harness.vehicle)?.seatId,
    ).toBe("gunner");
    expect(
      coordinator.requestBoarding(rebel.npc, harness.vehicle)?.seatId,
    ).toBe("passenger");
    expect(coordinator.requestBoarding(extra.npc, harness.vehicle)).toBeNull();

    expect(
      coordinator.getSeatReservation(harness.vehicle.id, "gunner"),
    ).toBe("alyx");
    expect(
      coordinator.getSeatReservation(harness.vehicle.id, "passenger"),
    ).toBe("rebel-01");
    expect(
      coordinator.getSeatReservation(harness.vehicle.id, "driver"),
    ).toBeNull();
  });

  it("ordena approach y sólo emite board al llegar a la entrada reservada", () => {
    const harness = createVehicle([seat("passenger", "passenger")], {
      passenger: [new Vector3(4, 0, 2)],
    });
    const npc = createNpc("alyx", new Vector3(0, 0, 0));
    const coordinator = new VehicleNpcCrewCoordinator();

    const reserved = coordinator.requestBoarding(npc.npc, harness.vehicle);
    expect(reserved?.phase).toBe("approach");
    expect(npc.order()?.target).toEqual(new Vector3(4, 0, 2));
    expect(coordinator.drainActions()).toHaveLength(0);

    npc.npc.position.copy(new Vector3(4, 0, 2));
    npc.setApproachStatus("arrived");
    coordinator.update(0.1);

    expect(coordinator.getAssignment(npc.npc.id)?.phase).toBe("boarding");
    expect(coordinator.drainActions()).toEqual([
      expect.objectContaining({
        type: "board",
        seatId: "passenger",
        role: "passenger",
      }),
    ]);

    harness.occupy(npc.npc.id, "passenger");
    npc.setMounted(true);
    expect(coordinator.confirmBoarded(npc.npc.id)).toBe(true);
    expect(coordinator.getAssignment(npc.npc.id)?.phase).toBe("mounted");
    expect(
      coordinator.getSeatReservation(harness.vehicle.id, "passenger"),
    ).toBeNull();
  });

  it("cancel libera la orden y permite reutilizar el asiento", () => {
    const harness = createVehicle([seat("passenger", "passenger")]);
    const first = createNpc("rebel-01");
    const second = createNpc("rebel-02");
    const coordinator = new VehicleNpcCrewCoordinator();

    expect(coordinator.requestBoarding(first.npc, harness.vehicle)).not.toBeNull();
    expect(coordinator.cancel(first.npc.id)).toBe(true);

    expect(first.order()).toBeNull();
    expect(coordinator.getAssignment(first.npc.id)).toBeNull();
    expect(
      coordinator.requestBoarding(second.npc, harness.vehicle)?.seatId,
    ).toBe("passenger");
  });

  it("serializa una evacuación cuando dos NPC comparten la misma salida", () => {
    const sharedExit = new Vector3(2, 0, 0);
    const harness = createVehicle(
      [
        seat("left", "passenger"),
        seat("right", "passenger"),
      ],
      {
        left: [sharedExit],
        right: [sharedExit],
      },
    );
    const first = createNpc("rebel-01");
    const second = createNpc("rebel-02");
    harness.occupy(first.npc.id, "left");
    harness.occupy(second.npc.id, "right");
    first.setMounted(true);
    second.setMounted(true);

    const coordinator = new VehicleNpcCrewCoordinator();
    coordinator.adoptMounted(first.npc, harness.vehicle);
    coordinator.adoptMounted(second.npc, harness.vehicle);

    expect(coordinator.evacuate(harness.vehicle, true)).toEqual({
      exiting: 1,
      queued: 1,
      canceledApproaches: 0,
    });
    expect(coordinator.getAssignment(first.npc.id)?.phase).toBe("exiting");
    expect(coordinator.getAssignment(second.npc.id)?.phase).toBe("mounted");
    expect(coordinator.getExitReservations(harness.vehicle.id)).toHaveLength(1);
    expect(exitActions(coordinator.drainActions())).toHaveLength(1);

    harness.detach(first.npc.id);
    first.setMounted(false);
    expect(coordinator.confirmExited(first.npc.id)).toBe(true);
    coordinator.update(0.1);

    expect(coordinator.getAssignment(second.npc.id)?.phase).toBe("exiting");
    expect(
      coordinator.getExitReservations(harness.vehicle.id)[0]?.actorId,
    ).toBe(second.npc.id);
    expect(exitActions(coordinator.drainActions())).toHaveLength(1);
  });

  it("mantiene el descenso normal en cola hasta que el vehículo se detiene", () => {
    const harness = createVehicle([seat("passenger", "passenger")]);
    const npc = createNpc("alyx");
    harness.occupy(npc.npc.id, "passenger");
    npc.setMounted(true);
    harness.setSpeed(4);
    const coordinator = new VehicleNpcCrewCoordinator();
    coordinator.adoptMounted(npc.npc, harness.vehicle);

    expect(coordinator.requestExit(npc.npc.id)).toBe("queued");
    expect(coordinator.drainActions()).toHaveLength(0);

    harness.setSpeed(0);
    coordinator.update(0.1);
    expect(coordinator.getAssignment(npc.npc.id)?.phase).toBe("exiting");
    expect(exitActions(coordinator.drainActions())).toHaveLength(1);
  });

  it("cancela un descenso en cola sin expulsar al NPC al detenerse", () => {
    const harness = createVehicle([seat("passenger", "passenger")]);
    const npc = createNpc("alyx");
    harness.occupy(npc.npc.id, "passenger");
    npc.setMounted(true);
    harness.setSpeed(4);
    const coordinator = new VehicleNpcCrewCoordinator();
    coordinator.adoptMounted(npc.npc, harness.vehicle);

    expect(coordinator.requestExit(npc.npc.id)).toBe("queued");
    expect(coordinator.cancel(npc.npc.id)).toBe(true);

    harness.setSpeed(0);
    coordinator.update(0.1);
    expect(coordinator.getAssignment(npc.npc.id)?.phase).toBe("mounted");
    expect(exitActions(coordinator.drainActions())).toHaveLength(0);
  });

  it("fuerza una salida de emergencia aunque el asiento no tenga anchors", () => {
    const harness = createVehicle(
      [seat("passenger", "passenger")],
      { passenger: [] },
    );
    const npc = createNpc("alyx", new Vector3());
    harness.occupy(npc.npc.id, "passenger");
    npc.setMounted(true);
    const coordinator = new VehicleNpcCrewCoordinator();
    coordinator.adoptMounted(npc.npc, harness.vehicle);

    expect(coordinator.requestExit(npc.npc.id, true)).toBe("started");
    expect(exitActions(coordinator.drainActions())).toEqual([
      expect.objectContaining({
        type: "exit",
        emergency: true,
        exitIndex: -1,
      }),
    ]);
  });

  it("cancela el approach si el vehículo arranca o el NPC muere", () => {
    const harness = createVehicle([seat("passenger", "passenger")]);
    const movingNpc = createNpc("rebel-01");
    const deadNpc = createNpc("rebel-02");
    const coordinator = new VehicleNpcCrewCoordinator();

    coordinator.requestBoarding(movingNpc.npc, harness.vehicle);
    harness.setSpeed(3);
    coordinator.update(0.1);
    expect(coordinator.getAssignment(movingNpc.npc.id)).toBeNull();
    expect(movingNpc.order()).toBeNull();

    harness.setSpeed(0);
    coordinator.requestBoarding(deadNpc.npc, harness.vehicle);
    deadNpc.kill();
    coordinator.update(0.1);
    expect(coordinator.getAssignment(deadNpc.npc.id)).toBeNull();
    expect(
      coordinator.getSeatReservation(harness.vehicle.id, "passenger"),
    ).toBeNull();
  });

  it("no reserva asientos en un vehículo incendiado", () => {
    const harness = createVehicle([seat("passenger", "passenger")]);
    harness.setBurning(true);
    const coordinator = new VehicleNpcCrewCoordinator();

    expect(
      coordinator.requestBoarding(createNpc("rebel-01").npc, harness.vehicle),
    ).toBeNull();
  });
});

interface NpcHarness {
  readonly npc: INpc;
  order(): NpcVehicleApproachOrder | null;
  setApproachStatus(status: NpcVehicleApproachStatus): void;
  setMounted(mounted: boolean): void;
  kill(): void;
}

function createNpc(
  id: string,
  position = new Vector3(),
  canDrive = false,
): NpcHarness {
  let alive = true;
  let mounted = false;
  let approachStatus: NpcVehicleApproachStatus = "none";
  let approachOrder: NpcVehicleApproachOrder | null = null;

  const npc = {
    id,
    faction: "resistance",
    position,
    vehicleCapability: { canDrive },
    isAlive: () => alive,
    isVehicleMounted: () => mounted,
    setVehicleApproach: (order: NpcVehicleApproachOrder | null) => {
      if (!order) {
        approachOrder = null;
        approachStatus = "none";
        return;
      }
      const sameReservation =
        approachOrder?.vehicleId === order.vehicleId &&
        approachOrder.seatId === order.seatId;
      approachOrder = {
        ...order,
        target: order.target.clone(),
        facing: order.facing.clone(),
      };
      if (!sameReservation) approachStatus = "moving";
    },
    getVehicleApproachStatus: () => approachStatus,
  } as unknown as INpc;

  return {
    npc,
    order: () => approachOrder,
    setApproachStatus: (status) => {
      approachStatus = status;
    },
    setMounted: (value) => {
      mounted = value;
      if (mounted) {
        approachOrder = null;
        approachStatus = "none";
      }
    },
    kill: () => {
      alive = false;
    },
  };
}

interface VehicleHarness {
  readonly vehicle: VehicleEntity;
  occupy(actorId: string, seatId: string): void;
  detach(actorId: string): void;
  setSpeed(speed: number): void;
  setBurning(burning: boolean): void;
}

function createVehicle(
  seats: readonly VehicleSeatPreset[],
  exits: Readonly<Record<string, readonly Vector3[]>> = {},
): VehicleHarness {
  const occupants = new Map<string, VehicleOccupant>();
  const velocity = new Vector3();
  const position = new Vector3();
  let burning = false;
  const vehicle = {
    id: "buggy-01",
    definition: {
      id: "buggy-01",
      presetId: "buggy",
      position: [0, 0, 0],
      accessPolicy: "player",
      faction: "resistance",
    },
    preset: { seats, navigation: { halfWidth: 1.1 } },
    damage: {
      getState: () => "operational",
      isBurning: () => burning,
    },
    isEnabled: () => true,
    isLocked: () => false,
    isCrashing: () => false,
    isWreckage: () => false,
    getLinearVelocity: () => velocity.clone(),
    getWorldPosition: (out = new Vector3()) => out.copy(position),
    getExitWorldPositions: (seatId: string) =>
      (exits[seatId] ?? [new Vector3(1, 0, 0)]).map((exit) => exit.clone()),
    getOccupants: () => [...occupants.values()],
    getOccupant: (actorId: string) =>
      [...occupants.values()].find((occupant) => occupant.actor === actorId) ??
      null,
  } as unknown as VehicleEntity;

  return {
    vehicle,
    occupy: (actorId, seatId) => {
      const preset = seats.find((candidate) => candidate.id === seatId);
      if (!preset) throw new Error(`Asiento inexistente: ${seatId}`);
      occupants.set(seatId, {
        actor: actorId,
        seatId,
        role: preset.role,
      });
    },
    detach: (actorId) => {
      const occupant = [...occupants.values()].find(
        (candidate) => candidate.actor === actorId,
      );
      if (occupant) occupants.delete(occupant.seatId);
    },
    setSpeed: (speed) => {
      velocity.set(speed, 0, 0);
    },
    setBurning: (value) => {
      burning = value;
    },
  };
}

function seat(id: string, role: VehicleCrewRole): VehicleSeatPreset {
  return {
    id,
    role,
    position: [0, 0, 0],
    cameraPosition: [0, 0, 0],
    exits: [[1, 0, 0]],
  };
}

function exitActions(
  actions: readonly VehicleNpcCrewAction[],
): readonly VehicleNpcCrewAction[] {
  return actions.filter((action) => action.type === "exit");
}
