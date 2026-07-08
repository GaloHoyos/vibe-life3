import { Vector3 } from "three";
import type { Task, TaskStatus } from "@engine/ai/brain/Task";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";

type NpcTask = Task<NpcBrainContext>;

const MIN_RANGE = 28;
const MAX_RANGE = 45;
const IDEAL_RANGE = 36;
const STRAFE_SPEED = 0.18;
const SEARCH_DURATION = 5;

const tmpTarget = new Vector3();
const tmpAim = new Vector3();

export function createStriderCloseTask(retreatRadius = 24): NpcTask {
  return {
    id: "striderClose",
    init: () => {},
    tick: (ctx): TaskStatus => {
      const threat = ctx.threat;
      if (!threat?.isAlive) {
        ctx.locomotion.stop();
        return "failure";
      }

      tmpAim.copy(threat.position);
      tmpAim.y += 1;
      ctx.combat.aim(threat.position);

      if (ctx.combat.canUseIntent?.("melee")) {
        ctx.locomotion.stop();
        ctx.locomotion.face(tmpAim);
        ctx.combat.setIntent?.("melee");
        ctx.combat.tryFire();
        return "running";
      }

      const dx = ctx.self.position.x - threat.position.x;
      const dz = ctx.self.position.z - threat.position.z;
      const dist = Math.max(0.001, Math.hypot(dx, dz));
      tmpTarget.set(
        threat.position.x + (dx / dist) * retreatRadius,
        threat.position.y,
        threat.position.z + (dz / dist) * retreatRadius,
      );
      ctx.locomotion.moveTo(tmpTarget, { gait: "sprint", facing: tmpAim });
      ctx.combat.setIntent?.("primary");
      ctx.combat.tryFire();
      return "running";
    },
    abort: (ctx) => {
      ctx.locomotion.stop();
      ctx.combat.setIntent?.("primary");
    },
  };
}

export function createStriderEngageTask(): NpcTask {
  let side = 1;
  let orbitAngle = 0;

  return {
    id: "striderEngage",
    init: (ctx) => {
      side = Math.random() < 0.5 ? -1 : 1;
      const threat = ctx.threat?.position ?? ctx.threatLastKnown ?? ctx.self.position;
      orbitAngle = Math.atan2(ctx.self.position.x - threat.x, ctx.self.position.z - threat.z);
    },
    tick: (ctx): TaskStatus => {
      const threat = ctx.threat;
      if (!threat?.isAlive) {
        ctx.locomotion.stop();
        return "failure";
      }

      tmpAim.copy(threat.position);
      tmpAim.y += 1;
      ctx.combat.aim(threat.position);

      if (ctx.combat.canUseIntent?.("secondary")) {
        ctx.locomotion.stop();
        ctx.locomotion.face(tmpAim);
        ctx.combat.setIntent?.("secondary");
        ctx.combat.tryFire();
        return "running";
      }

      orbitAngle += side * STRAFE_SPEED * ctx.delta;
      const dx = ctx.self.position.x - threat.position.x;
      const dz = ctx.self.position.z - threat.position.z;
      const dist = Math.max(0.001, Math.hypot(dx, dz));
      let radius = Math.max(MIN_RANGE, Math.min(MAX_RANGE, dist));
      if (dist < MIN_RANGE) radius = IDEAL_RANGE;
      if (dist > MAX_RANGE) radius = IDEAL_RANGE;
      tmpTarget.set(
        threat.position.x + Math.sin(orbitAngle) * radius,
        threat.position.y,
        threat.position.z + Math.cos(orbitAngle) * radius,
      );
      if (dist < MIN_RANGE || dist > MAX_RANGE) {
        tmpTarget.set(
          threat.position.x + (dx / dist) * IDEAL_RANGE,
          threat.position.y,
          threat.position.z + (dz / dist) * IDEAL_RANGE,
        );
      }

      ctx.locomotion.moveTo(tmpTarget, { gait: "walk", facing: tmpAim });
      ctx.combat.setIntent?.("primary");
      ctx.combat.tryFire();
      return "running";
    },
    abort: (ctx) => {
      ctx.locomotion.stop();
      ctx.combat.setIntent?.("primary");
    },
  };
}

export function createStriderSearchTask(): NpcTask {
  let elapsed = 0;
  let angle = 0;

  return {
    id: "striderSearch",
    init: (ctx) => {
      elapsed = 0;
      const lkp = ctx.threatLastKnown ?? ctx.self.position;
      angle = Math.atan2(ctx.self.position.x - lkp.x, ctx.self.position.z - lkp.z);
      ctx.combat.setIntent?.("primary");
    },
    tick: (ctx): TaskStatus => {
      const lkp = ctx.threatLastKnown;
      if (!lkp) {
        ctx.locomotion.stop();
        return "success";
      }
      elapsed += ctx.delta;
      if (elapsed >= SEARCH_DURATION) {
        ctx.locomotion.stop();
        return "success";
      }
      angle += 0.12 * ctx.delta;
      tmpTarget.set(
        lkp.x + Math.sin(angle) * 10,
        lkp.y,
        lkp.z + Math.cos(angle) * 10,
      );
      ctx.locomotion.moveTo(tmpTarget, { gait: "walk", facing: lkp });
      ctx.combat.scan?.();
      return "running";
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

export function createStriderPatrolTask(): NpcTask {
  let index = 0;
  let dwell = 0;

  return {
    id: "striderPatrol",
    init: () => {
      dwell = 0;
    },
    tick: (ctx): TaskStatus => {
      const route = ctx.patrolRoute;
      if (!route || route.length === 0) {
        ctx.locomotion.stop();
        return "failure";
      }
      if (dwell > 0) {
        dwell -= ctx.delta;
        return "running";
      }
      if (index >= route.length) index = 0;
      const point = route[index];
      ctx.locomotion.moveTo(point, { gait: "walk" });
      if (ctx.locomotion.distanceToTarget() <= 3) {
        ctx.locomotion.stop();
        index = (index + 1) % route.length;
        dwell = 1.5;
      }
      return "running";
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

export const StriderIdleTask: NpcTask = {
  id: "striderIdle",
  init: (ctx) => ctx.locomotion.stop(),
  tick: () => "running",
  abort: () => {},
};
