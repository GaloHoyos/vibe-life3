import { Vector3 } from 'three';
import type { Task, TaskStatus } from '@engine/ai/brain/Task';
import { task } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';

type NpcTask = Task<NpcBrainContext>;

/**
 * Wait estatico: success tras `duration` segundos. Util para schedules de
 * Idle / Alert / Investigate.
 */
export function createWaitTask(duration: number): NpcTask {
  let remaining = duration;
  return {
    id: 'wait',
    init: () => {
      remaining = duration;
    },
    tick: (ctx) => {
      remaining -= ctx.delta;
      return remaining <= 0 ? 'success' : 'running';
    },
    abort: () => {},
  };
}

/**
 * Encara al threat actual. Falla si no hay threat — el caller debe
 * encolarla cuando `SeeEnemy` o `LostEnemy` esten activos.
 */
export const FaceThreatTask: NpcTask = task<NpcBrainContext>('faceThreat', (ctx) => {
  const target = ctx.threat?.position ?? ctx.threatLastKnown;
  if (!target) return 'failure';
  ctx.locomotion.face(target);
  return 'success';
});

/**
 * Mueve al NPC hacia el threat (su posicion actual o lastKnown). Success
 * cuando esta dentro de `tolerance` (default 1.5 m). Failure si no hay
 * threat ni memoria.
 */
export function createMoveToThreatTask(tolerance = 1.5, gait: 'walk' | 'sprint' = 'walk'): NpcTask {
  return {
    id: 'moveToThreat',
    init: () => {},
    tick: (ctx): TaskStatus => {
      const target = ctx.threat?.position ?? ctx.threatLastKnown;
      if (!target) {
        ctx.locomotion.stop();
        return 'failure';
      }
      ctx.locomotion.moveTo(target, { gait });
      if (ctx.locomotion.distanceToTarget() <= tolerance) {
        ctx.locomotion.stop();
        return 'success';
      }
      if (ctx.locomotion.isStuck()) return 'failure';
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

const tmpVec = new Vector3();

/**
 * Mueve a un punto fijo, capturado al `init`. Usado por tasks de patrol /
 * cover / sweep que requieren un destino estable.
 */
export function createMoveToPointTask(
  resolver: (ctx: NpcBrainContext) => Vector3 | null,
  tolerance = 1.0,
): NpcTask {
  let target: Vector3 | null = null;
  return {
    id: 'moveToPoint',
    init: (ctx) => {
      const resolved = resolver(ctx);
      target = resolved ? tmpVec.copy(resolved).clone() : null;
    },
    tick: (ctx): TaskStatus => {
      if (!target) return 'failure';
      ctx.locomotion.moveTo(target);
      if (ctx.locomotion.distanceToTarget() <= tolerance) {
        ctx.locomotion.stop();
        return 'success';
      }
      if (ctx.locomotion.isStuck()) return 'failure';
      return 'running';
    },
    abort: (ctx) => {
      target = null;
      ctx.locomotion.stop();
    },
  };
}

/**
 * Apunta al threat por hasta `settle` segundos antes de devolver success.
 * Si pierde el threat o entra en cover_blown, falla.
 */
export function createAimTask(settle: number): NpcTask {
  let elapsed = 0;
  return {
    id: 'aim',
    init: () => {
      elapsed = 0;
    },
    tick: (ctx): TaskStatus => {
      const target = ctx.threat?.position;
      if (!target) return 'failure';
      ctx.combat.aim(target);
      elapsed += ctx.delta;
      return elapsed >= settle ? 'success' : 'running';
    },
    abort: () => {},
  };
}

/**
 * Dispara una rafaga. Success cuando el subsistema combat reporta que
 * arranco el fire (la duracion de la rafaga la maneja el combat por
 * separado y el siguiente tick lo refleja). Failure si magazine vacio.
 */
export const FireBurstTask: NpcTask = task<NpcBrainContext>('fireBurst', (ctx) => {
  if (ctx.combat.magazineEmpty()) return 'failure';
  if (!ctx.threat) return 'failure';
  ctx.combat.aim(ctx.threat.position);
  ctx.combat.tryFire();
  return 'success';
});

/**
 * Recarga el arma. Success cuando el combat reporta listo.
 */
export const ReloadWeaponTask: NpcTask = {
  id: 'reload',
  init: (ctx) => ctx.combat.reload(),
  tick: (ctx) => (ctx.combat.isReloading() ? 'running' : 'success'),
  abort: () => {},
};

/**
 * Marca animacion de death. La transicion a `isAlive=false` la hace
 * `applyDamage` cuando la salud llega a 0; este task solo espera la
 * animacion para liberar el slot del schedule.
 */
export const PlayDeathTask: NpcTask = task<NpcBrainContext>('playDeath', () => 'success');

export function createFlinchTask(duration = 0.2): NpcTask {
  return createWaitTask(duration);
}
