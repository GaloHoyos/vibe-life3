import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { createApproachVehicleTask } from "@game/npc/brain/tasks/VehicleTasks";

describe("VehicleTasks", () => {
  it("confirma llegada contra el punto navegable proyectado", () => {
    const status = vi.fn();
    const moveTo = vi.fn();
    const stop = vi.fn();
    const face = vi.fn();
    const projected = new Vector3(1, 0, 0);
    const context = {
      self: { position: projected.clone() },
      vehicleApproach: {
        vehicleId: "buggy",
        target: new Vector3(4, 0, 0),
        facing: new Vector3(0, 0, 1),
        arriveRadius: 0.9,
        setStatus: status,
      },
      navigation: {
        projectPoint: () => projected.clone(),
      },
      navigationProfile: {},
      locomotion: {
        moveTo,
        stop,
        face,
        isStuck: () => false,
      },
    } as unknown as NpcBrainContext;
    const task = createApproachVehicleTask();

    task.init(context);
    expect(task.tick(context)).toBe("running");

    expect(status).toHaveBeenLastCalledWith("arrived");
    expect(stop).toHaveBeenCalledOnce();
    expect(face).toHaveBeenCalledOnce();
    expect(moveTo).not.toHaveBeenCalled();
  });
});
