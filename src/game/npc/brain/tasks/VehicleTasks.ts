import { Vector3 } from "three";
import type { Task } from "@engine/ai/brain/Task";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";

type NpcTask = Task<NpcBrainContext>;

/**
 * Moves an NPC to the entrance reserved by the vehicle coordinator. The task
 * only reports arrival; VehicleSystem remains responsible for revalidating
 * speed, distance, and availability before committing the seat.
 */
export function createApproachVehicleTask(): NpcTask {
  const projectedTarget = new Vector3();
  const lastRequestedTarget = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
  let hasProjection = false;

  return {
    id: "approachVehicle",
    init: () => {
      hasProjection = false;
      lastRequestedTarget.set(Number.POSITIVE_INFINITY, 0, 0);
    },
    tick: (ctx) => {
      const order = ctx.vehicleApproach;
      if (!order) {
        ctx.locomotion.stop();
        return "failure";
      }

      if (
        !hasProjection ||
        lastRequestedTarget.distanceToSquared(order.target) > 0.25
      ) {
        const projected = ctx.navigation.projectPoint(
          order.target,
          ctx.navigationProfile,
        );
        if (!projected) {
          order.setStatus("blocked");
          ctx.locomotion.stop();
          return "running";
        }
        projectedTarget.copy(projected);
        lastRequestedTarget.copy(order.target);
        hasProjection = true;
      }

      const dx = ctx.self.position.x - projectedTarget.x;
      const dz = ctx.self.position.z - projectedTarget.z;
      if (dx * dx + dz * dz <= order.arriveRadius * order.arriveRadius) {
        order.setStatus("arrived");
        ctx.locomotion.stop();
        ctx.locomotion.face(order.facing);
        return "running";
      }

      order.setStatus(ctx.locomotion.isStuck() ? "blocked" : "moving");
      ctx.locomotion.moveTo(projectedTarget, {
        gait: "sprint",
        facing: order.facing,
      });
      return "running";
    },
    abort: (ctx) => {
      ctx.locomotion.stop();
      ctx.vehicleApproach?.setStatus("moving");
    },
  };
}
