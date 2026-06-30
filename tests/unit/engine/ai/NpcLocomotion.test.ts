import { describe, expect, it, vi } from "vitest";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { NpcLocomotion } from "@engine/ai/locomotion/NpcLocomotion";
import type { NavSpace } from "@engine/ai/nav/NavSpace";
import type { PathRequestQueue } from "@engine/ai/nav/PathRequestQueue";
import type { NpcMotor } from "@engine/physics/character/NpcMotor";

describe("NpcLocomotion directGround", () => {
  it("steers directly without enqueueing humanoid paths", () => {
    const update = vi.fn<NpcMotor["update"]>();
    const pathQueue = {
      enqueue: vi.fn(),
      cancel: vi.fn(),
    } as unknown as PathRequestQueue;
    const motor = fakeMotor(update);
    const locomotion = new NpcLocomotion(
      motor,
      {} as NavSpace,
      pathQueue,
      "strider-1",
      { directGround: true, goalReachRadius: 1 },
    );

    const target = new Vector3(10, 0, 0);
    const facing = new Vector3(0, 0, 10);
    locomotion.moveTo(target, facing);
    locomotion.update(1 / 60);

    expect(pathQueue.enqueue).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toEqual(target);
    expect(update.mock.calls[0][2]).toBe(true);
    expect(update.mock.calls[0][3]).toEqual(facing);
  });
});

function fakeMotor(update: NpcMotor["update"]): NpcMotor {
  const position = new Vector3(0, 0, 0);
  return {
    body: {} as RAPIER.RigidBody,
    update,
    getPosition: () => position,
    getYaw: () => 0,
    getRotation: () => new Quaternion(),
    getVelocity: () => new Vector3(),
    syncFromPhysics: () => ({
      position,
      velocity: new Vector3(),
      desiredVelocity: new Vector3(),
      forward: new Vector3(0, 0, 1),
      grounded: true,
      yaw: 0,
      targetYaw: 0,
      distanceToTarget: 0,
    }),
    setSpeedMultiplier: vi.fn(),
    disable: vi.fn(),
    leapTo: vi.fn(),
    isLeaping: () => false,
    isIncapacitated: () => false,
    consumeImpactDamage: () => 0,
    reactToHit: vi.fn(),
    consumeSliceHits: () => [],
  };
}
