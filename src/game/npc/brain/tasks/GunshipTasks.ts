import { Vector3 } from "three";
import type { Task, TaskStatus } from "@engine/ai/brain/Task";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";

type NpcTask = Task<NpcBrainContext>;

export interface GunshipOrbitProfile {
  minRadius: number;
  maxRadius: number;
  minHeight: number;
  maxHeight: number;
  orbitSpeed: number;
}

const DEFAULT_ORBIT: GunshipOrbitProfile = {
  minRadius: 22,
  maxRadius: 30,
  minHeight: 10,
  maxHeight: 14,
  orbitSpeed: 0.28,
};

const tmpAim = new Vector3();
const tmpTarget = new Vector3();

export function createGunshipEngageTask(profile: GunshipOrbitProfile = DEFAULT_ORBIT): NpcTask {
  let side = 1;
  let radius = 26;
  let height = 12;
  let orbitAngle = 0;

  return {
    id: "gunshipEngage",
    init: (ctx) => {
      side = Math.random() < 0.5 ? -1 : 1;
      radius = lerp(profile.minRadius, profile.maxRadius, Math.random());
      height = lerp(profile.minHeight, profile.maxHeight, Math.random());
      const threat = ctx.threat?.position ?? ctx.threatLastKnown ?? ctx.self.position;
      orbitAngle = Math.atan2(ctx.self.position.x - threat.x, ctx.self.position.z - threat.z);
    },
    tick: (ctx): TaskStatus => {
      const threat = ctx.threat;
      if (!threat?.isAlive) {
        ctx.locomotion.stop();
        return "failure";
      }
      orbitAngle += side * profile.orbitSpeed * ctx.delta;
      tmpTarget.set(
        threat.position.x + Math.sin(orbitAngle) * radius,
        threat.position.y + height,
        threat.position.z + Math.cos(orbitAngle) * radius,
      );
      tmpAim.copy(threat.position);
      tmpAim.y += 1;
      ctx.locomotion.moveTo(tmpTarget, { gait: "walk", facing: tmpAim });
      ctx.combat.aim(threat.position);
      ctx.combat.tryFire();
      return "running";
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

export function createGunshipEvadeTask(safeRadius = 24, retreatRadius = 32, height = 14): NpcTask {
  let target = new Vector3();
  return {
    id: "gunshipEvade",
    init: () => {},
    tick: (ctx): TaskStatus => {
      const threat = ctx.threat;
      if (!threat?.isAlive) {
        ctx.locomotion.stop();
        return "failure";
      }
      const dx = ctx.self.position.x - threat.position.x;
      const dz = ctx.self.position.z - threat.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= safeRadius) {
        ctx.locomotion.stop();
        return "success";
      }
      const inv = dist > 0.001 ? 1 / dist : 1;
      const dirX = dist > 0.001 ? dx * inv : Math.sin(ctx.elapsed);
      const dirZ = dist > 0.001 ? dz * inv : Math.cos(ctx.elapsed);
      target.set(
        threat.position.x + dirX * retreatRadius,
        threat.position.y + height,
        threat.position.z + dirZ * retreatRadius,
      );
      tmpAim.copy(threat.position);
      tmpAim.y += 1;
      ctx.locomotion.moveTo(target, { gait: "sprint", facing: tmpAim });
      ctx.combat.aim(threat.position);
      ctx.combat.tryFire();
      return "running";
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

export function createGunshipSearchTask(duration = 4.0, radius = 16, height = 12): NpcTask {
  let elapsed = 0;
  let angle = 0;
  return {
    id: "gunshipSearch",
    init: (ctx) => {
      elapsed = 0;
      const lkp = ctx.threatLastKnown ?? ctx.self.position;
      angle = Math.atan2(ctx.self.position.x - lkp.x, ctx.self.position.z - lkp.z);
    },
    tick: (ctx): TaskStatus => {
      const lkp = ctx.threatLastKnown;
      if (!lkp) {
        ctx.locomotion.stop();
        return "success";
      }
      elapsed += ctx.delta;
      if (elapsed >= duration) {
        ctx.locomotion.stop();
        return "success";
      }
      angle += 0.38 * ctx.delta;
      tmpTarget.set(
        lkp.x + Math.sin(angle) * radius,
        lkp.y + height,
        lkp.z + Math.cos(angle) * radius,
      );
      ctx.locomotion.moveTo(tmpTarget, { gait: "walk", facing: lkp });
      ctx.combat.scan?.();
      return "running";
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

export function createGunshipPatrolTask(height = 12): NpcTask {
  let index = 0;
  let dwell = 0;
  return {
    id: "gunshipPatrol",
    init: () => {
      dwell = 0;
    },
    tick: (ctx): TaskStatus => {
      const route = ctx.patrolRoute;
      if (!route || route.length === 0) {
        ctx.locomotion.stop();
        return "failure";
      }
      if (index >= route.length) index = 0;
      if (dwell > 0) {
        dwell -= ctx.delta;
        return "running";
      }
      const point = route[index];
      tmpTarget.set(point.x, point.y + height, point.z);
      ctx.locomotion.moveTo(tmpTarget, { gait: "walk" });
      if (ctx.locomotion.distanceToTarget() <= 2.5) {
        ctx.locomotion.stop();
        index = (index + 1) % route.length;
        dwell = 1.2;
      }
      return "running";
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

export const GunshipIdleTask: NpcTask = {
  id: "gunshipIdle",
  init: (ctx) => ctx.locomotion.stop(),
  tick: () => "running",
  abort: () => {},
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
