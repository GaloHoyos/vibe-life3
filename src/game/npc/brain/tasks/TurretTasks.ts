import type { Task, TaskStatus } from "@engine/ai/brain/Task";
import { has } from "@engine/ai/brain/Condition";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { Cond } from "@game/npc/brain/NpcConditions";

type NpcTask = Task<NpcBrainContext>;

/**
 * Tasks de la torreta de piso. Son delgadas: sólo le piden a `TurretCombat`
 * (`aim`/`tryFire`) hacia dónde apuntar y cuándo disparar; el deploy/spin-up, la
 * alineación, la cadencia y el thrash al volcarse los maneja el combat.
 */

/** Engage: encara y dispara al threat visible. Sale por los `interrupts` del schedule. */
export function createTurretEngageTask(): NpcTask {
  return {
    id: "turretEngage",
    init: () => {},
    tick: (ctx): TaskStatus => {
      const target = ctx.threat?.position;
      if (!target) return "failure";
      ctx.combat.aim(target);
      ctx.combat.tryFire();
      return "running";
    },
    abort: () => {},
  };
}

/**
 * Scan: perdió al enemigo (salió del cono o se rompió LOS). Barre el cono
 * izquierda↔derecha **sin disparar** mientras dura la memoria; al caducar, el
 * schedule deja de cumplirse y el brain cae a idle → la torreta se retrae y se
 * desactiva sola. No persigue al último punto conocido (no dispara a ciegas).
 */
export function createTurretScanTask(): NpcTask {
  return {
    id: "turretScan",
    init: () => {},
    tick: (ctx): TaskStatus => {
      // Memoria caducó → success: deja que el brain caiga a idle (se desactiva).
      if (!has(ctx.conditions, Cond.LostEnemy)) return "success";
      ctx.combat.scan?.();
      return "running";
    },
    abort: () => {},
  };
}

/**
 * Tipped: pide fuego cada tick (el `TurretCombat` decide thrash caótico vs
 * inerte según su timer). Termina cuando el cuerpo se reendereza.
 */
export const TurretTippedTask: NpcTask = {
  id: "turretTipped",
  init: () => {},
  tick: (ctx): TaskStatus => {
    if (!has(ctx.conditions, Cond.Tipped)) return "success";
    ctx.combat.tryFire();
    return "running";
  },
  abort: () => {},
};
