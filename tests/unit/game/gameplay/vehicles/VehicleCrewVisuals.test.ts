import { describe, expect, it, vi } from "vitest";
import { Group, Quaternion, Vector3 } from "three";
import { VehicleCrewVisuals } from "@game/gameplay/vehicles/VehicleCrewVisuals";
import type { VehicleEntity } from "@game/gameplay/vehicles/VehicleEntity";
import type { INpc, NpcSeatPose } from "@game/npc/core/INpc";

const HZ_60 = 1 / 60;
const SEAT = new Vector3(10, 2, 5);

describe("VehicleCrewVisuals", () => {
  it("la tripulación autorada arranca sentada, sin transición", () => {
    const { crew, npc, poses } = setup();

    crew.board(npc, vehicle(), "driver", "driver", true);

    expect(poses.at(-1)?.seated).toBe(1);
    expect(npc.mesh.position.distanceTo(SEAT)).toBeLessThan(0.001);
  });

  it("la subida mezcla desde la pose de pie hasta el asiento", () => {
    const { crew, npc, poses } = setup(new Vector3(11, 1, 5));

    crew.board(npc, vehicle(), "driver", "driver", false);
    expect(poses.at(-1)?.seated).toBeLessThan(0.2);

    crew.update(0.2);
    const mid = poses.at(-1);
    expect(mid?.seated).toBeGreaterThan(0.1);
    expect(mid?.seated).toBeLessThan(0.95);
    expect(npc.mesh.position.distanceTo(SEAT)).toBeGreaterThan(0.05);

    for (let i = 0; i < 40; i += 1) crew.update(HZ_60);
    expect(poses.at(-1)?.seated).toBe(1);
    expect(npc.mesh.position.distanceTo(SEAT)).toBeLessThan(0.001);
  });

  it("subir desde lejos no arrastra el cuerpo: sienta de una", () => {
    const { crew, npc, poses } = setup(new Vector3(40, 1, 5));

    crew.board(npc, vehicle(), "driver", "driver", false);

    expect(poses.at(-1)?.seated).toBe(1);
    expect(npc.mesh.position.distanceTo(SEAT)).toBeLessThan(0.001);
  });

  it("la bajada devuelve el motor recién al terminar el blend", () => {
    const { crew, npc, unmounts, exitVelocities } = setup();
    crew.board(npc, vehicle(), "driver", "driver", true);

    const exit = new Vector3(12, 1, 5);
    const exitVelocity = new Vector3(4, 1, -2);
    const releaseSeat = vi.fn();
    expect(crew.leave(npc.id, exit, releaseSeat, exitVelocity)).toBe(true);

    crew.update(0.2);
    expect(unmounts).toHaveLength(0);
    expect(releaseSeat).not.toHaveBeenCalled();
    expect(npc.mesh.position.distanceTo(SEAT)).toBeGreaterThan(0.05);
    expect(crew.isAboard(npc.id)).toBe(true);

    for (let i = 0; i < 40; i += 1) crew.update(HZ_60);
    expect(unmounts).toHaveLength(1);
    expect(releaseSeat).toHaveBeenCalledTimes(1);
    expect(unmounts[0]?.distanceTo(exit)).toBeLessThan(0.001);
    expect(exitVelocities[0]?.distanceTo(exitVelocity)).toBeLessThan(0.001);
    expect(crew.isAboard(npc.id)).toBe(false);
  });

  it("bajar a alguien que no está a bordo no hace nada", () => {
    const { crew, npc } = setup();
    expect(crew.leave(npc.id, new Vector3())).toBe(false);
  });

  it("el conductor lleva las manos a los controles; el artillero no", () => {
    const driver = setup();
    driver.crew.board(driver.npc, vehicle(), "driver", "driver", true);
    const gunner = setup();
    gunner.crew.board(gunner.npc, vehicle(), "gunner", "gunner", true);

    expect(driver.poses.at(-1)?.handsOnControls).toBe(true);
    expect(gunner.poses.at(-1)?.handsOnControls).toBe(false);
  });

  it("si muere bajando, no lo arrastra hasta el exit", () => {
    const { crew, npc, unmounts, kill } = setup();
    crew.board(npc, vehicle(), "driver", "driver", true);
    crew.leave(npc.id, new Vector3(40, 1, 5));

    kill();
    crew.update(HZ_60);

    expect(crew.isAboard(npc.id)).toBe(false);
    expect(unmounts).toHaveLength(1);
    expect(unmounts[0]?.x).toBeLessThan(20);
  });

  it("suelta al ocupante que perdió el asiento por otra vía", () => {
    const { crew, npc } = setup();
    crew.board(npc, vehicle(), "driver", "driver", true);

    npc.setVehicleMounted?.(false);
    crew.update(HZ_60);

    expect(crew.isAboard(npc.id)).toBe(false);
  });
});

function setup(start = new Vector3(10.4, 1, 5)): {
  crew: VehicleCrewVisuals;
  npc: INpc;
  poses: NpcSeatPose[];
  unmounts: Vector3[];
  exitVelocities: Vector3[];
  kill: () => void;
} {
  const poses: NpcSeatPose[] = [];
  const unmounts: Vector3[] = [];
  const exitVelocities: Vector3[] = [];
  const mesh = new Group();
  mesh.position.copy(start);
  let mounted = true;
  let alive = true;
  const npc = {
    id: "crew-1",
    mesh,
    position: start.clone(),
    isAlive: () => alive,
    setVehicleMounted: (
      value: boolean,
      exitPosition?: Vector3,
      exitVelocity?: Vector3,
    ) => {
      mounted = value;
      if (!value && exitPosition) unmounts.push(exitPosition.clone());
      if (!value && exitVelocity) exitVelocities.push(exitVelocity.clone());
    },
    isVehicleMounted: () => mounted,
    setSeatPose: (pose: NpcSeatPose) => {
      poses.push({ ...pose, position: pose.position.clone() });
      mesh.position.copy(pose.position);
      mesh.quaternion.copy(pose.rotation);
    },
  } as unknown as INpc;
  return {
    crew: new VehicleCrewVisuals(),
    npc,
    poses,
    unmounts,
    exitVelocities,
    kill: () => {
      alive = false;
    },
  };
}

/** Asiento fijo: alcanza con la pose que consulta `VehicleCrewVisuals`. */
function vehicle(): VehicleEntity {
  return {
    getSeatWorldPose: (
      _seatId: string,
      outPosition: Vector3,
      outRotation: Quaternion,
    ) => {
      outPosition.copy(SEAT);
      outRotation.identity();
      return true;
    },
  } as unknown as VehicleEntity;
}
